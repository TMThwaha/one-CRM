import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveAuthContext } from "@/server/modules/identity/auth.service";
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

/** For pages: returns the context or redirects to sign-in. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return ctx;
}
