import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { companies, contacts, deals, pipelineStages } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { conflict, invalid, notFound } from "@/server/platform/errors";
import { isOwnOnly, require as requirePerm, type AuthContext } from "@/server/modules/identity/context";
import { recordSystemActivity } from "@/server/modules/workforce/activities.service";
import { assertVersion, diff, isForeignKeyViolation, isUniqueViolation, likePattern, ownerCondition } from "@/server/modules/_shared/helpers";
import { companyInput, companyListQuery, companyUpdate, type CompanyInput } from "@/shared/schemas/crm";

export async function listCompanies(ctx: AuthContext, rawQuery: unknown) {
  const scope = requirePerm(ctx, "company.read");
  const q = companyListQuery.parse(rawQuery);
  return withTenant(ctx, async (tx) => {
    const where = and(
      isNull(companies.deletedAt),
      ownerCondition(ctx, scope, companies.ownerId),
      q.ownerId ? eq(companies.ownerId, q.ownerId) : undefined,
      q.q
        ? or(
            ilike(companies.name, likePattern(q.q)),
            ilike(companies.domain, likePattern(q.q)),
            ilike(companies.industry, likePattern(q.q)),
          )
        : undefined,
    );
    const contactCount = sql<number>`(select count(*)::int from ${contacts} where ${contacts.companyId} = ${companies.id} and ${contacts.deletedAt} is null)`;
    const [items, [{ total }]] = await Promise.all([
      tx
        .select({
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          industry: companies.industry,
          size: companies.size,
          city: companies.city,
          country: companies.country,
          ownerId: companies.ownerId,
          tags: companies.tags,
          version: companies.version,
          updatedAt: companies.updatedAt,
          contactCount,
        })
        .from(companies)
        .where(where)
        .orderBy(asc(sql`lower(${companies.name})`), asc(companies.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx.select({ total: sql<number>`count(*)::int` }).from(companies).where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}

export async function getCompany(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "company.read");
  z.string().uuid().parse(id);
  return withTenant(ctx, async (tx) => {
    const [company] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), isNull(companies.deletedAt), ownerCondition(ctx, scope, companies.ownerId)));
    if (!company) throw notFound("Company");

    const contactScope = ctx.permissions["contact.read"];
    const people = contactScope
      ? await tx
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            jobTitle: contacts.jobTitle,
          })
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, id),
              isNull(contacts.deletedAt),
              isOwnOnly(contactScope) ? eq(contacts.ownerId, ctx.userId) : undefined,
            ),
          )
          .orderBy(asc(contacts.firstName))
      : [];

    const dealScope = ctx.permissions["deal.read"];
    const companyDeals = dealScope
      ? await tx
          .select({
            id: deals.id,
            title: deals.title,
            amount: deals.amount,
            currency: deals.currency,
            status: deals.status,
            stageName: pipelineStages.name,
          })
          .from(deals)
          .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
          .where(
            and(
              eq(deals.companyId, id),
              isNull(deals.deletedAt),
              isOwnOnly(dealScope) ? eq(deals.ownerId, ctx.userId) : undefined,
            ),
          )
          .orderBy(desc(deals.updatedAt))
      : [];

    return { ...company, contacts: people, deals: companyDeals };
  });
}

export async function createCompany(ctx: AuthContext, input: CompanyInput) {
  requirePerm(ctx, "company.write");
  const data = companyInput.parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(companies)
        .values({ ...data, organizationId: ctx.organizationId, createdBy: ctx.userId, ownerId: data.ownerId ?? ctx.userId })
        .returning();
      await recordSystemActivity(tx, ctx, { companyId: row.id, subject: "Company created" });
      await audit(tx, ctx, { action: "company.created", entityType: "company", entityId: row.id, summary: row.name });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A company with this domain already exists");
    if (isForeignKeyViolation(e)) throw invalid("The selected owner does not exist in this organization");
    throw e;
  }
}

export async function updateCompany(ctx: AuthContext, id: string, input: unknown) {
  const scope = requirePerm(ctx, "company.write");
  const { version, ...patch } = companyUpdate.parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.id, id), isNull(companies.deletedAt), ownerCondition(ctx, scope, companies.ownerId)));
      if (!before) throw notFound("Company");
      assertVersion(before.version, version, "company");
      const [row] = await tx
        .update(companies)
        .set({ ...patch, updatedAt: new Date(), version: before.version + 1 })
        .where(and(eq(companies.id, id), eq(companies.version, before.version)))
        .returning();
      if (!row) throw conflict("This company was changed by someone else. Reload to see the latest version.");
      await audit(tx, ctx, { action: "company.updated", entityType: "company", entityId: id, changes: diff(before, patch) });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A company with this domain already exists");
    if (isForeignKeyViolation(e)) throw invalid("The selected owner does not exist in this organization");
    throw e;
  }
}

export async function deleteCompany(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "company.delete");
  await withTenant(ctx, async (tx) => {
    const res = await tx
      .update(companies)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(companies.id, id), isNull(companies.deletedAt), ownerCondition(ctx, scope, companies.ownerId)))
      .returning({ id: companies.id });
    if (res.length === 0) throw notFound("Company");
    await audit(tx, ctx, { action: "company.deleted", entityType: "company", entityId: id });
  });
}
