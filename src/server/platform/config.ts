import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default(".data/pglite"),
  /** Test-only escape hatch: lets a production build use the embedded database (E2E runs). */
  ALLOW_EMBEDDED_DB: z.enum(["true", "false"]).default("false"),
  /** 32 random bytes, base64. Encrypts secrets at rest (MFA seeds). Required in production. */
  APP_ENCRYPTION_KEY: z.string().optional(),
  /** e.g. smtps://user:pass@smtp.example.com:465 . Without it, email is NOT delivered (logged only). */
  SMTP_URL: z.string().optional(),
  /**
   * One-time secret that authorises creating the FIRST Super Admin at /setup. Min 24 chars. Remove it
   * from the environment once the Super Admin exists; setup is permanently closed after that anyway.
   */
  BOOTSTRAP_TOKEN: z.string().min(24, "BOOTSTRAP_TOKEN must be at least 24 characters").optional(),
  /**
   * OneCRM is centrally managed: companies are created by the Super Admin. Self-service sign-up is
   * OFF unless this is explicitly "true" (development and automated tests only).
   */
  ALLOW_PUBLIC_REGISTRATION: z.enum(["true", "false"]).default("false"),
  MAIL_FROM: z.string().default("ONECRM <no-reply@localhost>"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
    cached = parsed.data;
    if (cached.NODE_ENV === "production" && !cached.APP_ENCRYPTION_KEY && cached.ALLOW_EMBEDDED_DB !== "true") {
      throw new Error("APP_ENCRYPTION_KEY is required in production (32 random bytes, base64).");
    }
    if (cached.NODE_ENV === "production" && !cached.DATABASE_URL && cached.ALLOW_EMBEDDED_DB !== "true") {
      throw new Error("DATABASE_URL is required in production. The embedded PGlite database is for development and tests only.");
    }
  }
  return cached;
}
