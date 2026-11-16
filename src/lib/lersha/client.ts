import logger from "@/lib/logger";
import {
  auditExternalApiError,
  auditExternalApiRequest,
  auditExternalApiResponse,
  newAuditCorrelationId,
} from "@/lib/audit-log";
import type {
  LoanDecisionPayload,
  LershaDisbursementConfirmationPayload,
  InsuranceConfirmationPayload,
} from "./types";

const LERSHA_BASE_URL =
  process.env.LERSHA_API_BASE_URL ||
  "https://dev-api-integration.lersha.com/api/v1";

/** Shared secret issued by Lersha; sent on every outbound call. */
const LERSHA_API_KEY = process.env.LERSHA_API_KEY || "";

/**
 * Who triggered an outbound Lersha call and which record it concerns. Every
 * call is written to the audit log as a request/response pair (the same
 * EXTERNAL_API_* entries the core-banking disbursement call produces), so what
 * Lersha was told — and what it answered — survives beyond the server console.
 */
export type LershaAuditContext = {
  /** The signed-in user, or the integration that caused the call. */
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
  entity?: string;
  entityId?: string;
  context?: Record<string, unknown>;
};

/**
 * Low-level helper to call Lersha endpoints.
 */
async function lershaFetch<T = unknown>(
  path: string,
  body: unknown,
  audit: LershaAuditContext = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const url = `${LERSHA_BASE_URL}${path}`;
  logger.info(`[Lersha] POST ${url}`);
  console.log(`[Lersha] Outgoing request to ${url}:`, body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (LERSHA_API_KEY) {
    headers["X-API-Key"] = LERSHA_API_KEY;
  } else {
    // Lersha rejects unauthenticated calls, so surface the misconfiguration
    // rather than letting it show up as an opaque 401/403 later.
    logger.warn(`[Lersha] LERSHA_API_KEY is not set; calling ${url} without it`);
    console.warn("[Lersha] LERSHA_API_KEY is not set; sending request without X-API-Key");
  }

  const auditBase = {
    actorId: audit.actorId ?? "system",
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
    integration: "LERSHA",
    entity: audit.entity,
    entityId: audit.entityId,
    context: audit.context,
    correlationId: newAuditCorrelationId(),
  };
  const startedAt = Date.now();

  // Auditing must never be the reason a call to Lersha fails, hence the
  // swallowed rejections. The API key is redacted by the audit helper.
  await auditExternalApiRequest(auditBase, {
    method: "POST",
    url,
    headers,
    body,
  }).catch(() => null);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Unreachable host, DNS, TLS, timeout: Lersha never received the call.
    await auditExternalApiError(auditBase, err, {
      durationMs: Date.now() - startedAt,
      request: { method: "POST", url, body },
    }).catch(() => null);
    throw err;
  }

  let data: T | undefined;
  try {
    data = (await res.json()) as T;
  } catch {
    data = undefined;
  }

  console.log(`[Lersha] Response from ${url} status=${res.status}:`, data);

  await auditExternalApiResponse(auditBase, {
    status: res.status,
    statusText: res.statusText,
    body: data,
    durationMs: Date.now() - startedAt,
  }).catch(() => null);

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
export async function sendLoanDecision(
  payload: LoanDecisionPayload,
  audit?: LershaAuditContext,
) {
  return lershaFetch("/nib/loan-decision", payload, audit);
}

/**
 * Confirm disbursement to Lersha with remaining balance.
 * POST /nib/disbursement-confirmation
 */
export async function sendDisbursementConfirmation(
  payload: LershaDisbursementConfirmationPayload,
  audit?: LershaAuditContext,
) {
  const body: LershaDisbursementConfirmationPayload = {
    farmer_id: payload.farmer_id,
    remaining_balance: Number(payload.remaining_balance.toFixed(2)),
    productId: payload.productId,
    referenceNo: payload.referenceNo,
    status: "DISBURSED",
  };
  return lershaFetch("/nib/disbursement-confirmation", body, audit);
}

/**
 * Report insurance payment confirmation results to Lersha.
 * POST /nib/insuranceConfirmation
 */
export async function sendInsuranceConfirmation(
  payload: InsuranceConfirmationPayload,
  audit?: LershaAuditContext,
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
  return lershaFetch("/nib/insuranceConfirmation", body, audit);
}
