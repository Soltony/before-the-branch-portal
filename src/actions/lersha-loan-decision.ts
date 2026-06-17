"use server";

import prisma from "@/lib/prisma";
import { sendLoanDecision } from "@/lib/lersha/client";
import { createAuditLog } from "@/lib/audit-log";
import logger from "@/lib/logger";

export type LoanDecisionInput = {
  loanRequestId: string;
  decision: "APPROVED" | "DECLINED";
  comment?: string;
};

export type LoanDecisionResult = {
  success: boolean;
  referenceNo?: string;
  lershaNotified: boolean;
  error?: string;
};

/**
 * Approve or decline a Lersha farmer loan request and notify Lersha.
 */
export async function processLoanDecision(
  input: LoanDecisionInput,
): Promise<LoanDecisionResult> {
  const { loanRequestId, decision, comment } = input;
  console.log("[LoanDecision] Received decision input:", input);

  const loanRequest = await prisma.lershaLoanRequest.findUnique({
    where: { id: loanRequestId },
    include: { farmer: true },
  });

  if (!loanRequest) {
    console.warn("[LoanDecision] Loan request not found:", loanRequestId);
    return { success: false, lershaNotified: false, error: "Loan request not found." };
  }

  if (loanRequest.status !== "OTP_VERIFIED") {
    console.warn("[LoanDecision] Invalid loan request status:", {
      loanRequestId,
      status: loanRequest.status,
    });
    return {
      success: false,
      lershaNotified: false,
      error: `Cannot make a decision on a request with status "${loanRequest.status}". Only OTP_VERIFIED requests can be decided.`,
    };
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
  console.log("[LoanDecision] Local request updated:", {
    loanRequestId,
    decision,
    referenceNo,
  });

  // Notify Lersha
  let lershaNotified = false;
  try {
    const lershaPayload = {
      farmer_id: loanRequest.farmer.farmerId,
      decision,
      comment: comment ?? undefined,
      reference_no: referenceNo,
    };
    console.log("[LoanDecision] Sending payload to Lersha:", lershaPayload);
    const lershaResult = await sendLoanDecision(lershaPayload);
    console.log("[LoanDecision] Response from Lersha:", {
      status: lershaResult.status,
      ok: lershaResult.ok,
      data: lershaResult.data,
    });

    lershaNotified = lershaResult.ok;

    // Store Lersha response
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
    console.error("[LoanDecision] Exception while notifying Lersha:", err);
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

  const response = { success: true, referenceNo, lershaNotified };
  console.log("[LoanDecision] Returning response:", response);
  return response;
}
