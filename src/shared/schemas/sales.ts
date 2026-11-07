import { z } from "zod";
import { STAGE_KINDS } from "../constants";
import {
  currencySchema,
  moneySchema,
  optText,
  optUuid,
  pageQuery,
  tagsSchema,
  versionField,
} from "./common";

const closeDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31")
  .nullish()
  .transform((v) => v || null);

export const dealInput = z.object({
  title: z.string().trim().min(1, "Deal title is required").max(200),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  amount: moneySchema.default("0"),
  currency: currencySchema.optional(),
  expectedCloseDate: closeDate,
  ownerId: optUuid,
  companyId: optUuid,
  contactIds: z.array(z.string().uuid()).max(25).default([]),
  tags: tagsSchema,
});
export type DealInput = z.input<typeof dealInput>;

export const dealUpdate = z
  .object({
    title: z.string().trim().min(1).max(200),
    amount: moneySchema,
    currency: currencySchema,
    expectedCloseDate: closeDate,
    ownerId: optUuid,
    companyId: optUuid,
    tags: tagsSchema,
  })
  .partial()
  .extend(versionField);

export const dealMoveInput = z.object({
  stageId: z.string().uuid(),
  lostReason: optText(300),
  ...versionField,
});

export const dealListQuery = pageQuery.extend({
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  status: z.enum(["open", "won", "lost"]).optional(),
  ownerId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
});

export const dealContactInput = z.object({
  contactId: z.string().uuid(),
  role: optText(60),
  isPrimary: z.boolean().default(false),
});

export const stageInput = z.object({
  name: z.string().trim().min(1).max(60),
  probability: z.number().int().min(0).max(100),
  kind: z.enum(STAGE_KINDS).default("open"),
});

export const pipelineInput = z.object({
  name: z.string().trim().min(1).max(80),
  stages: z.array(stageInput).min(2).max(15),
});
