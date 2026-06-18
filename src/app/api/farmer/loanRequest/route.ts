import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { loanRequestSchema } from "@/lib/lersha/types";
import { createAuditLog } from "@/lib/audit-log";
import { randomInt } from "crypto";
import { isFarmerApprovedForProcessing } from "@/lib/lersha/farmer-status";
import sendSms from "@/lib/sms";

/** Generate a 6-character alphanumeric OTP */
function generateOtp(): string {
  const chars = "0123456789";
  let otp = "";
  for (let i = 0; i < 6; i++) {
    otp += chars[randomInt(chars.length)];
  }
  return otp;
}

const OTP_EXPIRY_MINUTES = 5;

export async function POST(req: NextRequest) {
  try {
    console.log("[loanRequest] Request received");
    const body = await req.json();
    console.log("[loanRequest] Incoming payload:", body);

    const parsed = loanRequestSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("[loanRequest] Validation failed:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { farmer_id, product_id } = parsed.data;
    console.log("[loanRequest] Parsed identifiers:", { farmer_id, product_id });

    // Verify farmer exists
    const farmer = await prisma.lershaFarmer.findUnique({
      where: { farmerId: farmer_id },
    });
    if (!farmer) {
      console.warn("[loanRequest] Farmer not found:", { farmer_id });
      return NextResponse.json(
        { error: "Farmer not found. Please register the farmer first." },
        { status: 404 },
      );
    }

    // Must be approved before any loan request (including after profile updates).
    if (!isFarmerApprovedForProcessing(farmer.status)) {
      console.warn("[loanRequest] Farmer not approved for loan processing:", {
        farmer_id,
        status: farmer.status,
      });
      return NextResponse.json(
        {
          error:
            farmer.status === "PENDING_UPDATE"
              ? "Farmer profile was updated and is pending admin re-approval. Loan requests are blocked until approved."
              : "Farmer registration is not approved. Loan requests are not allowed yet.",
        },
        { status: 403 },
      );
    }

    // A signed loan contract is a prerequisite to processing the loan.
    const signedContract = await prisma.loanContract.findFirst({
      where: { farmerId: farmer.id, status: "SIGNED" },
      orderBy: { signedAt: "desc" },
    });
    if (!signedContract) {
      console.warn("[loanRequest] No signed loan contract for farmer:", {
        farmer_id,
      });
      return NextResponse.json(
        {
          error:
            "A signed loan contract is required before processing this loan. Please complete the loan contract step first.",
        },
        { status: 403 },
      );
    }

    // Verify the product_id belongs to this farmer's loan purposes
    const loanPurpose = await prisma.lershaLoanPurpose.findUnique({
      where: { productId: product_id },
    });
    if (!loanPurpose || loanPurpose.farmerId !== farmer.id) {
      console.warn("[loanRequest] Invalid product for farmer:", {
        farmer_id,
        product_id,
      });
      return NextResponse.json(
        { error: "Invalid product_id for this farmer." },
        { status: 400 },
      );
    }
    console.log("[loanRequest] Loan purpose resolved:", {
      product_id,
      loanPurpose: loanPurpose.loanPurpose,
      productTotalCost: loanPurpose.totalCost,
    });

    const previousDisbursedRequests = await prisma.lershaLoanRequest.findMany({
      where: {
        farmerId: farmer.id,
        status: "DISBURSED",
      },
      select: {
        productId: true,
      },
    });
    const disbursedProductIds = previousDisbursedRequests
      .map((r) => r.productId)
      .filter((id): id is string => Boolean(id));

    // A product line should only be disbursed once.
    if (disbursedProductIds.includes(product_id)) {
      console.warn("[loanRequest] Product already disbursed for farmer:", {
        farmer_id,
        product_id,
      });
      return NextResponse.json(
        { error: "This product has already been disbursed for this farmer." },
        { status: 409 },
      );
    }

    let totalDisbursedAmount = 0;
    if (disbursedProductIds.length > 0) {
      const disbursedPurposes = await prisma.lershaLoanPurpose.findMany({
        where: {
          farmerId: farmer.id,
          productId: { in: disbursedProductIds },
        },
        select: { totalCost: true },
      });
      totalDisbursedAmount = disbursedPurposes.reduce(
        (sum, item) => sum + item.totalCost,
        0,
      );
    }
    const remainingBeforeRequest = farmer.requestedLoanAmount - totalDisbursedAmount;
    console.log("[loanRequest] Farmer balance before request:", {
      requestedLoanAmount: farmer.requestedLoanAmount,
      totalDisbursedAmount,
      remainingBeforeRequest,
    });

    if (loanPurpose.totalCost > remainingBeforeRequest) {
      console.warn("[loanRequest] Insufficient remaining balance for product:", {
        farmer_id,
        product_id,
        requestedProductAmount: loanPurpose.totalCost,
        remainingBeforeRequest,
      });
      return NextResponse.json(
        {
          error:
            "Insufficient remaining balance for this product request.",
        },
        { status: 409 },
      );
    }

    // Generate OTP and expiry
    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    console.log("[loanRequest] OTP generated:", {
      farmer_id,
      requestExpiry: otpExpiresAt.toISOString(),
    });

    // Create loan request record
    const loanRequest = await prisma.lershaLoanRequest.create({
      data: {
        farmerId: farmer.id,
        productId: product_id,
        otp,
        otpExpiresAt,
        status: "PENDING_OTP",
      },
    });

    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_LOAN_REQUESTED",
      entity: "LershaLoanRequest",
      entityId: loanRequest.id,
      details: {
        farmerId: farmer_id,
        productId: product_id,
        productAmount: loanPurpose.totalCost,
        remainingBeforeRequest,
      },
    });

    // Send OTP directly to farmer via SMS
    // const smsText = `Your NIB loan verification code is: ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`;
    // console.log("[loanRequest] Sending OTP SMS:", {
    //   phoneNumber: farmer.phoneNumber,
    //   requestId: loanRequest.id,
    // });
    // const smsResult = await sendSms(farmer.phoneNumber, smsText);
    // console.log("[loanRequest] SMS provider response:", smsResult);

    // if (!smsResult.ok) {
    //   console.error("[loanRequest] Failed to send OTP SMS:", smsResult);
    // }

    const response = {
      message: "OTP sent to farmer's registered phone number.",
      requestId: loanRequest.id,
      expiresAt: otpExpiresAt.toISOString(),
      //smsSent: smsResult.ok,
      productAmount: loanPurpose.totalCost,
      remainingBeforeRequest,
    };
    console.log("[loanRequest] Returning response:", response);
    return NextResponse.json(response, { status: 201 });
  } catch (error: any) {
    console.error("[loanRequest] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
