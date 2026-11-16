/**
 * Puts an Ethiopian phone number into the one form the core-banking
 * get-accounts endpoint accepts: the country code bare, no `+` and no trunk
 * `0` — `251942476692`.
 *
 * Verified against the upstream: `942476692` answers 400 "No records", while
 * the same person's `251942476692` returns their accounts. Numbers reach us in
 * other shapes too — Lersha pushes the bare 9 digits and the mini-app carries
 * `+251…` from the super app — so normalize here, in the single function
 * that calls this endpoint, rather than trusting each caller.
 *
 * This only changes what is sent upstream. The phone number stored on the
 * farmer record is left exactly as Lersha sent it.
 *
 * Anything not recognizable as an Ethiopian mobile passes through as digits, so
 * an unexpected format reaches the upstream unmangled and fails there with a
 * real message instead of being silently rewritten into a different number.
 */
export function toUpstreamPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");

  // 942476692 as is | 0942476692 drops the trunk 0 | 251…, +251… and 2510…
  // drop the country code and any trunk 0 behind it. All reduce to the same 9
  // subscriber digits, which start 9 or 7 on an Ethiopian mobile.
  const recognized =
    (digits.length === 9 && /^[79]/.test(digits)) ||
    (digits.length === 10 && digits.startsWith("0")) ||
    (digits.length === 12 && digits.startsWith("251")) ||
    (digits.length === 13 && digits.startsWith("2510"));

  return recognized ? `251${digits.slice(-9)}` : digits;
}

/**
 * Fetches bank accounts linked to a phone number from the external core-banking API.
 * Same upstream used by `/api/loan-accounts` during phone–account association.
 */
export async function fetchAccountsByPhone(phoneNumber: string): Promise<{
  status: number;
  data: Record<string, unknown> | null;
}> {
  const logPrefix = "[fetchAccountsByPhone]";
  const apiUrl = process.env.EXTERNAL_API_URL ?? "";
  const user = process.env.EXTERNAL_API_USERNAME;
  const pass = process.env.EXTERNAL_API_PASSWORD;

  const upstreamPhone = toUpstreamPhone(phoneNumber);

  console.log(`${logPrefix} Starting lookup for phone:`, upstreamPhone);

  if (!apiUrl) {
    console.error(`${logPrefix} EXTERNAL_API_URL not configured`);
    return { status: 500, data: { error: "EXTERNAL_API_URL not configured" } };
  }

  console.log(`${logPrefix} POST ${apiUrl} (credentials: ${user ? "set" : "missing"})`);

  const auth =
    "Basic " + Buffer.from(`${user ?? ""}:${pass ?? ""}`).toString("base64");

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body: JSON.stringify({ phoneNumber: upstreamPhone }),
  });

  console.log(`${logPrefix} HTTP status:`, res.status);

  const data = (await res.json().catch((err) => {
    console.warn(`${logPrefix} Failed to parse JSON response:`, err);
    return null;
  })) as Record<string, unknown> | null;

  const detailCount = Array.isArray(data?.details) ? data.details.length : 0;
  console.log(`${logPrefix} Parsed response — details count:`, detailCount);

  return { status: res.status, data };
}

export function accountDetailsFromResponse(
  data: Record<string, unknown> | null,
): unknown[] {
  return Array.isArray(data?.details) ? data.details : [];
}
