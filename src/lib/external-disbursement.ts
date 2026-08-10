import prisma from "@/lib/prisma";
import {
  auditExternalApiError,
  auditExternalApiRequest,
  auditExternalApiResponse,
  newAuditCorrelationId,
} from "@/lib/audit-log";

export type ExternalDisbursementInput = {
  creditAccount: string;
  providerId: string;
  amount: number;
  /**
   * Account of the agro dealer supplying the farmer's inputs. When present the
   * core is also sent `agroDealersAmount` (the dealer's share of the transfer).
   */
  agroDealerAccount?: string | null;
  loanId?: string;
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Portion deducted from the disbursed amount before it reaches the agro dealer.
 * The real deduction rule is not confirmed yet, so for now it is a flat 1%.
 */
export const AGRO_DEALER_DEDUCTION_RATE = 0.01;

/** Amount the core should move to the agro dealer: `amount` less 1%. */
export function calculateAgroDealersAmount(amount: number): number {
  return (
    Math.round(amount * (1 - AGRO_DEALER_DEDUCTION_RATE) * 100 + Number.EPSILON) /
    100
  );
}

export type ExternalDisbursementResult = {
  ok: boolean;
  statusCode: number | null;
  disbursementStatus: "SUCCESS" | "FAILED" | "PENDING";
  transactionId?: string | null;
  error?: string;
};

export async function findOrCreateDisbursementTransaction(
  loanId: string | undefined,
  data: {
    providerId: string;
    originalProviderId?: string;
    creditAccount: string;
    amount?: number;
    requestPayload: string;
    responsePayload?: string;
    rawResponse?: string;
    statusCode?: number | null;
    transactionId?: string | null;
    disbursementStatus: string;
  },
) {
  if (loanId) {
    const existing = await prisma.disbursementTransaction.findFirst({
      where: {
        loanId,
        disbursementStatus: "PENDING",
      } as any,
    });

    if (existing) {
      return await prisma.disbursementTransaction.update({
        where: { id: existing.id },
        data: {
          transactionId: data.transactionId ?? undefined,
          providerId: data.providerId,
          originalProviderId: data.originalProviderId,
          creditAccount: data.creditAccount,
          amount: data.amount,
          disbursementStatus: data.disbursementStatus,
          requestPayload: data.requestPayload,
          responsePayload: data.responsePayload,
          rawResponse: data.rawResponse,
          statusCode: data.statusCode,
        } as any,
      });
    }
  }

  return await prisma.disbursementTransaction.create({
    data: {
      loanId: loanId ?? undefined,
      transactionId: data.transactionId ?? undefined,
      providerId: data.providerId,
      originalProviderId: data.originalProviderId,
      creditAccount: data.creditAccount,
      amount: data.amount,
      disbursementStatus: data.disbursementStatus,
      requestPayload: data.requestPayload,
      responsePayload: data.responsePayload,
      rawResponse: data.rawResponse,
      statusCode: data.statusCode,
    } as any,
  });
}

/**
 * Call the CBS/external disbursement API and persist DisbursementTransaction.
 * Used by /api/external/disbursement and Lersha auto-disbursement.
 */
export async function processExternalDisbursement(
  input: ExternalDisbursementInput,
): Promise<ExternalDisbursementResult> {
  const {
    creditAccount,
    providerId,
    loanId,
    actorId = "system",
    ipAddress = "N/A",
    userAgent = "N/A",
  } = input;

  const agroDealerAccount = input.agroDealerAccount?.trim() || null;

  let amount: number = input.amount;
  if (loanId) {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        select: {
          loanAmount: true,
          taxDeducted: true,
          netDisbursedAmount: true,
        },
      } as any);
      if (loan) {
        const loanData = loan as any;
        if (loanData.netDisbursedAmount != null && loanData.taxDeducted > 0) {
          amount = loanData.netDisbursedAmount;
        } else {
          amount = loanData.loanAmount;
        }
      }
    } catch (e) {
      console.error(
        "[processExternalDisbursement] failed to lookup loan net amount",
        e,
      );
    }
  }

  const forcedProviderId = process.env.FORCE_PROVIDER_ID ?? "PRO0001";
  const sendProviderId = forcedProviderId;
  const apiUrl = process.env.EXTERNAL_DISBURSEMENT_URL;
  const user = process.env.EXTERNAL_API_USERNAME;
  const pass = process.env.EXTERNAL_API_PASSWORD;
  const auth =
    user && pass
      ? "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")
      : undefined;

  // Exactly what the core receives. `agroDealerAccount`/`agroDealersAmount` are
  // only sent when the loan has an agro dealer behind it (agri-input loans);
  // other disbursements keep the original three-field payload.
  const corePayload = {
    creditAccount,
    ...(agroDealerAccount
      ? {
          agroDealerAccount,
          agroDealersAmount: calculateAgroDealersAmount(amount),
        }
      : {}),
    providerId: sendProviderId,
    amount,
  };

  const requestPayload = JSON.stringify({ ...corePayload, loanId });

  const logPrefix = "[processExternalDisbursement]";
  console.log(`${logPrefix} loanId=${loanId ?? "none"} url=${apiUrl ?? "MISSING"}`, {
    credentials: user && pass ? "set" : "missing",
    providerId: sendProviderId,
    originalProviderId: providerId,
    payload: corePayload,
  });

  if (!apiUrl) {
    const errMsg = "Missing EXTERNAL_DISBURSEMENT_URL env var";
    console.error(`${logPrefix} ${errMsg}`);
    await findOrCreateDisbursementTransaction(loanId, {
      providerId: sendProviderId,
      originalProviderId: providerId,
      creditAccount: String(creditAccount),
      amount,
      requestPayload,
      responsePayload: JSON.stringify({ error: errMsg }),
      rawResponse: errMsg,
      statusCode: null,
      disbursementStatus: "FAILED",
    }).catch(() => null);

    return {
      ok: false,
      statusCode: null,
      disbursementStatus: "FAILED",
      error: errMsg,
    };
  }

  const correlationId = newAuditCorrelationId();
  const startedAt = Date.now();

  try {
    await auditExternalApiRequest(
      {
        actorId,
        ipAddress,
        userAgent,
        integration: "DISBURSEMENT",
        entity: "DisbursementTransaction",
        correlationId,
      },
      {
        method: "POST",
        url: apiUrl,
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: corePayload,
      },
    ).catch(() => null);

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify(corePayload),
    });

    const txt = await res.text().catch(() => null);
    let payload: any = null;
    try {
      payload = txt ? JSON.parse(txt) : null;
    } catch {
      payload = txt;
    }

    await auditExternalApiResponse(
      {
        actorId,
        ipAddress,
        userAgent,
        integration: "DISBURSEMENT",
        entity: "DisbursementTransaction",
        correlationId,
      },
      {
        status: res.status,
        statusText: res.statusText,
        body: payload,
        durationMs: Date.now() - startedAt,
      },
    ).catch(() => null);

    let upstreamTransactionId: string | null = null;
    if (payload && typeof payload === "object") {
      upstreamTransactionId =
        payload.transactionId ??
        payload.transactionid ??
        payload.transaction_id ??
        null;
    } else if (typeof txt === "string") {
      const m =
        txt.match(/transactionId['"]?\s*[:=]\s*['"]?([A-Za-z0-9_-]+)['"]?/i) ||
        txt.match(/'transactionId'\s*:\s*'([^']+)'/i);
      if (m) upstreamTransactionId = m[1];
    }

    const isSuccess = res.ok && res.status >= 200 && res.status < 300;
    const disbursementStatus = isSuccess ? "SUCCESS" : "FAILED";

    // The upstream explains a rejection in the body (unknown account, provider
    // mismatch, insufficient funds); log it verbatim so a FAILED disbursement can
    // be diagnosed without going to the DisbursementTransaction row.
    const logResponse = isSuccess ? console.log : console.error;
    logResponse(
      `${logPrefix} HTTP ${res.status} ${res.statusText} — ${disbursementStatus} (loanId=${loanId ?? "none"}, ${Date.now() - startedAt}ms)`,
      { transactionId: upstreamTransactionId, body: payload ?? txt },
    );

    await findOrCreateDisbursementTransaction(loanId, {
      transactionId: upstreamTransactionId ?? undefined,
      providerId: sendProviderId,
      originalProviderId: providerId,
      creditAccount: String(creditAccount),
      amount,
      requestPayload,
      responsePayload:
        typeof payload === "string"
          ? payload
          : payload
            ? JSON.stringify(payload)
            : undefined,
      rawResponse: txt ?? undefined,
      statusCode: res.status,
      disbursementStatus,
    }).catch((e) => {
      console.error("[processExternalDisbursement] failed to save transaction", e);
    });

    return {
      ok: isSuccess,
      statusCode: res.status,
      disbursementStatus,
      transactionId: upstreamTransactionId,
      error: isSuccess
        ? undefined
        : `Upstream disbursement failed (HTTP ${res.status}): ${
            typeof payload === "string"
              ? payload
              : payload
                ? JSON.stringify(payload)
                : (txt ?? "<empty response body>")
          }`,
    };
  } catch (fetchErr: any) {
    const details = String(fetchErr?.message ?? fetchErr);
    console.error(
      `${logPrefix} fetch threw after ${Date.now() - startedAt}ms (loanId=${loanId ?? "none"}, url=${apiUrl}): ${details}`,
      fetchErr?.cause ?? fetchErr,
    );
    await auditExternalApiError(
      {
        actorId,
        ipAddress,
        userAgent,
        integration: "DISBURSEMENT",
        entity: "DisbursementTransaction",
        correlationId,
      },
      fetchErr,
      {
        durationMs: Date.now() - startedAt,
        request: {
          method: "POST",
          url: apiUrl,
          body: corePayload,
        },
      },
    ).catch(() => null);

    await findOrCreateDisbursementTransaction(loanId, {
      providerId: sendProviderId,
      originalProviderId: providerId,
      creditAccount: String(creditAccount),
      amount,
      requestPayload,
      responsePayload: JSON.stringify({
        error: "Upstream fetch failed",
        details,
      }),
      rawResponse: details,
      statusCode: null,
      disbursementStatus: "FAILED",
    }).catch(() => null);

    return {
      ok: false,
      statusCode: null,
      disbursementStatus: "FAILED",
      error: details,
    };
  }
}
