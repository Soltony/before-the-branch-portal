import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireMiniAppAuthContext } from "@/lib/miniapp-auth";
import { ensureInstallmentRollover } from "@/lib/installment-rollover";
import { calculateInstallmentPenalty } from "@/lib/installment-penalty";
import { getAsOfDate } from "@/lib/date-utils";

const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
  if (!jsonString) return defaultValue;
  try {
    return JSON.parse(jsonString);
  } catch {
    return defaultValue;
  }
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireMiniAppAuthContext();
    const borrowerId = String(ctx.borrowerId);

    // Ensure rollover so the returned schedule is consistent with repayment validation
    const loans = await prisma.loan.findMany({
      where: { borrowerId },
      select: { id: true },
    });
    for (const l of loans) {
      await ensureInstallmentRollover(prisma, l.id);
    }

    const asOfDate = getAsOfDate();
    const refreshedLoans = await prisma.loan.findMany({
      where: { borrowerId },
      include: {
        product: { include: { provider: true } },
        payments: { orderBy: { date: "asc" } },
        installments: { orderBy: { installmentNumber: "asc" } },
      },
      orderBy: { disbursedDate: "desc" },
    });

    const result = refreshedLoans.map((loan) => ({
      id: loan.id,
      borrowerId: loan.borrowerId,
      providerName: loan.product.provider.name,
      productName: loan.product.name,
      loanAmount: loan.loanAmount,
      serviceFee: loan.serviceFee,
      disbursedDate: loan.disbursedDate,
      dueDate: loan.dueDate,
      repaymentStatus: loan.repaymentStatus as "Paid" | "Unpaid",
      repaidAmount: loan.repaidAmount || 0,
      penaltyAmount: loan.penaltyAmount,
      product: {
        ...loan.product,
        serviceFee: safeJsonParse(loan.product.serviceFee, { type: "percentage", value: 0 }),
        dailyFee: safeJsonParse(loan.product.dailyFee, { type: "percentage", value: 0 }),
        penaltyRules: safeJsonParse(loan.product.penaltyRules, []),
        penaltyPerInstallment: loan.product.penaltyPerInstallment ?? false,
      },
      payments: loan.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        date: p.date,
        outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
      })),
      installments: (loan.installments || []).map((i) => {
        const penaltyPerInstallment = loan.product.penaltyPerInstallment ?? false;
        const penaltyDueDate = penaltyPerInstallment ? i.dueDate : loan.dueDate;
        return {
          id: i.id,
          installmentNumber: i.installmentNumber,
          dueDate: i.dueDate,
          amount: i.amount,
          paidAmount: i.paidAmount || 0,
          paidAt: i.paidAt,
          status: i.status,
          penaltyAmount: calculateInstallmentPenalty({
            dueDate: penaltyDueDate,
            principalOutstanding: Math.max(0, (i.amount || 0) - (i.paidAmount || 0)),
            penaltyRules: (safeJsonParse(loan.product.penaltyRules as any, []) as any) || [],
            asOfDate,
          }),
          isActive: i.isActive,
        };
      }),
    }));

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load loan history" },
      { status: 500 },
    );
  }
}

