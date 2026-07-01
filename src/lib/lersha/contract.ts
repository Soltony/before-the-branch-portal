import { randomInt } from "crypto";
import prisma from "@/lib/prisma";
import { resolveLershaProvider } from "@/lib/lersha/disbursement";
import { fieldForLanguage } from "@/lib/lersha/contract-languages";

const CONTRACT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)
const CONTRACT_CODE_PREFIX = "LC-";
const CONTRACT_CODE_LENGTH = 6;
const CONTRACT_CODE_MAX_ATTEMPTS = 8;

/** Generate a single contract code, e.g. "LC-AKX6TU" (prefix + 6 alphanumeric chars). */
export function generateContractCode(): string {
  let code = "";
  for (let i = 0; i < CONTRACT_CODE_LENGTH; i++) {
    code += CONTRACT_CODE_ALPHABET[randomInt(CONTRACT_CODE_ALPHABET.length)];
  }
  return `${CONTRACT_CODE_PREFIX}${code}`;
}

/** Generate a contract code that does not already exist in the database. */
export async function generateUniqueContractCode(): Promise<string> {
  for (let attempt = 0; attempt < CONTRACT_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateContractCode();
    const existing = await prisma.loanContract.findUnique({
      where: { contractCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error("Failed to generate a unique contract code.");
}

/**
 * Resolve the active TermsAndConditions for the provider used by the Lersha
 * farmer flow. Returns null if no provider or no active terms are configured.
 */
export async function resolveActiveLershaTerms() {
  const provider = await resolveLershaProvider();
  if (!provider) return null;

  return prisma.termsAndConditions.findFirst({
    where: { providerId: provider.id, isActive: true },
    orderBy: { version: "desc" },
  });
}

/**
 * Pick the contract text for the requested language, falling back to the
 * legacy `content` column when that language has not been configured.
 */
export function pickContractText(
  terms: {
    content: string;
    contentAm?: string | null;
    contentOm?: string | null;
    contentTi?: string | null;
    contentSo?: string | null;
    contentSid?: string | null;
    contentEn?: string | null;
  },
  languageCode: string,
): string {
  const field = fieldForLanguage(languageCode);
  const localized = field ? (terms[field] as string | null | undefined) : null;
  const text = localized && localized.trim().length > 0 ? localized : terms.content;
  return text ?? "";
}
