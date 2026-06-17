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

  console.log(`${logPrefix} Starting lookup for phone:`, phoneNumber);

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
    body: JSON.stringify({ phoneNumber }),
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
