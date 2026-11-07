import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { createCompany } from "@/server/modules/crm/companies.service";
import { createContact, deleteContact, getContact, listContacts, updateContact } from "@/server/modules/crm/contacts.service";
import { createDeal, getBoard, getDeal, listDeals } from "@/server/modules/sales/deals.service";
import { createTask, listTasks } from "@/server/modules/workforce/tasks.service";
import { getTimeline } from "@/server/modules/workforce/activities.service";
import { globalSearch } from "@/server/modules/platform/search.service";
import { listAuditLogs } from "@/server/modules/platform/audit.service";
import { listMembers } from "@/server/modules/identity/team.service";
import type { AuthContext } from "@/server/modules/identity/context";
import { signUpOrg, startTestDatabase } from "./support/harness";
import type { Rows } from "./support/harness";

let handle: DatabaseHandle;
let a: AuthContext;
let b: AuthContext;
let aContactId: string;
let aCompanyId: string;
let aDealId: string;

beforeAll(async () => {
  handle = await startTestDatabase();
  a = (await signUpOrg("Alpha")).ctx;
  b = (await signUpOrg("Bravo")).ctx;

  const company = await createCompany(a, { name: "Acme Corp", domain: "acme.test" });
  aCompanyId = company.id;
  const contact = await createContact(a, { firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test", companyId: company.id });
  aContactId = contact.id;
  const deal = await createDeal(a, { title: "Acme rollout", amount: "125000.50", companyId: company.id, contactIds: [contact.id] });
  aDealId = deal.id;
  await createTask(a, { title: "Call Ada", contactId: contact.id });
  await createContact(b, { firstName: "Bob", email: "bob@bravo.test" });
});

afterAll(async () => {
  await handle.close();
});

describe("tenant isolation - application layer", () => {
  it("organizations have different ids", () => {
    expect(a.organizationId).not.toBe(b.organizationId);
  });

  it("org B cannot read org A's records by id", async () => {
    await expect(getContact(b, aContactId)).rejects.toMatchObject({ code: "not_found" });
    await expect(getDeal(b, aDealId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("org B cannot modify or delete org A's records", async () => {
    await expect(updateContact(b, aContactId, { firstName: "Hacked" })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteContact(b, aContactId)).rejects.toMatchObject({ code: "not_found" });
    const still = await getContact(a, aContactId);
    expect(still.firstName).toBe("Ada");
  });

  it("lists, boards, search, tasks, timelines and audit never cross tenants", async () => {
    const contactsB = await listContacts(b, {});
    expect(contactsB.items.map((c) => c.firstName)).toEqual(["Bob"]);
    expect((await listDeals(b, {})).total).toBe(0);
    expect((await getBoard(b)).stages.flatMap((s) => s.deals)).toHaveLength(0);
    expect((await listTasks(b, {})).total).toBe(0);
    expect(await globalSearch(b, "Ada")).toHaveLength(0);
    expect(await globalSearch(b, "Acme")).toHaveLength(0);
    expect((await getTimeline(b, { kind: "contact", id: aContactId })).items).toHaveLength(0);
    const auditB = await listAuditLogs(b, {});
    expect(auditB.items.every((x) => !/Acme|Ada/.test(x.summary ?? ""))).toBe(true);
    expect((await listMembers(b)).length).toBe(1);
  });

  it("org A can see its own data", async () => {
    expect((await globalSearch(a, "Ada")).some((r) => r.type === "contact")).toBe(true);
    expect((await listDeals(a, {})).items[0].amount).toBe("125000.50");
  });
});

describe("tenant isolation - database layer (RLS, even if app code is wrong)", () => {
  it("a tenant transaction with NO filter returns only its own rows", async () => {
    const rows = await withTenant(b, (tx) => tx.execute(sql`select first_name from contacts`));
    expect((rows as Rows).rows.map((r) => r.first_name)).toEqual(["Bob"]);
  });

  it("cannot insert a row into another organization (WITH CHECK)", async () => {
    await expect(
      withTenant(b, (tx) =>
        tx.execute(sql`insert into contacts (organization_id, first_name) values (${a.organizationId}, 'Injected')`),
      ),
    ).rejects.toThrow();
  });

  it("cannot update or delete another organization's rows (silently matches zero rows)", async () => {
    const upd = await withTenant(b, (tx) =>
      tx.execute(sql`update contacts set first_name = 'X' where id = ${aContactId} returning id`),
    );
    expect((upd as Rows).rows).toHaveLength(0);
    const del = await withTenant(b, (tx) => tx.execute(sql`delete from contacts where id = ${aContactId} returning id`));
    expect((del as Rows).rows).toHaveLength(0);
  });

  it("without an organization set, a tenant transaction sees nothing", async () => {
    const { db } = handle;
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role onecrm_app`);
      return tx.execute(sql`select id from contacts`);
    });
    expect((rows as Rows).rows).toHaveLength(0);
  });

  it("the app role cannot read password hashes or sessions", async () => {
    await expect(withTenant(a, (tx) => tx.execute(sql`select password_hash from users`))).rejects.toThrow();
    await expect(withTenant(a, (tx) => tx.execute(sql`select * from sessions`))).rejects.toThrow();
  });

  it("users of other organizations are invisible", async () => {
    const rows = await withTenant(b, (tx) => tx.execute(sql`select email from users`));
    expect((rows as Rows).rows.length).toBe(1);
  });

  it("audit log is append-only for the application role", async () => {
    await expect(withTenant(a, (tx) => tx.execute(sql`update audit_logs set action = 'tampered'`))).rejects.toThrow();
    await expect(withTenant(a, (tx) => tx.execute(sql`delete from audit_logs`))).rejects.toThrow();
  });
});

describe("tenant isolation - referential integrity (composite foreign keys)", () => {
  it("a record in org B cannot reference a company that belongs to org A", async () => {
    // Even the OWNING connection (which bypasses RLS) cannot create a cross-tenant reference.
    await expect(
      handle.db.execute(
        sql`insert into contacts (organization_id, first_name, company_id) values (${b.organizationId}, 'Cross', ${aCompanyId})`,
      ),
    ).rejects.toThrow();
  });

  it("a deal cannot use another organization's pipeline stage", async () => {
    const stage = await handle.db.execute(
      sql`select s.id, s.pipeline_id from pipeline_stages s where s.organization_id = ${a.organizationId} limit 1`,
    );
    const { id, pipeline_id } = (stage as Rows).rows[0] as { id: string; pipeline_id: string };
    await expect(
      handle.db.execute(
        sql`insert into deals (organization_id, title, pipeline_id, stage_id) values (${b.organizationId}, 'x', ${pipeline_id}, ${id})`,
      ),
    ).rejects.toThrow();
  });
});

describe("schema guard", () => {
  it("every table that carries organization_id has row-level security enabled", async () => {
    const res = await handle.db.execute(sql`
      select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join information_schema.columns col on col.table_name = c.relname and col.table_schema = 'public'
      where n.nspname = 'public' and c.relkind = 'r' and col.column_name = 'organization_id'
    `);
    const missing = ((res as Rows).rows as { relname: string; relrowsecurity: boolean }[])
      .filter((r) => !r.relrowsecurity)
      .map((r) => r.relname);
    expect(missing).toEqual([]);
  });
});
