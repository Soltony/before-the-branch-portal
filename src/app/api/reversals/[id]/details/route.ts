import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";
import { hasPermission } from "@/lib/permissions";

export async function GET(
  req: NextRequest,
  { params }: { params: any }
) {
  try {
    const user = await getUserFromSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canView =
      hasPermission(user, "reversals", "read") ||
      hasPermission(user, "approvals", "read") ||
      hasPermission(user, "reversal-approval", "read");
    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const resolvedParams = await params;
    const entityId = resolvedParams?.id;
    if (!entityId) {
      return NextResponse.json({ error: "Missing entity ID" }, { status: 400 });
    }

    // The id can be a loanId or disbursementTransactionId.
    // We look for the reversal audit log by entityId on both entity types.
    let reversalLog = await prisma.auditLog.findFirst({
      where: {
        action: { in: ["LOAN_REVERSED", "DISBURSEMENT_REVERSED"] },
        entityId,
      },
      orderBy: { createdAt: "desc" },
    });

    // If not found by entityId, try to find by loanId inside details JSON
    if (!reversalLog) {
      const allReversalLogs = await prisma.auditLog.findMany({
        where: {
          action: { in: ["LOAN_REVERSED", "DISBURSEMENT_REVERSED"] },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });

      for (const log of allReversalLogs) {
        try {
          const details = log.details ? JSON.parse(log.details) : {};
          if (details.loanId === entityId || details.disbursementTransactionId === entityId) {
            reversalLog = log;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!reversalLog) {
      return NextResponse.json(
        { error: "Reversal record not found for this entity" },
        { status: 404 }
      );
    }

    let details: any = {};
    try {
      details = reversalLog.details ? JSON.parse(reversalLog.details) : {};
    } catch {
      details = {};
    }

    // Get the reverser (person who performed the reversal action = actorId)
    const reversedByUser = await prisma.user.findUnique({
      where: { id: reversalLog.actorId },
      select: { id: true, fullName: true, email: true, phoneNumber: true },
    });

    // Get the PendingChange record that was used for maker-checker approval
    // The reversal was requested via a PendingChange, search for the matching one
    const loanId = details.loanId;
    const entityTypes = ["DisbursementReversal", "LoanReversal"];

    let pendingChange: any = null;

    // Find the approved PendingChange for this reversal
    const pendingChanges = await prisma.pendingChange.findMany({
      where: {
        entityType: { in: entityTypes },
        status: "APPROVED",
      },
      include: {
        createdBy: {
          select: { id: true, fullName: true, email: true, phoneNumber: true },
        },
        approvedBy: {
          select: { id: true, fullName: true, email: true, phoneNumber: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    for (const pc of pendingChanges) {
      try {
        const payload = JSON.parse(pc.payload);
        const target = payload.created || payload.updated || payload.original;
        if (!target) continue;

        if (
          target.loanId === loanId ||
          pc.entityId === entityId ||
          target.disbursementTransactionId === entityId
        ) {
          pendingChange = pc;
          break;
        }
      } catch {
        continue;
      }
    }

    // Get the loan details if we have a loanId
    let loan: any = null;
    if (loanId) {
      loan = await prisma.loan.findUnique({
        where: { id: loanId },
        select: {
          id: true,
          borrowerId: true,
          loanAmount: true,
          serviceFee: true,
          penaltyAmount: true,
          disbursedDate: true,
          dueDate: true,
          repaymentStatus: true,
          repaymentBehavior: true,
          repaidAmount: true,
          createdAt: true,
          product: {
            select: {
              name: true,
              provider: {
                select: { id: true, name: true },
              },
            },
          },
        },
      });
    }

    // Build the response
    const response = {
      reversalId: reversalLog.id,
      reversalAction: reversalLog.action,
      reversalDate: reversalLog.createdAt,

      // Loan info
      loanId: details.loanId || null,
      borrowerId: details.borrowerId || loan?.borrowerId || null,
      loanAmount: details.amount || loan?.loanAmount || null,
      providerName: loan?.product?.provider?.name || null,
      providerId: details.providerId || loan?.product?.provider?.id || null,
      productName: loan?.product?.name || null,
      disbursedDate: loan?.disbursedDate || null,
      dueDate: loan?.dueDate || null,
      serviceFee: loan?.serviceFee || null,

      // Reversal details
      disbursementTransactionId: details.disbursementTransactionId || null,
      reversalJournalEntryId: details.reversalJournalEntryId || null,
      creditAccount: details.creditAccount || null,
      statusCode: details.statusCode ?? null,
      isPosted: details.isPosted ?? false,

      // Repayment activity that was reversed
      hasRepaymentActivity: details.hasRepaymentActivity ?? false,
      totalRepaid: details.totalRepaid ?? 0,
      reversedPaymentCount: details.reversedPaymentCount ?? 0,
      reversedPayments: details.reversedPayments || [],

      // Who requested the reversal (maker)
      requestedBy: pendingChange?.createdBy || null,
      requestedAt: pendingChange?.createdAt || null,

      // Who approved the reversal (checker)
      approvedBy: pendingChange?.approvedBy || reversedByUser || null,
      approvedAt: pendingChange?.approvedAt || reversalLog.createdAt || null,

      // Who executed the reversal (system actor)
      reversedBy: reversedByUser || null,

      // Current loan status
      currentLoanStatus: loan?.repaymentStatus || null,
      currentRepaymentBehavior: loan?.repaymentBehavior || null,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[reversal-details] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
