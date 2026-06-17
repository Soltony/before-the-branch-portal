import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";

function isFailureStatus(statusCode: number | null | undefined) {
  if (statusCode == null) return true;
  return statusCode < 200 || statusCode >= 300;
}

function isSuccessStatus(statusCode: number | null | undefined) {
  return statusCode != null && statusCode >= 200 && statusCode < 300;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || (!user.permissions?.["reversals"]?.read && !user.permissions?.["approvals"]?.read && !user.permissions?.["reversal-approval"]?.read)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const limit = Math.min(
    100,
    Math.max(1, Number(searchParams.get("limit") || 20))
  );

  // Optional date filters
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  
  // Search by account number or phone number
  const search = searchParams.get("search")?.trim();
  
  // Filter mode: 'failed' (default), 'all', or 'posted'
  const filterMode = searchParams.get("filter") || "failed";
  
  const createdAt: any = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lte = new Date(to);

  // Helper function to find matching borrower IDs based on search
  async function getMatchingBorrowerIds(searchTerm: string): Promise<string[]> {
    const matchingPhoneAccounts = await prisma.phoneAccount.findMany({
      where: {
        OR: [
          { accountNumber: { contains: searchTerm } },
          { phoneNumber: { contains: searchTerm } },
        ],
      },
      select: { phoneNumber: true, accountNumber: true },
      take: 500,
    });
    return [...new Set(matchingPhoneAccounts.map(pa => pa.phoneNumber))];
  }

  // Helper function to find matching credit accounts based on search
  async function getMatchingCreditAccounts(searchTerm: string): Promise<string[]> {
    const matchingPhoneAccounts = await prisma.phoneAccount.findMany({
      where: {
        OR: [
          { accountNumber: { contains: searchTerm } },
          { phoneNumber: { contains: searchTerm } },
        ],
      },
      select: { accountNumber: true },
      take: 500,
    });
    return [...new Set(matchingPhoneAccounts.map(pa => pa.accountNumber))];
  }

  // For 'posted' filter, we need to find loans without disbursement transactions
  if (filterMode === "posted") {
    // Find loans that have NO corresponding DisbursementTransaction
    const loanDateFilter: any = {};
    if (from) loanDateFilter.gte = new Date(from);
    if (to) loanDateFilter.lte = new Date(to);

    // Build the where clause for posted loans
    const postedWhereClause: any = {
      ...(Object.keys(loanDateFilter).length ? { createdAt: loanDateFilter } : {}),
      // Exclude loans that have a linked disbursement transaction
      disbursementTransactions: { none: {} },
    };

    // Add search filter for posted loans
    if (search) {
      const matchingBorrowerIds = await getMatchingBorrowerIds(search);
      if (matchingBorrowerIds.length === 0) {
        return NextResponse.json({
          page,
          limit,
          total: 0,
          totalPages: 1,
          rows: [],
        });
      }
      postedWhereClause.borrowerId = { in: matchingBorrowerIds };
    }

    const loansWithoutDisbursement = await prisma.loan.findMany({
      where: postedWhereClause,
      include: {
        product: { include: { provider: true } },
        borrower: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalPosted = await prisma.loan.count({
      where: postedWhereClause,
    });

    // Get phone accounts for borrower resolution
    const borrowerIds = loansWithoutDisbursement.map((l) => l.borrowerId);
    const loanIds = loansWithoutDisbursement.map((l) => l.id);
    
    // Fetch phone accounts with deterministic ordering: prefer isActive first, then most recent
    // This ensures consistent account selection when borrowers have multiple accounts
    // (matches the logic used in the reports API)
    const phoneAccounts = borrowerIds.length
      ? await prisma.phoneAccount.findMany({
          where: { phoneNumber: { in: borrowerIds } },
          select: { phoneNumber: true, accountNumber: true, isActive: true, createdAt: true },
          orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        })
      : [];
    // Build map preferring the first (best) account per borrower
    const accountByBorrower = new Map<string, string>();
    for (const pa of phoneAccounts) {
      if (!accountByBorrower.has(pa.phoneNumber)) {
        accountByBorrower.set(pa.phoneNumber, pa.accountNumber);
      }
    }

    // Check for reversed/cancelled status for posted loans
    const reversalLogs = loanIds.length
      ? await prisma.auditLog.findMany({
          where: {
            action: "LOAN_REVERSED",
            entity: "Loan",
            entityId: { in: loanIds },
          },
          select: { entityId: true, createdAt: true, actorId: true },
        })
      : [];

    const cancelLogs = loanIds.length
      ? await prisma.auditLog.findMany({
          where: {
            action: "LOAN_CANCELLED",
            entity: "Loan",
            entityId: { in: loanIds },
          },
          select: { entityId: true, createdAt: true, actorId: true },
        })
      : [];

    const pendingRequests = loanIds.length
      ? await prisma.pendingChange.findMany({
          where: {
            status: "PENDING",
            entityType: { in: ["LoanReversal", "LoanCancel"] },
            entityId: { in: loanIds },
          },
          select: {
            id: true,
            entityId: true,
            entityType: true,
            createdAt: true,
            createdById: true,
          },
        })
      : [];

    const reversedByLoanId = new Map<string, { reversedAt: string; reversedBy: string }>();
    for (const r of reversalLogs) {
      if (!r.entityId) continue;
      reversedByLoanId.set(r.entityId, {
        reversedAt: r.createdAt.toISOString(),
        reversedBy: r.actorId,
      });
    }

    const cancelledByLoanId = new Map<string, { cancelledAt: string; cancelledBy: string }>();
    for (const c of cancelLogs) {
      if (!c.entityId) continue;
      cancelledByLoanId.set(c.entityId, {
        cancelledAt: c.createdAt.toISOString(),
        cancelledBy: c.actorId,
      });
    }

    const pendingByLoanId = new Map<string, { changeId: string; requestedAt: string; requestedBy: string; type: string }>();
    for (const p of pendingRequests) {
      if (!p.entityId) continue;
      pendingByLoanId.set(p.entityId, {
        changeId: p.id,
        requestedAt: p.createdAt.toISOString(),
        requestedBy: p.createdById,
        type: p.entityType,
      });
    }

    const rows = loansWithoutDisbursement.map((loan) => ({
      id: `loan-${loan.id}`,
      transactionId: null,
      providerId: loan.product?.provider?.id || null,
      originalProviderId: loan.product?.provider?.id || null,
      creditAccount: accountByBorrower.get(loan.borrowerId) || null,
      amount: loan.loanAmount,
      statusCode: null,
      createdAt: loan.createdAt.toISOString(),
      borrowerId: loan.borrowerId,
      loanId: loan.id,
      reversed: reversedByLoanId.get(loan.id) ?? null,
      cancelled: cancelledByLoanId.get(loan.id) ?? null,
      pendingApproval: pendingByLoanId.get(loan.id) ?? null,
      isFailure: false,
      isPosted: true, // Flag to indicate internally posted without external disbursement
      disbursementStatus: "POSTED",
    }));

    return NextResponse.json({
      page,
      limit,
      total: totalPosted,
      totalPages: Math.ceil(totalPosted / limit) || 1,
      rows,
    });
  }

  // Default behavior: show failed disbursements or all
  // Build where clause for disbursement transactions
  const where: any = {
    AND: [
      Object.keys(createdAt).length ? { createdAt } : {},
      // For 'all' filter, don't filter by status; for 'failed', only show failures
      ...(filterMode === "all"
        ? []
        : [
            {
              OR: [
                { statusCode: null },
                { statusCode: { lt: 200 } },
                { statusCode: { gte: 300 } },
              ],
            },
          ]),
    ],
  };

  // Add search filter for disbursement transactions (by credit account)
  if (search) {
    const matchingCreditAccounts = await getMatchingCreditAccounts(search);
    if (matchingCreditAccounts.length === 0) {
      return NextResponse.json({
        page,
        limit,
        total: 0,
        totalPages: 1,
        rows: [],
      });
    }
    where.AND.push({ creditAccount: { in: matchingCreditAccounts } });
  }

  const [total, txs] = await Promise.all([
    prisma.disbursementTransaction.count({ where }),
    prisma.disbursementTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const ids = txs.map((t) => t.id);
  const reversalLogs = ids.length
    ? await prisma.auditLog.findMany({
        where: {
          action: "DISBURSEMENT_REVERSED",
          entity: "DisbursementTransaction",
          entityId: { in: ids },
        },
        select: { entityId: true, createdAt: true, actorId: true },
      })
    : [];

  const cancelLogs = ids.length
    ? await prisma.auditLog.findMany({
        where: {
          action: "DISBURSEMENT_CANCELLED",
          entity: "DisbursementTransaction",
          entityId: { in: ids },
        },
        select: { entityId: true, createdAt: true, actorId: true },
      })
    : [];

  const pendingRequests = ids.length
    ? await prisma.pendingChange.findMany({
        where: {
          status: "PENDING",
          entityType: { in: ["DisbursementReversal", "DisbursementCancel"] },
          entityId: { in: ids },
        },
        select: {
          id: true,
          entityId: true,
          entityType: true,
          createdAt: true,
          createdById: true,
        },
      })
    : [];

  const reversalById = new Map<
    string,
    { reversedAt: string; reversedBy: string }
  >();
  for (const r of reversalLogs) {
    if (!r.entityId) continue;
    reversalById.set(r.entityId, {
      reversedAt: r.createdAt.toISOString(),
      reversedBy: r.actorId,
    });
  }

  const cancelledById = new Map<
    string,
    { cancelledAt: string; cancelledBy: string }
  >();
  for (const c of cancelLogs) {
    if (!c.entityId) continue;
    cancelledById.set(c.entityId, {
      cancelledAt: c.createdAt.toISOString(),
      cancelledBy: c.actorId,
    });
  }

  const pendingByTxId = new Map<
    string,
    { changeId: string; requestedAt: string; requestedBy: string; type: string }
  >();
  for (const p of pendingRequests) {
    if (!p.entityId) continue;
    pendingByTxId.set(p.entityId, {
      changeId: p.id,
      requestedAt: p.createdAt.toISOString(),
      requestedBy: p.createdById,
      type: p.entityType,
    });
  }

  // Try to resolve borrowerId + loanId for convenience in UI
  const creditAccounts = Array.from(
    new Set(txs.map((t) => t.creditAccount).filter(Boolean))
  );
  const phoneMaps = creditAccounts.length
    ? await prisma.phoneAccount.findMany({
        where: { accountNumber: { in: creditAccounts } },
        select: { accountNumber: true, phoneNumber: true },
      })
    : [];
  const phoneByAccount = new Map<string, string>();
  for (const p of phoneMaps) phoneByAccount.set(p.accountNumber, p.phoneNumber);

  const rows = await Promise.all(
    txs.map(async (t) => {
      const reversed = reversalById.get(t.id) ?? null;
      const borrowerId = phoneByAccount.get(t.creditAccount) ?? null;

      // best-effort loan resolution
      let loanId: string | null = null;
      if (borrowerId && t.amount != null) {
        const internalProviderId = t.originalProviderId || t.providerId;
        const windowStart = new Date(t.createdAt.getTime() - 60 * 60 * 1000);
        const windowEnd = new Date(t.createdAt.getTime() + 60 * 60 * 1000);

        const loan = await prisma.loan.findFirst({
          where: {
            borrowerId,
            loanAmount: Number(t.amount),
            createdAt: { gte: windowStart, lte: windowEnd },
            product: { providerId: internalProviderId },
          },
          select: { id: true },
          orderBy: { createdAt: "desc" },
        });
        loanId = loan?.id ?? null;
      }

      return {
        id: t.id,
        transactionId: t.transactionId,
        providerId: t.providerId,
        originalProviderId: t.originalProviderId,
        creditAccount: t.creditAccount,
        amount: t.amount,
        statusCode: t.statusCode,
        createdAt: t.createdAt.toISOString(),
        borrowerId,
        loanId: t.loanId || loanId,
        reversed,
        cancelled: cancelledById.get(t.id) ?? null,
        pendingApproval: pendingByTxId.get(t.id) ?? null,
        isFailure: isFailureStatus(t.statusCode),
        isPosted: false,
        disbursementStatus: isSuccessStatus(t.statusCode) 
          ? "SUCCESS" 
          : isFailureStatus(t.statusCode) 
            ? "FAILED" 
            : "PENDING",
      };
    })
  );

  // Also include reversed disbursement loans whose DisbursementTransaction
  // records were deleted during reversal.  These loans would otherwise vanish
  // from the list entirely.
  const reversedDisbursementLogs = await prisma.auditLog.findMany({
    where: {
      action: "DISBURSEMENT_REVERSED",
      entity: "DisbursementTransaction",
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Collect loanIds from audit log details and exclude those already in rows
  const existingLoanIds = new Set(rows.map((r) => r.loanId).filter(Boolean));
  const existingTxIds = new Set(rows.map((r) => r.id));
  const reversedLoanRows: typeof rows = [];

  for (const log of reversedDisbursementLogs) {
    let details: any = {};
    try {
      details = log.details ? JSON.parse(log.details) : {};
    } catch {
      continue;
    }
    const loanId = details.loanId;
    const txId = details.disbursementTransactionId;

    // Skip if already present in rows
    if ((loanId && existingLoanIds.has(loanId)) || (txId && existingTxIds.has(txId))) continue;

    // Optionally apply search filter
    if (search) {
      const creditAcc = details.creditAccount || "";
      if (!creditAcc.includes(search)) continue;
    }

    // Fetch the reversed loan for metadata
    let loan: any = null;
    if (loanId) {
      loan = await prisma.loan.findUnique({
        where: { id: loanId },
        select: {
          id: true,
          borrowerId: true,
          loanAmount: true,
          createdAt: true,
          product: { select: { provider: { select: { id: true } } } },
        },
      });
    }

    reversedLoanRows.push({
      id: txId || `reversed-${loanId || log.id}`,
      transactionId: null,
      providerId: details.providerId || loan?.product?.provider?.id || "",
      originalProviderId: details.providerId || loan?.product?.provider?.id || null,
      creditAccount: details.creditAccount || null,
      amount: loan?.loanAmount ?? null,
      statusCode: details.statusCode ?? null,
      createdAt: loan?.createdAt?.toISOString?.() || log.createdAt.toISOString(),
      borrowerId: loan?.borrowerId || null,
      loanId: loanId || null,
      reversed: {
        reversedAt: log.createdAt.toISOString(),
        reversedBy: log.actorId,
      },
      cancelled: null,
      pendingApproval: null,
      isFailure: true,
      isPosted: false,
      disbursementStatus: "REVERSED",
    });

    if (loanId) existingLoanIds.add(loanId);
  }

  // Merge reversed rows and re-sort by date descending
  const allRows = [...rows, ...reversedLoanRows].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const totalWithReversed = total + reversedLoanRows.length;

  return NextResponse.json({
    page,
    limit,
    total: totalWithReversed,
    totalPages: Math.ceil(totalWithReversed / limit) || 1,
    rows: allRows,
  });
}
