import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isPlatformAdmin, resolveAuthContext } from "@/server/modules/identity/auth.service";
import { resolvePlatformContext, type PlatformContext } from "@/server/modules/platform-admin/context";
import type { AuthContext } from "@/server/modules/identity/context";
import { getConfig } from "@/server/platform/config";

const secure = () => getConfig().NODE_ENV === "production";
/** `__Host-` binds the cookie to this exact origin (no Domain, Path=/, Secure) in production. */
export const COOKIE_NAME = () => (secure() ? "__Host-onecrm_session" : "onecrm_session");

export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(COOKIE_NAME(), token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE_NAME());
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_NAME())?.value;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  // Only meaningful behind a trusted proxy that sets/overwrites this header.
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Per-request memoized lookup for Server Components. Null when signed out. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  return resolveAuthContext(token, { ip: await clientIp() });
});

/** Per-request memoized Super Admin lookup. Null for everyone who is not a live platform admin. */
export const getPlatformContext = cache(async (): Promise<PlatformContext | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  return resolvePlatformContext(token, { ip: await clientIp() });
});

/** Where a freshly signed-in user lands: Super Admins in their control panel, everyone else in the workspace. */
export async function homePathFor(userId: string): Promise<string> {
  return (await isPlatformAdmin(userId)) ? "/super-admin" : "/dashboard";
}

/** For company pages: returns the context or redirects (Super Admins go to their own panel). */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (ctx) return ctx;
  if (await getPlatformContext()) redirect("/super-admin");
  redirect("/login");
}

/**
 * For /super-admin pages. Signed out -> sign-in. Signed in but not a Super Admin (e.g. a Company
 * Admin) -> 404, exactly as if the route did not exist.
 */
export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const ctx = await getPlatformContext();
  if (ctx) return ctx;
  if (await getAuthContext()) notFound();
  redirect("/login");
}
