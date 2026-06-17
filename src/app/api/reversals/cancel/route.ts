import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";
import { createAuditLog } from "@/lib/audit-log";

function isFailureStatus(statusCode: number | null | undefined) {
  if (statusCode == null) return true;
  return statusCode < 200 || statusCode >= 300;
}

/**
 * Cancel a "failed" disbursement by marking it as successful.
 * This is used when an external disbursement was recorded as failed
 * but actually succeeded on the CBS side.
 *
 * Also handles "Posted" loans - loans with no disbursement transaction record.
 * For posted loans, this creates a disbursement record and marks it as successful.
 *
 * Creates a pending change request for maker-checker approval.
 * Upon approval, the transactionId and statusCode on the DisbursementTransaction will be updated.
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || (!user.permissions?.["reversals"]?.update && !user.permissions?.["approvals"]?.update && !user.permissions?.["reversal-approval"]?.update)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const ipAddress =
    (req as any).ip || req.headers.get("x-forwarded-for") || "N/A";
  const userAgent = req.headers.get("user-agent") || "N/A";

  const body = await req.json().catch(() => null);
  const disbursementTransactionId = body?.id ? String(body.id) : null;
  const loanId = body?.loanId ? String(body.loanId) : null;
  const isPosted = body?.isPosted === true;
  const cbsTransactionId = body?.transactionId
    ? String(body.transactionId).trim()
    : null;

  // Handle "Posted" loans - loans with no disbursement transaction record
  if (isPosted && loanId) {
    if (!cbsTransactionId) {
      await createAuditLog({
        actorId: user.id,
        action: "CANCEL_REQUEST_INVALID",
        entity: "Loan",
        entityId: loanId,
        details: { reason: "Missing transactionId", isPosted: true },
        ipAddress,
        userAgent,
      }).catch(() => null);
      return NextResponse.json(
        { error: "Missing CBS transaction ID" },
        { status: 400 }
      );
    }

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: { product: { include: { provider: true } } },
    });

    if (!loan) {
      await createAuditLog({
        actorId: user.id,
        action: "CANCEL_REQUEST_NOT_FOUND",
        entity: "Loan",
        entityId: loanId,
        details: { reason: "Loan not found", isPosted: true },
        ipAddress,
        userAgent,
      }).catch(() => null);
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }

    // Check if already cancelled or reversed
    const alreadyProcessed = await prisma.auditLog.findFirst({
      where: {
        action: { in: ["LOAN_CANCELLED", "LOAN_REVERSED"] },
        entity: "Loan",
        entityId: loanId,
      },
      select: { id: true, action: true },
    });
    if (alreadyProcessed) {
      return NextResponse.json(
        { ok: true, message: `Already ${alreadyProcessed.action === "LOAN_REVERSED" ? "reversed" : "cancelled"}` },
        { status: 200 }
      );
    }

    // Check for existing pending
    const existingPending = await prisma.pendingChange.findFirst({
      where: {
        status: "PENDING",
        entityType: { in: ["LoanReversal", "LoanCancel"] },
        entityId: loanId,
      },
      select: { id: true, entityType: true },
    });
    if (existingPending) {
      return NextResponse.json(
        {
          ok: true,
          message: `Already submitted for approval (${existingPending.entityType})`,
          changeId: existingPending.id,
        },
        { status: 200 }
      );
    }

    const payload = JSON.stringify({
      created: {
        loanId: loan.id,
        cbsTransactionId,
        borrowerId: loan.borrowerId,
        providerId: loan.product?.provider?.id,
        amount: loan.loanAmount,
        createdAt: loan.createdAt?.toISOString?.() ?? null,
        isPosted: true,
      },
    });

    const pending = await prisma.pendingChange.create({
      data: {
        entityType: "LoanCancel",
        entityId: loanId,
        changeType: "CREATE",
        payload,
        status: "PENDING",
        createdById: user.id,
      },
    });

    await createAuditLog({
      actorId: user.id,
      action: "LOAN_CANCEL_APPROVAL_REQUESTED",
      entity: "Loan",
      entityId: loanId,
      details: { changeId: pending.id, loanId, cbsTransactionId, isPosted: true },
      ipAddress,
      userAgent,
    });

    return NextResponse.json(
      { ok: true, message: "Submitted for approval", changeId: pending.id },
      { status: 201 }
    );
  }

  // Original flow for DisbursementTransaction
  if (!disbursementTransactionId) {
    await createAuditLog({
      actorId: user.id,
      action: "CANCEL_REQUEST_INVALID",
      entity: "DisbursementTransaction",
      details: { reason: "Missing id" },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json(
      { error: "Missing disbursement transaction id" },
      { status: 400 }
    );
  }

  if (!cbsTransactionId) {
    await createAuditLog({
      actorId: user.id,
      action: "CANCEL_REQUEST_INVALID",
      entity: "DisbursementTransaction",
      entityId: disbursementTransactionId,
      details: { reason: "Missing transactionId" },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json(
      { error: "Missing CBS transaction ID" },
      { status: 400 }
    );
  }

  const tx = await prisma.disbursementTransaction.findUnique({
    where: { id: disbursementTransactionId },
  });
  if (!tx) {
    await createAuditLog({
      actorId: user.id,
      action: "CANCEL_REQUEST_NOT_FOUND",
      entity: "DisbursementTransaction",
      entityId: disbursementTransactionId,
      details: { reason: "DisbursementTransaction not found" },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json(
      { error: "DisbursementTransaction not found" },
      { status: 404 }
    );
  }

  // Check if this is actually a failure status
  if (!isFailureStatus(tx.statusCode)) {
    await createAuditLog({
      actorId: user.id,
      action: "CANCEL_REQUEST_BLOCKED",
      entity: "DisbursementTransaction",
      entityId: tx.id,
      details: { reason: "Not marked as failed", statusCode: tx.statusCode },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json(
      {
        error: "This disbursement is not marked as failed; cancel is blocked.",
      },
      { status: 400 }
    );
  }

  // Check if it was already reversed
  const alreadyReversed = await prisma.auditLog.findFirst({
    where: {
      action: "DISBURSEMENT_REVERSED",
      entity: "DisbursementTransaction",
      entityId: tx.id,
    },
    select: { id: true },
  });
  if (alreadyReversed) {
    await createAuditLog({
      actorId: user.id,
      action: "CANCEL_REQUEST_BLOCKED",
      entity: "DisbursementTransaction",
      entityId: tx.id,
      details: { reason: "Already reversed, cannot cancel" },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json(
      {
        error:
          "This disbursement has already been reversed and cannot be cancelled.",
      },
      { status: 400 }
    );
  }

  // Check if it was already cancelled
  const alreadyCancelled = await prisma.auditLog.findFirst({
    where: {
      action: "DISBURSEMENT_CANCELLED",
      entity: "DisbursementTransaction",
      entityId: tx.id,
    },
    select: { id: true },
  });
  if (alreadyCancelled) {
    await createAuditLog({
      actorId: user.id,
      action: "CANCEL_REQUEST_ALREADY_CANCELLED",
      entity: "DisbursementTransaction",
      entityId: tx.id,
      details: { reason: "Already cancelled" },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json(
      { ok: true, message: "Already cancelled" },
      { status: 200 }
    );
  }

  // Check for existing pending approval (either reversal or cancel)
  const existingPending = await prisma.pendingChange.findFirst({
    where: {
      status: "PENDING",
      entityType: { in: ["DisbursementReversal", "DisbursementCancel"] },
      entityId: tx.id,
    },
    select: { id: true, entityType: true },
  });
  if (existingPending) {
    await createAuditLog({
      actorId: user.id,
      action: "CANCEL_REQUEST_ALREADY_PENDING",
      entity: "DisbursementTransaction",
      entityId: tx.id,
      details: {
        reason: "Already submitted for approval",
        changeId: existingPending.id,
        existingType: existingPending.entityType,
      },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json(
      {
        ok: true,
        message: `Already submitted for approval (${existingPending.entityType})`,
        changeId: existingPending.id,
      },
      { status: 200 }
    );
  }

  // Create a pending change for maker-checker approval
  const payload = JSON.stringify({
    created: {
      disbursementTransactionId: tx.id,
      cbsTransactionId,
      previousTransactionId: tx.transactionId,
      previousStatusCode: tx.statusCode,
      providerId: tx.providerId,
      originalProviderId: tx.originalProviderId,
      creditAccount: tx.creditAccount,
      amount: tx.amount,
      loanId: (tx as any).loanId ?? null,
      createdAt: tx.createdAt?.toISOString?.() ?? null,
    },
  });

  const pending = await prisma.pendingChange.create({
    data: {
      entityType: "DisbursementCancel",
      entityId: tx.id,
      changeType: "CREATE",
      payload,
      status: "PENDING",
      createdById: user.id,
    },
  });

  await createAuditLog({
    actorId: user.id,
    action: "CANCEL_APPROVAL_REQUESTED",
    entity: "DisbursementTransaction",
    entityId: tx.id,
    details: {
      changeId: pending.id,
      disbursementTransactionId: tx.id,
      cbsTransactionId,
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json(
    { ok: true, message: "Submitted for approval", changeId: pending.id },
    { status: 201 }
  );
}
