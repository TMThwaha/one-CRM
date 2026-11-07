import { z } from "zod";

/** Empty strings from forms become null so the database never stores "". */
export const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const optEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address");

export const optUuid = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().uuid().safeParse(v).success, "Invalid identifier");

export const uuidSchema = z.string().uuid();

export const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .default([])
  .transform((t) => [...new Set(t)]);

/** Optimistic concurrency: the version the client last saw. Mismatch => 409. */
export const versionField = { version: z.number().int().min(1).optional() };

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
});

/** Money is carried as a decimal STRING end to end; never as a JS float. */
export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Enter an amount like 1500 or 1500.50");

export const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code");
