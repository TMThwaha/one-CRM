import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { createContact, listContacts } from "@/server/modules/crm/contacts.service";
import { createLead, listLeads } from "@/server/modules/crm/leads.service";
import { resolveAuthContext } from "@/server/modules/identity/auth.service";
import { createRole, deleteRole, updateRole } from "@/server/modules/identity/roles.service";
import { createInvitation, listRoles, updateMember } from "@/server/modules/identity/team.service";
import { PERMISSION_GROUPS, PERMISSIONS, SCOPED_PERMISSIONS, covers, setPermission, validatePermissionSet, withDependencies, type Permission } from "@/shared/permissions";
import { addMember, signUpOrg, startTestDatabase, type Rows } from "./support/harness";

let handle: DatabaseHandle;
beforeAll(async () => {
  handle = await startTestDatabase();
});
afterAll(async () => {
  await handle.close();
});

const reader = { name: "Contact Reader", description: "Can look, not touch", permissions: { "contact.read": "all", "company.read": "all" } };
const roleId = async (ctx: Awaited<ReturnType<typeof signUpOrg>>["ctx"], key: string) => (await listRoles(ctx)).find((r) => r.key === key)!.id;

describe("permission model (pure rules)", () => {
  it("only offers 'own' for permissions the services really scope, and groups every permission once", () => {
    for (const p of SCOPED_PERMISSIONS) expect(p).toMatch(/^(contact|company|lead|deal|task)\./);
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(Object.keys(PERMISSIONS).sort()); // nothing missing from the editor
  });

  it("validates keys, scopes and dependencies", () => {
    expect(validatePermissionSet({ "contact.read": "all", "contact.write": "all" })).toEqual([]);
    expect(validatePermissionSet({ "contact.write": "all" })[0]).toMatch(/also needs/);
    expect(validatePermissionSet({ "contact.read": "own", "contact.write": "all" })[0]).toMatch(/at least the records/);
    expect(validatePermissionSet({ "contact.read": "all", "contact.write": "own" })).toEqual([]);
    expect(validatePermissionSet({ "org.manage": "own" })[0]).toMatch(/cannot be limited/);
    expect(validatePermissionSet({ "nope.read": "all" })[0]).toMatch(/Unknown permission/);
    expect(validatePermissionSet({ "contact.read": "everyone" })[0]).toMatch(/scope must be/);
    expect(validatePermissionSet({ "role.manage": "all" })[0]).toMatch(/also needs/);
  });

  it("withDependencies repairs a set and covers() compares breadth", () => {
    const fixed = withDependencies({ "deal.write": "own", "pipeline.manage": "all" });
    expect(fixed).toMatchObject({ "deal.read": "all", "deal.write": "own" }); // read widened to cover pipeline.manage
    expect(validatePermissionSet(fixed)).toEqual([]);
    expect(covers({ "contact.read": "all" }, { "contact.read": "own" })).toBe(true);
    expect(covers({ "contact.read": "own" }, { "contact.read": "all" })).toBe(false);
    expect(covers({}, { "contact.read": "own" })).toBe(false);
  });
});

describe("creating, assigning and editing a custom role", () => {
  it("a Company Admin defines a role; assigning it limits what the person can do, immediately", async () => {
    const o = await signUpOrg("Roles");
    const role = await createRole(o.ctx, reader);
    expect(role).toMatchObject({ key: "custom_contact_reader", name: "Contact Reader" });
    const listed = (await listRoles(o.ctx)).find((r) => r.id === role.id)!;
    expect(listed).toMatchObject({ isSystem: false, memberCount: 0, description: "Can look, not touch" });
    expect(listed.permissions.map((p) => p.permission).sort()).toEqual(["company.read", "contact.read"]);

    const m = await addMember(o.ctx, "Rita Reader", role.key);
    expect(m.ctx.roleName).toBe("Contact Reader");
    expect((await listRoles(o.ctx)).find((r) => r.id === role.id)!.memberCount).toBe(1);
    await createContact(o.ctx, { firstName: "Visible" });
    expect((await listContacts(m.ctx, {})).items.map((c) => c.firstName)).toEqual(["Visible"]);
    await expect(createContact(m.ctx, { firstName: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listLeads(m.ctx, {})).rejects.toMatchObject({ code: "forbidden" }); // nothing beyond the role

    // Edit the role: the member's very next request reflects it, with no re-login.
    await updateRole(o.ctx, role.id, { ...reader, permissions: { ...reader.permissions, "contact.write": "all" } });
    const after = (await resolveAuthContext(m.token))!;
    expect((await createContact(after, { firstName: "Allowed" })).firstName).toBe("Allowed");
    await updateRole(o.ctx, role.id, reader);
    await expect(createContact((await resolveAuthContext(m.token))!, { firstName: "Again" })).rejects.toMatchObject({ code: "forbidden" });

    const log = await withTenant(o.ctx, (tx) => tx.execute(sql`select action, changes from audit_logs where action like 'role.%' order by created_at`));
    const rows = (log as unknown as Rows).rows;
    expect(rows.map((r) => r.action)).toEqual(["role.created", "role.updated", "role.updated"]);
    expect(rows[1].changes.added).toEqual(["contact.write"]);
    expect(rows[2].changes.removed).toEqual(["contact.write"]);
  });

  it("record scope works end to end: an 'own records' role sees only its own leads", async () => {
    const o = await signUpOrg("OwnScope");
    const role = await createRole(o.ctx, { name: "Own Leads", permissions: { "lead.read": "own", "lead.write": "own", "contact.read": "all" } });
    const m = await addMember(o.ctx, "Olly Own", role.key);
    await createLead(o.ctx, { firstName: "Admins" });
    await createLead(m.ctx, { firstName: "Mine" });
    expect((await listLeads(m.ctx, {})).items.map((l) => l.firstName)).toEqual(["Mine"]);
    expect((await listLeads(o.ctx, {})).items.map((l) => l.firstName).sort()).toEqual(["Admins", "Mine"]);
  });

  it("rejects incoherent or invented permission sets, even from a hand-made request", async () => {
    const o = await signUpOrg("Validation");
    const bad = async (name: string, permissions: Record<string, string>) => expect(createRole(o.ctx, { name, permissions }), name).rejects.toMatchObject({ code: "validation_failed" });
    await bad("Write only", { "contact.write": "all" });
    await bad("Broad write", { "contact.read": "own", "contact.write": "all" });
    await bad("Invented", { "contact.read": "all", "root.access": "all" });
    await bad("Bad scope", { "org.manage": "own" });
    await bad("Nothing", {});
    await expect(createRole(o.ctx, { name: "x", permissions: { "contact.read": "all" } })).rejects.toThrow(); // name too short
  });

  it("names are unique per company and keys never collide", async () => {
    const o = await signUpOrg("Naming");
    const a = await createRole(o.ctx, { name: "Field Team", permissions: { "task.read": "all" } });
    await expect(createRole(o.ctx, { name: "field team", permissions: { "task.read": "all" } })).rejects.toMatchObject({ code: "conflict" });
    await expect(createRole(o.ctx, { name: "Admin", permissions: { "task.read": "all" } })).rejects.toMatchObject({ code: "conflict" }); // a system role's name
    const b = await createRole(o.ctx, { name: "Field-Team", permissions: { "task.read": "all" } });
    expect([a.key, b.key]).toEqual(["custom_field_team", "custom_field_team_2"]);
  });
});

describe("privilege escalation is impossible through roles", () => {
  it("only a Company Admin can manage roles; the delegated Admin and everyone else cannot", async () => {
    const o = await signUpOrg("Gate");
    expect(o.ctx.permissions["role.manage"]).toBe("all");
    for (const key of ["admin", "manager", "sales", "viewer"]) {
      const m = await addMember(o.ctx, `Gate ${key}`, key);
      expect(m.ctx.permissions["role.manage"], key).toBeUndefined();
      await expect(createRole(m.ctx, reader), key).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("a delegate can define roles but never grant more than they hold, nor touch stronger roles", async () => {
    const o = await signUpOrg("Delegate");
    const powerful = await createRole(o.ctx, { name: "Powerful", permissions: { "contact.read": "all", "contact.write": "all", "member.read": "all" } });
    const delegateRole = await createRole(o.ctx, { name: "Role Delegate", permissions: { "role.read": "all", "role.manage": "all", "contact.read": "all" } });
    const d = await addMember(o.ctx, "Dee Delegate", delegateRole.key);

    await expect(createRole(d.ctx, { name: "Sneaky", permissions: { "contact.read": "all", "contact.write": "all" } })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createRole(d.ctx, { name: "Sneakier", permissions: { "contact.read": "all", "org.manage": "all" } })).rejects.toMatchObject({ code: "forbidden" });
    const ok = await createRole(d.ctx, { name: "Within Means", permissions: { "contact.read": "all" } });
    expect(ok.key).toBe("custom_within_means");

    // Cannot edit or delete a role that is stronger than themselves, and cannot widen their own role.
    await expect(updateRole(d.ctx, powerful.id, { name: "Powerful", permissions: { "contact.read": "all" } })).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteRole(d.ctx, powerful.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateRole(d.ctx, delegateRole.id, { name: "Role Delegate", permissions: { "role.read": "all", "role.manage": "all", "contact.read": "all", "contact.write": "all" } })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("system roles are immutable", async () => {
    const o = await signUpOrg("System");
    const ownerRole = await roleId(o.ctx, "owner");
    await expect(updateRole(o.ctx, ownerRole, reader)).rejects.toMatchObject({ code: "conflict" });
    await expect(deleteRole(o.ctx, ownerRole)).rejects.toMatchObject({ code: "conflict" });
    await expect(deleteRole(o.ctx, await roleId(o.ctx, "sales"))).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("deleting roles", () => {
  it("is blocked while people or live invitations use the role, then allowed", async () => {
    const o = await signUpOrg("Delete");
    const role = await createRole(o.ctx, reader);
    const m = await addMember(o.ctx, "Dan Member", role.key);
    await expect(deleteRole(o.ctx, role.id)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("1 person has this role") });

    await updateMember(o.ctx, m.ctx.membershipId, { roleKey: "viewer" });
    await createInvitation(o.ctx, { email: "pending-delete@example.test", roleKey: role.key });
    await expect(deleteRole(o.ctx, role.id)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("pending invitation") });

    await handle.db.execute(sql`update invitations set revoked_at = now() where lower(email) = 'pending-delete@example.test'`);
    await deleteRole(o.ctx, role.id); // spent invitations (accepted + revoked) are removed with it
    expect((await listRoles(o.ctx)).some((r) => r.id === role.id)).toBe(false);
    const left = ((await handle.db.execute(sql`select count(*)::int as n from roles where id = ${role.id}`)) as unknown as Rows).rows[0].n;
    expect(left).toBe(0);
    const log = await withTenant(o.ctx, (tx) => tx.execute(sql`select action from audit_logs where action = 'role.deleted'`));
    expect((log as unknown as Rows).rows).toHaveLength(1);
  });
});

describe("tenant isolation for roles", () => {
  it("another company cannot see, edit or delete my role", async () => {
    const a = await signUpOrg("RoleA");
    const b = await signUpOrg("RoleB");
    const role = await createRole(a.ctx, reader);
    expect((await listRoles(b.ctx)).some((r) => r.id === role.id)).toBe(false);
    await expect(updateRole(b.ctx, role.id, reader)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteRole(b.ctx, role.id)).rejects.toMatchObject({ code: "not_found" });
    // The same name in another company is fine: names are per company.
    expect((await createRole(b.ctx, reader)).key).toBe("custom_contact_reader");
    expect((await listRoles(a.ctx)).find((r) => r.id === role.id)).toBeTruthy();
  });
});

describe("migration 0007: existing companies get role.manage on their Company Admin role", () => {
  it("backfills owners only, and is idempotent", async () => {
    const o = await signUpOrg("Backfill");
    const ownerRole = await roleId(o.ctx, "owner");
    const adminRole = await roleId(o.ctx, "admin");
    await handle.db.execute(sql`delete from role_permissions where role_id = ${ownerRole} and permission = 'role.manage'`);
    const migration = fs.readFileSync("drizzle/0007_role_manage_permission.sql", "utf8");
    await handle.db.execute(sql.raw(migration));
    await handle.db.execute(sql.raw(migration)); // running it twice changes nothing
    const has = async (id: string) => ((await handle.db.execute(sql`select count(*)::int as n from role_permissions where role_id = ${id} and permission = 'role.manage'`)) as unknown as Rows).rows[0].n;
    expect(await has(ownerRole)).toBe(1);
    expect(await has(adminRole)).toBe(0);
    const fresh = (await resolveAuthContext(o.token))!;
    expect(fresh.permissions["role.manage"]).toBe("all");
    expect(Object.keys(fresh.permissions as Record<Permission, string>)).toHaveLength(Object.keys(PERMISSIONS).length);
  });
});

describe("role editor helper", () => {
  it("keeps a permission set valid through every kind of edit", () => {
    const base = { "contact.read": "all", "contact.write": "all", "contact.delete": "all" } as const;
    // removing the base removes what is built on it
    expect(setPermission({ ...base }, "contact.read", null)).toEqual({});
    // narrowing the base narrows what is built on it
    expect(setPermission({ ...base }, "contact.read", "own")).toEqual({ "contact.read": "own", "contact.write": "own", "contact.delete": "own" });
    // adding a dependent adds what it needs, at the same breadth
    expect(setPermission({}, "deal.write", "own")).toEqual({ "deal.read": "own", "deal.write": "own" });
    // transitive: role.manage needs role.read, removing role.read removes role.manage
    expect(setPermission({ "role.read": "all", "role.manage": "all" }, "role.read", null)).toEqual({});
    for (const m of [setPermission({}, "lead.convert", "all"), setPermission({ ...base }, "contact.write", "own")]) expect(validatePermissionSet(m)).toEqual([]);
  });
});
