import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { insuranceRequestSchema } from "@/lib/lersha/types";
import { createAuditLog } from "@/lib/audit-log";

/**
 * POST /api/v1/nib/insuranceRequest
 *
 * Lersha submits insurance payment requests for a list of farmers. For each
 * farmer we resolve the "Insurance" loan purpose (captured at registration) and
 * create a reviewable LershaInsurancePayment (status REQUESTED). An admin later
 * reviews and approves these from the portal, which books the loan + credits the
 * insurer account. Public endpoint (matches the other /api/farmer/* and
 * /api/v1/* Lersha integration endpoints).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = insuranceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "Invalid request" },
        { status: 400 },
      );
    }

    const uniqueIds = Array.from(
      new Set(parsed.data.farmerIDs.map((s) => s.trim()).filter(Boolean)),
    );
    if (uniqueIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "Invalid request" },
        { status: 400 },
      );
    }

    let farmers;
    try {
      farmers = await prisma.lershaFarmer.findMany({
        where: { farmerId: { in: uniqueIds } },
        include: { loanPurposes: true, insurancePayments: true },
      });
    } catch (e) {
      console.error("[insuranceRequest] Failed to fetch farmers:", e);
      return NextResponse.json(
        { success: false, message: "Failed to fetch farmers" },
        { status: 500 },
      );
    }

    const accounts = await prisma.insuranceAccount.findMany({
      where: { status: "ACTIVE" },
    });
    const accountByName = new Map(
      accounts.map((a) => [a.insuranceName.trim().toLowerCase(), a]),
    );

    const farmersById = new Map(farmers.map((f) => [f.farmerId, f]));

    // One batch id groups all payments recorded from this single request.
    const batchId = randomUUID();

    const detailDTO: { farmerID: string; insuranceAmount: string }[] = [];
    const recorded: { farmerId: string; paymentId: string }[] = [];
    const skipped: { farmerId: string; reason: string }[] = [];
    let duplicateCount = 0;

    for (const fid of uniqueIds) {
      const farmer = farmersById.get(fid);
      if (!farmer) {
        skipped.push({ farmerId: fid, reason: "FARMER_NOT_FOUND" });
        continue;
      }

      const insurancePurposes = farmer.loanPurposes.filter(
        (lp) =>
          lp.insuranceName != null ||
          lp.loanPurpose.trim().toLowerCase() === "insurance",
      );
      if (insurancePurposes.length === 0) {
        skipped.push({ farmerId: fid, reason: "NO_INSURANCE_PURPOSE" });
        continue;
      }

      for (const purpose of insurancePurposes) {
        const existing = farmer.insurancePayments.find(
          (p) =>
            p.loanPurposeId === purpose.id &&
            (p.status === "REQUESTED" || p.status === "SUCCESS"),
        );
        if (existing) {
          duplicateCount += 1;
          skipped.push({ farmerId: fid, reason: `ALREADY_${existing.status}` });
          continue;
        }

        const account = purpose.insuranceName
          ? accountByName.get(purpose.insuranceName.trim().toLowerCase())
          : undefined;
        const amount = purpose.totalCost;

        const created = await prisma.lershaInsurancePayment.create({
          data: {
            batchId,
            farmerId: farmer.id,
            loanPurposeId: purpose.id,
            insuranceName: purpose.insuranceName,
            insuranceAccountId: account?.id ?? null,
            insuranceId: account?.insuranceId ?? null,
            creditAccount: account?.accountNumber ?? null,
            insuranceAmount: amount,
            status: "REQUESTED",
            requestPayload: JSON.stringify({
              farmerID: fid,
              insuranceAmount: amount.toFixed(2),
              insuranceId: account?.insuranceId ?? null,
            }),
          },
        });

        recorded.push({ farmerId: fid, paymentId: created.id });
        detailDTO.push({ farmerID: fid, insuranceAmount: amount.toFixed(2) });
      }
    }

    if (recorded.length === 0) {
      // Already-queued duplicates → acknowledge as success (idempotent).
      if (duplicateCount > 0) {
        return NextResponse.json(
          { success: true, message: "Success", data: {} },
          { status: 200 },
        );
      }
      return NextResponse.json(
        { success: false, message: "No insurance records found" },
        { status: 400 },
      );
    }

    // Transformed payload documented in the NIB spec (recorded for traceability).
    const nibPayload = {
      insuranceId: accounts[0]?.insuranceId ?? "INSURANCE001",
      insuranceDetailRequestDTO: detailDTO,
    };

    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_INSURANCE_REQUESTED",
      entity: "LershaInsurancePayment",
      details: {
        batchId,
        requested: uniqueIds.length,
        recorded: recorded.length,
        duplicates: duplicateCount,
        skipped,
        nibPayload,
      },
    });

    return NextResponse.json(
      { success: true, message: "Success", data: {} },
      { status: 200 },
    );
  } catch (error) {
    console.error("[insuranceRequest] Error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch farmers" },
      { status: 500 },
    );
  }
}
