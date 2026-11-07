import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { companies, contacts, deals, leads, tasks } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { isOwnOnly, type AuthContext } from "@/server/modules/identity/context";
import { likePattern } from "@/server/modules/_shared/helpers";

export interface SearchResult {
  type: "contact" | "company" | "lead" | "deal" | "task";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * Cross-module search. Every branch applies the SAME permission and record-scope rules as the
 * module's own list endpoint - search must never be a side door around authorization.
 */
export async function globalSearch(ctx: AuthContext, rawQuery: string, limitPerType = 5): Promise<SearchResult[]> {
  const q = rawQuery.trim().slice(0, 100);
  if (q.length < 2) return [];
  const pattern = likePattern(q);
  const own = (scope: "all" | "team" | "own" | undefined) => scope !== undefined && isOwnOnly(scope);

  return withTenant(ctx, async (tx) => {
    const jobs: Promise<SearchResult[]>[] = [];

    const cs = ctx.permissions["contact.read"];
    if (cs)
      jobs.push(
        tx
          .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, email: contacts.email, title: contacts.jobTitle })
          .from(contacts)
          .where(
            and(
              isNull(contacts.deletedAt),
              own(cs) ? eq(contacts.ownerId, ctx.userId) : undefined,
              or(
                ilike(sql`concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})`, pattern),
                ilike(contacts.email, pattern),
                ilike(contacts.phone, pattern),
              ),
            ),
          )
          .orderBy(asc(contacts.firstName))
          .limit(limitPerType)
          .then((r) =>
            r.map((x) => ({
              type: "contact" as const,
              id: x.id,
              title: [x.first, x.last].filter(Boolean).join(" "),
              subtitle: x.email ?? x.title,
              href: `/contacts/${x.id}`,
            })),
          ),
      );

    const co = ctx.permissions["company.read"];
    if (co)
      jobs.push(
        tx
          .select({ id: companies.id, name: companies.name, domain: companies.domain })
          .from(companies)
          .where(
            and(
              isNull(companies.deletedAt),
              own(co) ? eq(companies.ownerId, ctx.userId) : undefined,
              or(ilike(companies.name, pattern), ilike(companies.domain, pattern)),
            ),
          )
          .orderBy(asc(companies.name))
          .limit(limitPerType)
          .then((r) => r.map((x) => ({ type: "company" as const, id: x.id, title: x.name, subtitle: x.domain, href: `/companies/${x.id}` }))),
      );

    const ls = ctx.permissions["lead.read"];
    if (ls)
      jobs.push(
        tx
          .select({ id: leads.id, first: leads.firstName, last: leads.lastName, company: leads.companyName })
          .from(leads)
          .where(
            and(
              isNull(leads.deletedAt),
              own(ls) ? eq(leads.ownerId, ctx.userId) : undefined,
              or(
                ilike(sql`concat_ws(' ', ${leads.firstName}, ${leads.lastName})`, pattern),
                ilike(leads.email, pattern),
                ilike(leads.companyName, pattern),
              ),
            ),
          )
          .orderBy(desc(leads.score))
          .limit(limitPerType)
          .then((r) =>
            r.map((x) => ({
              type: "lead" as const,
              id: x.id,
              title: [x.first, x.last].filter(Boolean).join(" "),
              subtitle: x.company,
              href: `/leads?open=${x.id}`,
            })),
          ),
      );

    const ds = ctx.permissions["deal.read"];
    if (ds)
      jobs.push(
        tx
          .select({ id: deals.id, title: deals.title, status: deals.status })
          .from(deals)
          .where(
            and(
              isNull(deals.deletedAt),
              own(ds) ? eq(deals.ownerId, ctx.userId) : undefined,
              ilike(deals.title, pattern),
            ),
          )
          .orderBy(desc(deals.updatedAt))
          .limit(limitPerType)
          .then((r) => r.map((x) => ({ type: "deal" as const, id: x.id, title: x.title, subtitle: x.status, href: `/deals/${x.id}` }))),
      );

    const ts = ctx.permissions["task.read"];
    if (ts)
      jobs.push(
        tx
          .select({ id: tasks.id, title: tasks.title, status: tasks.status })
          .from(tasks)
          .where(
            and(
              isNull(tasks.deletedAt),
              own(ts) ? sql`(${tasks.assigneeId} = ${ctx.userId} or ${tasks.createdBy} = ${ctx.userId})` : undefined,
              ilike(tasks.title, pattern),
            ),
          )
          .orderBy(desc(tasks.createdAt))
          .limit(limitPerType)
          .then((r) => r.map((x) => ({ type: "task" as const, id: x.id, title: x.title, subtitle: x.status, href: `/tasks?open=${x.id}` }))),
      );

    // Queries share one transaction/connection and run sequentially under the hood.
    const results: SearchResult[] = [];
    for (const j of jobs) results.push(...(await j));
    return results;
  });
}
