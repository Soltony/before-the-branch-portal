import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';
import { createAuditLog } from '@/lib/audit-log';

function isFailureStatus(statusCode: number | null | undefined) {
  if (statusCode == null) return true;
  return statusCode < 200 || statusCode >= 300;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || (!user.permissions?.['reversals']?.update && !user.permissions?.['approvals']?.update && !user.permissions?.['reversal-approval']?.update)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const ipAddress = (req as any).ip || req.headers.get('x-forwarded-for') || 'N/A';
  const userAgent = req.headers.get('user-agent') || 'N/A';

  const body = await req.json().catch(() => null);
  const disbursementTransactionId = body?.id ? String(body.id) : null;
  const loanId = body?.loanId ? String(body.loanId) : null;
  const isPosted = body?.isPosted === true;

  // Handle "Posted" loans - loans with no disbursement transaction record
  if (isPosted && loanId) {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: { product: { include: { provider: true } } },
    });

    if (!loan) {
      await createAuditLog({
        actorId: user.id,
        action: 'REVERSAL_REQUEST_NOT_FOUND',
        entity: 'Loan',
        entityId: loanId,
        details: { reason: 'Loan not found', isPosted: true },
        ipAddress,
        userAgent,
      }).catch(() => null);
      return NextResponse.json({ error: 'Loan not found' }, { status: 404 });
    }

    // Check if already reversed
    const alreadyReversed = await prisma.auditLog.findFirst({
      where: {
        action: 'LOAN_REVERSED',
        entity: 'Loan',
        entityId: loanId,
      },
      select: { id: true },
    });
    if (alreadyReversed) {
      return NextResponse.json({ ok: true, message: 'Already reversed' }, { status: 200 });
    }

    // Check for existing pending
    const existingPending = await prisma.pendingChange.findFirst({
      where: {
        status: 'PENDING',
        entityType: { in: ['LoanReversal', 'LoanCancel'] },
        entityId: loanId,
      },
      select: { id: true },
    });
    if (existingPending) {
      return NextResponse.json({ ok: true, message: 'Already submitted for approval', changeId: existingPending.id }, { status: 200 });
    }

    const payload = JSON.stringify({
      created: {
        loanId: loan.id,
        borrowerId: loan.borrowerId,
        providerId: loan.product?.provider?.id,
        amount: loan.loanAmount,
        createdAt: loan.createdAt?.toISOString?.() ?? null,
        isPosted: true,
      },
    });

    const pending = await prisma.pendingChange.create({
      data: {
        entityType: 'LoanReversal',
        entityId: loanId,
        changeType: 'CREATE',
        payload,
        status: 'PENDING',
        createdById: user.id,
      },
    });

    await createAuditLog({
      actorId: user.id,
      action: 'LOAN_REVERSAL_APPROVAL_REQUESTED',
      entity: 'Loan',
      entityId: loanId,
      details: { changeId: pending.id, loanId, isPosted: true },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true, message: 'Submitted for approval', changeId: pending.id }, { status: 201 });
  }

  // Original flow for DisbursementTransaction
  if (!disbursementTransactionId) {
    await createAuditLog({
      actorId: user.id,
      action: 'REVERSAL_REQUEST_INVALID',
      entity: 'DisbursementTransaction',
      details: { reason: 'Missing id' },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const tx = await prisma.disbursementTransaction.findUnique({ where: { id: disbursementTransactionId } });
  if (!tx) {
    await createAuditLog({
      actorId: user.id,
      action: 'REVERSAL_REQUEST_NOT_FOUND',
      entity: 'DisbursementTransaction',
      entityId: disbursementTransactionId,
      details: { reason: 'DisbursementTransaction not found' },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json({ error: 'DisbursementTransaction not found' }, { status: 404 });
  }

  if (!isFailureStatus(tx.statusCode)) {
    await createAuditLog({
      actorId: user.id,
      action: 'REVERSAL_REQUEST_BLOCKED',
      entity: 'DisbursementTransaction',
      entityId: tx.id,
      details: { reason: 'Not marked failed', statusCode: tx.statusCode },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json({ error: 'This disbursement is not marked as failed; reversal is blocked.' }, { status: 400 });
  }

  const alreadyReversed = await prisma.auditLog.findFirst({
    where: {
      action: 'DISBURSEMENT_REVERSED',
      entity: 'DisbursementTransaction',
      entityId: tx.id,
    },
    select: { id: true },
  });
  if (alreadyReversed) {
    await createAuditLog({
      actorId: user.id,
      action: 'REVERSAL_REQUEST_ALREADY_REVERSED',
      entity: 'DisbursementTransaction',
      entityId: tx.id,
      details: { reason: 'Already reversed' },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json({ ok: true, message: 'Already reversed' }, { status: 200 });
  }

  const existingPending = await prisma.pendingChange.findFirst({
    where: {
      status: 'PENDING',
      entityType: 'DisbursementReversal',
      entityId: tx.id,
    },
    select: { id: true },
  });
  if (existingPending) {
    await createAuditLog({
      actorId: user.id,
      action: 'REVERSAL_REQUEST_ALREADY_PENDING',
      entity: 'DisbursementTransaction',
      entityId: tx.id,
      details: { reason: 'Already submitted for approval', changeId: existingPending.id },
      ipAddress,
      userAgent,
    }).catch(() => null);
    return NextResponse.json({ ok: true, message: 'Already submitted for approval', changeId: existingPending.id }, { status: 200 });
  }

  const payload = JSON.stringify({
    created: {
      disbursementTransactionId: tx.id,
      transactionId: tx.transactionId,
      providerId: tx.providerId,
      originalProviderId: tx.originalProviderId,
      creditAccount: tx.creditAccount,
      amount: tx.amount,
      statusCode: tx.statusCode,
      createdAt: tx.createdAt?.toISOString?.() ?? null,
    },
  });

  const pending = await prisma.pendingChange.create({
    data: {
      entityType: 'DisbursementReversal',
      entityId: tx.id,
      changeType: 'CREATE',
      payload,
      status: 'PENDING',
      createdById: user.id,
    },
  });

  await createAuditLog({
    actorId: user.id,
    action: 'REVERSAL_APPROVAL_REQUESTED',
    entity: 'DisbursementTransaction',
    entityId: tx.id,
    details: { changeId: pending.id, disbursementTransactionId: tx.id },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ ok: true, message: 'Submitted for approval', changeId: pending.id }, { status: 201 });
}
