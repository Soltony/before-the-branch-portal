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
  loanId?: string;
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
};

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

  const requestPayload = JSON.stringify({
    creditAccount,
    providerId: sendProviderId,
    amount,
    loanId,
  });

  if (!apiUrl) {
    const errMsg = "Missing EXTERNAL_DISBURSEMENT_URL env var";
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
        body: { creditAccount, providerId: sendProviderId, amount },
      },
    ).catch(() => null);

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({
        creditAccount,
        providerId: sendProviderId,
        amount,
      }),
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
      error: isSuccess ? undefined : "Upstream disbursement failed",
    };
  } catch (fetchErr: any) {
    const details = String(fetchErr?.message ?? fetchErr);
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
          body: { creditAccount, providerId: sendProviderId, amount },
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
