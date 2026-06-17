import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";

export async function GET(req: NextRequest) {
  const user = await getUserFromSession();
  if (
    !user ||
    (
      !user.permissions?.["reversals"]?.read &&
      !user.permissions?.["approvals"]?.read &&
      !user.permissions?.["reversal-approval"]?.read
    )
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const loanId = searchParams.get("loanId");

  if (!loanId) {
    return NextResponse.json({ error: "Missing loanId" }, { status: 400 });
  }

  // Fetch the loan (even if reversed)
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: {
      product: {
        include: {
          provider: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!loan) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  // Fetch the reversal audit log
  const reversalLog = await prisma.auditLog.findFirst({
    where: {
      action: "LOAN_REVERSED",
      entity: "Loan",
      entityId: loanId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      actorId: true,
      details: true,
      createdAt: true,
    },
  });

  // Fetch the PendingChange record for this reversal to get who requested and who approved
  const pendingChange = await prisma.pendingChange.findFirst({
    where: {
      entityType: { in: ["LoanReversal", "DisbursementReversal"] },
      entityId: loanId,
      status: "APPROVED",
    },
    orderBy: { updatedAt: "desc" },
    include: {
      createdBy: {
        select: { id: true, fullName: true, email: true },
      },
      approvedBy: {
        select: { id: true, fullName: true, email: true },
      },
    },
  });

  // Also check for disbursement-level reversals if no loan-level reversal found
  let disbursementPendingChange = null;
  if (!pendingChange) {
    // Try to find via disbursement transaction
    const disbTx = await prisma.disbursementTransaction.findFirst({
      where: { loanId },
      select: { id: true },
    });
    if (disbTx) {
      disbursementPendingChange = await prisma.pendingChange.findFirst({
        where: {
          entityType: "DisbursementReversal",
          entityId: disbTx.id,
          status: "APPROVED",
        },
        orderBy: { updatedAt: "desc" },
        include: {
          createdBy: {
            select: { id: true, fullName: true, email: true },
          },
          approvedBy: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });
    }
  }

  const approvalRecord = pendingChange || disbursementPendingChange;

  // Parse reversal details from audit log
  let reversalDetails: any = {};
  if (reversalLog?.details) {
    try {
      reversalDetails =
        typeof reversalLog.details === "string"
          ? JSON.parse(reversalLog.details)
          : reversalLog.details;
    } catch {
      reversalDetails = {};
    }
  }

  // Resolve actor names
  const actorIds = new Set<string>();
  if (reversalLog?.actorId) actorIds.add(reversalLog.actorId);
  if (approvalRecord?.createdById) actorIds.add(approvalRecord.createdById);
  if (approvalRecord?.approvedById) actorIds.add(approvalRecord.approvedById);

  const actors = actorIds.size
    ? await prisma.user.findMany({
        where: { id: { in: Array.from(actorIds) } },
        select: { id: true, fullName: true, email: true },
      })
    : [];

  const actorMap = new Map(actors.map((a) => [a.id, a]));

  // Get borrower's phone account for display
  const phoneAccount = await prisma.phoneAccount.findFirst({
    where: { phoneNumber: loan.borrowerId },
    select: { accountNumber: true, phoneNumber: true },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    loan: {
      id: loan.id,
      borrowerId: loan.borrowerId,
      borrowerPhone: loan.borrowerId,
      accountNumber: phoneAccount?.accountNumber || null,
      loanAmount: loan.loanAmount,
      serviceFee: loan.serviceFee,
      penaltyAmount: loan.penaltyAmount,
      disbursedDate: loan.disbursedDate.toISOString(),
      dueDate: loan.dueDate.toISOString(),
      repaymentStatus: loan.repaymentStatus,
      repaidAmount: loan.repaidAmount || 0,
      providerName: loan.product?.provider?.name || "Unknown",
      productName: loan.product?.name || "Unknown",
    },
    reversal: reversalLog
      ? {
          reversedAt: reversalLog.createdAt.toISOString(),
          reversedBy: actorMap.get(reversalLog.actorId)?.fullName || reversalLog.actorId,
          reversedByEmail: actorMap.get(reversalLog.actorId)?.email || null,
        }
      : null,
    approval: approvalRecord
      ? {
          requestedAt: approvalRecord.createdAt.toISOString(),
          requestedBy: approvalRecord.createdBy?.fullName || approvalRecord.createdById,
          requestedByEmail: approvalRecord.createdBy?.email || null,
          approvedAt: approvalRecord.approvedAt?.toISOString() || null,
          approvedBy: approvalRecord.approvedBy?.fullName || approvalRecord.approvedById || null,
          approvedByEmail: approvalRecord.approvedBy?.email || null,
          rejectionReason: approvalRecord.rejectionReason || null,
        }
      : null,
    paymentActivity: {
      hasPaymentActivity: reversalDetails.hasPaymentActivity || false,
      totalRepaidAmount: reversalDetails.totalRepaidAmount || 0,
      reversedPayments: reversalDetails.reversedPayments || [],
      reversedInstallments: reversalDetails.reversedInstallments || [],
    },
  });
}
