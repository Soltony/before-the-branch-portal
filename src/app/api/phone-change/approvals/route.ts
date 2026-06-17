"use server";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";
import { z, ZodError } from "zod";
import { validationErrorResponse, handleApiError } from "@/lib/error-utils";
import { createAuditLog } from "@/lib/audit-log";

// ---------------------------------------------------------------------------
// GET  /api/phone-change/approvals
// Returns paginated list of phone change requests (defaults to PENDING).
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const status = req.nextUrl.searchParams.get("status") || "PENDING";
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 10));
    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      prisma.phoneChangeRequest.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.phoneChangeRequest.count({ where: { status } }),
    ]);

    // Fetch requester names
    const requesterIds = [...new Set(requests.map((r) => r.requestedById))];
    const requesters = await prisma.user.findMany({
      where: { id: { in: requesterIds } },
      select: { id: true, fullName: true },
    });
    const requesterMap = new Map(requesters.map((u) => [u.id, u.fullName]));

    return NextResponse.json({
      data: requests.map((r) => ({
        ...r,
        requestedByName: requesterMap.get(r.requestedById) || "Unknown",
      })),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err: any) {
    return handleApiError(err, { operation: "phone-change-approvals-list" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/phone-change/approvals
// Approve or reject a phone change request.
// ---------------------------------------------------------------------------
const approvalSchema = z.object({
  requestId: z.string(),
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const data = approvalSchema.parse(body);

    const request = await prisma.phoneChangeRequest.findUnique({
      where: { id: data.requestId },
    });

    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (request.status !== "PENDING") {
      return NextResponse.json(
        { error: "This request has already been processed" },
        { status: 409 }
      );
    }

    // Cannot approve own request
    if (request.requestedById === user.id) {
      return NextResponse.json(
        { error: "You cannot approve your own request" },
        { status: 403 }
      );
    }

    if (!data.approved) {
      if (!data.rejectionReason?.trim()) {
        return NextResponse.json(
          { error: "Rejection reason is required" },
          { status: 400 }
        );
      }

      await prisma.phoneChangeRequest.update({
        where: { id: data.requestId },
        data: {
          status: "REJECTED",
          approvedById: user.id,
          approvedAt: new Date(),
          rejectionReason: data.rejectionReason,
        },
      });

      await createAuditLog({
        actorId: user.id,
        action: "PHONE_CHANGE_REJECTED",
        entity: "PhoneChangeRequest",
        entityId: request.id,
        details: {
          oldPhoneNumber: request.oldPhoneNumber,
          newPhoneNumber: request.newPhoneNumber,
          reason: data.rejectionReason,
        },
      });

      return NextResponse.json({ success: true, status: "REJECTED" });
    }

    // ---- APPROVE: migrate borrower data from old phone to new phone ----

    // Re-validate: old borrower must still exist
    const oldBorrower = await prisma.borrower.findUnique({
      where: { id: request.oldPhoneNumber },
    });
    if (!oldBorrower) {
      return NextResponse.json(
        { error: "Old borrower record no longer exists" },
        { status: 400 }
      );
    }

    // Re-validate: no active loans on old phone
    const activeLoans = await prisma.loan.count({
      where: { borrowerId: request.oldPhoneNumber, repaymentStatus: "Unpaid" },
    });
    if (activeLoans > 0) {
      return NextResponse.json(
        { error: "Cannot change: there are now active loans on the old phone number" },
        { status: 400 }
      );
    }

    // Re-validate: new phone must not already exist as a borrower
    const newBorrower = await prisma.borrower.findUnique({
      where: { id: request.newPhoneNumber },
    });
    if (newBorrower) {
      return NextResponse.json(
        { error: "A borrower already exists with the new phone number" },
        { status: 409 }
      );
    }

    // Execute the migration in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Create new borrower record with same status
      await tx.borrower.create({
        data: {
          id: request.newPhoneNumber,
          status: oldBorrower.status,
        },
      });

      // 2. Update all loans to point to new borrower
      await tx.loan.updateMany({
        where: { borrowerId: request.oldPhoneNumber },
        data: { borrowerId: request.newPhoneNumber },
      });

      // 3. Update loan applications
      await tx.loanApplication.updateMany({
        where: { borrowerId: request.oldPhoneNumber },
        data: { borrowerId: request.newPhoneNumber },
      });

      // 4. Update provisioned data
      await tx.provisionedData.updateMany({
        where: { borrowerId: request.oldPhoneNumber },
        data: { borrowerId: request.newPhoneNumber },
      });

      // 5. Update borrower agreements
      await tx.borrowerAgreement.updateMany({
        where: { borrowerId: request.oldPhoneNumber },
        data: { borrowerId: request.newPhoneNumber },
      });

      // 6. Update pending payments
      await tx.pendingPayment.updateMany({
        where: { borrowerId: request.oldPhoneNumber },
        data: { borrowerId: request.newPhoneNumber },
      });

      // 7. Update account statements
      await tx.accountStatement.updateMany({
        where: { borrowerId: request.oldPhoneNumber },
        data: { borrowerId: request.newPhoneNumber },
      });

      // 8. Update account statement metrics
      await tx.accountStatementMetrics.updateMany({
        where: { borrowerId: request.oldPhoneNumber },
        data: { borrowerId: request.newPhoneNumber },
      });

      // 9. Update phone accounts to new phone number
      await tx.phoneAccount.updateMany({
        where: { phoneNumber: request.oldPhoneNumber },
        data: { phoneNumber: request.newPhoneNumber },
      });

      // 10. Delete old borrower record
      await tx.borrower.delete({
        where: { id: request.oldPhoneNumber },
      });

      // 11. Mark request as approved
      await tx.phoneChangeRequest.update({
        where: { id: data.requestId },
        data: {
          status: "APPROVED",
          approvedById: user.id,
          approvedAt: new Date(),
        },
      });
    });

    await createAuditLog({
      actorId: user.id,
      action: "PHONE_CHANGE_APPROVED",
      entity: "PhoneChangeRequest",
      entityId: request.id,
      details: {
        oldPhoneNumber: request.oldPhoneNumber,
        newPhoneNumber: request.newPhoneNumber,
      },
    });

    return NextResponse.json({ success: true, status: "APPROVED" });
  } catch (err: any) {
    if (err instanceof ZodError) return validationErrorResponse(err);
    return handleApiError(err, { operation: "phone-change-approval" });
  }
}
