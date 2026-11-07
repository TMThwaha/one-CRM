import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { companies, contacts, leads } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { conflict, invalid, notFound } from "@/server/platform/errors";
import { require as requirePerm, type AuthContext } from "@/server/modules/identity/context";
import { recordSystemActivity } from "@/server/modules/workforce/activities.service";
import { createDealInTx, resolveOwner } from "@/server/modules/sales/deals.service";
import { assertVersion, diff, isForeignKeyViolation, isUniqueViolation, likePattern, ownerCondition } from "@/server/modules/_shared/helpers";
import { leadConvertInput, leadInput, leadListQuery, leadUpdate, type LeadInput } from "@/shared/schemas/crm";
import { scoreLead } from "./lead-scoring";

export async function listLeads(ctx: AuthContext, rawQuery: unknown) {
  const scope = requirePerm(ctx, "lead.read");
  const q = leadListQuery.parse(rawQuery);
  return withTenant(ctx, async (tx) => {
    const where = and(
      isNull(leads.deletedAt),
      ownerCondition(ctx, scope, leads.ownerId),
      q.status ? eq(leads.status, q.status) : undefined,
      q.ownerId ? eq(leads.ownerId, q.ownerId) : undefined,
      q.q
        ? or(
            ilike(sql`concat_ws(' ', ${leads.firstName}, ${leads.lastName})`, likePattern(q.q)),
            ilike(leads.email, likePattern(q.q)),
            ilike(leads.companyName, likePattern(q.q)),
          )
        : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(leads)
        .where(where)
        .orderBy(desc(leads.score), desc(leads.createdAt), asc(leads.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx.select({ total: sql<number>`count(*)::int` }).from(leads).where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}

export async function getLead(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "lead.read");
  z.string().uuid().parse(id);
  return withTenant(ctx, async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt), ownerCondition(ctx, scope, leads.ownerId)));
    if (!lead) throw notFound("Lead");
    return lead;
  });
}

export async function createLead(ctx: AuthContext, input: LeadInput) {
  const scope = requirePerm(ctx, "lead.write");
  const data = leadInput.parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      const { score, reasons } = scoreLead(data);
      const [row] = await tx
        .insert(leads)
        .values({
          ...data,
          ownerId: resolveOwner(ctx, scope, data.ownerId),
          organizationId: ctx.organizationId,
          createdBy: ctx.userId,
          score,
          scoreReasons: reasons,
        })
        .returning();
      await recordSystemActivity(tx, ctx, { leadId: row.id, subject: "Lead created", metadata: { source: row.source } });
      await audit(tx, ctx, { action: "lead.created", entityType: "lead", entityId: row.id, summary: `${row.firstName} ${row.lastName ?? ""}`.trim() });
      return row;
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) throw invalid("The selected owner does not exist in this organization");
    throw e;
  }
}

export async function updateLead(ctx: AuthContext, id: string, input: unknown) {
  const scope = requirePerm(ctx, "lead.write");
  const { version, ...patch } = leadUpdate.parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), isNull(leads.deletedAt), ownerCondition(ctx, scope, leads.ownerId)));
      if (!before) throw notFound("Lead");
      assertVersion(before.version, version, "lead");
      if (before.status === "converted") throw conflict("A converted lead can no longer be edited. Edit the contact instead.");
      if (patch.status === "converted") throw invalid("Use the Convert action to convert a lead");
      if (patch.ownerId !== undefined && scope !== "all" && patch.ownerId !== ctx.userId) {
        throw invalid("You can only keep your own leads assigned to yourself");
      }
      const merged = { ...before, ...patch };
      const { score, reasons } = scoreLead(merged);
      const [row] = await tx
        .update(leads)
        .set({ ...patch, score, scoreReasons: reasons, updatedAt: new Date(), version: before.version + 1 })
        .where(and(eq(leads.id, id), eq(leads.version, before.version)))
        .returning();
      if (!row) throw conflict("This lead was changed by someone else. Reload to see the latest version.");
      if (patch.status && patch.status !== before.status) {
        await recordSystemActivity(tx, ctx, {
          leadId: id,
          subject: `Status changed from ${before.status} to ${patch.status}`,
          metadata: { from: before.status, to: patch.status },
        });
      }
      await audit(tx, ctx, { action: "lead.updated", entityType: "lead", entityId: id, changes: diff(before, patch) });
      return row;
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) throw invalid("The selected owner does not exist in this organization");
    throw e;
  }
}

export async function deleteLead(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "lead.delete");
  await withTenant(ctx, async (tx) => {
    const res = await tx
      .update(leads)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(leads.id, id), isNull(leads.deletedAt), ownerCondition(ctx, scope, leads.ownerId)))
      .returning({ id: leads.id });
    if (res.length === 0) throw notFound("Lead");
    await audit(tx, ctx, { action: "lead.deleted", entityType: "lead", entityId: id });
  });
}

/**
 * Converts a lead into a contact (+ company, + optional deal) in ONE transaction. If the
 * lead's email already matches an existing contact, that contact is reused instead of
 * creating a duplicate customer record. History is carried over to the contact's timeline.
 */
export async function convertLead(ctx: AuthContext, id: string, input: unknown) {
  const leadScope = requirePerm(ctx, "lead.convert");
  requirePerm(ctx, "contact.write");
  const data = leadConvertInput.parse(input ?? {});
  if (data.createDeal) requirePerm(ctx, "deal.write");

  return withTenant(ctx, async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt), ownerCondition(ctx, leadScope, leads.ownerId)));
    if (!lead) throw notFound("Lead");
    if (lead.status === "converted") throw conflict("This lead has already been converted");

    // Reuse an existing company by name, else create one when the lead names a company.
    let companyId: string | null = null;
    if (lead.companyName && ctx.permissions["company.write"]) {
      const [existing] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(and(sql`lower(${companies.name}) = ${lead.companyName.toLowerCase()}`, isNull(companies.deletedAt)));
      if (existing) companyId = existing.id;
      else {
        const [c] = await tx
          .insert(companies)
          .values({ organizationId: ctx.organizationId, name: lead.companyName, ownerId: ctx.userId, createdBy: ctx.userId })
          .returning({ id: companies.id });
        companyId = c.id;
        await recordSystemActivity(tx, ctx, { companyId, subject: "Company created from lead conversion" });
      }
    }

    let contactId: string | null = null;
    let reused = false;
    if (lead.email) {
      const [dup] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(sql`lower(${contacts.email}) = ${lead.email.toLowerCase()}`, isNull(contacts.deletedAt)));
      if (dup) {
        contactId = dup.id;
        reused = true;
      }
    }
    if (!contactId) {
      try {
        const [c] = await tx
          .insert(contacts)
          .values({
            organizationId: ctx.organizationId,
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            phone: lead.phone,
            jobTitle: lead.jobTitle,
            companyId,
            ownerId: lead.ownerId ?? ctx.userId,
            source: lead.source,
            tags: lead.tags,
            createdBy: ctx.userId,
          })
          .returning({ id: contacts.id });
        contactId = c.id;
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("A contact with this email already exists");
        throw e;
      }
    }

    let dealId: string | null = null;
    if (data.createDeal) {
      const deal = await createDealInTx(
        tx,
        ctx,
        {
          title: data.dealTitle ?? `${lead.companyName ?? lead.firstName} - opportunity`,
          amount: data.dealAmount ?? "0",
          pipelineId: data.pipelineId,
          companyId,
          contactIds: [contactId],
          ownerId: lead.ownerId ?? ctx.userId,
        },
        ctx.permissions["deal.write"] ?? "own",
      );
      dealId = deal.id;
    }

    await tx
      .update(leads)
      .set({
        status: "converted",
        convertedContactId: contactId,
        convertedDealId: dealId,
        convertedAt: new Date(),
        updatedAt: new Date(),
        version: lead.version + 1,
      })
      .where(eq(leads.id, id));

    const summary = reused ? "Lead converted (matched existing contact)" : "Lead converted to contact";
    await recordSystemActivity(tx, ctx, { leadId: id, contactId, subject: summary, metadata: { dealId, reusedContact: reused } });
    await audit(tx, ctx, { action: "lead.converted", entityType: "lead", entityId: id, changes: { contactId, dealId, companyId, reusedContact: reused } });
    return { contactId, companyId, dealId, reusedExistingContact: reused };
  });
}
