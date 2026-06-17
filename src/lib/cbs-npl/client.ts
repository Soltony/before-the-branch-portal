import logger from "@/lib/logger";
import type {
  CbsBulkUploadRequest,
  CbsBulkUploadResponse,
  CbsCallResult,
  CbsRepayRequest,
  CbsRepayResponse,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:8080/api/v1/notification";

/**
 * Resolve the CBS NPL notification base URL.
 * Set `CBS_NPL_BASE_URL` to e.g. `https://cbs.nibbank.local/api/v1/notification`.
 */
export function getCbsBaseUrl(): string {
  return (process.env.CBS_NPL_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

/**
 * Optional Bearer token for outbound requests. When empty, no Authorization
 * header is sent (useful for local CBS sandboxes).
 */
function getOutboundAuthHeader(): Record<string, string> {
  const token = process.env.CBS_NPL_AUTH_TOKEN?.trim();
  if (!token) return {};
  return { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` };
}

/** Default CBS provider id used for /repay calls when none is supplied. */
export function getDefaultCbsProviderId(): string {
  return process.env.CBS_DEFAULT_PROVIDER_ID?.trim() || "PRO0001";
}

/** CBS bulk endpoint limit (default 1000 accounts per request). */
export function getCbsBulkMaxAccountsPerRequest(): number {
  const raw = Number(process.env.CBS_NPL_BULK_MAX_ACCOUNTS ?? 1000);
  if (!Number.isFinite(raw) || raw < 1) return 1000;
  return Math.floor(raw);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize < 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

async function cbsPost<T>(
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number },
): Promise<CbsCallResult<T>> {
  const url = `${getCbsBaseUrl()}${path}`;
  const timeoutMs = opts?.timeoutMs ?? Number(process.env.CBS_NPL_TIMEOUT_MS ?? 20000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  void logger.info(`[CBS-NPL] POST ${url}`);

  let status = 0;
  let raw: string | undefined;
  let parsed: T | undefined;
  let error: string | undefined;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...getOutboundAuthHeader(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    status = res.status;
    raw = await res.text();
    if (raw) {
      try {
        parsed = JSON.parse(raw) as T;
      } catch {
        // non-JSON body — leave parsed undefined.
      }
    }

    if (!res.ok) {
      void logger.warn(
        `[CBS-NPL] ${url} responded ${res.status}: ${raw?.slice(0, 500) ?? ""}`,
      );
    }

    return {
      ok: res.ok,
      status,
      data: parsed,
      requestBody: body,
      rawResponse: raw,
      durationMs: Date.now() - startedAt,
    };
  } catch (e: any) {
    error = e?.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : String(e?.message ?? e);
    void logger.error(`[CBS-NPL] ${url} failed: ${error}`);
    return {
      ok: false,
      status,
      data: undefined,
      requestBody: body,
      rawResponse: raw,
      durationMs: Date.now() - startedAt,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upload a list of NPL (unpaid) loan account numbers for daily monitoring.
 * Corresponds to: POST /bulk
 */
export async function uploadNplBulk(
  accountNumbers: string[],
): Promise<CbsCallResult<CbsBulkUploadResponse>> {
  const body: CbsBulkUploadRequest = { accountNumbers };
  return cbsPost<CbsBulkUploadResponse>("/bulk", body);
}

export interface CbsBulkUploadBatchedResult {
  ok: boolean;
  status: number;
  chunkCount: number;
  failedChunkIndexes: number[];
  data?: CbsBulkUploadResponse;
  requestBody: { accountNumbers: string[]; chunks: CbsBulkUploadRequest[] };
  rawResponse?: string;
  durationMs: number;
  error?: string;
}

/**
 * Upload NPL accounts in multiple /bulk calls when the list exceeds the CBS
 * per-request limit (typically 1000).
 */
export async function uploadNplBulkInBatches(
  accountNumbers: string[],
): Promise<CbsBulkUploadBatchedResult> {
  const maxPerRequest = getCbsBulkMaxAccountsPerRequest();
  const chunks = chunkArray(accountNumbers, maxPerRequest);
  const startedAt = Date.now();
  const chunkBodies: CbsBulkUploadRequest[] = chunks.map((c) => ({ accountNumbers: c }));

  if (chunks.length === 0) {
    return {
      ok: true,
      status: 200,
      chunkCount: 0,
      failedChunkIndexes: [],
      data: { totalReceived: 0, insertedCount: 0, alreadyExistsCount: 0 },
      requestBody: { accountNumbers: [], chunks: [] },
      durationMs: 0,
    };
  }

  if (chunks.length === 1) {
    const single = await uploadNplBulk(chunks[0]!);
    return {
      ok: single.ok,
      status: single.status,
      chunkCount: 1,
      failedChunkIndexes: single.ok ? [] : [0],
      data: single.data,
      requestBody: { accountNumbers, chunks: chunkBodies },
      rawResponse: single.rawResponse,
      durationMs: single.durationMs,
      error: single.error,
    };
  }

  console.log(
    `[CBS-NPL] Bulk upload split into ${chunks.length} chunk(s) (max ${maxPerRequest} accounts per request, total ${accountNumbers.length})`,
  );

  let totalReceived = 0;
  let insertedCount = 0;
  let alreadyExistsCount = 0;
  const failedChunkIndexes: number[] = [];
  const chunkResponses: Array<{
    index: number;
    sent: number;
    ok: boolean;
    status: number;
    data?: CbsBulkUploadResponse;
    error?: string;
    rawResponse?: string;
  }> = [];
  let lastStatus = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    console.log(`[CBS-NPL] Bulk upload chunk ${i + 1}/${chunks.length} (${chunk.length} accounts)`);
    const result = await uploadNplBulk(chunk);
    lastStatus = result.status;
    chunkResponses.push({
      index: i,
      sent: chunk.length,
      ok: result.ok,
      status: result.status,
      data: result.data,
      error: result.error,
      rawResponse: result.rawResponse,
    });

    if (result.ok && result.data) {
      totalReceived += result.data.totalReceived ?? 0;
      insertedCount += result.data.insertedCount ?? 0;
      alreadyExistsCount += result.data.alreadyExistsCount ?? 0;
    } else {
      failedChunkIndexes.push(i);
      console.error(`[CBS-NPL] Bulk upload chunk ${i + 1} failed`, {
        status: result.status,
        error: result.error,
        body: result.rawResponse?.slice(0, 300),
      });
    }
  }

  const ok = failedChunkIndexes.length === 0;
  const error =
    failedChunkIndexes.length > 0
      ? `Failed chunk(s): ${failedChunkIndexes.map((i) => i + 1).join(", ")} of ${chunks.length}`
      : undefined;

  return {
    ok,
    status: ok ? 200 : lastStatus || 400,
    chunkCount: chunks.length,
    failedChunkIndexes,
    data: {
      totalReceived,
      insertedCount,
      alreadyExistsCount,
    },
    requestBody: { accountNumbers, chunks: chunkBodies },
    rawResponse: JSON.stringify({ chunks: chunkResponses }),
    durationMs: Date.now() - startedAt,
    error,
  };
}

/**
 * Trigger a repayment debit on the customer's account once funds are
 * available, crediting the configured loan repayment account.
 * Corresponds to: POST /repay
 */
export async function requestRepay(
  payload: CbsRepayRequest,
): Promise<CbsCallResult<CbsRepayResponse>> {
  return cbsPost<CbsRepayResponse>("/repay", {
    correlationId: payload.correlationId,
    accountNumber: payload.accountNumber,
    amount: String(payload.amount),
    providerId: payload.providerId,
  });
}
