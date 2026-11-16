import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";

import { disbursementConfirmationPayloadSchema } from "@/lib/lersha/types";

import { sendDisbursementConfirmation } from "@/lib/lersha/client";

import { createAuditLog, getAuditRequestContext } from "@/lib/audit-log";

import { autoDisburseFarmerLoan } from "@/lib/lersha/disbursement";



export async function POST(req: NextRequest) {

  const auditCtx = getAuditRequestContext(req);

  let attemptedFarmerId: string | null = null;

  try {

    console.log("[disbursement] Request received");

    const body = await req.json();

    console.log("[disbursement] Incoming payload:", body);



    const parsed = disbursementConfirmationPayloadSchema.safeParse(body);

    if (!parsed.success) {

      console.warn("[disbursement] Validation failed:", parsed.error.flatten());

      return NextResponse.json(

        { error: "Validation failed", details: parsed.error.flatten() },

        { status: 400 },

      );

    }



    const { farmer_id, remaining_balance } = parsed.data;

    attemptedFarmerId = farmer_id;

    // This endpoint can trigger a disbursement, so a call that ends without one

    // is recorded with its reason. (A disbursement that was attempted and

    // refused is recorded by autoDisburseFarmerLoan itself.)

    const auditFailed = (

      reason: string,

      target: { entity: string; entityId?: string },

    ) =>

      createAuditLog({

        actorId: "lersha-integration",

        action: "LERSHA_DISBURSEMENT_CONFIRMATION_FAILED",

        ...target,

        details: {

          farmerId: farmer_id,

          remainingBalance: remaining_balance,

          reason,

        },

        ...auditCtx,

      });



    const farmer = await prisma.lershaFarmer.findUnique({

      where: { farmerId: farmer_id },

    });

    if (!farmer) {

      await auditFailed("FARMER_NOT_FOUND", { entity: "LershaFarmer" });

      return NextResponse.json(

        { error: "Farmer not found." },

        { status: 404 },

      );

    }



    const loanRequest = await prisma.lershaLoanRequest.findFirst({

      where: {

        farmerId: farmer.id,

        status: { in: ["OTP_VERIFIED", "DISBURSED"] },

      },

      orderBy: { createdAt: "desc" },

    });



    if (!loanRequest) {

      await auditFailed("NO_ELIGIBLE_LOAN_REQUEST", {

        entity: "LershaFarmer",

        entityId: farmer.id,

      });

      return NextResponse.json(

        { error: "No eligible loan request found for this farmer." },

        { status: 404 },

      );

    }



    let disbursementResult: Awaited<ReturnType<typeof autoDisburseFarmerLoan>> | null =

      null;



    if (loanRequest.status === "OTP_VERIFIED") {

      disbursementResult = await autoDisburseFarmerLoan(loanRequest.id, auditCtx);

      if (!disbursementResult.success) {

        return NextResponse.json(

          {

            error: "Loan disbursement failed.",

            details: disbursementResult,

          },

          { status: 500 },

        );

      }

    }



    const refreshed = await prisma.lershaLoanRequest.findUnique({

      where: { id: loanRequest.id },

    });



    if (!refreshed?.referenceNo) {

      await auditFailed("MISSING_REFERENCE_NO", {

        entity: "LershaLoanRequest",

        entityId: loanRequest.id,

      });

      return NextResponse.json(

        { error: "Loan request is missing referenceNo." },

        { status: 400 },

      );

    }



    await prisma.lershaLoanRequest.update({

      where: { id: loanRequest.id },

      data: {

        remainingBalance: remaining_balance,

        disbursementConfirmedAt: new Date(),

      },

    });



    const lershaPayload = {

      farmer_id,

      remaining_balance,

      productId: refreshed.productId,

      referenceNo: refreshed.referenceNo,

      status: "DISBURSED" as const,

    };



    const lershaResponse = await sendDisbursementConfirmation(lershaPayload, {

      actorId: "lersha-integration",

      ...auditCtx,

      entity: "LershaLoanRequest",

      entityId: loanRequest.id,

    });



    await createAuditLog({

      // Lersha calls this endpoint; "system" made it look like a scheduled job.

      actorId: "lersha-integration",

      action: "LERSHA_DISBURSEMENT_CONFIRMED",

      entity: "LershaLoanRequest",

      entityId: loanRequest.id,

      details: {

        farmerId: farmer_id,

        remainingBalance: remaining_balance,

        // What the balance was before Lersha's figure overwrote it.

        previousRemainingBalance: refreshed.remainingBalance,

        productId: refreshed.productId,

        referenceNo: refreshed.referenceNo,

        lershaResponseOk: lershaResponse.ok,

        lershaStatus: lershaResponse.status,

        disbursementResult,

      },

      ...auditCtx,

    });



    return NextResponse.json(

      {

        message: "Disbursement confirmed and Lersha notified.",

        loanRequestId: loanRequest.id,

        remainingBalance: remaining_balance,

        lershaNotified: lershaResponse.ok,

        disbursement: disbursementResult,

      },

      { status: 200 },

    );

  } catch (error: any) {

    console.error("[disbursement] Error:", error);

    await createAuditLog({

      actorId: "lersha-integration",

      action: "LERSHA_DISBURSEMENT_CONFIRMATION_FAILED",

      entity: "LershaFarmer",

      details: {

        farmerId: attemptedFarmerId,

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


