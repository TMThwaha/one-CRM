import { z } from "zod";
import { ACTIVITY_TYPES, TASK_PRIORITIES } from "../constants";
import { optText, optUuid, pageQuery, versionField } from "./common";

const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date and time")
  .nullish()
  .transform((v) => (v ? new Date(v).toISOString() : null));

const linkFields = {
  contactId: optUuid,
  companyId: optUuid,
  leadId: optUuid,
  dealId: optUuid,
};

export const taskInput = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  description: optText(2000),
  dueAt: isoDateTime,
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assigneeId: optUuid,
  ...linkFields,
});
export type TaskInput = z.input<typeof taskInput>;

export const taskUpdate = taskInput
  .partial()
  .extend({ status: z.enum(["open", "done"]).optional() })
  .extend(versionField);

export const taskListQuery = pageQuery.extend({
  status: z.enum(["open", "done"]).optional(),
  assigneeId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  due: z.enum(["overdue", "today", "upcoming"]).optional(),
  mine: z.coerce.boolean().optional(),
});

export const activityInput = z
  .object({
    type: z.enum(ACTIVITY_TYPES).exclude(["system"]),
    subject: z.string().trim().min(1, "A subject is required").max(200),
    body: optText(5000),
    occurredAt: isoDateTime,
    durationMinutes: z.number().int().min(0).max(1440).nullish(),
    ...linkFields,
  })
  .refine((v) => v.contactId || v.companyId || v.leadId || v.dealId, {
    message: "Link the activity to a contact, company, lead or deal",
  });
export type ActivityInput = z.input<typeof activityInput>;
