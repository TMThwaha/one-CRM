import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  companies,
  contacts,
  dealContacts,
  deals,
  organizations,
  pipelineStages,
  pipelines,
  users,
} from "@/server/db/schema";
import { withTenant, type Tx } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { conflict, invalid, notFound } from "@/server/platform/errors";
import { isOwnOnly, require as requirePerm, type AuthContext } from "@/server/modules/identity/context";
import { recordSystemActivity } from "@/server/modules/workforce/activities.service";
import { assertVersion, diff, isForeignKeyViolation, likePattern, ownerCondition } from "@/server/modules/_shared/helpers";
import type { Scope } from "@/shared/permissions";
import {
  dealContactInput,
  dealInput,
  dealListQuery,
  dealMoveInput,
  dealUpdate,
  pipelineInput,
  type DealInput,
} from "@/shared/schemas/sales";

/** Users limited to `own` scope can only create records owned by themselves. */
export function resolveOwner(ctx: AuthContext, scope: Scope, requested: string | null | undefined) {
  if (isOwnOnly(scope)) return ctx.userId;
  return requested ?? ctx.userId;
}

// ---------------------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------------------

export async function listPipelines(ctx: AuthContext) {
  requirePerm(ctx, "deal.read");
  return withTenant(ctx, async (tx) => {
    const ps = await tx
      .select()
      .from(pipelines)
      .where(isNull(pipelines.archivedAt))
      .orderBy(desc(pipelines.isDefault), asc(pipelines.name));
    const stages = await tx.select().from(pipelineStages).orderBy(asc(pipelineStages.position));
    return ps.map((p) => ({ ...p, stages: stages.filter((s) => s.pipelineId === p.id) }));
  });
}

export async function createPipeline(ctx: AuthContext, input: unknown) {
  requirePerm(ctx, "pipeline.manage");
  const data = pipelineInput.parse(input);
  if (!data.stages.some((s) => s.kind === "won") || !data.stages.some((s) => s.kind === "lost")) {
    throw invalid("A pipeline needs at least one Won stage and one Lost stage");
  }
  return withTenant(ctx, async (tx) => {
    const [p] = await tx.insert(pipelines).values({ organizationId: ctx.organizationId, name: data.name }).returning();
    await tx.insert(pipelineStages).values(
      data.stages.map((s, i) => ({
        organizationId: ctx.organizationId,
        pipelineId: p.id,
        name: s.name,
        position: i,
        probability: s.kind === "won" ? 100 : s.kind === "lost" ? 0 : s.probability,
        kind: s.kind,
      })),
    );
    await audit(tx, ctx, { action: "pipeline.created", entityType: "pipeline", entityId: p.id, summary: p.name });
    return p;
  });
}

// ---------------------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------------------

const dealColumns = {
  id: deals.id,
  title: deals.title,
  amount: deals.amount,
  currency: deals.currency,
  pipelineId: deals.pipelineId,
  stageId: deals.stageId,
  stageName: pipelineStages.name,
  stageKind: pipelineStages.kind,
  probability: deals.probability,
  status: deals.status,
  lostReason: deals.lostReason,
  expectedCloseDate: deals.expectedCloseDate,
  closedAt: deals.closedAt,
  ownerId: deals.ownerId,
  ownerName: users.name,
  companyId: deals.companyId,
  companyName: companies.name,
  tags: deals.tags,
  version: deals.version,
  createdAt: deals.createdAt,
  updatedAt: deals.updatedAt,
};

function dealsQuery(tx: Tx) {
  return tx
    .select(dealColumns)
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(users, eq(users.id, deals.ownerId));
}

export async function listDeals(ctx: AuthContext, rawQuery: unknown) {
  const scope = requirePerm(ctx, "deal.read");
  const q = dealListQuery.parse(rawQuery);
  return withTenant(ctx, async (tx) => {
    const where = and(
      isNull(deals.deletedAt),
      ownerCondition(ctx, scope, deals.ownerId),
      q.pipelineId ? eq(deals.pipelineId, q.pipelineId) : undefined,
      q.stageId ? eq(deals.stageId, q.stageId) : undefined,
      q.status ? eq(deals.status, q.status) : undefined,
      q.ownerId ? eq(deals.ownerId, q.ownerId) : undefined,
      q.companyId ? eq(deals.companyId, q.companyId) : undefined,
      q.q ? or(ilike(deals.title, likePattern(q.q)), ilike(companies.name, likePattern(q.q))) : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      dealsQuery(tx)
        .where(where)
        .orderBy(desc(deals.updatedAt), asc(deals.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(deals)
        .leftJoin(companies, eq(companies.id, deals.companyId))
        .where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}

/** Kanban data: every stage of a pipeline with its open/closed deals and exact totals. */
export async function getBoard(ctx: AuthContext, pipelineId?: string) {
  const scope = requirePerm(ctx, "deal.read");
  return withTenant(ctx, async (tx) => {
    const [pipeline] = pipelineId
      ? await tx.select().from(pipelines).where(and(eq(pipelines.id, pipelineId), isNull(pipelines.archivedAt)))
      : await tx.select().from(pipelines).where(isNull(pipelines.archivedAt)).orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt)).limit(1);
    if (!pipeline) throw notFound("Pipeline");

    const stages = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipeline.id))
      .orderBy(asc(pipelineStages.position));

    const rows = await dealsQuery(tx)
      .where(and(eq(deals.pipelineId, pipeline.id), isNull(deals.deletedAt), ownerCondition(ctx, scope, deals.ownerId)))
      .orderBy(desc(deals.updatedAt))
      .limit(1000);

    const [org] = await tx.select({ baseCurrency: organizations.baseCurrency }).from(organizations);

    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      baseCurrency: org?.baseCurrency ?? "INR",
      stages: stages.map((s) => ({
        ...s,
        deals: rows.filter((d) => d.stageId === s.id),
      })),
    };
  });
}

export async function getDeal(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "deal.read");
  z.string().uuid().parse(id);
  return withTenant(ctx, async (tx) => {
    const [deal] = await dealsQuery(tx).where(
      and(eq(deals.id, id), isNull(deals.deletedAt), ownerCondition(ctx, scope, deals.ownerId)),
    );
    if (!deal) throw notFound("Deal");
    const people = ctx.permissions["contact.read"]
      ? await tx
          .select({
            contactId: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            role: dealContacts.role,
            isPrimary: dealContacts.isPrimary,
          })
          .from(dealContacts)
          .innerJoin(contacts, eq(contacts.id, dealContacts.contactId))
          .where(and(eq(dealContacts.dealId, id), isNull(contacts.deletedAt)))
          .orderBy(desc(dealContacts.isPrimary), asc(contacts.firstName))
      : [];
    const stages = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, deal.pipelineId))
      .orderBy(asc(pipelineStages.position));
    return { ...deal, contacts: people, stages };
  });
}

export async function createDealInTx(tx: Tx, ctx: AuthContext, input: DealInput, scope: Scope) {
  const data = dealInput.parse(input);

  const [pipeline] = data.pipelineId
    ? await tx.select().from(pipelines).where(and(eq(pipelines.id, data.pipelineId), isNull(pipelines.archivedAt)))
    : await tx.select().from(pipelines).where(isNull(pipelines.archivedAt)).orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt)).limit(1);
  if (!pipeline) throw invalid("No pipeline is available. Create a pipeline first.");

  const [stage] = data.stageId
    ? await tx.select().from(pipelineStages).where(and(eq(pipelineStages.id, data.stageId), eq(pipelineStages.pipelineId, pipeline.id)))
    : await tx.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, pipeline.id), eq(pipelineStages.kind, "open"))).orderBy(asc(pipelineStages.position)).limit(1);
  if (!stage) throw invalid("That stage does not belong to the selected pipeline");

  const [org] = await tx.select({ baseCurrency: organizations.baseCurrency }).from(organizations);
  const terminal = stage.kind !== "open";

  const [deal] = await tx
    .insert(deals)
    .values({
      organizationId: ctx.organizationId,
      title: data.title,
      pipelineId: pipeline.id,
      stageId: stage.id,
      amount: data.amount,
      currency: data.currency ?? org?.baseCurrency ?? "INR",
      expectedCloseDate: data.expectedCloseDate,
      probability: stage.probability,
      status: stage.kind,
      closedAt: terminal ? new Date() : null,
      ownerId: resolveOwner(ctx, scope, data.ownerId),
      companyId: data.companyId,
      tags: data.tags,
      createdBy: ctx.userId,
    })
    .returning();

  if (data.contactIds.length > 0) {
    const visible = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(inArray(contacts.id, data.contactIds), isNull(contacts.deletedAt)));
    if (visible.length !== new Set(data.contactIds).size) throw invalid("One or more selected contacts were not found");
    await tx.insert(dealContacts).values(
      [...new Set(data.contactIds)].map((contactId, i) => ({
        organizationId: ctx.organizationId,
        dealId: deal.id,
        contactId,
        isPrimary: i === 0,
      })),
    );
  }

  await recordSystemActivity(tx, ctx, {
    dealId: deal.id,
    subject: `Deal created in ${stage.name}`,
    metadata: { stage: stage.name, amount: deal.amount, currency: deal.currency },
  });
  await audit(tx, ctx, { action: "deal.created", entityType: "deal", entityId: deal.id, summary: deal.title });
  return deal;
}

export async function createDeal(ctx: AuthContext, input: DealInput) {
  const scope = requirePerm(ctx, "deal.write");
  try {
    return await withTenant(ctx, (tx) => createDealInTx(tx, ctx, input, scope));
  } catch (e) {
    if (isForeignKeyViolation(e)) throw invalid("A selected company, contact or owner does not exist in this organization");
    throw e;
  }
}

export async function updateDeal(ctx: AuthContext, id: string, input: unknown) {
  const scope = requirePerm(ctx, "deal.write");
  const { version, ...patch } = dealUpdate.parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(deals)
        .where(and(eq(deals.id, id), isNull(deals.deletedAt), ownerCondition(ctx, scope, deals.ownerId)));
      if (!before) throw notFound("Deal");
      assertVersion(before.version, version, "deal");
      if (patch.ownerId !== undefined && isOwnOnly(scope) && patch.ownerId !== ctx.userId) {
        throw invalid("You can only keep your own deals assigned to yourself");
      }
      const [row] = await tx
        .update(deals)
        .set({ ...patch, updatedAt: new Date(), version: before.version + 1 })
        .where(and(eq(deals.id, id), eq(deals.version, before.version)))
        .returning();
      if (!row) throw conflict("This deal was changed by someone else. Reload to see the latest version.");
      await audit(tx, ctx, { action: "deal.updated", entityType: "deal", entityId: id, changes: diff(before, patch) });
      return row;
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) throw invalid("A selected company or owner does not exist in this organization");
    throw e;
  }
}

/** Moves a deal to another stage of its pipeline, deriving status and probability from the stage. */
export async function moveDeal(ctx: AuthContext, id: string, input: unknown) {
  const scope = requirePerm(ctx, "deal.write");
  const data = dealMoveInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const [before] = await tx
      .select({ deal: deals, stageName: pipelineStages.name })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(and(eq(deals.id, id), isNull(deals.deletedAt), ownerCondition(ctx, scope, deals.ownerId)));
    if (!before) throw notFound("Deal");
    assertVersion(before.deal.version, data.version, "deal");
    if (before.deal.stageId === data.stageId) return before.deal;

    const [stage] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.id, data.stageId), eq(pipelineStages.pipelineId, before.deal.pipelineId)));
    if (!stage) throw invalid("That stage does not belong to this deal's pipeline");
    if (stage.kind === "lost" && !data.lostReason) throw invalid("Please record why the deal was lost");

    const terminal = stage.kind !== "open";
    const [row] = await tx
      .update(deals)
      .set({
        stageId: stage.id,
        status: stage.kind,
        probability: stage.probability,
        lostReason: stage.kind === "lost" ? data.lostReason : null,
        closedAt: terminal ? new Date() : null,
        updatedAt: new Date(),
        version: before.deal.version + 1,
      })
      .where(and(eq(deals.id, id), eq(deals.version, before.deal.version)))
      .returning();
    if (!row) throw conflict("This deal was changed by someone else. Reload to see the latest version.");

    await recordSystemActivity(tx, ctx, {
      dealId: id,
      subject: `Moved from ${before.stageName} to ${stage.name}`,
      metadata: { from: before.stageName, to: stage.name, status: stage.kind, lostReason: data.lostReason ?? null },
    });
    await audit(tx, ctx, {
      action: "deal.stage_changed",
      entityType: "deal",
      entityId: id,
      changes: { stage: { from: before.stageName, to: stage.name } },
    });
    return row;
  });
}

export async function deleteDeal(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "deal.delete");
  await withTenant(ctx, async (tx) => {
    const res = await tx
      .update(deals)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(deals.id, id), isNull(deals.deletedAt), ownerCondition(ctx, scope, deals.ownerId)))
      .returning({ id: deals.id });
    if (res.length === 0) throw notFound("Deal");
    await audit(tx, ctx, { action: "deal.deleted", entityType: "deal", entityId: id });
  });
}

export async function addDealContact(ctx: AuthContext, dealId: string, input: unknown) {
  const scope = requirePerm(ctx, "deal.write");
  requirePerm(ctx, "contact.read");
  const data = dealContactInput.parse(input);
  try {
    await withTenant(ctx, async (tx) => {
      const [deal] = await tx
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.id, dealId), isNull(deals.deletedAt), ownerCondition(ctx, scope, deals.ownerId)));
      if (!deal) throw notFound("Deal");
      const [c] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, data.contactId), isNull(contacts.deletedAt)));
      if (!c) throw invalid("Contact not found");
      if (data.isPrimary) {
        await tx.update(dealContacts).set({ isPrimary: false }).where(eq(dealContacts.dealId, dealId));
      }
      await tx
        .insert(dealContacts)
        .values({ organizationId: ctx.organizationId, dealId, contactId: data.contactId, role: data.role, isPrimary: data.isPrimary })
        .onConflictDoUpdate({
          target: [dealContacts.dealId, dealContacts.contactId],
          set: { role: data.role, isPrimary: data.isPrimary },
        });
      await recordSystemActivity(tx, ctx, { dealId, contactId: data.contactId, subject: "Contact linked to deal" });
      await audit(tx, ctx, { action: "deal.contact_added", entityType: "deal", entityId: dealId, changes: { contactId: data.contactId } });
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) throw invalid("Contact not found");
    throw e;
  }
}

export async function removeDealContact(ctx: AuthContext, dealId: string, contactId: string) {
  const scope = requirePerm(ctx, "deal.write");
  await withTenant(ctx, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.id, dealId), isNull(deals.deletedAt), ownerCondition(ctx, scope, deals.ownerId)));
    if (!deal) throw notFound("Deal");
    await tx.delete(dealContacts).where(and(eq(dealContacts.dealId, dealId), eq(dealContacts.contactId, contactId)));
    await audit(tx, ctx, { action: "deal.contact_removed", entityType: "deal", entityId: dealId, changes: { contactId } });
  });
}
