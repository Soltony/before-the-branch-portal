import logger from "@/lib/logger";
import type {
  LoanDecisionPayload,
  LershaDisbursementConfirmationPayload,
  InsuranceConfirmationPayload,
} from "./types";

const LERSHA_BASE_URL =
  process.env.LERSHA_API_BASE_URL ||
  "https://dev-api-integration.lersha.com/api/v1";

/**
 * Low-level helper to call Lersha endpoints.
 */
async function lershaFetch<T = unknown>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const url = `${LERSHA_BASE_URL}${path}`;
  logger.info(`[Lersha] POST ${url}`);
  console.log(`[Lersha] Outgoing request to ${url}:`, body);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data: T | undefined;
  try {
    data = (await res.json()) as T;
  } catch {
    data = undefined;
  }

  console.log(`[Lersha] Response from ${url} status=${res.status}:`, data);

  if (!res.ok) {
    logger.error(
      `[Lersha] ${url} responded ${res.status}: ${JSON.stringify(data)}`,
    );
    console.error(`[Lersha] Non-OK response from ${url}:`, data);
  }

  return { ok: res.ok, status: res.status, data: data as T };
}

/**
 * Notify Lersha about a loan approval or rejection.
 * POST /nib/loan-decision
 */
export async function sendLoanDecision(payload: LoanDecisionPayload) {
  return lershaFetch("/nib/loan-decision", payload);
}

/**
 * Confirm disbursement to Lersha with remaining balance.
 * POST /nib/disbursement-confirmation
 */
export async function sendDisbursementConfirmation(
  payload: LershaDisbursementConfirmationPayload,
) {
  const body: LershaDisbursementConfirmationPayload = {
    farmer_id: payload.farmer_id,
    remaining_balance: Number(payload.remaining_balance.toFixed(2)),
    productId: payload.productId,
    referenceNo: payload.referenceNo,
    status: "DISBURSED",
  };
  return lershaFetch("/nib/disbursement-confirmation", body);
}

/**
 * Report insurance payment confirmation results to Lersha.
 * POST /nib/insuranceConfirmation
 */
export async function sendInsuranceConfirmation(
  payload: InsuranceConfirmationPayload,
) {
  const body: InsuranceConfirmationPayload = {
    requests: payload.requests.map((r) => ({
      farmer_id: r.farmer_id,
      status: r.status,
      remaining_balance: Number(r.remaining_balance.toFixed(2)),
      ...(r.transaction_id ? { transaction_id: r.transaction_id } : {}),
      ...(r.transaction_amount != null
        ? { transaction_amount: Number(r.transaction_amount.toFixed(2)) }
        : {}),
    })),
  };
  return lershaFetch("/nib/insuranceConfirmation", body);
}
