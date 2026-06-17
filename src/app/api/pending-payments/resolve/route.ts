import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";
import { createAuditLog } from "@/lib/audit-log";

/**
 * POST /api/pending-payments/resolve
 *
 * Creates a maker-checker pending change request to mark a pending payment as successful.
 * The actual recording of the repayment happens when the request is approved.
 *
 * Body: { pendingPaymentId: string, ftReference: string }
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromSession();
  if (
    !user ||
    (!user.permissions?.["approvals"]?.update &&
      !user.permissions?.["reversals"]?.update)
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const ipAddress =
    (req as any).ip || req.headers.get("x-forwarded-for") || "N/A";
  const userAgent = req.headers.get("user-agent") || "N/A";

  const body = await req.json().catch(() => null);
  const pendingPaymentId = body?.pendingPaymentId
    ? String(body.pendingPaymentId).trim()
    : null;
  const ftReference = body?.ftReference
    ? String(body.ftReference).trim()
    : null;
  const paymentDate = body?.paymentDate ? String(body.paymentDate).trim() : null;

  if (!pendingPaymentId || !ftReference) {
    return NextResponse.json(
      { error: "Missing pendingPaymentId or ftReference" },
      { status: 400 }
    );
  }

  // Find the pending payment
  const pendingPayment = await prisma.pendingPayment.findUnique({
    where: { id: pendingPaymentId },
    include: {
      loan: {
        select: {
          id: true,
          loanAmount: true,
          repaidAmount: true,
          repaymentStatus: true,
          borrowerId: true,
          product: {
            select: {
              name: true,
              provider: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!pendingPayment) {
    return NextResponse.json(
      { error: "Pending payment not found" },
      { status: 404 }
    );
  }

  if (pendingPayment.status !== "PENDING") {
    return NextResponse.json(
      {
        error: `This payment has already been ${pendingPayment.status.toLowerCase()}`,
      },
      { status: 409 }
    );
  }

  // Check for existing pending approval
  const existingPending = await prisma.pendingChange.findFirst({
    where: {
      status: "PENDING",
      entityType: "PendingPaymentResolve",
      entityId: pendingPaymentId,
    },
    select: { id: true },
  });

  if (existingPending) {
    return NextResponse.json(
      {
        ok: true,
        message: "A resolution request is already pending approval",
        changeId: existingPending.id,
      },
      { status: 200 }
    );
  }

  // Create the pending change for maker-checker approval
  const pendingChange = await prisma.pendingChange.create({
    data: {
      entityType: "PendingPaymentResolve",
      entityId: pendingPaymentId,
      changeType: "CREATE",
      payload: JSON.stringify({
        created: {
          pendingPaymentId: pendingPayment.id,
          transactionId: pendingPayment.transactionId,
          ftReference,
          loanId: pendingPayment.loanId,
          borrowerId: pendingPayment.borrowerId,
          amount: pendingPayment.amount,
          paymentDate,
          providerName: pendingPayment.loan?.product?.provider?.name ?? null,
          providerId: pendingPayment.loan?.product?.provider?.id ?? null,
          productName: pendingPayment.loan?.product?.name ?? null,
        },
      }),
      createdById: user.id,
    },
  });

  await createAuditLog({
    actorId: user.id,
    action: "PENDING_PAYMENT_RESOLVE_REQUESTED",
    entity: "PendingPayment",
    entityId: pendingPaymentId,
    details: {
      pendingPaymentId,
      ftReference,
      loanId: pendingPayment.loanId,
      borrowerId: pendingPayment.borrowerId,
      amount: pendingPayment.amount,
      changeId: pendingChange.id,
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({
    ok: true,
    message: "Resolve request submitted for approval",
    changeId: pendingChange.id,
  });
}
