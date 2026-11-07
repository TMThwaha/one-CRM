/** Thin client for the ONECRM REST API (same-origin, cookie-authenticated). */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: { fields?: Record<string, string>; [k: string]: unknown },
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined | null> } = {},
): Promise<T> {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && !window.location.pathname.startsWith("/login")) {
      // Hard navigation on purpose: drops all client-side state belonging to the dead session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    throw new ApiError(e?.code ?? "internal", e?.message ?? "Something went wrong", res.status, e?.details);
  }
  return data as T;
}

export const post = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const del = <T = unknown>(path: string) => api<T>(path, { method: "DELETE" });
