import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";

/**
 * GET /api/pending-payments
 *
 * Returns pending payments (status = PENDING) with related loan and borrower info.
 * Supports pagination, search by transactionId or borrowerId, and date filtering.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromSession();
  if (
    !user ||
    (!user.permissions?.["approvals"]?.read &&
      !user.permissions?.["reversals"]?.read)
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10))
  );
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const search = url.searchParams.get("search")?.trim();

  const where: any = {
    status: "PENDING",
  };

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.createdAt.lte = toDate;
    }
  }

  if (search) {
    // Also search for account numbers in PhoneAccount table
    const matchedPhoneAccounts = await prisma.phoneAccount.findMany({
      where: {
        accountNumber: { contains: search },
      },
      select: { phoneNumber: true },
      take: 100, // Limit to avoid massive IN clauses
    });

    const matchedPhoneNumbers = matchedPhoneAccounts.map((pa) => pa.phoneNumber);

    where.OR = [
      { transactionId: { contains: search } },
      { borrowerId: { contains: search } },
      { loanId: { contains: search } },
      ...(matchedPhoneNumbers.length > 0
        ? [{ borrowerId: { in: matchedPhoneNumbers } }]
        : []),
    ];
  }

  const [total, pendingPayments] = await Promise.all([
    prisma.pendingPayment.count({ where }),
    prisma.pendingPayment.findMany({
      where,
      include: {
        loan: {
          select: {
            id: true,
            loanAmount: true,
            repaidAmount: true,
            repaymentStatus: true,
            dueDate: true,
            disbursedDate: true,
            borrowerId: true,
            product: {
              select: {
                id: true,
                name: true,
                provider: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  // Look up phone accounts for borrowers
  const borrowerIds = [
    ...new Set(pendingPayments.map((pp) => pp.borrowerId)),
  ];
  const phoneAccounts = borrowerIds.length
    ? await prisma.phoneAccount.findMany({
        where: { phoneNumber: { in: borrowerIds } },
        select: { phoneNumber: true, accountNumber: true },
      })
    : [];
  const phoneAccountMap = new Map(
    phoneAccounts.map((pa) => [pa.phoneNumber, pa.accountNumber])
  );

  // Check if each pending payment already has a pending approval or was already resolved
  const pendingPaymentIds = pendingPayments.map((pp) => pp.id);
  const existingApprovals = pendingPaymentIds.length
    ? await prisma.pendingChange.findMany({
        where: {
          status: "PENDING",
          entityType: "PendingPaymentResolve",
          entityId: { in: pendingPaymentIds },
        },
        select: { entityId: true, id: true, createdAt: true, createdById: true },
      })
    : [];

  const approvalMap = new Map(
    existingApprovals.map((a) => [a.entityId, a])
  );

  const rows = pendingPayments.map((pp) => {
    const pendingApproval = approvalMap.get(pp.id);
    return {
      id: pp.id,
      transactionId: pp.transactionId,
      loanId: pp.loanId,
      borrowerId: pp.borrowerId,
      amount: pp.amount,
      status: pp.status,
      createdAt: pp.createdAt.toISOString(),
      updatedAt: pp.updatedAt.toISOString(),
      loan: pp.loan
        ? {
            id: pp.loan.id,
            loanAmount: pp.loan.loanAmount,
            repaidAmount: pp.loan.repaidAmount,
            repaymentStatus: pp.loan.repaymentStatus,
            dueDate: pp.loan.dueDate?.toISOString() ?? null,
            disbursedDate: pp.loan.disbursedDate?.toISOString() ?? null,
            productName: pp.loan.product?.name ?? null,
            providerName: pp.loan.product?.provider?.name ?? null,
            providerId: pp.loan.product?.provider?.id ?? null,
          }
        : null,
      phoneNumber: pp.borrowerId,
      accountNumber: phoneAccountMap.get(pp.borrowerId) ?? null,
      pendingApproval: pendingApproval
        ? {
            changeId: pendingApproval.id,
            requestedAt: pendingApproval.createdAt.toISOString(),
          }
        : null,
    };
  });

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    page,
    limit,
    total,
    totalPages,
    rows,
  });
}
