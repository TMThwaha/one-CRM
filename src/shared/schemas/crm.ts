import { z } from "zod";
import { LEAD_STATUSES } from "../constants";
import { optEmail, optText, optUuid, pageQuery, tagsSchema, versionField } from "./common";

export const contactInput = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: optText(100),
  email: optEmail,
  phone: optText(40),
  jobTitle: optText(120),
  companyId: optUuid,
  ownerId: optUuid,
  source: optText(60),
  tags: tagsSchema,
});
export type ContactInput = z.input<typeof contactInput>;

export const contactUpdate = contactInput.partial().extend(versionField);

export const contactListQuery = pageQuery.extend({
  companyId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
});

export const companyInput = z.object({
  name: z.string().trim().min(1, "Company name is required").max(160),
  domain: optText(120).transform((d) => (d ? d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null)),
  industry: optText(80),
  size: optText(40),
  phone: optText(40),
  website: optText(200),
  city: optText(80),
  country: optText(80),
  ownerId: optUuid,
  tags: tagsSchema,
});
export type CompanyInput = z.input<typeof companyInput>;
export const companyUpdate = companyInput.partial().extend(versionField);
export const companyListQuery = pageQuery.extend({ ownerId: z.string().uuid().optional() });

export const leadInput = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: optText(100),
  email: optEmail,
  phone: optText(40),
  companyName: optText(160),
  jobTitle: optText(120),
  source: optText(60),
  ownerId: optUuid,
  tags: tagsSchema,
});
export type LeadInput = z.input<typeof leadInput>;
export const leadUpdate = leadInput
  .partial()
  .extend({ status: z.enum(LEAD_STATUSES).optional() })
  .extend(versionField);
export const leadListQuery = pageQuery.extend({
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.string().uuid().optional(),
});

export const leadConvertInput = z.object({
  createDeal: z.boolean().default(false),
  dealTitle: optText(200),
  dealAmount: z.string().trim().regex(/^\d{1,16}(\.\d{1,2})?$/).optional(),
  pipelineId: z.string().uuid().optional(),
});
