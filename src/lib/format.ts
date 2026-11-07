/**
 * Display-only formatting. Amounts are stored and transported as exact decimal strings; they are
 * converted to a JS number ONLY here, for presentation, never for arithmetic that is saved.
 */
export function formatMoney(amount: string | number, currency: string, locale = "en-IN"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

export function formatCompactMoney(amount: string | number, currency: string, locale = "en-IN"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

export function formatDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(d));
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function relativeTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const diff = new Date(d).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function fullName(first: string, last?: string | null) {
  return [first, last].filter(Boolean).join(" ");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function isOverdue(due: string | Date | null | undefined, status?: string) {
  return Boolean(due) && status !== "done" && new Date(due!).getTime() < Date.now();
}

/** Exact decimal sum of money strings (no float drift). Returns a 2-dp decimal string. */
export function sumDecimal(values: string[]): string {
  let cents = BigInt(0);
  for (const v of values) {
    const [i, f = ""] = v.split(".");
    cents += BigInt(i || "0") * BigInt(100) + BigInt((f + "00").slice(0, 2));
  }
  const s = cents.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}
