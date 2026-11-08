import { z } from "zod";
import { COMPANY_STATUSES, COUNTRIES, DATE_FORMATS, isValidCurrency, isValidTimeZone } from "../countries";
import { emailSchema, passwordSchema } from "./identity";

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  text(max).nullish().transform((v) => (v ? v : null));

const httpUrl = (label: string, httpsOnly = false) =>
  z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => {
      if (v === null) return true;
      try {
        const u = new URL(v);
        return httpsOnly ? u.protocol === "https:" : u.protocol === "https:" || u.protocol === "http:";
      } catch {
        return false;
      }
    }, httpsOnly ? `${label} must be a valid https:// address` : `${label} must be a valid web address`);

const phone = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[0-9+()\-.\s]{5,30}$/.test(v), "Enter a valid phone number");

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address");

export const companyProfileSchema = z.object({
  legalName: text(200).min(2, "Legal company name is required"),
  displayName: text(120).min(2, "Display name is required"),
  industry: optional(60),
  website: httpUrl("Website"),
  businessEmail: optionalEmail,
  businessPhone: phone,
  logoUrl: httpUrl("Logo", true),
  country: z.string().trim().toUpperCase().refine((c) => COUNTRIES.some((x) => x.code === c), "Select a country"),
  region: optional(100),
  city: optional(100),
  address: optional(300),
  registrationNumber: optional(60),
  taxId: optional(60),
  baseCurrency: z.string().trim().toUpperCase().refine(isValidCurrency, "Enter a valid ISO currency code"),
  timezone: z.string().trim().refine(isValidTimeZone, "Select a valid time zone"),
  locale: z.string().trim().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Select a language"),
  dateFormat: z.enum(DATE_FORMATS),
  phoneCountryCode: z.string().trim().regex(/^\+\d{1,4}$/, "Enter a country calling code such as +91"),
  planId: z.string().uuid("Select a subscription plan"),
});

/**
 * What a Company Admin may change about their own company. Legal name, country, registration number,
 * plan and status are intentionally absent: parsing drops them, so they cannot be smuggled in.
 */
export const companySettingsSchema = companyProfileSchema.pick({
  displayName: true,
  industry: true,
  website: true,
  businessEmail: true,
  businessPhone: true,
  logoUrl: true,
  region: true,
  city: true,
  address: true,
  taxId: true,
  baseCurrency: true,
  timezone: true,
  locale: true,
  dateFormat: true,
  phoneCountryCode: true,
});
export type CompanySettingsInput = z.input<typeof companySettingsSchema>;

export const administratorSchema = z.object({
  name: text(120).min(2, "Administrator name is required"),
  email: emailSchema,
  phone,
  jobTitle: optional(100),
});

export const createCompanySchema = z.object({
  company: companyProfileSchema,
  status: z.enum(["active", "suspended"]).default("active"),
  administrator: administratorSchema,
});
export type CreateCompanyInput = z.input<typeof createCompanySchema>;
export type CreateCompanyData = z.output<typeof createCompanySchema>;

export const updateCompanySchema = companyProfileSchema.partial();
export type UpdateCompanyInput = z.input<typeof updateCompanySchema>;

export const setCompanyStatusSchema = z
  .object({
    status: z.enum(COMPANY_STATUSES),
    reason: text(500).optional(),
  })
  .refine((v) => v.status === "active" || (v.reason && v.reason.length >= 3), {
    path: ["reason"],
    message: "Give a reason (it is kept in the audit log)",
  });

export const appointAdministratorSchema = administratorSchema;

export const deleteCompanySchema = z.object({
  confirmName: text(200).min(1, "Type the company legal name to confirm"),
  password: z.string().min(1, "Your password is required").max(128),
});

export const bootstrapSchema = z.object({
  token: z.string().min(1, "Setup token is required").max(300),
  name: text(120).min(2, "Your name is required"),
  email: emailSchema,
  password: passwordSchema,
});
export type BootstrapInput = z.infer<typeof bootstrapSchema>;

export const companyListQuerySchema = z.object({
  q: text(100).optional(),
  country: z.string().trim().toUpperCase().length(2).optional(),
  industry: text(60).optional(),
  status: z.enum(COMPANY_STATUSES).optional(),
  plan: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(["name", "country", "createdAt", "employees", "status"]).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type CompanyListQuery = z.output<typeof companyListQuerySchema>;
