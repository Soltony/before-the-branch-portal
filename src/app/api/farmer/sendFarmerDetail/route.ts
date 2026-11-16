import { NextRequest, NextResponse } from "next/server";
import type { LershaLoanPurpose } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sendFarmerDetailArraySchema } from "@/lib/lersha/types";
import { createAuditLog, getAuditRequestContext } from "@/lib/audit-log";
import {
  farmerProfileData,
  syncLoanPurposes,
} from "@/lib/lersha/farmer-sync";
import {
  canAcceptProfileUpdate,
  isFarmerPendingApproval,
  FARMER_PENDING_STATUS,
} from "@/lib/lersha/farmer-status";
import {
  buildReviewBaseline,
  diffProfiles,
  diffPurposes,
  toProfileSnapshot,
  toPurposeSnapshot,
  type FieldChange,
  type PurposeChange,
} from "@/lib/lersha/farmer-update-diff";

/** Before/after of a changed field, without the display-only label and kind. */
function auditFieldChange({ field, previous, current }: FieldChange) {
  return { field, previous, current };
}

function auditPurposeChange({ label, totalCost, changes }: PurposeChange) {
  return {
    label,
    totalCost,
    ...(changes ? { changes: changes.map(auditFieldChange) } : {}),
  };
}

export async function POST(req: NextRequest) {
  const auditCtx = getAuditRequestContext(req);
  // The farmer being processed when something throws, so a failure mid-batch
  // can be told apart from the farmers already saved before it.
  let currentFarmerId: string | null = null;
  const processedFarmerIds: string[] = [];

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
      status: "REGISTERED" | "UPDATED" | "REJECTED";
      registrationStatus: string;
      requiresApproval: boolean;
      reason?: string;
      loanPurposes: {
        productId: string | null;
        loanPurpose: string;
        specificVarietyName: string | null;
      }[];
    }[] = [];

    for (const farmer of farmers) {
      currentFarmerId = farmer.farmerId;
      console.log("[sendFarmerDetail] Processing farmer:", {
        farmerId: farmer.farmerId,
        farmerName: farmer.farmerName,
      });

      const existing = await prisma.lershaFarmer.findUnique({
        where: { farmerId: farmer.farmerId },
      });

      // Approved farmers are locked: their record is what the bank approved
      // and loans may already be processing against it, so Lersha cannot
      // modify it. Only farmers awaiting first approval (or resubmitting
      // after a rejection) accept updates.
      if (existing && !canAcceptProfileUpdate(existing.status)) {
        const reason = `Farmer ${farmer.farmerId} has already been ${
          existing.status === "APPROVED" ? "approved" : `decided (${existing.status})`
        }. Updates via Send Farmer Details are not accepted after approval.`;
        console.warn("[sendFarmerDetail] Update rejected:", {
          farmerId: farmer.farmerId,
          status: existing.status,
        });

        results.push({
          farmerId: farmer.farmerId,
          status: "REJECTED",
          registrationStatus: existing.status,
          requiresApproval: false,
          reason,
          loanPurposes: [],
        });

        await createAuditLog({
          actorId: "lersha-integration",
          action: "LERSHA_FARMER_UPDATE_REJECTED",
          entity: "LershaFarmer",
          entityId: existing.id,
          details: {
            farmerId: farmer.farmerId,
            farmerName: farmer.farmerName,
            currentStatus: existing.status,
            reason,
          },
          ...auditCtx,
        });
        processedFarmerIds.push(farmer.farmerId);
        continue;
      }

      const profile = farmerProfileData(farmer);
      let upserted;
      let updatedFields: string[] = [];
      let profileChanges: FieldChange[] = [];
      let purposesBefore: LershaLoanPurpose[] = [];
      if (existing) {
        // Read on every update, not only when a baseline is missing: the audit
        // entry below records what this update changed, and the review baseline
        // is cleared once a reviewer decides — after which the audit log is the
        // only place the before-values survive.
        purposesBefore = await prisma.lershaLoanPurpose.findMany({
          where: { farmerId: existing.id },
          orderBy: { createdAt: "asc" },
        });

        // Snapshot the record as it was before the first unreviewed update so
        // reviewers can see exactly what changed. Later updates keep the same
        // baseline, accumulating changes until a reviewer decides.
        let reviewBaseline = existing.reviewBaseline;
        if (!reviewBaseline) {
          reviewBaseline = buildReviewBaseline(existing, purposesBefore);
        }

        upserted = await prisma.lershaFarmer.update({
          where: { farmerId: farmer.farmerId },
          data: {
            ...profile,
            // Rejected/declined resubmissions go back to PENDING for review.
            status: FARMER_PENDING_STATUS,
            reviewBaseline,
          },
        });
        profileChanges = diffProfiles(
          toProfileSnapshot(existing),
          toProfileSnapshot(upserted),
        );
        updatedFields = profileChanges.map((c) => c.field);
      } else {
        upserted = await prisma.lershaFarmer.create({
          data: {
            farmerId: farmer.farmerId,
            ...profile,
            status: farmer.status ?? FARMER_PENDING_STATUS,
          },
        });
      }

      const loanPurposeResults = await syncLoanPurposes(
        upserted.id,
        farmer.loanPurposes,
      );

      const operationStatus = existing ? "UPDATED" : "REGISTERED";

      // What this call did to the loan purposes. They decide how much is lent
      // and which agro-dealer account the money is forwarded to, so a change to
      // them matters as much as a change to the profile itself.
      let loanPurposeChanges: {
        added: ReturnType<typeof auditPurposeChange>[];
        removed: ReturnType<typeof auditPurposeChange>[];
        modified: ReturnType<typeof auditPurposeChange>[];
      } | null = null;
      if (existing) {
        const purposesAfter = await prisma.lershaLoanPurpose.findMany({
          where: { farmerId: upserted.id },
          orderBy: { createdAt: "asc" },
        });
        const diff = diffPurposes(
          purposesBefore.map(toPurposeSnapshot),
          purposesAfter.map(toPurposeSnapshot),
        );
        loanPurposeChanges = {
          added: diff.added.map(auditPurposeChange),
          removed: diff.removed.map(auditPurposeChange),
          modified: diff.modified.map(auditPurposeChange),
        };
      }

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
          requestedLoanAmount: upserted.requestedLoanAmount,
          districtCode: upserted.districtCode,
          ...(operationStatus === "UPDATED"
            ? {
                updatedFields,
                changes: profileChanges.map(auditFieldChange),
                loanPurposeChanges,
              }
            : {
                // syncLoanPurposes returns one result per incoming purpose, in
                // order, so the two arrays line up by index.
                loanPurposes: farmer.loanPurposes.map((p, i) => ({
                  productId: loanPurposeResults[i]?.productId ?? null,
                  loanPurpose: p.loanPurpose,
                  specificVarietyName: p.specificVarietyName ?? null,
                  totalCost: p.totalCost,
                  agroDealerName: p.agro_dealer?.agro_dealer_name ?? null,
                  agroDealerAccountNo:
                    p.agro_dealer?.agro_dealer_account_number ?? null,
                })),
              }),
        },
        ...auditCtx,
      });
      processedFarmerIds.push(farmer.farmerId);

      console.log("[sendFarmerDetail] Farmer processed:", {
        farmerId: farmer.farmerId,
        operationStatus,
        updatedFields,
        loanPurposes: loanPurposeResults.length,
      });
    }

    const rejectedCount = results.filter((r) => r.status === "REJECTED").length;
    const hasUpdates = results.some((r) => r.status === "UPDATED");
    const allRejected = rejectedCount === results.length;

    const message = allRejected
      ? "Farmer details rejected: updates are not accepted for approved farmers."
      : rejectedCount > 0
        ? "Farmer details processed; some updates were rejected (farmer already approved)."
        : hasUpdates
          ? "Farmer details saved successfully (includes updates)."
          : "Farmer details registered successfully";

    const response = { message, results };
    console.log("[sendFarmerDetail] Returning response:", response);
    return NextResponse.json(response, {
      status: allRejected ? 409 : hasUpdates || rejectedCount > 0 ? 200 : 201,
    });
  } catch (error: any) {
    console.error("[sendFarmerDetail] Error:", error);
    // Farmers earlier in the batch are already saved (and audited); Lersha only
    // sees a 500, so record where the batch stopped.
    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_FARMER_SYNC_FAILED",
      entity: "LershaFarmer",
      details: {
        failedFarmerId: currentFarmerId,
        processedFarmerIds,
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
