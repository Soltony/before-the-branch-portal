import {
  accountDetailsFromResponse,
  fetchAccountsByPhone,
} from "@/lib/external-loan-accounts";

/**
 * Bank accounts the core banking system holds against a farmer's phone number.
 *
 * Lersha's registration payload carries no account number for the farmer, so the
 * account credited on disbursement (agri-input loan and insurance alike) is
 * chosen by the approver from this list and stored on `LershaFarmer`.
 */
export interface FarmerBankAccount {
  accountNumber: string;
  accountName: string | null;
  status: string | null;
}

/**
 * The upstream returns `{ details: [{ AccountNumber, Name, Status }] }`, but key
 * casing has varied between environments — read each field case-insensitively so
 * a casing change upstream cannot silently produce an empty account list.
 */
function normalizeAccount(raw: unknown): FarmerBankAccount | null {
  if (!raw || typeof raw !== "object") return null;

  const entries = new Map(
    Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  );
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = entries.get(key);
      if (value != null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return null;
  };

  const accountNumber = pick("accountnumber", "account_no", "accountno");
  if (!accountNumber) return null;

  return {
    accountNumber,
    accountName: pick("name", "accountname", "customername"),
    status: pick("status"),
  };
}

export type FarmerAccountsResult =
  | { ok: true; accounts: FarmerBankAccount[] }
  | { ok: false; error: string; status: number };

/**
 * List the accounts registered against a farmer's phone number.
 */
export async function listFarmerAccounts(
  phoneNumber: string,
): Promise<FarmerAccountsResult> {
  const phone = phoneNumber?.trim();
  if (!phone) {
    return { ok: false, error: "Farmer has no phone number on record.", status: 400 };
  }

  let status: number;
  let data: Record<string, unknown> | null;
  try {
    ({ status, data } = await fetchAccountsByPhone(phone));
  } catch (err) {
    console.error("[listFarmerAccounts] Upstream lookup threw:", err);
    return {
      ok: false,
      error: "Unable to reach the banking service to list accounts.",
      status: 502,
    };
  }

  if (status < 200 || status >= 300) {
    console.warn(
      `[listFarmerAccounts] Upstream error — status=${status} phone=${phone}`,
    );
    return {
      ok: false,
      error: "Unable to list accounts from the banking service.",
      status: 502,
    };
  }

  const accounts = accountDetailsFromResponse(data)
    .map(normalizeAccount)
    .filter((a): a is FarmerBankAccount => a !== null);

  // The same account can be returned more than once when it is linked to the
  // phone through several products; collapse to one entry per account number.
  const unique = new Map<string, FarmerBankAccount>();
  for (const account of accounts) {
    if (!unique.has(account.accountNumber)) unique.set(account.accountNumber, account);
  }

  return { ok: true, accounts: Array.from(unique.values()) };
}

export type FarmerAccountSelection =
  | { ok: true; account: FarmerBankAccount }
  | { ok: false; error: string; status: number };

/**
 * Re-fetch the farmer's accounts and confirm the chosen account number is really
 * one of them. Selection always passes through here so a caller cannot post an
 * arbitrary account number and have it credited — the account must belong to the
 * phone number on the farmer's record.
 */
export async function verifyFarmerAccountSelection(
  phoneNumber: string,
  accountNumber: string,
): Promise<FarmerAccountSelection> {
  const wanted = accountNumber?.trim();
  if (!wanted) {
    return { ok: false, error: "An account number is required.", status: 400 };
  }

  const result = await listFarmerAccounts(phoneNumber);
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }

  if (result.accounts.length === 0) {
    return {
      ok: false,
      error: `No bank account is registered against the farmer's phone number (${phoneNumber}).`,
      status: 422,
    };
  }

  const match = result.accounts.find((a) => a.accountNumber === wanted);
  if (!match) {
    return {
      ok: false,
      error:
        "The selected account is not registered against this farmer's phone number.",
      status: 422,
    };
  }

  return { ok: true, account: match };
}
