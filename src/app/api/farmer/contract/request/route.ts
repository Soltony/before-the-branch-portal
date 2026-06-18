import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { contractRequestSchema } from "@/lib/lersha/types";
import { createAuditLog } from "@/lib/audit-log";
import { isFarmerApprovedForProcessing } from "@/lib/lersha/farmer-status";
import { labelForLanguage } from "@/lib/lersha/contract-languages";
import {
  resolveActiveLershaTerms,
  pickContractText,
  generateUniqueContractCode,
} from "@/lib/lersha/contract";
import sendSms from "@/lib/sms";

/**
 * Diagram steps 3–4: Lersha submits a contract request for an approved farmer.
 * NIB generates a unique Contract ID, snapshots the chosen-language contract,
 * and sends the Contract ID to the farmer's registered phone number via SMS.
 *
 * POST /api/farmer/contract/request  { farmer_id, language_code }
 */
export async function POST(req: NextRequest) {
  try {
    console.log("[contract/request] Request received");
    const body = await req.json();
    console.log("[contract/request] Incoming payload:", body);

    const parsed = contractRequestSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("[contract/request] Validation failed:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { farmer_id, language_code } = parsed.data;

    const farmer = await prisma.lershaFarmer.findUnique({
      where: { farmerId: farmer_id },
    });
    if (!farmer) {
      console.warn("[contract/request] Farmer not found:", { farmer_id });
      return NextResponse.json(
        { error: "Farmer not found. Please register the farmer first." },
        { status: 404 },
      );
    }

    // The contract step sits between approval and loan processing.
    if (!isFarmerApprovedForProcessing(farmer.status)) {
      console.warn("[contract/request] Farmer not approved:", {
        farmer_id,
        status: farmer.status,
      });
      return NextResponse.json(
        {
          error:
            farmer.status === "PENDING_UPDATE"
              ? "Farmer profile was updated and is pending admin re-approval. Contracts cannot be issued yet."
              : "Farmer registration is not approved. Contracts cannot be issued yet.",
        },
        { status: 403 },
      );
    }

    const terms = await resolveActiveLershaTerms();
    if (!terms) {
      console.warn("[contract/request] No active terms configured");
      return NextResponse.json(
        { error: "No active terms and conditions are configured." },
        { status: 409 },
      );
    }

    const contractContent = pickContractText(terms, language_code);
    const contractCode = await generateUniqueContractCode();

    const contract = await prisma.loanContract.create({
      data: {
        farmerId: farmer.id,
        languageCode: language_code,
        contractCode,
        termsId: terms.id,
        contractContent,
        status: "PENDING",
      },
    });
    console.log("[contract/request] Contract created:", {
      contractId: contract.id,
      contractCode,
      languageCode: language_code,
    });

    // Send the Contract ID to the farmer (diagram step 4).
    const smsText = `Dear Customer, your loan contract ID is: ${contractCode}. Thank you.`;
    const smsResult = await sendSms(farmer.phoneNumber, smsText);
    console.log("[contract/request] SMS provider response:", smsResult);
    if (!smsResult.ok) {
      console.error("[contract/request] Failed to send contract SMS:", smsResult);
    }

    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_CONTRACT_REQUESTED",
      entity: "LoanContract",
      entityId: contract.id,
      details: {
        farmerId: farmer_id,
        languageCode: language_code,
        languageLabel: labelForLanguage(language_code),
        termsVersion: terms.version,
        smsSent: smsResult.ok,
      },
    });

    const response: Record<string, unknown> = {
      message: "Contract ID sent to farmer's registered phone number.",
      farmerId: farmer_id,
      languageCode: language_code,
      status: contract.status,
      smsSent: smsResult.ok,
    };
    // Expose the code only outside production to ease integration testing.
    if (process.env.NODE_ENV !== "production") {
      response.contractCode = contractCode;
    }

    console.log("[contract/request] Returning response:", response);
    return NextResponse.json(response, { status: 201 });
  } catch (error: any) {
    console.error("[contract/request] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
