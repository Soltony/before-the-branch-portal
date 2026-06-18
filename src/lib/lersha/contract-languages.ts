/**
 * Single source of truth for the languages NIB loan contracts can be issued in.
 *
 * Used by:
 *  - the Settings → Agreement tab editor (one textarea per language)
 *  - the contract API endpoints (validate `language_code`, pick the right column)
 *  - the Prisma `TermsAndConditions` per-language columns (`field`)
 */

export interface ContractLanguage {
  /** Short code used over the wire / stored on LoanContract.languageCode */
  code: string;
  /** Human-readable label shown in the admin UI */
  label: string;
  /** Matching column on the TermsAndConditions model */
  field: TermsLanguageField;
}

export type TermsLanguageField =
  | "contentAm"
  | "contentOm"
  | "contentTi"
  | "contentSo"
  | "contentSid";

export const CONTRACT_LANGUAGES: readonly ContractLanguage[] = [
  { code: "am", label: "Amharic", field: "contentAm" },
  { code: "om", label: "Afan Oromo", field: "contentOm" },
  { code: "ti", label: "Tigrigna", field: "contentTi" },
  { code: "so", label: "Somali", field: "contentSo" },
  { code: "sid", label: "Sidama", field: "contentSid" },
] as const;

/** Tuple of supported codes, e.g. for building a zod enum. */
export const LANGUAGE_CODES = CONTRACT_LANGUAGES.map((l) => l.code) as [
  string,
  ...string[],
];

export function isSupportedLanguage(code: string): boolean {
  return CONTRACT_LANGUAGES.some((l) => l.code === code);
}

/** The TermsAndConditions column that stores the given language, or null. */
export function fieldForLanguage(code: string): TermsLanguageField | null {
  return CONTRACT_LANGUAGES.find((l) => l.code === code)?.field ?? null;
}

export function labelForLanguage(code: string): string {
  return CONTRACT_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
