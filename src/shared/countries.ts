/**
 * Regional defaults per country. These pre-fill the Create Company form; every value can be
 * overridden per company and is stored on the company, never read from here at runtime.
 *
 * This is a curated list, not an exhaustive or authoritative one. Tax fields are LABELS ONLY:
 * OneCRM stores the identifier a company enters and does not calculate, file or certify tax.
 */
export interface CountryDefaults {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: string; // ISO 4217
  timeZone: string; // default IANA zone; multi-zone countries can be changed per company
  phoneCode: string;
  locale: string; // BCP 47
  dateFormat: string;
  taxLabel: string;
}

const c = (
  code: string, name: string, currency: string, timeZone: string, phoneCode: string,
  locale: string, dateFormat: string, taxLabel: string,
): CountryDefaults => ({ code, name, currency, timeZone, phoneCode, locale, dateFormat, taxLabel });

export const COUNTRIES: CountryDefaults[] = [
  c("IN", "India", "INR", "Asia/Kolkata", "+91", "en-IN", "dd/MM/yyyy", "GSTIN"),
  c("AE", "United Arab Emirates", "AED", "Asia/Dubai", "+971", "en-AE", "dd/MM/yyyy", "VAT TRN"),
  c("GB", "United Kingdom", "GBP", "Europe/London", "+44", "en-GB", "dd/MM/yyyy", "VAT number"),
  c("US", "United States", "USD", "America/New_York", "+1", "en-US", "MM/dd/yyyy", "EIN"),
  c("CA", "Canada", "CAD", "America/Toronto", "+1", "en-CA", "yyyy-MM-dd", "Business number (GST/HST)"),
  c("AU", "Australia", "AUD", "Australia/Sydney", "+61", "en-AU", "dd/MM/yyyy", "ABN"),
  c("NZ", "New Zealand", "NZD", "Pacific/Auckland", "+64", "en-NZ", "dd/MM/yyyy", "GST number"),
  c("SG", "Singapore", "SGD", "Asia/Singapore", "+65", "en-SG", "dd/MM/yyyy", "GST registration number"),
  c("MY", "Malaysia", "MYR", "Asia/Kuala_Lumpur", "+60", "en-MY", "dd/MM/yyyy", "SST registration number"),
  c("ID", "Indonesia", "IDR", "Asia/Jakarta", "+62", "id-ID", "dd/MM/yyyy", "NPWP"),
  c("PH", "Philippines", "PHP", "Asia/Manila", "+63", "en-PH", "MM/dd/yyyy", "TIN"),
  c("TH", "Thailand", "THB", "Asia/Bangkok", "+66", "th-TH", "dd/MM/yyyy", "Tax ID"),
  c("VN", "Vietnam", "VND", "Asia/Ho_Chi_Minh", "+84", "vi-VN", "dd/MM/yyyy", "Tax code"),
  c("JP", "Japan", "JPY", "Asia/Tokyo", "+81", "ja-JP", "yyyy/MM/dd", "Invoice registration number"),
  c("KR", "South Korea", "KRW", "Asia/Seoul", "+82", "ko-KR", "yyyy. MM. dd", "Business registration number"),
  c("CN", "China", "CNY", "Asia/Shanghai", "+86", "zh-CN", "yyyy/MM/dd", "Unified social credit code"),
  c("HK", "Hong Kong", "HKD", "Asia/Hong_Kong", "+852", "en-HK", "dd/MM/yyyy", "Business registration number"),
  c("LK", "Sri Lanka", "LKR", "Asia/Colombo", "+94", "en-LK", "dd/MM/yyyy", "VAT number"),
  c("BD", "Bangladesh", "BDT", "Asia/Dhaka", "+880", "bn-BD", "dd/MM/yyyy", "BIN"),
  c("PK", "Pakistan", "PKR", "Asia/Karachi", "+92", "en-PK", "dd/MM/yyyy", "NTN"),
  c("SA", "Saudi Arabia", "SAR", "Asia/Riyadh", "+966", "ar-SA", "dd/MM/yyyy", "VAT number"),
  c("QA", "Qatar", "QAR", "Asia/Qatar", "+974", "ar-QA", "dd/MM/yyyy", "Tax card number"),
  c("KW", "Kuwait", "KWD", "Asia/Kuwait", "+965", "ar-KW", "dd/MM/yyyy", "Tax ID"),
  c("BH", "Bahrain", "BHD", "Asia/Bahrain", "+973", "ar-BH", "dd/MM/yyyy", "VAT number"),
  c("OM", "Oman", "OMR", "Asia/Muscat", "+968", "ar-OM", "dd/MM/yyyy", "VAT number"),
  c("EG", "Egypt", "EGP", "Africa/Cairo", "+20", "ar-EG", "dd/MM/yyyy", "Tax registration number"),
  c("ZA", "South Africa", "ZAR", "Africa/Johannesburg", "+27", "en-ZA", "yyyy/MM/dd", "VAT number"),
  c("NG", "Nigeria", "NGN", "Africa/Lagos", "+234", "en-NG", "dd/MM/yyyy", "TIN"),
  c("KE", "Kenya", "KES", "Africa/Nairobi", "+254", "en-KE", "dd/MM/yyyy", "KRA PIN"),
  c("DE", "Germany", "EUR", "Europe/Berlin", "+49", "de-DE", "dd.MM.yyyy", "USt-IdNr. (VAT)"),
  c("FR", "France", "EUR", "Europe/Paris", "+33", "fr-FR", "dd/MM/yyyy", "VAT number"),
  c("ES", "Spain", "EUR", "Europe/Madrid", "+34", "es-ES", "dd/MM/yyyy", "VAT number (NIF)"),
  c("IT", "Italy", "EUR", "Europe/Rome", "+39", "it-IT", "dd/MM/yyyy", "Partita IVA"),
  c("NL", "Netherlands", "EUR", "Europe/Amsterdam", "+31", "nl-NL", "dd-MM-yyyy", "BTW number"),
  c("IE", "Ireland", "EUR", "Europe/Dublin", "+353", "en-IE", "dd/MM/yyyy", "VAT number"),
  c("CH", "Switzerland", "CHF", "Europe/Zurich", "+41", "de-CH", "dd.MM.yyyy", "UID / VAT number"),
  c("SE", "Sweden", "SEK", "Europe/Stockholm", "+46", "sv-SE", "yyyy-MM-dd", "VAT number"),
  c("BR", "Brazil", "BRL", "America/Sao_Paulo", "+55", "pt-BR", "dd/MM/yyyy", "CNPJ"),
  c("MX", "Mexico", "MXN", "America/Mexico_City", "+52", "es-MX", "dd/MM/yyyy", "RFC"),
];

const BY_CODE = new Map(COUNTRIES.map((x) => [x.code, x]));
export const getCountry = (code: string | null | undefined) => (code ? BY_CODE.get(code.toUpperCase()) : undefined);

export const LANGUAGES: { locale: string; label: string }[] = [
  { locale: "en-IN", label: "English (India)" },
  { locale: "en-GB", label: "English (United Kingdom)" },
  { locale: "en-US", label: "English (United States)" },
  { locale: "en-AE", label: "English (UAE)" },
  { locale: "en-AU", label: "English (Australia)" },
  { locale: "en-SG", label: "English (Singapore)" },
  { locale: "ar-SA", label: "Arabic" },
  { locale: "de-DE", label: "German" },
  { locale: "fr-FR", label: "French" },
  { locale: "es-ES", label: "Spanish" },
  { locale: "pt-BR", label: "Portuguese (Brazil)" },
  { locale: "ja-JP", label: "Japanese" },
];

export const DATE_FORMATS = ["dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd", "dd.MM.yyyy", "yyyy/MM/dd", "dd-MM-yyyy", "yyyy. MM. dd"] as const;

/** Valid IANA time zone? Uses the runtime's tz database, so it never goes stale. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency");
    return list ? list.includes(code) : true;
  } catch {
    return true;
  }
}

/** Renders an instant (UTC) in a company's time zone. Pure; used wherever a company-local time is shown. */
export function formatInTimeZone(d: Date | string, timeZone: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(d));
}

export const COMPANY_STATUSES = ["active", "suspended", "deactivated", "archived"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
