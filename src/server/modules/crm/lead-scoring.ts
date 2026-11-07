export interface ScoreReason {
  label: string;
  points: number;
}

export interface ScoreInput {
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  source?: string | null;
  status?: string;
}

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "protonmail.com", "rediffmail.com"]);

const SOURCE_POINTS: Record<string, number> = {
  referral: 25,
  partner: 20,
  website: 15,
  event: 12,
  "cold outreach": 5,
};

const SENIOR = /(chief|ceo|cto|cfo|coo|cmo|founder|owner|director|head|vp|vice president|president|partner|manager)/i;

/**
 * Deterministic, rule-based lead score (0-100). It is NOT a machine-learning model: every
 * point is explained so a salesperson can see exactly why a lead ranks where it does.
 */
export function scoreLead(lead: ScoreInput): { score: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  const add = (label: string, points: number) => reasons.push({ label, points });

  if (lead.email) {
    const domain = lead.email.split("@")[1]?.toLowerCase();
    if (domain && !FREE_MAIL.has(domain)) add("Business email address", 20);
    else add("Email address provided", 10);
  }
  if (lead.phone) add("Phone number provided", 10);
  if (lead.companyName) add("Company identified", 15);
  if (lead.jobTitle) add(SENIOR.test(lead.jobTitle) ? "Senior decision-maker title" : "Job title provided", SENIOR.test(lead.jobTitle) ? 20 : 5);
  const src = lead.source?.trim().toLowerCase();
  if (src) add(`Source: ${lead.source}`, SOURCE_POINTS[src] ?? 8);
  if (lead.status === "qualified") add("Marked qualified by a person", 20);
  if (lead.status === "contacted") add("Already contacted", 5);
  if (lead.status === "unqualified") add("Marked unqualified by a person", -40);

  const score = Math.max(0, Math.min(100, reasons.reduce((s, r) => s + r.points, 0)));
  return { score, reasons };
}
