import { NextRequest, NextResponse } from "next/server";
import { processCreditNotification } from "@/actions/cbs-npl";
import type { CbsCreditNotificationPayload } from "@/lib/cbs-npl/types";
import logger from "@/lib/logger";

/**
 * Inbound webhook called by the CBS when a credit (deposit) is detected on
 * one of the NPL accounts we previously uploaded via /api/v1/notification/bulk.
 *
 * Authenticated via the shared `CBS_NPL_INBOUND_TOKEN` env var. Send as
 *   Authorization: Bearer <token>
 * or
 *   x-cbs-token: <token>
 *
 * Always returns 200 to acknowledge receipt; failures are persisted on the
 * NplCreditNotification record so they can be retried from the admin UI.
 */
export async function POST(req: NextRequest) {
  console.log("[CBS-NPL][Webhook] Received inbound credit notification request");
  const expected = process.env.CBS_NPL_INBOUND_TOKEN?.trim();
  if (expected) {
    const auth = req.headers.get("authorization")?.replace(/^bearer\s+/i, "").trim();
    const headerToken = req.headers.get("x-cbs-token")?.trim();
    if (auth !== expected && headerToken !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: CbsCreditNotificationPayload;
  try {
    body = (await req.json()) as CbsCreditNotificationPayload;
    console.log("[CBS-NPL][Webhook] Payload parsed", {
      correlationId: (body as any)?.correlationId ?? null,
      accountNumber: body?.accountNumber ?? null,
      amount: body?.amount ?? null,
      externalReference: body?.externalReference ?? null,
      providerId: body?.providerId ?? null,
    });
  } catch (e) {
    void logger.warn(`[CBS-NPL] inbound webhook received invalid JSON: ${String(e)}`);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const result = await processCreditNotification(body, { sourceIp });
    console.log("[CBS-NPL][Webhook] Processing finished", {
      notificationId: result.notificationId,
      status: result.status,
      message: result.message,
      repayTransactionId: result.repayResponse?.transactionId ?? null,
      repayStatus: result.repayResponse?.status ?? null,
      repayCode: result.repayResponse?.status_code ?? null,
    });
    return NextResponse.json(
      {
        notificationId: result.notificationId,
        status: result.status,
        message: result.message,
        repay: result.repayResponse ?? null,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[CBS-NPL][Webhook] Processing failed", {
      error: error?.message ?? String(error),
    });
    void logger.error(`[CBS-NPL] inbound webhook processing error: ${String(error?.message ?? error)}`);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
