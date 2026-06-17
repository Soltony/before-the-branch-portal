import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";

import { disbursementConfirmationPayloadSchema } from "@/lib/lersha/types";

import { sendDisbursementConfirmation } from "@/lib/lersha/client";

import { createAuditLog } from "@/lib/audit-log";

import { autoDisburseFarmerLoan } from "@/lib/lersha/disbursement";



export async function POST(req: NextRequest) {

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



    const farmer = await prisma.lershaFarmer.findUnique({

      where: { farmerId: farmer_id },

    });

    if (!farmer) {

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

      return NextResponse.json(

        { error: "No eligible loan request found for this farmer." },

        { status: 404 },

      );

    }



    let disbursementResult: Awaited<ReturnType<typeof autoDisburseFarmerLoan>> | null =

      null;



    if (loanRequest.status === "OTP_VERIFIED") {

      disbursementResult = await autoDisburseFarmerLoan(loanRequest.id);

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



    const lershaResponse = await sendDisbursementConfirmation(lershaPayload);



    await createAuditLog({

      actorId: "system",

      action: "LERSHA_DISBURSEMENT_CONFIRMED",

      entity: "LershaLoanRequest",

      entityId: loanRequest.id,

      details: {

        farmerId: farmer_id,

        remainingBalance: remaining_balance,

        lershaResponseOk: lershaResponse.ok,

        lershaStatus: lershaResponse.status,

        disbursementResult,

      },

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

    return NextResponse.json(

      { error: "Internal server error" },

      { status: 500 },

    );

  }

}


