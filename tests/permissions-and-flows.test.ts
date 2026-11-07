import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { login, logout, resolveAuthContext, switchOrganization, createAdditionalOrganization } from "@/server/modules/identity/auth.service";
import { createInvitation, acceptInvitation, previewInvitation, updateMember, revokeInvitation, listInvitations } from "@/server/modules/identity/team.service";
import { createCompany } from "@/server/modules/crm/companies.service";
import { createContact, getContact, listContacts, updateContact } from "@/server/modules/crm/contacts.service";
import { convertLead, createLead, getLead, listLeads, updateLead } from "@/server/modules/crm/leads.service";
import { createDeal, getBoard, getDeal, listDeals, moveDeal, listPipelines } from "@/server/modules/sales/deals.service";
import { createTask, listTasks, updateTask } from "@/server/modules/workforce/tasks.service";
import { createActivity, getTimeline } from "@/server/modules/workforce/activities.service";
import { globalSearch } from "@/server/modules/platform/search.service";
import { listAuditLogs } from "@/server/modules/platform/audit.service";
import { getDashboard } from "@/server/modules/platform/dashboard.service";
import type { AuthContext } from "@/server/modules/identity/context";
import { resetRateLimits } from "@/server/platform/rate-limit";
import { addMember, signUpOrg, startTestDatabase } from "./support/harness";
import type { Rows } from "./support/harness";

let handle: DatabaseHandle;
let owner: AuthContext;
let ownerEmail: string;
let rep1: AuthContext;
let rep2: AuthContext;
let viewer: AuthContext;
let rep1Token: string;

beforeAll(async () => {
  handle = await startTestDatabase();
  const o = await signUpOrg("Acme");
  owner = o.ctx;
  ownerEmail = o.email;
  const r1 = await addMember(owner, "Rep One", "sales");
  rep1 = r1.ctx;
  rep1Token = r1.token;
  rep2 = (await addMember(owner, "Rep Two", "sales")).ctx;
  viewer = (await addMember(owner, "Viewer", "viewer")).ctx;
});

afterAll(async () => {
  await handle.close();
});

describe("authentication & sessions", () => {
  it("logs in with correct credentials and rejects wrong ones with a generic error", async () => {
    await resetRateLimits();
    const ok = await login({ email: ownerEmail, password: "correct-horse-battery" }, { ip: "9.9.9.9" });
    expect(await resolveAuthContext(ok.token)).not.toBeNull();
    await expect(login({ email: ownerEmail, password: "wrong-password!!" }, { ip: "9.9.9.9" })).rejects.toMatchObject({
      code: "unauthenticated",
      message: "Invalid email or password",
    });
    await expect(login({ email: "nobody@example.test", password: "whatever-whatever" }, { ip: "9.9.9.9" })).rejects.toMatchObject({
      message: "Invalid email or password",
    });
  });

  it("locks the account after repeated failures", async () => {
    await resetRateLimits();
    const o = await signUpOrg("Locky");
    for (let i = 0; i < 5; i++) {
      await login({ email: o.email, password: "bad-password-bad" }, { ip: "8.8.8.8" }).catch(() => {});
    }
    await expect(login({ email: o.email, password: "correct-horse-battery" }, { ip: "8.8.8.8" })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("an expired session cannot access anything", async () => {
    const o = await signUpOrg("Expiry");
    expect(await resolveAuthContext(o.token)).not.toBeNull();
    await handle.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, o.ctx.sessionId));
    expect(await resolveAuthContext(o.token)).toBeNull();
  });

  it("a logged-out (revoked) session stops working immediately", async () => {
    const o = await signUpOrg("Logout");
    await logout(o.token);
    expect(await resolveAuthContext(o.token)).toBeNull();
  });

  it("garbage tokens resolve to nothing", async () => {
    expect(await resolveAuthContext("not-a-token")).toBeNull();
    expect(await resolveAuthContext(undefined)).toBeNull();
  });
});

describe("roles, invitations and privilege escalation", () => {
  it("assigns the invited role", () => {
    expect(rep1.roleKey).toBe("sales");
    expect(viewer.roleKey).toBe("viewer");
  });

  it("an invitation works exactly once and the token is not stored in clear", async () => {
    const { token } = await createInvitation(owner, { email: "once@example.test", roleKey: "viewer" });
    expect((await previewInvitation(token)).organizationName).toBe("Acme Inc");
    await acceptInvitation(token, { name: "Once", password: "correct-horse-battery" }, { ip: "1.1.1.1" });
    await expect(acceptInvitation(token, { name: "Once", password: "correct-horse-battery" }, { ip: "1.1.1.1" })).rejects.toMatchObject({ code: "not_found" });
    const rows = await handle.db.execute(`select token_hash from invitations`);
    expect(JSON.stringify((rows as Rows).rows)).not.toContain(token);
  });

  it("revoked invitations cannot be accepted", async () => {
    const { token, invitation } = await createInvitation(owner, { email: "revoked@example.test", roleKey: "viewer" });
    await revokeInvitation(owner, invitation.id);
    await expect(acceptInvitation(token, { name: "R", password: "correct-horse-battery" }, { ip: "1.1.1.2" })).rejects.toMatchObject({ code: "not_found" });
    expect((await listInvitations(owner)).some((i) => i.id === invitation.id)).toBe(false);
  });

  it("weak passwords are rejected when creating an account through an invitation", async () => {
    const { token } = await createInvitation(owner, { email: "weak@example.test", roleKey: "viewer" });
    await expect(acceptInvitation(token, { name: "Weak", password: "short" }, { ip: "1.1.1.3" })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("members without member.invite cannot invite; admins cannot mint owners", async () => {
    await expect(createInvitation(rep1, { email: "x@example.test", roleKey: "viewer" })).rejects.toMatchObject({ code: "forbidden" });
    const admin = await addMember(owner, "Admin", "admin");
    await expect(createInvitation(admin.ctx, { email: "y@example.test", roleKey: "owner" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateMember(admin.ctx, owner.membershipId, { roleKey: "viewer" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the last owner cannot be demoted or suspended", async () => {
    await expect(updateMember(owner, owner.membershipId, { roleKey: "viewer" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("suspending a member cuts off access immediately, reactivating restores it", async () => {
    const m = await addMember(owner, "Temp", "sales");
    expect(await resolveAuthContext(m.token)).not.toBeNull();
    await updateMember(owner, m.ctx.membershipId, { status: "suspended" });
    expect(await resolveAuthContext(m.token)).toBeNull();
    await updateMember(owner, m.ctx.membershipId, { status: "active" });
    expect(await resolveAuthContext(m.token)).not.toBeNull();
  });

  it("a role change takes effect on the very next request", async () => {
    const m = await addMember(owner, "Promote", "viewer");
    await expect(createContact(m.ctx, { firstName: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await updateMember(owner, m.ctx.membershipId, { roleKey: "sales" });
    const fresh = (await resolveAuthContext(m.token))!;
    expect((await createContact(fresh, { firstName: "Yes" })).firstName).toBe("Yes");
  });

  it("users can belong to several organizations and switch between them", async () => {
    const second = await createAdditionalOrganization(rep1, { name: "Side Hustle" });
    const ctx2 = (await resolveAuthContext(rep1Token))!;
    expect(ctx2.organizationId).toBe(second.organizationId);
    expect(ctx2.roleKey).toBe("owner");
    await switchOrganization(ctx2, owner.organizationId);
    expect((await resolveAuthContext(rep1Token))!.organizationId).toBe(owner.organizationId);
    const stranger = (await signUpOrg("Stranger")).ctx;
    await expect(switchOrganization(rep1, stranger.organizationId)).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("record-level authorization (an employee cannot access an unauthorized deal)", () => {
    let deal2: string;
  let lead1: string;
  let lead2: string;

  beforeAll(async () => {
    rep1 = (await resolveAuthContext(rep1Token))!;
    await createDeal(rep1, { title: "Rep1 deal", amount: "1000" });
    deal2 = (await createDeal(rep2, { title: "Rep2 deal", amount: "2000" })).id;
    lead1 = (await createLead(rep1, { firstName: "Lee", email: "lee@big.test" })).id;
    lead2 = (await createLead(rep2, { firstName: "Mia", email: "mia@big.test" })).id;
    await createActivity(rep2, { type: "note", subject: "Secret negotiation notes", dealId: deal2 });
  });

  it("a sales rep sees only their own deals everywhere", async () => {
    expect((await listDeals(rep1, {})).items.map((d) => d.title)).toEqual(["Rep1 deal"]);
    await expect(getDeal(rep1, deal2)).rejects.toMatchObject({ code: "not_found" });
    await expect(moveDeal(rep1, deal2, { stageId: (await getDeal(rep2, deal2)).stages[1].id })).rejects.toMatchObject({ code: "not_found" });
    const board = await getBoard(rep1);
    expect(board.stages.flatMap((s) => s.deals).map((d) => d.title)).toEqual(["Rep1 deal"]);
    expect((await globalSearch(rep1, "Rep2 deal")).filter((r) => r.type === "deal")).toHaveLength(0);
  });

  it("cannot read, link, or log activity against someone else's deal or lead", async () => {
    await expect(getLead(rep1, lead2)).rejects.toMatchObject({ code: "not_found" });
    expect((await listLeads(rep1, {})).items.map((l) => l.firstName)).toEqual(["Lee"]);
    await expect(createActivity(rep1, { type: "note", subject: "peek", dealId: deal2 })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(createTask(rep1, { title: "snoop", dealId: deal2 })).rejects.toMatchObject({ code: "validation_failed" });
    expect((await getTimeline(rep1, { kind: "deal", id: deal2 })).items).toHaveLength(0);
  });

  it("owners / managers see everything; a rep cannot reassign ownership to dodge scope", async () => {
    expect((await listDeals(owner, {})).total).toBeGreaterThanOrEqual(2);
    const forced = await createDeal(rep1, { title: "Try to give away", ownerId: rep2.userId });
    expect(forced.ownerId).toBe(rep1.userId);
  });

  it("viewers can read but not write", async () => {
    expect((await listContacts(viewer, {})).total).toBeGreaterThanOrEqual(0);
    await expect(createContact(viewer, { firstName: "No" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createDeal(viewer, { title: "No" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listAuditLogs(viewer, {})).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the dashboard only aggregates what the user may see", async () => {
    const d1 = await getDashboard(rep1);
    expect(d1.pipeline[0].openCount).toBe(2); // rep1's own: "Rep1 deal" + "Try to give away"
    const dOwner = await getDashboard(owner);
    expect(dOwner.pipeline[0].openCount).toBeGreaterThanOrEqual(3);
    expect(d1.recent.some((r) => r.subject.includes("Secret"))).toBe(false);
  });

  it("lead scoring is explainable and deterministic", async () => {
    const lead = await getLead(rep1, lead1);
    expect(lead.score).toBeGreaterThan(0);
    expect((lead.scoreReasons as { label: string }[]).length).toBeGreaterThan(0);
  });

  it("cannot assign a record to a user outside the organization", async () => {
    const outsider = (await signUpOrg("Outsider")).ctx;
    await expect(createContact(owner, { firstName: "Bad", ownerId: outsider.userId })).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("CRM workflows", () => {
  it("prevents duplicate contacts by email and reports the existing record", async () => {
    await createContact(owner, { firstName: "Dup", email: "Dup@Example.test" });
    await expect(createContact(owner, { firstName: "Dup2", email: "dup@example.test" })).rejects.toMatchObject({
      code: "conflict",
      details: { existingContactId: expect.any(String) },
    });
  });

  it("detects concurrent edits with optimistic versioning", async () => {
    const c = await createContact(owner, { firstName: "Race", email: "race@example.test" });
    await updateContact(owner, c.id, { jobTitle: "CEO", version: c.version });
    await expect(updateContact(owner, c.id, { jobTitle: "CTO", version: c.version })).rejects.toMatchObject({ code: "conflict" });
  });

  it("converts a lead into a contact + company + deal in one step, and reuses existing contacts", async () => {
    const lead = await createLead(owner, { firstName: "Conv", lastName: "Erted", email: "conv@bigco.test", companyName: "BigCo", jobTitle: "Founder", source: "Referral" });
    const res = await convertLead(owner, lead.id, { createDeal: true, dealTitle: "BigCo deal", dealAmount: "5000.25" });
    expect(res.contactId && res.companyId && res.dealId).toBeTruthy();
    expect(res.reusedExistingContact).toBe(false);
    const contact = await getContact(owner, res.contactId!);
    expect(contact.companyName).toBe("BigCo");
    expect(contact.deals.map((d) => d.title)).toEqual(["BigCo deal"]);
    await expect(convertLead(owner, lead.id, {})).rejects.toMatchObject({ code: "conflict" });
    await expect(updateLead(owner, lead.id, { firstName: "Edit" })).rejects.toMatchObject({ code: "conflict" });

    const second = await createLead(owner, { firstName: "Again", email: "CONV@bigco.test" });
    const res2 = await convertLead(owner, second.id, {});
    expect(res2.reusedExistingContact).toBe(true);
    expect(res2.contactId).toBe(res.contactId);
  });

  it("moves deals through stages with derived status, loss reasons and a connected timeline", async () => {
    const [pipeline] = await listPipelines(owner);
    const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!.id;
    const company = await createCompany(owner, { name: "Timeline Co" });
    const contact = await createContact(owner, { firstName: "Tim", email: "tim@timeline.test", companyId: company.id });
    const deal = await createDeal(owner, { title: "Timeline deal", amount: "100", companyId: company.id, contactIds: [contact.id] });

    const moved = await moveDeal(owner, deal.id, { stageId: stage("Proposal") });
    expect(moved.probability).toBe(50);
    await expect(moveDeal(owner, deal.id, { stageId: stage("Lost") })).rejects.toMatchObject({ code: "validation_failed" });
    const won = await moveDeal(owner, deal.id, { stageId: stage("Won") });
    expect(won.status).toBe("won");
    expect(won.closedAt).not.toBeNull();

    await createActivity(owner, { type: "call", subject: "Closing call", contactId: contact.id });
    const tl = await getTimeline(owner, { kind: "contact", id: contact.id });
    const subjects = tl.items.map((i) => i.subject);
    expect(subjects).toContain("Closing call");
    expect(subjects).toContain("Moved from Proposal to Won"); // deal activity appears on the contact timeline
    expect(subjects).toContain("Contact created");
    const companyTl = await getTimeline(owner, { kind: "company", id: company.id });
    expect(companyTl.items.map((i) => i.subject)).toContain("Closing call");
  });

  it("task completion lands on the customer timeline and is audited", async () => {
    const c = await createContact(owner, { firstName: "Task", email: "task@example.test" });
    const t = await createTask(owner, { title: "Send proposal", contactId: c.id, dueAt: new Date(Date.now() - 3600_000).toISOString() });
    expect((await listTasks(owner, { due: "overdue" })).items.some((x) => x.id === t.id)).toBe(true);
    await updateTask(owner, t.id, { status: "done" });
    expect((await listTasks(owner, { due: "overdue" })).items.some((x) => x.id === t.id)).toBe(false);
    const tl = await getTimeline(owner, { kind: "contact", id: c.id });
    expect(tl.items.map((i) => i.subject)).toContain("Task completed: Send proposal");
    const log = await listAuditLogs(owner, { q: "task.completed" });
    expect(log.total).toBeGreaterThan(0);
  });

  it("stores money as exact decimals and rejects malformed amounts", async () => {
    const d = await createDeal(owner, { title: "Precise", amount: "0.10" });
    const d2 = await createDeal(owner, { title: "Precise2", amount: "0.20" });
    expect(d.amount).toBe("0.10");
    expect(d2.amount).toBe("0.20");
    await expect(createDeal(owner, { title: "Bad", amount: "12.345" })).rejects.toThrow();
    await expect(createDeal(owner, { title: "Neg", amount: "-5" })).rejects.toThrow();
    const dash = await getDashboard(owner);
    const inr = dash.pipeline.find((p) => p.currency === "INR")!;
    expect(inr.openAmount).toMatch(/^\d+\.\d{2}$/);
  });
});
