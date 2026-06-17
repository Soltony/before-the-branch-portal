import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import sendSms from "@/lib/sms";
import { areDisbursementsEnabled } from "@/lib/disbursement-control";
import { processExternalDisbursement } from "@/lib/external-disbursement";

type Body = {
  creditAccount: string;
  providerId: string;
  amount: string | number;
  loanId?: string;
};

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || "N/A";
    const userAgent = req.headers.get("user-agent") || "N/A";
    const actorId = "system";

    const enabled = await areDisbursementsEnabled();
    if (!enabled) {
      return NextResponse.json(
        { error: "Disbursements are currently disabled." },
        { status: 503 },
      );
    }

    const body: Body = await req.json();
    const { creditAccount, providerId, amount: clientAmount, loanId } = body;

    if (!creditAccount || !providerId || !clientAmount) {
      return NextResponse.json(
        { error: "creditAccount, providerId and amount are required" },
        { status: 400 },
      );
    }

    let amount =
      typeof clientAmount === "number"
        ? clientAmount
        : Number(String(clientAmount)) || 0;

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
          "[external][disbursement] failed to lookup loan for net amount",
          e,
        );
      }
    }

    const result = await processExternalDisbursement({
      creditAccount: String(creditAccount),
      providerId,
      amount,
      loanId,
      actorId,
      ipAddress,
      userAgent,
    });

    (async () => {
      try {
        const phoneMap = await prisma.phoneAccount.findFirst({
          where: { accountNumber: String(creditAccount) },
        });
        const phoneNumber = phoneMap?.phoneNumber ?? null;
        if (!phoneNumber) return;

        const message = result.ok
          ? `Your loan request of ETB ${amount} has been successfully disbursed to your account ${creditAccount}. Thank you for choosing NIBtera Loan.`
          : `Your loan request of ETB ${amount} could not be disbursed to your account ${creditAccount}. Please try again later or contact NIBtera Loan support for assistance.`;
        const smsRes = await sendSms(phoneNumber, message);
        if (!smsRes.ok) {
          console.warn("[external][disbursement] sms send failed", smsRes);
        }
      } catch (e) {
        console.error("[external][disbursement] sms notify failed", e);
      }
    })();

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error ?? "Upstream disbursement failed",
          status: result.statusCode,
        },
        { status: result.statusCode && result.statusCode >= 400 ? result.statusCode : 502 },
      );
    }

    return NextResponse.json(
      {
        status: "OK",
        status_code: result.statusCode,
        transactionId: result.transactionId,
      },
      { status: result.statusCode ?? 200 },
    );
  } catch (err: any) {
    console.error("[external][disbursement] error", err);
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
