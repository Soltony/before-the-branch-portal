import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendFarmerDetailArraySchema } from "@/lib/lersha/types";
import { createAuditLog } from "@/lib/audit-log";
import {
  farmerProfileData,
  syncLoanPurposes,
} from "@/lib/lersha/farmer-sync";
import { isFarmerPendingApproval, resolveStatusOnUpdate } from "@/lib/lersha/farmer-status";

export async function POST(req: NextRequest) {
  try {
    console.log("[sendFarmerDetail] Request received");
    const body = await req.json();
    console.log("[sendFarmerDetail] Incoming payload:", body);

    const parsed = sendFarmerDetailArraySchema.safeParse(body);
    if (!parsed.success) {
      console.warn("[sendFarmerDetail] Validation failed:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const farmers = parsed.data;
    console.log("[sendFarmerDetail] Farmers to process:", farmers.length);
    const results: {
      farmerId: string;
      status: "REGISTERED" | "UPDATED";
      registrationStatus: string;
      requiresApproval: boolean;
      loanPurposes: {
        productId: string | null;
        loanPurpose: string;
        specificVarietyName: string | null;
      }[];
    }[] = [];

    for (const farmer of farmers) {
      console.log("[sendFarmerDetail] Processing farmer:", {
        farmerId: farmer.farmerId,
        farmerName: farmer.farmerName,
      });

      const existing = await prisma.lershaFarmer.findUnique({
        where: { farmerId: farmer.farmerId },
      });

      const profile = farmerProfileData(farmer);
      const upserted = existing
        ? await prisma.lershaFarmer.update({
            where: { farmerId: farmer.farmerId },
            data: {
              ...profile,
              status: resolveStatusOnUpdate(existing.status),
            },
          })
        : await prisma.lershaFarmer.create({
            data: {
              farmerId: farmer.farmerId,
              ...profile,
              status: farmer.status ?? "PENDING",
            },
          });

      const loanPurposeResults = await syncLoanPurposes(
        upserted.id,
        farmer.loanPurposes,
      );

      const operationStatus = existing ? "UPDATED" : "REGISTERED";
      results.push({
        farmerId: farmer.farmerId,
        status: operationStatus,
        registrationStatus: upserted.status,
        requiresApproval: isFarmerPendingApproval(upserted.status),
        loanPurposes: loanPurposeResults,
      });

      await createAuditLog({
        actorId: "lersha-integration",
        action:
          operationStatus === "UPDATED"
            ? "LERSHA_FARMER_UPDATED"
            : "LERSHA_FARMER_REGISTERED",
        entity: "LershaFarmer",
        entityId: upserted.id,
        details: {
          farmerId: farmer.farmerId,
          farmerName: farmer.farmerName,
          loanPurposeCount: loanPurposeResults.length,
          previousStatus: existing?.status ?? null,
          currentStatus: upserted.status,
          requiresReapproval:
            upserted.status === "PENDING_UPDATE" ||
            (existing && upserted.status === "PENDING"),
        },
      });

      console.log("[sendFarmerDetail] Farmer processed:", {
        farmerId: farmer.farmerId,
        operationStatus,
        loanPurposes: loanPurposeResults.length,
      });
    }

    const hasUpdates = results.some((r) => r.status === "UPDATED");
    const response = {
      message: hasUpdates
        ? "Farmer details saved successfully (includes updates)."
        : "Farmer details registered successfully",
      results,
    };
    console.log("[sendFarmerDetail] Returning response:", response);
    return NextResponse.json(response, {
      status: hasUpdates ? 200 : 201,
    });
  } catch (error: any) {
    console.error("[sendFarmerDetail] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
