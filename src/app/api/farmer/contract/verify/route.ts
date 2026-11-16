import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { contractVerifySchema } from "@/lib/lersha/types";
import { createAuditLog, getAuditRequestContext } from "@/lib/audit-log";

/**
 * Diagram steps 5–6: Lersha submits the Contract ID the farmer received via SMS.
 * NIB validates it against the farmer's pending contract and marks it SIGNED.
 * Only after this can the loan be processed (see /api/farmer/loanRequest).
 *
 * POST /api/farmer/contract/verify  { farmer_id, contract_id }
 */
export async function POST(req: NextRequest) {
  const auditCtx = getAuditRequestContext(req);
  let attemptedFarmerId: string | null = null;

  try {
    console.log("[contract/verify] Request received");
    const body = await req.json();
    console.log("[contract/verify] Incoming payload:", {
      ...body,
      contract_id: body?.contract_id ? "***" : undefined,
    });

    const parsed = contractVerifySchema.safeParse(body);
    if (!parsed.success) {
      console.warn("[contract/verify] Validation failed:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { farmer_id, contract_id } = parsed.data;
    attemptedFarmerId = farmer_id;

    // Presenting the Contract ID is the farmer's signature, so a wrong or
    // replayed one is worth a record: repeated failures against one farmer are
    // what guessing the code looks like. The submitted code is never written
    // here — a near-miss in the log would give most of it away.
    const auditFailed = (
      reason: string,
      target: { entity: string; entityId?: string },
      details: Record<string, unknown> = {},
    ) =>
      createAuditLog({
        actorId: "lersha-integration",
        action: "LERSHA_CONTRACT_VERIFY_FAILED",
        ...target,
        details: { farmerId: farmer_id, reason, ...details },
        ...auditCtx,
      });

    const farmer = await prisma.lershaFarmer.findUnique({
      where: { farmerId: farmer_id },
      select: { id: true },
    });
    if (!farmer) {
      console.warn("[contract/verify] Farmer not found:", { farmer_id });
      await auditFailed("FARMER_NOT_FOUND", { entity: "LershaFarmer" });
      return NextResponse.json({ error: "Farmer not found." }, { status: 404 });
    }

    const contract = await prisma.loanContract.findUnique({
      where: { contractCode: contract_id },
    });

    // Reject unknown codes or codes that belong to a different farmer (without
    // leaking which case it was).
    if (!contract || contract.farmerId !== farmer.id) {
      console.warn("[contract/verify] Invalid contract for farmer:", { farmer_id });
      await auditFailed(
        "INVALID_CONTRACT_ID",
        { entity: "LershaFarmer", entityId: farmer.id },
        // The response hides which case it was; the log does not need to.
        { belongsToAnotherFarmer: Boolean(contract) },
      );
      return NextResponse.json(
        { error: "Invalid Contract ID for this farmer." },
        { status: 404 },
      );
    }

    if (contract.status === "SIGNED") {
      console.warn("[contract/verify] Contract already signed:", {
        contractId: contract.id,
      });
      await auditFailed(
        "ALREADY_SIGNED",
        { entity: "LoanContract", entityId: contract.id },
        { signedAt: contract.signedAt },
      );
      return NextResponse.json(
        { error: "This contract has already been signed." },
        { status: 409 },
      );
    }

    if (contract.status !== "PENDING") {
      console.warn("[contract/verify] Contract not pending:", {
        contractId: contract.id,
        status: contract.status,
      });
      await auditFailed(
        "NOT_PENDING",
        { entity: "LoanContract", entityId: contract.id },
        { contractStatus: contract.status },
      );
      return NextResponse.json(
        { error: `Contract cannot be signed from status: ${contract.status}.` },
        { status: 409 },
      );
    }

    const signed = await prisma.loanContract.update({
      where: { id: contract.id },
      data: { status: "SIGNED", signedAt: new Date() },
    });

    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_CONTRACT_SIGNED",
      entity: "LoanContract",
      entityId: signed.id,
      details: {
        farmerId: farmer_id,
        languageCode: signed.languageCode,
        termsId: signed.termsId,
        signedAt: signed.signedAt,
      },
      ...auditCtx,
    });

    const response = {
      message: "Contract ID validated. Contract signed.",
      farmerId: farmer_id,
      status: signed.status,
      signedAt: signed.signedAt,
    };
    console.log("[contract/verify] Returning response:", response);
    return NextResponse.json(response, { status: 200 });
  } catch (error: any) {
    console.error("[contract/verify] Error:", error);
    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_CONTRACT_VERIFY_FAILED",
      entity: "LershaFarmer",
      details: {
        farmerId: attemptedFarmerId,
        reason: "UNEXPECTED_ERROR",
        error: error?.message ?? String(error),
      },
      ...auditCtx,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
