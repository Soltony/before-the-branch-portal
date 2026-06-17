"use server";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";
import { z, ZodError } from "zod";
import { validationErrorResponse, handleApiError } from "@/lib/error-utils";
import { createAuditLog } from "@/lib/audit-log";

// ---------------------------------------------------------------------------
// GET  /api/phone-change?phone=09...
// Looks up whether a phone number has any active (unpaid) loans.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const phone = req.nextUrl.searchParams.get("phone")?.trim();
    if (!phone) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    // Check if borrower exists
    const borrower = await prisma.borrower.findUnique({ where: { id: phone } });

    // Find active (unpaid) loans for this phone number
    const activeLoans = await prisma.loan.findMany({
      where: {
        borrowerId: phone,
        repaymentStatus: "Unpaid",
      },
      include: {
        product: {
          select: { name: true, provider: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Also check PhoneAccount for name info
    const phoneAccount = await prisma.phoneAccount.findFirst({
      where: { phoneNumber: phone, isActive: true },
    });

    return NextResponse.json({
      phone,
      borrowerExists: !!borrower,
      customerName: phoneAccount?.customerName || null,
      accountNumber: phoneAccount?.accountNumber || null,
      activeLoans: activeLoans.map((l) => ({
        id: l.id,
        loanAmount: l.loanAmount,
        repaidAmount: l.repaidAmount,
        disbursedDate: l.disbursedDate,
        dueDate: l.dueDate,
        productName: l.product.name,
        providerName: l.product.provider.name,
      })),
    });
  } catch (err: any) {
    return handleApiError(err, { operation: "phone-change-lookup" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/phone-change
// Creates a phone change request.
// ---------------------------------------------------------------------------
const createRequestSchema = z.object({
  oldPhoneNumber: z.string().min(1, "Old phone number is required"),
  newPhoneNumber: z.string().min(1, "New phone number is required"),
  reason: z.string().min(1, "Reason is required"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const data = createRequestSchema.parse(body);

    if (data.oldPhoneNumber === data.newPhoneNumber) {
      return NextResponse.json(
        { error: "Old and new phone numbers must be different" },
        { status: 400 }
      );
    }

    // Verify the old phone number has a borrower record
    const borrower = await prisma.borrower.findUnique({
      where: { id: data.oldPhoneNumber },
    });
    if (!borrower) {
      return NextResponse.json(
        { error: "No borrower found with the old phone number" },
        { status: 404 }
      );
    }

    // Verify the new phone number does NOT already have a borrower record
    const existingBorrower = await prisma.borrower.findUnique({
      where: { id: data.newPhoneNumber },
    });
    if (existingBorrower) {
      return NextResponse.json(
        { error: "A borrower already exists with the new phone number" },
        { status: 409 }
      );
    }

    // Check for duplicate pending requests
    const existingRequest = await prisma.phoneChangeRequest.findFirst({
      where: {
        oldPhoneNumber: data.oldPhoneNumber,
        status: "PENDING",
      },
    });
    if (existingRequest) {
      return NextResponse.json(
        { error: "A pending phone change request already exists for this phone number" },
        { status: 409 }
      );
    }

    const request = await prisma.phoneChangeRequest.create({
      data: {
        oldPhoneNumber: data.oldPhoneNumber,
        newPhoneNumber: data.newPhoneNumber,
        reason: data.reason,
        requestedById: user.id,
      },
    });

    await createAuditLog({
      actorId: user.id,
      action: "PHONE_CHANGE_REQUESTED",
      entity: "PhoneChangeRequest",
      entityId: request.id,
      details: {
        oldPhoneNumber: data.oldPhoneNumber,
        newPhoneNumber: data.newPhoneNumber,
      },
    });

    return NextResponse.json(request, { status: 201 });
  } catch (err: any) {
    if (err instanceof ZodError) return validationErrorResponse(err);
    return handleApiError(err, { operation: "phone-change-create" });
  }
}
