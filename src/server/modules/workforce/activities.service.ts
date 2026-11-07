import "server-only";
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import {
  activities,
  companies,
  contacts,
  dealContacts,
  deals,
  leads,
  users,
} from "@/server/db/schema";
import { withTenant, type Tx } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { invalid, notFound } from "@/server/platform/errors";
import { isOwnOnly, require as requirePerm, type AuthContext } from "@/server/modules/identity/context";
import { activityInput, type ActivityInput } from "@/shared/schemas/workforce";

export interface RecordLinks {
  contactId?: string | null;
  companyId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
}

/**
 * A user may only attach work to records they are allowed to see. Same rule as reading them:
 * a sales rep with `own` scope cannot log an activity on a colleague's deal.
 */
export async function assertLinksVisible(tx: Tx, ctx: AuthContext, l: RecordLinks): Promise<void> {
  if (l.contactId) {
    const scope = requirePerm(ctx, "contact.read");
    const [r] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, l.contactId),
          isNull(contacts.deletedAt),
          isOwnOnly(scope) ? eq(contacts.ownerId, ctx.userId) : undefined,
        ),
      );
    if (!r) throw invalid("The linked contact was not found");
  }
  if (l.companyId) {
    const scope = requirePerm(ctx, "company.read");
    const [r] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(
        and(
          eq(companies.id, l.companyId),
          isNull(companies.deletedAt),
          isOwnOnly(scope) ? eq(companies.ownerId, ctx.userId) : undefined,
        ),
      );
    if (!r) throw invalid("The linked company was not found");
  }
  if (l.leadId) {
    const scope = requirePerm(ctx, "lead.read");
    const [r] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.id, l.leadId),
          isNull(leads.deletedAt),
          isOwnOnly(scope) ? eq(leads.ownerId, ctx.userId) : undefined,
        ),
      );
    if (!r) throw invalid("The linked lead was not found");
  }
  if (l.dealId) {
    const scope = requirePerm(ctx, "deal.read");
    const [r] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(
          eq(deals.id, l.dealId),
          isNull(deals.deletedAt),
          isOwnOnly(scope) ? eq(deals.ownerId, ctx.userId) : undefined,
        ),
      );
    if (!r) throw invalid("The linked deal was not found");
  }
}

/** Timeline entries produced by the platform itself (stage moves, conversions, creation...). */
export async function recordSystemActivity(
  tx: Tx,
  ctx: AuthContext,
  entry: RecordLinks & { subject: string; metadata?: Record<string, unknown> },
) {
  await tx.insert(activities).values({
    organizationId: ctx.organizationId,
    type: "system",
    subject: entry.subject,
    metadata: entry.metadata ?? {},
    contactId: entry.contactId ?? null,
    companyId: entry.companyId ?? null,
    leadId: entry.leadId ?? null,
    dealId: entry.dealId ?? null,
    createdBy: ctx.userId,
  });
}

export async function createActivity(ctx: AuthContext, input: ActivityInput) {
  requirePerm(ctx, "activity.write");
  const data = activityInput.parse(input);
  return withTenant(ctx, async (tx) => {
    await assertLinksVisible(tx, ctx, data);
    const [row] = await tx
      .insert(activities)
      .values({
        organizationId: ctx.organizationId,
        type: data.type,
        subject: data.subject,
        body: data.body,
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
        durationMinutes: data.durationMinutes ?? null,
        contactId: data.contactId,
        companyId: data.companyId,
        leadId: data.leadId,
        dealId: data.dealId,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "activity.created", entityType: "activity", entityId: row.id, summary: `${data.type}: ${data.subject}` });
    return row;
  });
}

export async function deleteActivity(ctx: AuthContext, id: string) {
  requirePerm(ctx, "activity.write");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(activities).where(eq(activities.id, id));
    if (!row || row.type === "system") throw notFound("Activity"); // system events are immutable
    if (row.createdBy !== ctx.userId && ctx.permissions["member.manage"] === undefined) {
      throw notFound("Activity");
    }
    await assertLinksVisible(tx, ctx, row);
    await tx.delete(activities).where(eq(activities.id, id));
    await audit(tx, ctx, { action: "activity.deleted", entityType: "activity", entityId: id });
  });
}

/** Visibility of an activity follows the visibility of the deal / lead it is attached to. */
function visibilityFilter(ctx: AuthContext): SQL {
  const parts: SQL[] = [];

  const dealScope = ctx.permissions["deal.read"];
  if (!dealScope) parts.push(isNull(activities.dealId));
  else if (isOwnOnly(dealScope)) {
    parts.push(
      or(
        isNull(activities.dealId),
        inArray(
          activities.dealId,
          sql`(select ${deals.id} from ${deals} where ${deals.ownerId} = ${ctx.userId})`,
        ),
      )!,
    );
  }

  const leadScope = ctx.permissions["lead.read"];
  if (!leadScope) parts.push(isNull(activities.leadId));
  else if (isOwnOnly(leadScope)) {
    parts.push(
      or(
        isNull(activities.leadId),
        inArray(
          activities.leadId,
          sql`(select ${leads.id} from ${leads} where ${leads.ownerId} = ${ctx.userId})`,
        ),
      )!,
    );
  }

  if (!ctx.permissions["contact.read"]) parts.push(isNull(activities.contactId));
  if (!ctx.permissions["company.read"]) parts.push(isNull(activities.companyId));
  return and(...parts) ?? sql`true`;
}

export type TimelineTarget =
  | { kind: "contact"; id: string }
  | { kind: "company"; id: string }
  | { kind: "lead"; id: string }
  | { kind: "deal"; id: string };

/**
 * The connected customer timeline. A contact's timeline includes activity on the deals they
 * participate in; a company's includes its contacts' and deals' activity.
 */
export async function getTimeline(
  ctx: AuthContext,
  target: TimelineTarget,
  opts: { before?: string; limit?: number } = {},
) {
  requirePerm(ctx, "activity.read");
  const limit = Math.min(opts.limit ?? 30, 100);

  let match: SQL;
  switch (target.kind) {
    case "contact":
      match = or(
        eq(activities.contactId, target.id),
        inArray(
          activities.dealId,
          sql`(select ${dealContacts.dealId} from ${dealContacts} where ${dealContacts.contactId} = ${target.id})`,
        ),
      )!;
      break;
    case "company":
      match = or(
        eq(activities.companyId, target.id),
        inArray(
          activities.contactId,
          sql`(select ${contacts.id} from ${contacts} where ${contacts.companyId} = ${target.id})`,
        ),
        inArray(
          activities.dealId,
          sql`(select ${deals.id} from ${deals} where ${deals.companyId} = ${target.id})`,
        ),
      )!;
      break;
    case "lead":
      match = eq(activities.leadId, target.id);
      break;
    case "deal":
      match = eq(activities.dealId, target.id);
      break;
  }

  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: activities.id,
        type: activities.type,
        subject: activities.subject,
        body: activities.body,
        occurredAt: activities.occurredAt,
        durationMinutes: activities.durationMinutes,
        metadata: activities.metadata,
        contactId: activities.contactId,
        companyId: activities.companyId,
        leadId: activities.leadId,
        dealId: activities.dealId,
        createdBy: activities.createdBy,
        authorName: users.name,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.createdBy))
      .where(
        and(
          match,
          visibilityFilter(ctx),
          opts.before ? lt(activities.occurredAt, new Date(opts.before)) : undefined,
        ),
      )
      .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items,
      nextBefore: hasMore ? items[items.length - 1].occurredAt.toISOString() : null,
    };
  });
}
