export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const ACTIVITY_TYPES = ["note", "call", "email", "meeting", "system"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const STAGE_KINDS = ["open", "won", "lost"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
