import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { otpConfirmationSchema } from "@/lib/lersha/types";
import { createAuditLog, getAuditRequestContext } from "@/lib/audit-log";
import { autoDisburseFarmerLoan } from "@/lib/lersha/disbursement";
import { isFarmerApprovedForProcessing } from "@/lib/lersha/farmer-status";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const auditCtx = getAuditRequestContext(req);
  let attemptedRequestId: string | null = null;

  try {
    console.log("[OtpConfirmation] Request received");
    const body = await req.json();
    console.log("[OtpConfirmation] Incoming payload:", body);

    const parsed = otpConfirmationSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("[OtpConfirmation] Validation failed:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { uniqueRequestIdentifier, otp } = parsed.data;
    console.log("[OtpConfirmation] Parsed payload:", {
      uniqueRequestIdentifier,
      otpLength: otp.length,
    });
    attemptedRequestId = uniqueRequestIdentifier;

    // The OTP is what authorises the loan, so every attempt that does not pass
    // is recorded: a run of INVALID_OTP entries against one request is what
    // guessing the code looks like, and nothing else in the system would show
    // it. The submitted code is never written to the log.
    const auditFailed = (
      reason: string,
      details: Record<string, unknown> = {},
      found = true,
    ) =>
      createAuditLog({
        actorId: "lersha-integration",
        action: "LERSHA_OTP_VERIFICATION_FAILED",
        entity: "LershaLoanRequest",
        // Only point at a row that exists.
        entityId: found ? uniqueRequestIdentifier : undefined,
        details: { requestId: uniqueRequestIdentifier, reason, ...details },
        ...auditCtx,
      });

    // Find the loan request by ID
    const loanRequest = await prisma.lershaLoanRequest.findUnique({
      where: { id: uniqueRequestIdentifier },
      include: { farmer: true },
    });

    if (!loanRequest) {
      console.warn("[OtpConfirmation] Loan request not found:", {
        uniqueRequestIdentifier,
      });
      await auditFailed("LOAN_REQUEST_NOT_FOUND", {}, false);
      return NextResponse.json(
        { error: "Loan request not found." },
        { status: 404 },
      );
    }

    const attempt = {
      farmerId: loanRequest.farmer.farmerId,
      productId: loanRequest.productId,
    };

    if (!isFarmerApprovedForProcessing(loanRequest.farmer.status)) {
      console.warn("[OtpConfirmation] Farmer not approved for processing:", {
        uniqueRequestIdentifier,
        farmerId: loanRequest.farmer.farmerId,
        status: loanRequest.farmer.status,
      });
      await auditFailed("FARMER_NOT_APPROVED", {
        ...attempt,
        farmerStatus: loanRequest.farmer.status,
      });
      return NextResponse.json(
        {
          error:
            loanRequest.farmer.status === "PENDING_UPDATE"
              ? "Farmer profile was updated and requires admin re-approval before OTP confirmation or disbursement."
              : "Farmer registration is not approved. OTP confirmation is not allowed.",
        },
        { status: 403 },
      );
    }

    if (loanRequest.otpVerified) {
      console.warn("[OtpConfirmation] OTP already verified:", {
        uniqueRequestIdentifier,
      });
      await auditFailed("ALREADY_VERIFIED", {
        ...attempt,
        requestStatus: loanRequest.status,
      });
      return NextResponse.json(
        { error: "OTP has already been verified for this request." },
        { status: 409 },
      );
    }

    // Check expiry
    if (loanRequest.otpExpiresAt && new Date() > loanRequest.otpExpiresAt) {
      console.warn("[OtpConfirmation] OTP expired:", {
        uniqueRequestIdentifier,
        otpExpiresAt: loanRequest.otpExpiresAt,
      });
      await auditFailed("OTP_EXPIRED", {
        ...attempt,
        otpExpiresAt: loanRequest.otpExpiresAt,
      });
      return NextResponse.json(
        { error: "OTP has expired. Please request a new loan." },
        { status: 410 },
      );
    }

    // Verify OTP (constant-time comparison to prevent timing attacks)
    const storedOtp = loanRequest.otp ?? "";
    if (
      otp.length !== storedOtp.length ||
      !timingSafeEqual(otp, storedOtp)
    ) {
      console.warn("[OtpConfirmation] Invalid OTP submitted:", {
        uniqueRequestIdentifier,
      });
      await auditFailed("INVALID_OTP", attempt);
      return NextResponse.json(
        { error: "Invalid OTP." },
        { status: 401 },
      );
    }

    // Generate reference number
    const referenceNo = `REF${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Update the loan request
    const updated = await prisma.lershaLoanRequest.update({
      where: { id: uniqueRequestIdentifier },
      data: {
        otpVerified: true,
        otp: null, // Clear OTP after verification
        status: "OTP_VERIFIED",
        referenceNo,
      },
    });
    console.log("[OtpConfirmation] OTP verified and request updated:", {
      requestId: updated.id,
      referenceNo,
    });

    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_OTP_VERIFIED",
      entity: "LershaLoanRequest",
      entityId: updated.id,
      details: {
        farmerId: loanRequest.farmer.farmerId,
        productId: loanRequest.productId,
        referenceNo,
      },
      ...auditCtx,
    });

    const disbursement = await autoDisburseFarmerLoan(
      uniqueRequestIdentifier,
      auditCtx,
    );
    console.log("[OtpConfirmation] Post-OTP disbursement result:", disbursement);

    const otpResponse = disbursement.success
      ? {
          farmerId: loanRequest.farmer.farmerId,
          message: "OTP verified and loan disbursed successfully.",
          referenceNo,
          productId: loanRequest.productId,
          status: "DISBURSED" as const,
          disbursement,
        }
      : {
          farmerId: loanRequest.farmer.farmerId,
          message: "OTP verified successfully, but loan disbursement failed.",
          referenceNo,
          productId: loanRequest.productId,
          status: updated.status,
          disbursement,
        };
    console.log("[OtpConfirmation] Returning OTP verification response:", otpResponse);

    return NextResponse.json(otpResponse, { status: 200 });
  } catch (error: any) {
    console.error("[OtpConfirmation] Error:", error);
    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_OTP_VERIFICATION_FAILED",
      entity: "LershaLoanRequest",
      details: {
        requestId: attemptedRequestId,
        reason: "UNEXPECTED_ERROR",
        error: error?.message ?? String(error),
      },
      ...auditCtx,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Constant-time string comparison to prevent timing attacks on OTP.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
