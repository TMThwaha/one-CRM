import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { companies, contacts, dealContacts, deals, pipelineStages, tasks } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { emit } from "@/server/jobs/emit";
import { conflict, invalid, notFound } from "@/server/platform/errors";
import { require as requirePerm, isOwnOnly, type AuthContext } from "@/server/modules/identity/context";
import { recordSystemActivity } from "@/server/modules/workforce/activities.service";
import { assertVersion, diff, isForeignKeyViolation, isUniqueViolation, likePattern, ownerCondition } from "@/server/modules/_shared/helpers";
import { contactInput, contactListQuery, contactUpdate, type ContactInput } from "@/shared/schemas/crm";
import { z } from "zod";

const columns = {
  id: contacts.id,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  email: contacts.email,
  phone: contacts.phone,
  jobTitle: contacts.jobTitle,
  companyId: contacts.companyId,
  companyName: companies.name,
  ownerId: contacts.ownerId,
  source: contacts.source,
  tags: contacts.tags,
  createdAt: contacts.createdAt,
  updatedAt: contacts.updatedAt,
  version: contacts.version,
};

export async function listContacts(ctx: AuthContext, rawQuery: unknown) {
  const scope = requirePerm(ctx, "contact.read");
  const q = contactListQuery.parse(rawQuery);
  return withTenant(ctx, async (tx) => {
    const where = and(
      isNull(contacts.deletedAt),
      ownerCondition(ctx, scope, contacts.ownerId),
      q.companyId ? eq(contacts.companyId, q.companyId) : undefined,
      q.ownerId ? eq(contacts.ownerId, q.ownerId) : undefined,
      q.q
        ? or(
            ilike(sql`concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})`, likePattern(q.q)),
            ilike(contacts.email, likePattern(q.q)),
            ilike(contacts.phone, likePattern(q.q)),
            ilike(companies.name, likePattern(q.q)),
          )
        : undefined,
    );
    const base = tx.select(columns).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId));
    const [items, [{ total }]] = await Promise.all([
      base
        .where(where)
        .orderBy(asc(sql`lower(${contacts.firstName})`), asc(contacts.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(contacts)
        .leftJoin(companies, eq(companies.id, contacts.companyId))
        .where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}

/** Customer 360: the contact plus the records and work connected to it. */
export async function getContact(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "contact.read");
  z.string().uuid().parse(id);
  return withTenant(ctx, async (tx) => {
    const [contact] = await tx
      .select(columns)
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt), ownerCondition(ctx, scope, contacts.ownerId)));
    if (!contact) throw notFound("Contact");

    // Related deals respect the actor's deal visibility, not the contact's.
    const dealScope = ctx.permissions["deal.read"];
    const relatedDeals = dealScope
      ? await tx
          .select({
            id: deals.id,
            title: deals.title,
            amount: deals.amount,
            currency: deals.currency,
            status: deals.status,
            stageName: pipelineStages.name,
            role: dealContacts.role,
          })
          .from(dealContacts)
          .innerJoin(deals, eq(deals.id, dealContacts.dealId))
          .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
          .where(
            and(
              eq(dealContacts.contactId, id),
              isNull(deals.deletedAt),
              isOwnOnly(dealScope) ? eq(deals.ownerId, ctx.userId) : undefined,
            ),
          )
          .orderBy(desc(deals.updatedAt))
      : [];

    const taskScope = ctx.permissions["task.read"];
    const openTasks = taskScope
      ? await tx
          .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority })
          .from(tasks)
          .where(
            and(
              eq(tasks.contactId, id),
              eq(tasks.status, "open"),
              isNull(tasks.deletedAt),
              isOwnOnly(taskScope) ? eq(tasks.assigneeId, ctx.userId) : undefined,
            ),
          )
          .orderBy(asc(tasks.dueAt))
          .limit(20)
      : [];

    return { ...contact, deals: relatedDeals, openTasks };
  });
}

async function findDuplicateByEmail(tx: Parameters<Parameters<typeof withTenant>[1]>[0], email: string, exceptId?: string) {
  const [dup] = await tx
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(
      and(
        sql`lower(${contacts.email}) = ${email}`,
        isNull(contacts.deletedAt),
        exceptId ? sql`${contacts.id} <> ${exceptId}` : undefined,
      ),
    );
  return dup;
}

export async function createContact(ctx: AuthContext, input: ContactInput) {
  requirePerm(ctx, "contact.write");
  const data = contactInput.parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      if (data.email) {
        const dup = await findDuplicateByEmail(tx, data.email);
        if (dup) {
          throw conflict(`A contact with this email already exists (${[dup.firstName, dup.lastName].filter(Boolean).join(" ")})`, {
            existingContactId: dup.id,
          });
        }
      }
      const [row] = await tx
        .insert(contacts)
        .values({ ...data, organizationId: ctx.organizationId, createdBy: ctx.userId, ownerId: data.ownerId ?? ctx.userId })
        .returning();
      await recordSystemActivity(tx, ctx, { contactId: row.id, subject: "Contact created" });
      await audit(tx, ctx, { action: "contact.created", entityType: "contact", entityId: row.id, summary: `${row.firstName} ${row.lastName ?? ""}`.trim() });
      await emit(tx, ctx, { type: "contact.created", entityType: "contact", entityId: row.id });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A contact with this email already exists");
    if (isForeignKeyViolation(e)) throw invalid("The selected company or owner does not exist in this organization");
    throw e;
  }
}

export async function updateContact(ctx: AuthContext, id: string, input: unknown) {
  const scope = requirePerm(ctx, "contact.write");
  const { version, ...patch } = contactUpdate.parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), isNull(contacts.deletedAt), ownerCondition(ctx, scope, contacts.ownerId)));
      if (!before) throw notFound("Contact");
      assertVersion(before.version, version, "contact");

      if (patch.email && patch.email !== before.email?.toLowerCase()) {
        if (await findDuplicateByEmail(tx, patch.email, id)) throw conflict("A contact with this email already exists");
      }
      const [row] = await tx
        .update(contacts)
        .set({ ...patch, updatedAt: new Date(), version: before.version + 1 })
        .where(and(eq(contacts.id, id), eq(contacts.version, before.version)))
        .returning();
      if (!row) throw conflict("This contact was changed by someone else. Reload to see the latest version.");
      await audit(tx, ctx, { action: "contact.updated", entityType: "contact", entityId: id, changes: diff(before, patch) });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A contact with this email already exists");
    if (isForeignKeyViolation(e)) throw invalid("The selected company or owner does not exist in this organization");
    throw e;
  }
}

export async function deleteContact(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "contact.delete");
  await withTenant(ctx, async (tx) => {
    const res = await tx
      .update(contacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt), ownerCondition(ctx, scope, contacts.ownerId)))
      .returning({ id: contacts.id });
    if (res.length === 0) throw notFound("Contact");
    await audit(tx, ctx, { action: "contact.deleted", entityType: "contact", entityId: id });
  });
}
