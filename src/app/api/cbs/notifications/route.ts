import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";

const REQUIRED_PERMS = ["npl-collection", "npl"] as const;

function userHasAnyPerm(user: any, action: "read" | "update"): boolean {
  if (!user?.permissions) return false;
  return REQUIRED_PERMS.some((key) => Boolean(user.permissions[key]?.[action]));
}

/** Paginated listing of received credit notifications. */
export async function GET(req: NextRequest) {
  const user = await getUserFromSession({ allowRefresh: false });
  if (!user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!userHasAnyPerm(user, "read")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const status = url.searchParams.get("status")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: any = {};
  if (status) where.processStatus = status;
  if (search) {
    where.OR = [
      { accountNumber: { contains: search } },
      { correlationId: { contains: search } },
      { externalReference: { contains: search } },
      { repayTransactionId: { contains: search } },
      { loanId: { contains: search } },
      { borrowerId: { contains: search } },
    ];
  }
  if (from || to) {
    where.receivedAt = {};
    if (from) where.receivedAt.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.receivedAt.lte = toDate;
    }
  }

  const [total, rows] = await Promise.all([
    prisma.nplCreditNotification.count({ where }),
    prisma.nplCreditNotification.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    rows: rows.map((n) => ({
      id: n.id,
      correlationId: n.correlationId,
      externalReference: n.externalReference,
      accountNumber: n.accountNumber,
      creditedAmount: n.creditedAmount,
      providerId: n.providerId,
      processStatus: n.processStatus,
      resultMessage: n.resultMessage,
      borrowerId: n.borrowerId,
      loanId: n.loanId,
      paymentId: n.paymentId,
      repayHttpStatus: n.repayHttpStatus,
      repayTransactionId: n.repayTransactionId,
      repayDebitAmount: n.repayDebitAmount,
      repayDebitAccount: n.repayDebitAccount,
      repayCreditAccount: n.repayCreditAccount,
      attempts: n.attempts,
      receivedAt: n.receivedAt.toISOString(),
      lastAttemptAt: n.lastAttemptAt?.toISOString() ?? null,
    })),
  });
}
