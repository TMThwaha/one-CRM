import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { getDatabase } from "@/server/db/client";
import { authEvents, emailTokens, sessions, users } from "@/server/db/schema";
import { getConfig } from "@/server/platform/config";
import { hashPassword, hashToken, newToken, verifyPassword } from "@/server/platform/crypto";
import { conflict, invalid, notFound, unauthenticated } from "@/server/platform/errors";
import { sendBestEffort } from "@/server/platform/mailer";
import { enforceRateLimit } from "@/server/platform/rate-limit";
import { decryptSecret, encryptSecret } from "@/server/platform/secrets";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/server/platform/totp";
import { passwordSchema } from "@/shared/schemas/identity";
import { MFA_PENDING_MINUTES, isPlatformAdmin, sessionLifetimeMs, type RequestMeta } from "./auth.service";
import type { AccountContext } from "./context";

const RESET_TTL_MINUTES = 60;
const VERIFY_TTL_HOURS = 48;

// ---------------------------------------------------------------------------------------
// Multi-factor authentication (TOTP)
// ---------------------------------------------------------------------------------------

function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const h = randomBytes(5).toString("hex");
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
}
const normaliseRecovery = (c: string) => c.trim().toLowerCase().replace(/\s/g, "");

export async function mfaStatus(ctx: AccountContext) {
  const { db } = await getDatabase();
  const [u] = await db
    .select({ enabledAt: users.mfaEnabledAt, hashes: users.mfaRecoveryHashes })
    .from(users)
    .where(eq(users.id, ctx.userId));
  return { enabled: Boolean(u?.enabledAt), recoveryCodesRemaining: u?.enabledAt ? u.hashes.length : 0 };
}

/** Starts enrolment: generates and stores (encrypted) a seed that is inactive until confirmed. */
export async function mfaBeginSetup(ctx: AccountContext) {
  const { db } = await getDatabase();
  const [u] = await db.select({ enabledAt: users.mfaEnabledAt }).from(users).where(eq(users.id, ctx.userId));
  if (u?.enabledAt) throw conflict("Two-factor authentication is already enabled");
  const secret = generateTotpSecret();
  await db.update(users).set({ mfaSecretEnc: encryptSecret(secret) }).where(eq(users.id, ctx.userId));
  const uri = otpauthUri(secret, ctx.userEmail);
  return { secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, width: 192 }) };
}

/** Confirms enrolment with a valid code and returns the one-time recovery codes. */
export async function mfaEnable(ctx: AccountContext, code: string) {
  await enforceRateLimit(`mfa-enable:${ctx.userId}`, 10, 10 * 60_000);
  const { db } = await getDatabase();
  const [u] = await db.select().from(users).where(eq(users.id, ctx.userId));
  if (!u?.mfaSecretEnc) throw invalid("Start setup first");
  if (u.mfaEnabledAt) throw conflict("Two-factor authentication is already enabled");
  if (verifyTotp(decryptSecret(u.mfaSecretEnc), code) === null) throw invalid("That code is not correct. Check your authenticator and try again.");
  const codes = newRecoveryCodes();
  await db
    .update(users)
    .set({ mfaEnabledAt: new Date(), mfaRecoveryHashes: codes.map((c) => hashToken(normaliseRecovery(c))) })
    .where(eq(users.id, ctx.userId));
  return { recoveryCodes: codes };
}

export async function mfaDisable(ctx: AccountContext, input: { password: string; code: string }) {
  await enforceRateLimit(`mfa-disable:${ctx.userId}`, 10, 10 * 60_000);
  const { db } = await getDatabase();
  const [u] = await db.select().from(users).where(eq(users.id, ctx.userId));
  if (!u?.mfaEnabledAt || !u.mfaSecretEnc) throw conflict("Two-factor authentication is not enabled");
  if (!(await verifyPassword(input.password, u.passwordHash))) throw unauthenticated("Password is incorrect");
  if (!(await checkSecondFactor(u, input.code, db))) throw invalid("That code is not correct");
  await db.update(users).set({ mfaSecretEnc: null, mfaEnabledAt: null, mfaRecoveryHashes: [] }).where(eq(users.id, ctx.userId));
}

async function checkSecondFactor(u: typeof users.$inferSelect, code: string, db: Awaited<ReturnType<typeof getDatabase>>["db"]): Promise<boolean> {
  if (!u.mfaSecretEnc) return false;
  if (verifyTotp(decryptSecret(u.mfaSecretEnc), code) !== null) return true;
  // Recovery code: single use, consumed atomically.
  const h = hashToken(normaliseRecovery(code));
  if (!u.mfaRecoveryHashes.includes(h)) return false;
  const res = await db
    .update(users)
    .set({ mfaRecoveryHashes: sql`array_remove(${users.mfaRecoveryHashes}, ${h})` })
    .where(and(eq(users.id, u.id), sql`${h} = any(${users.mfaRecoveryHashes})`))
    .returning({ id: users.id });
  return res.length > 0;
}

/** Second step of sign-in: upgrades the pending session created after the password step. */
export async function completeMfaLogin(token: string | undefined, code: string, meta: RequestMeta) {
  if (!token) throw unauthenticated();
  const { db } = await getDatabase();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        eq(sessions.mfaPending, true),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  if (!row) throw unauthenticated("Your sign-in expired. Please start again.");
  // Throttle per pending session AND per user: six digits must not be brute-forceable.
  await enforceRateLimit(`mfa:session:${row.session.id}`, 5, MFA_PENDING_MINUTES * 60_000);
  await enforceRateLimit(`mfa:user:${row.user.id}`, 10, 15 * 60_000);
  if (!(await checkSecondFactor(row.user, code, db))) {
    await db.insert(authEvents).values({ type: "mfa_failed", success: false, userId: row.user.id, ip: meta.ip ?? null });
    throw unauthenticated("That code is not correct");
  }
  const platformAdmin = await isPlatformAdmin(row.user.id, db);
  const expiresAt = new Date(Date.now() + sessionLifetimeMs(platformAdmin));
  await db.update(sessions).set({ mfaPending: false, expiresAt }).where(eq(sessions.id, row.session.id));
  return { token, expiresAt, platformAdmin };
}

// ---------------------------------------------------------------------------------------
// Password reset & email verification
// ---------------------------------------------------------------------------------------

async function issueEmailToken(userId: string, purpose: "verify_email" | "reset_password", ttlMs: number) {
  const { db } = await getDatabase();
  // Only the newest token per purpose is valid.
  await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)));
  const token = newToken();
  await db.insert(emailTokens).values({ userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

async function consumeEmailToken(token: string, purpose: "verify_email" | "reset_password") {
  const { db } = await getDatabase();
  const res = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(token)),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: emailTokens.userId });
  if (res.length === 0) throw notFound("Link"); // identical for unknown, used and expired
  return res[0].userId;
}

/** Always succeeds from the caller's view: never reveals whether an account exists. */
export async function requestPasswordReset(emailRaw: string, meta: RequestMeta): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  await enforceRateLimit(`reset:ip:${meta.ip ?? "unknown"}`, 10, 60 * 60_000);
  await enforceRateLimit(`reset:email:${email}`, 3, 60 * 60_000);
  const { db } = await getDatabase();
  const [u] = await db.select({ id: users.id, name: users.name, disabledAt: users.disabledAt }).from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!u || u.disabledAt) return;
  const token = await issueEmailToken(u.id, "reset_password", RESET_TTL_MINUTES * 60_000);
  await sendBestEffort({
    to: email,
    subject: "Reset your ONECRM password",
    text: `Hi ${u.name},\n\nUse this link to choose a new password (valid for ${RESET_TTL_MINUTES} minutes, single use):\n${getConfig().APP_URL}/reset-password/${token}\n\nIf you did not request this, you can ignore this email; your password has not changed.`,
  });
}

export async function resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
  await enforceRateLimit(`reset-submit:ip:${meta.ip ?? "unknown"}`, 20, 60 * 60_000);
  const pw = passwordSchema.safeParse(newPassword);
  if (!pw.success) throw invalid(pw.error.issues[0].message);
  const userId = await consumeEmailToken(token, "reset_password");
  const { db } = await getDatabase();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    // A reset means the old credential may be compromised: end every session.
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  });
}

export async function sendVerificationEmail(userId: string): Promise<void> {
  const { db } = await getDatabase();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || u.emailVerifiedAt) return;
  const token = await issueEmailToken(userId, "verify_email", VERIFY_TTL_HOURS * 3_600_000);
  await sendBestEffort({
    to: u.email,
    subject: "Verify your ONECRM email address",
    text: `Hi ${u.name},\n\nConfirm your email address:\n${getConfig().APP_URL}/verify-email/${token}\n\nThis link is valid for ${VERIFY_TTL_HOURS} hours.`,
  });
}

export async function resendVerification(ctx: AccountContext): Promise<void> {
  await enforceRateLimit(`verify-resend:${ctx.userId}`, 3, 60 * 60_000);
  await sendVerificationEmail(ctx.userId);
}

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeEmailToken(token, "verify_email");
  const { db } = await getDatabase();
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
}

export async function isEmailVerified(userId: string): Promise<boolean> {
  const { db } = await getDatabase();
  const [u] = await db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  return Boolean(u?.v);
}

// ---------------------------------------------------------------------------------------
// Password change & session management
// ---------------------------------------------------------------------------------------

export async function changePassword(ctx: AccountContext, input: { currentPassword: string; newPassword: string }) {
  await enforceRateLimit(`pw-change:${ctx.userId}`, 10, 15 * 60_000);
  const pw = passwordSchema.safeParse(input.newPassword);
  if (!pw.success) throw invalid(pw.error.issues[0].message);
  const { db } = await getDatabase();
  const [u] = await db.select().from(users).where(eq(users.id, ctx.userId));
  if (!u || !(await verifyPassword(input.currentPassword, u.passwordHash))) throw unauthenticated("Current password is incorrect");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() }).where(eq(users.id, ctx.userId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, ctx.userId), isNull(sessions.revokedAt), sql`${sessions.id} <> ${ctx.sessionId}`));
  });
}

export async function listMySessions(ctx: AccountContext) {
  const { db } = await getDatabase();
  const rows = await db
    .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .where(and(eq(sessions.userId, ctx.userId), isNull(sessions.revokedAt), eq(sessions.mfaPending, false), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
  return rows.map((r) => ({ ...r, current: r.id === ctx.sessionId }));
}

export async function revokeMySession(ctx: AccountContext, sessionId: string) {
  const { db } = await getDatabase();
  const res = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, ctx.userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (res.length === 0) throw notFound("Session");
}
