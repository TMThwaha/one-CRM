export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "rate_limited"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

/** Expected, user-presentable failures. Anything else is treated as an internal error. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const unauthenticated = (m = "Authentication required") => new AppError("unauthenticated", m);
export const forbidden = (m = "You do not have permission to do that") => new AppError("forbidden", m);
export const notFound = (what = "Record") => new AppError("not_found", `${what} not found`);
export const invalid = (m: string, details?: unknown) => new AppError("validation_failed", m, details);
export const conflict = (m: string, details?: unknown) => new AppError("conflict", m, details);
export const rateLimited = (m = "Too many attempts. Try again later.") => new AppError("rate_limited", m);
