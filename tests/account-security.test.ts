import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { login, resolveAuthContext } from "@/server/modules/identity/auth.service";
import {
  changePassword, completeMfaLogin, isEmailVerified, listMySessions, mfaBeginSetup, mfaDisable, mfaEnable, mfaStatus,
  requestPasswordReset, resetPassword, revokeMySession, sendVerificationEmail, verifyEmail,
} from "@/server/modules/identity/account.service";
import { createInvitation } from "@/server/modules/identity/team.service";
import { setMailerForTesting, type Email, type Mailer } from "@/server/platform/mailer";
import { enforceRateLimit, resetRateLimits } from "@/server/platform/rate-limit";
import { decryptSecret, encryptSecret } from "@/server/platform/secrets";
import { base32Decode, base32Encode, totpAt, verifyTotp } from "@/server/platform/totp";
import { signUpOrg, startTestDatabase, type Rows } from "./support/harness";

let handle: DatabaseHandle;
const outbox: Email[] = [];
const mailer: Mailer = { kind: "smtp", send: async (e) => void outbox.push(e) };
const tokenFrom = (e: Email) => e.text.match(/\/(?:reset-password|verify-email)\/([\w-]+)/)![1];

beforeAll(async () => {
  handle = await startTestDatabase();
  setMailerForTesting(mailer);
});
afterAll(async () => {
  setMailerForTesting(undefined);
  await handle.close();
});
beforeEach(async () => {
  outbox.length = 0;
  await resetRateLimits();
});

describe("TOTP implementation", () => {
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 6238 SHA-1 test vectors (6-digit truncation)", () => {
    expect(totpAt(rfcSecret, 59_000)).toBe("287082"); // 94287082
    expect(totpAt(rfcSecret, 1111111109_000)).toBe("081804"); // 07081804
    expect(totpAt(rfcSecret, 1234567890_000)).toBe("005924"); // 89005924
  });
  it("base32 round-trips and verify accepts ±1 step but not ±2", () => {
    expect(base32Decode(base32Encode(Buffer.from("hello!")))).toEqual(Buffer.from("hello!"));
    const now = 1_700_000_000_000;
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, now - 90_000), now)).toBeNull();
    expect(verifyTotp(rfcSecret, "12345", now)).toBeNull();
    expect(verifyTotp(rfcSecret, "abcdef", now)).toBeNull();
  });
  it("secrets are encrypted with authenticated encryption", () => {
    const enc = encryptSecret("SEKRET");
    expect(enc).not.toContain("SEKRET");
    expect(decryptSecret(enc)).toBe("SEKRET");
    expect(() => decryptSecret(enc.slice(0, -2) + "xx")).toThrow();
  });
});

describe("multi-factor sign-in", () => {
  it("full lifecycle: enrol, require on login, block pending sessions, recovery codes, disable", async () => {
    const o = await signUpOrg("Mfa");
    expect((await mfaStatus(o.ctx)).enabled).toBe(false);

    const setup = await mfaBeginSetup(o.ctx);
    // The seed is stored encrypted, never in clear.
    const raw = await handle.db.execute(sql`select mfa_secret_enc from users where id = ${o.ctx.userId}`);
    expect(JSON.stringify((raw as Rows).rows)).not.toContain(setup.secret);
    expect(setup.qrSvg).toContain("<svg");

    await expect(mfaEnable(o.ctx, "000000")).rejects.toMatchObject({ code: "validation_failed" });
    const { recoveryCodes } = await mfaEnable(o.ctx, totpAt(setup.secret, Date.now()));
    expect(recoveryCodes).toHaveLength(8);
    expect((await mfaStatus(o.ctx)).recoveryCodesRemaining).toBe(8);

    // Login now needs a second step; the pending session grants NOTHING.
    const first = await login({ email: o.email, password: "correct-horse-battery" }, { ip: "7.7.7.7" });
    expect(first.mfaRequired).toBe(true);
    expect(await resolveAuthContext(first.token)).toBeNull();

    await expect(completeMfaLogin(first.token, "111111", {})).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await resolveAuthContext(first.token)).toBeNull();
    const ok = await completeMfaLogin(first.token, totpAt(setup.secret, Date.now()), {});
    expect((await resolveAuthContext(ok.token))?.userId).toBe(o.ctx.userId);

    // A recovery code works once.
    const second = await login({ email: o.email, password: "correct-horse-battery" }, { ip: "7.7.7.7" });
    await completeMfaLogin(second.token, recoveryCodes[0], {});
    const third = await login({ email: o.email, password: "correct-horse-battery" }, { ip: "7.7.7.7" });
    await expect(completeMfaLogin(third.token, recoveryCodes[0], {})).rejects.toMatchObject({ code: "unauthenticated" });
    expect((await mfaStatus(o.ctx)).recoveryCodesRemaining).toBe(7);

    // Disabling needs password AND a valid code.
    await expect(mfaDisable(o.ctx, { password: "wrong-password!!", code: totpAt(setup.secret, Date.now()) })).rejects.toMatchObject({ code: "unauthenticated" });
    await mfaDisable(o.ctx, { password: "correct-horse-battery", code: totpAt(setup.secret, Date.now()) });
    expect((await login({ email: o.email, password: "correct-horse-battery" }, { ip: "7.7.7.7" })).mfaRequired).toBeUndefined();
  });

  it("second-factor guessing is throttled", async () => {
    const o = await signUpOrg("Brute");
    const setup = await mfaBeginSetup(o.ctx);
    await mfaEnable(o.ctx, totpAt(setup.secret, Date.now()));
    const pending = await login({ email: o.email, password: "correct-horse-battery" }, { ip: "6.6.6.6" });
    const results: string[] = [];
    for (let i = 0; i < 7; i++) {
      results.push(await completeMfaLogin(pending.token, String(100000 + i), {}).then(() => "ok", (e) => e.code));
    }
    expect(results.slice(0, 5)).toEqual(Array(5).fill("unauthenticated"));
    expect(results.slice(5)).toEqual(["rate_limited", "rate_limited"]);
    // Even the right code is refused once throttled.
    await expect(completeMfaLogin(pending.token, totpAt(setup.secret, Date.now()), {})).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("a pending session that outlives its window is useless", async () => {
    const o = await signUpOrg("Stale");
    const setup = await mfaBeginSetup(o.ctx);
    await mfaEnable(o.ctx, totpAt(setup.secret, Date.now()));
    const pending = await login({ email: o.email, password: "correct-horse-battery" }, { ip: "5.5.5.5" });
    await handle.db.execute(sql`update sessions set expires_at = now() - interval '1 minute' where mfa_pending = true`);
    await expect(completeMfaLogin(pending.token, totpAt(setup.secret, Date.now()), {})).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("password reset", () => {
  it("emails a single-use link, resets the password, and ends all sessions", async () => {
    const o = await signUpOrg("Reset");
    outbox.length = 0;
    await requestPasswordReset(o.email, { ip: "4.4.4.4" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(o.email);
    const token = tokenFrom(outbox[0]);
    const raw = await handle.db.execute(sql`select token_hash from email_tokens`);
    expect(JSON.stringify((raw as Rows).rows)).not.toContain(token); // stored hashed

    await expect(resetPassword(token, "short", {})).rejects.toMatchObject({ code: "validation_failed" });
    await resetPassword(token, "a-brand-new-password", { ip: "4.4.4.4" });
    expect(await resolveAuthContext(o.token)).toBeNull(); // old session revoked
    await expect(resetPassword(token, "another-new-password", {})).rejects.toMatchObject({ code: "not_found" }); // single use
    await expect(login({ email: o.email, password: "correct-horse-battery" }, { ip: "4.4.4.4" })).rejects.toMatchObject({ code: "unauthenticated" });
    expect((await resolveAuthContext((await login({ email: o.email, password: "a-brand-new-password" }, { ip: "4.4.4.4" })).token))?.userId).toBe(o.ctx.userId);
  });

  it("does not reveal whether an account exists, and sends nothing for unknown emails", async () => {
    await expect(requestPasswordReset("ghost@example.test", { ip: "3.3.3.3" })).resolves.toBeUndefined();
    expect(outbox).toHaveLength(0);
  });

  it("a newer request invalidates the older link; expired links fail; requests are throttled", async () => {
    const o = await signUpOrg("Reset2");
    outbox.length = 0;
    await requestPasswordReset(o.email, { ip: "2.2.2.2" });
    await requestPasswordReset(o.email, { ip: "2.2.2.2" });
    const [oldLink, newLink] = outbox.map(tokenFrom);
    await expect(resetPassword(oldLink, "a-brand-new-password", {})).rejects.toMatchObject({ code: "not_found" });
    await handle.db.execute(sql`update email_tokens set expires_at = now() - interval '1 minute'`);
    await expect(resetPassword(newLink, "a-brand-new-password", {})).rejects.toMatchObject({ code: "not_found" });
    await requestPasswordReset(o.email, { ip: "2.2.2.2" });
    await expect(requestPasswordReset(o.email, { ip: "2.2.2.2" })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("a reset also clears a lockout", async () => {
    const o = await signUpOrg("Locked");
    for (let i = 0; i < 5; i++) await login({ email: o.email, password: "wrong-wrong-wrong" }, { ip: "1.1.1.9" }).catch(() => {});
    await requestPasswordReset(o.email, { ip: "1.1.1.9" });
    await resetPassword(tokenFrom(outbox.at(-1)!), "a-brand-new-password", {});
    await login({ email: o.email, password: "a-brand-new-password" }, { ip: "1.1.1.9" });
  });
});

describe("email verification, password change, sessions", () => {
  it("verifies once; registration sends the email; unverified until then", async () => {
    outbox.length = 0;
    const o = await signUpOrg("Verify");
    const mail = outbox.find((e) => e.to === o.email && e.subject.includes("Verify"))!;
    expect(mail).toBeTruthy();
    expect(await isEmailVerified(o.ctx.userId)).toBe(false);
    const token = tokenFrom(mail);
    await verifyEmail(token);
    expect(await isEmailVerified(o.ctx.userId)).toBe(true);
    await expect(verifyEmail(token)).rejects.toMatchObject({ code: "not_found" });
    outbox.length = 0;
    await sendVerificationEmail(o.ctx.userId); // already verified: nothing to send
    expect(outbox).toHaveLength(0);
  });

  it("changing the password needs the current one and signs out other sessions", async () => {
    const o = await signUpOrg("Change");
    const other = await login({ email: o.email, password: "correct-horse-battery" }, { ip: "9.9.1.1" });
    expect(await listMySessions(o.ctx)).toHaveLength(2);
    await expect(changePassword(o.ctx, { currentPassword: "nope-nope-nope", newPassword: "a-brand-new-password" })).rejects.toMatchObject({ code: "unauthenticated" });
    await changePassword(o.ctx, { currentPassword: "correct-horse-battery", newPassword: "a-brand-new-password" });
    expect(await resolveAuthContext(other.token)).toBeNull();
    expect(await resolveAuthContext(o.token)).not.toBeNull(); // current session survives
  });

  it("users can revoke only their own sessions", async () => {
    const a = await signUpOrg("SessA");
    const b = await signUpOrg("SessB");
    await expect(revokeMySession(a.ctx, b.ctx.sessionId)).rejects.toMatchObject({ code: "not_found" });
    expect(await resolveAuthContext(b.token)).not.toBeNull();
  });
});

describe("invitations and rate limiting", () => {
  it("invitation email goes through the mailer; `emailed` reflects real delivery", async () => {
    const o = await signUpOrg("Inviter");
    outbox.length = 0;
    const r = await createInvitation(o.ctx, { email: "newbie@example.test", roleKey: "viewer" });
    expect(r.emailed).toBe(true);
    expect(outbox[0].to).toBe("newbie@example.test");
    expect(outbox[0].text).toContain(r.url);
    setMailerForTesting({ kind: "log-only", send: async () => {} });
    const r2 = await createInvitation(o.ctx, { email: "second@example.test", roleKey: "viewer" });
    expect(r2.emailed).toBe(false); // the UI must then tell the inviter to share the link
    setMailerForTesting(mailer);
  });

  it("a mail outage never fails the business operation", async () => {
    const o = await signUpOrg("Outage");
    setMailerForTesting({ kind: "smtp", send: async () => { throw new Error("smtp down"); } });
    const r = await createInvitation(o.ctx, { email: "down@example.test", roleKey: "viewer" });
    expect(r.url).toContain("/accept-invite/");
    expect(r.emailed).toBe(false);
    setMailerForTesting(mailer);
  });

  it("the database-backed limiter enforces limits per key and window", async () => {
    await enforceRateLimit("t:a", 2, 60_000);
    await enforceRateLimit("t:a", 2, 60_000);
    await expect(enforceRateLimit("t:a", 2, 60_000)).rejects.toMatchObject({ code: "rate_limited" });
    await enforceRateLimit("t:b", 2, 60_000); // independent key
    await handle.db.execute(sql`update rate_limit_hits set hit_at = now() - interval '2 minutes' where key = 't:a'`);
    await enforceRateLimit("t:a", 2, 60_000); // window slid
  });
});
