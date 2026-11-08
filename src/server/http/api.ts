import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { resolveAuthContext } from "@/server/modules/identity/auth.service";
import type { AccountContext } from "@/server/modules/identity/context";
import { resolvePlatformContext, type PlatformContext } from "@/server/modules/platform-admin/context";
import type { AuthContext } from "@/server/modules/identity/context";
import { AppError, forbidden, invalid, notFound, unauthenticated } from "@/server/platform/errors";
import { getConfig } from "@/server/platform/config";
import { COOKIE_NAME } from "./session";

export interface ApiArgs {
  req: NextRequest;
  ctx: AuthContext;
  params: Record<string, string>;
  query: Record<string, string>;
  body: () => Promise<unknown>;
}

export interface PublicApiArgs extends Omit<ApiArgs, "ctx"> {
  ip: string | null;
  userAgent: string | null;
}

type RouteContext = { params?: Promise<Record<string, string>> };

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense for cookie-authenticated requests, on top of SameSite=Lax:
 * a state-changing request must come from our own origin.
 */
function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  const allowed = new Set([req.nextUrl.origin, new URL(getConfig().APP_URL).origin]);
  if (origin) {
    if (!allowed.has(origin)) throw forbidden("Cross-origin request blocked");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  throw forbidden("Cross-origin request blocked");
}

function errorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
    return NextResponse.json(
      { error: { code: "validation_failed", message: Object.values(fields)[0] ?? "Invalid input", details: { fields } } },
      { status: 422 },
    );
  }
  // Never leak internals to the client; log with enough context to diagnose.
  console.error("[api] unhandled error", e);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

function readBody(req: NextRequest) {
  return async () => {
    try {
      return await req.json();
    } catch {
      throw invalid("Request body must be valid JSON");
    }
  };
}

function finish(result: unknown, status: number): NextResponse {
  const res =
    result === undefined || result === null
      ? new NextResponse(null, { status: status === 200 ? 204 : status })
      : NextResponse.json(result, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Authenticated, organization-scoped endpoint. The organization comes from the session. */
export function api(handler: (a: ApiArgs) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: NextRequest, route: RouteContext): Promise<NextResponse> => {
    try {
      assertSameOrigin(req);
      const token = req.cookies.get(COOKIE_NAME())?.value;
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      const ctx = await resolveAuthContext(token, { ip });
      if (!ctx) throw unauthenticated();
      const result = await handler({
        req,
        ctx,
        params: (await route.params) ?? {},
        query: Object.fromEntries(req.nextUrl.searchParams),
        body: readBody(req),
      });
      return finish(result, opts.status ?? 200);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export interface AccountApiArgs extends Omit<ApiArgs, "ctx"> {
  ctx: AccountContext;
}

/**
 * Personal-account endpoint (2FA, password, sessions). Works for ANY signed-in person, company user
 * or Super Admin, because it needs only who they are, never a company.
 */
export function accountApi(handler: (a: AccountApiArgs) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: NextRequest, route: RouteContext): Promise<NextResponse> => {
    try {
      assertSameOrigin(req);
      const token = req.cookies.get(COOKIE_NAME())?.value;
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      const ctx = (await resolveAuthContext(token, { ip })) ?? (await resolvePlatformContext(token, { ip }));
      if (!ctx) throw unauthenticated();
      const result = await handler({
        req,
        ctx,
        params: (await route.params) ?? {},
        query: Object.fromEntries(req.nextUrl.searchParams),
        body: readBody(req),
      });
      return finish(result, opts.status ?? 200);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export interface PlatformApiArgs extends Omit<ApiArgs, "ctx"> {
  ctx: PlatformContext;
}

/**
 * Global Super Admin endpoint. Authorises ONLY through the platform resolver: a company session,
 * including a Company Admin's, can never reach it. Callers without platform rights get 404 (not
 * 403) so the existence of platform routes is not disclosed.
 */
export function platformApi(handler: (a: PlatformApiArgs) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: NextRequest, route: RouteContext): Promise<NextResponse> => {
    try {
      assertSameOrigin(req);
      const token = req.cookies.get(COOKIE_NAME())?.value;
      if (!token) throw unauthenticated();
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      const ctx = await resolvePlatformContext(token, { ip });
      if (!ctx) throw notFound("Resource");
      const result = await handler({
        req,
        ctx,
        params: (await route.params) ?? {},
        query: Object.fromEntries(req.nextUrl.searchParams),
        body: readBody(req),
      });
      return finish(result, opts.status ?? 200);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Unauthenticated endpoint (sign-in, registration, invitation acceptance). */
export function publicApi(handler: (a: PublicApiArgs) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: NextRequest, route: RouteContext): Promise<NextResponse> => {
    try {
      assertSameOrigin(req);
      const result = await handler({
        req,
        params: (await route.params) ?? {},
        query: Object.fromEntries(req.nextUrl.searchParams),
        body: readBody(req),
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        userAgent: req.headers.get("user-agent"),
      });
      return finish(result, opts.status ?? 200);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
