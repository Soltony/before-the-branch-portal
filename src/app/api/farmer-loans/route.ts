import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendLoanDecision } from "@/lib/lersha/client";
import { createAuditLog } from "@/lib/audit-log";
import logger from "@/lib/logger";
import { z } from "zod";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const search = searchParams.get("search")?.trim() || "";
    const status = searchParams.get("status")?.trim() || "";

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { farmerId: { contains: search } },
        { farmerName: { contains: search } },
        { phoneNumber: { contains: search } },
        { primaryCropType: { contains: search } },
      ];
    }

    const [farmers, total] = await Promise.all([
      prisma.lershaFarmer.findMany({
        where,
        include: {
          loanPurposes: true,
          loanRequests: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              referenceNo: true,
              otpVerified: true,
              lershaDecisionSentAt: true,
              createdAt: true,
            },
          },
          loanContracts: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              contractCode: true,
              languageCode: true,
              signedAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.lershaFarmer.count({ where }),
    ]);

    return NextResponse.json({
      farmers: farmers.map((f) => ({
        ...f,
        isUpdated:
          new Date(f.updatedAt).getTime() - new Date(f.createdAt).getTime() >
          60_000,
      })),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error: any) {
    console.error("[farmer-loans API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

const decisionSchema = z.object({
  loanRequestId: z.string().min(1),
  decision: z.enum(["APPROVED", "DECLINED"]),
  comment: z.string().optional(),
});

/**
 * POST — Approve or decline a loan request and notify Lersha.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { loanRequestId, decision, comment } = parsed.data;

    const loanRequest = await prisma.lershaLoanRequest.findUnique({
      where: { id: loanRequestId },
      include: { farmer: true },
    });

    if (!loanRequest) {
      return NextResponse.json(
        { error: "Loan request not found." },
        { status: 404 },
      );
    }

    if (loanRequest.status !== "OTP_VERIFIED") {
      return NextResponse.json(
        {
          error: `Cannot decide on a request with status "${loanRequest.status}". Only OTP_VERIFIED requests can be decided.`,
        },
        { status: 409 },
      );
    }

    const referenceNo =
      loanRequest.referenceNo ??
      `REF${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;

    // Update local status
    await prisma.lershaLoanRequest.update({
      where: { id: loanRequestId },
      data: {
        status: decision,
        referenceNo,
      },
    });

    // Notify Lersha
    let lershaNotified = false;
    try {
      const lershaResult = await sendLoanDecision({
        farmer_id: loanRequest.farmer.farmerId,
        decision,
        comment: comment ?? undefined,
        reference_no: referenceNo,
      });

      lershaNotified = lershaResult.ok;

      await prisma.lershaLoanRequest.update({
        where: { id: loanRequestId },
        data: {
          lershaDecisionSentAt: new Date(),
          lershaDecisionResponse: JSON.stringify(lershaResult.data),
        },
      });

      if (!lershaResult.ok) {
        logger.error(
          `[LoanDecision] Lersha responded with ${lershaResult.status} for request ${loanRequestId}`,
        );
      }
    } catch (err) {
      logger.error(
        `[LoanDecision] Failed to notify Lersha for request ${loanRequestId}: ${err}`,
      );
    }

    await createAuditLog({
      actorId: "system",
      action: `LERSHA_LOAN_${decision}`,
      entity: "LershaLoanRequest",
      entityId: loanRequestId,
      details: {
        farmerId: loanRequest.farmer.farmerId,
        decision,
        comment,
        referenceNo,
        lershaNotified,
      },
    });

    return NextResponse.json({
      success: true,
      referenceNo,
      lershaNotified,
      decision,
    });
  } catch (error: any) {
    console.error("[farmer-loans POST] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
