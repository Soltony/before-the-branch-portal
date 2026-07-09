import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { priceChangeRequestSchema } from "@/lib/lersha/types";
import { createAuditLog } from "@/lib/audit-log";
import { getPriceChangeThresholdPercent } from "@/lib/price-change-control";

/**
 * POST /api/v1/nib/priceChange
 *
 * Lersha prices products at the woreda level, so a single price change affects
 * every farmer in that woreda. This endpoint accepts the full batch of affected
 * (farmerId, productId) pairs with the proposed new unit price.
 *
 * The tolerance (default ±10%, see PriceChangeControl) is enforced at the LOAN
 * level, not per product: an individual product's price may move by any amount,
 * as long as the NET ETB change across a farmer's whole loan stays within
 * requestedLoanAmount × thresholdPercent (positive and negative product changes
 * offset each other, each measured against the product's original price). A
 * product whose loan is already disbursed stays locked. Agro-dealer changes are
 * handled separately via /api/v1/nib/agroDealerChange.
 *
 * If the loan-level threshold is breached for even one farmer — or any
 * farmer/product can't be resolved — the entire batch is rejected (HTTP 422)
 * and nothing is written, preserving woreda-level consistency between Lersha
 * and the bank. A fully valid batch is applied atomically in one transaction.
 *
 * Public endpoint, matching the other /api/farmer/* and /api/v1/nib/* Lersha
 * integration endpoints.
 */
export async function POST(req: NextRequest) {
  const batchId = randomUUID();
  try {
    const body = await req.json().catch(() => null);
    const parsed = priceChangeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid request",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { changes } = parsed.data;

    // A productId may appear only once per batch — duplicates would make the
    // all-or-nothing outcome ambiguous. Reject up front.
    const seen = new Set<string>();
    const duplicateProductIds = new Set<string>();
    for (const c of changes) {
      if (seen.has(c.productId)) duplicateProductIds.add(c.productId);
      seen.add(c.productId);
    }
    if (duplicateProductIds.size > 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Price change rejected",
          violations: Array.from(duplicateProductIds).map((productId) => ({
            productId,
            reason: "DUPLICATE_IN_REQUEST",
          })),
        },
        { status: 422 },
      );
    }

    const thresholdPercent = await getPriceChangeThresholdPercent();

    const productIds = changes.map((c) => c.productId);
    const purposes = await prisma.lershaLoanPurpose.findMany({
      where: { productId: { in: productIds } },
      include: { farmer: { select: { farmerId: true } } },
    });
    const purposeByProductId = new Map(
      purposes.map((p) => [p.productId as string, p]),
    );

    // A product's price is locked once its loan has been disbursed: a regular
    // loan purpose is disbursed via a DISBURSED LershaLoanRequest, while an
    // insurance purpose is "disbursed" once its LershaInsurancePayment is
    // SUCCESS. Either way the bank has already paid out against that price, so a
    // change must be rejected.
    const disbursedRequests = await prisma.lershaLoanRequest.findMany({
      where: { productId: { in: productIds }, status: "DISBURSED" },
      select: { productId: true },
    });
    const disbursedProductIds = new Set(
      disbursedRequests
        .map((r) => r.productId)
        .filter((id): id is string => Boolean(id)),
    );

    const purposeIds = purposes.map((p) => p.id);
    const paidInsurancePayments =
      purposeIds.length > 0
        ? await prisma.lershaInsurancePayment.findMany({
            where: { loanPurposeId: { in: purposeIds }, status: "SUCCESS" },
            select: { loanPurposeId: true },
          })
        : [];
    const paidInsurancePurposeIds = new Set(
      paidInsurancePayments
        .map((p) => p.loanPurposeId)
        .filter((id): id is string => Boolean(id)),
    );

    // The threshold is enforced at the LOAN level, not per product: individual
    // product prices may move by any amount, as long as the NET change across a
    // farmer's whole loan stays within requestedLoanAmount × thresholdPercent.
    // We need every purpose of each affected farmer (not just the ones in this
    // batch) to size the loan and to account for products changed previously.
    const farmerExternalIds = Array.from(
      new Set(changes.map((c) => c.farmerId)),
    );
    const farmersForLoan = await prisma.lershaFarmer.findMany({
      where: { farmerId: { in: farmerExternalIds } },
      select: {
        farmerId: true,
        requestedLoanAmount: true,
        loanPurposes: {
          select: {
            productId: true,
            quantity: true,
            unitPrice: true,
            originalUnitPrice: true,
          },
        },
      },
    });
    const farmerByExternalId = new Map(
      farmersForLoan.map((f) => [f.farmerId, f]),
    );

    type Violation = {
      farmerId: string;
      productId?: string;
      reason: string;
      oldUnitPrice?: number | null;
      originalUnitPrice?: number | null;
      newUnitPrice?: number;
      allowedPercent?: number;
      // Loan-level (EXCEEDS_LOAN_THRESHOLD) context:
      loanAmount?: number;
      totalVariance?: number;
      allowedVariance?: number;
    };
    type PlannedUpdate = {
      id: string;
      farmerId: string;
      productId: string;
      oldUnitPrice: number | null;
      newUnitPrice: number;
      newTotalCost: number | null;
    };

    const violations: Violation[] = [];
    const planned: PlannedUpdate[] = [];

    // ---- Validate the whole batch first; nothing is written in this loop. ----
    for (const change of changes) {
      const purpose = purposeByProductId.get(change.productId);
      if (!purpose) {
        violations.push({
          farmerId: change.farmerId,
          productId: change.productId,
          reason: "PRODUCT_NOT_FOUND",
        });
        continue;
      }
      if (purpose.farmer.farmerId !== change.farmerId) {
        violations.push({
          farmerId: change.farmerId,
          productId: change.productId,
          reason: "FARMER_PRODUCT_MISMATCH",
        });
        continue;
      }

      // Task 1: once the loan for this product is disbursed, its price is locked.
      if (
        disbursedProductIds.has(change.productId) ||
        paidInsurancePurposeIds.has(purpose.id)
      ) {
        violations.push({
          farmerId: change.farmerId,
          productId: change.productId,
          reason: "LOAN_ALREADY_DISBURSED",
          oldUnitPrice: purpose.unitPrice,
          newUnitPrice: change.newUnitPrice,
        });
        continue;
      }

      const oldUnitPrice = purpose.unitPrice;
      // The loan-level variance is measured against the ORIGINAL registered
      // price (not the last changed value), so repeated changes can't drift the
      // loan past the threshold. A baseline is required to score the change;
      // fall back to the current price for any legacy row not yet backfilled.
      const baselineUnitPrice = purpose.originalUnitPrice ?? oldUnitPrice;
      if (baselineUnitPrice == null || baselineUnitPrice <= 0) {
        violations.push({
          farmerId: change.farmerId,
          productId: change.productId,
          reason: "MISSING_BASELINE_PRICE",
          oldUnitPrice,
          originalUnitPrice: purpose.originalUnitPrice,
          newUnitPrice: change.newUnitPrice,
        });
        continue;
      }

      // Individual products may move by any amount — the ±threshold is enforced
      // per loan below, not here.
      // Keep totalCost consistent with the new unit price when quantity is known.
      const newTotalCost =
        purpose.quantity != null ? change.newUnitPrice * purpose.quantity : null;

      planned.push({
        id: purpose.id,
        farmerId: change.farmerId,
        productId: change.productId,
        oldUnitPrice,
        newUnitPrice: change.newUnitPrice,
        newTotalCost,
      });
    }

    // ---- Loan-level (global) threshold check, per farmer. ----
    // For each affected farmer, the NET ETB change across their whole loan
    // (proposed prices for products in this batch, current prices for the rest,
    // each measured against the product's original price) must stay within
    // requestedLoanAmount × thresholdPercent. Positive and negative product
    // changes offset each other.
    const proposedByProductId = new Map(
      planned.map((p) => [p.productId, p.newUnitPrice]),
    );
    for (const externalId of farmerExternalIds) {
      const farmer = farmerByExternalId.get(externalId);
      // Missing farmer / product-ownership problems are already reported as
      // per-item violations above; nothing to size here.
      if (!farmer) continue;
      const loanAmount = farmer.requestedLoanAmount;
      if (loanAmount == null || loanAmount <= 0) continue;

      let netVariance = 0;
      for (const lp of farmer.loanPurposes) {
        const baseUnit = lp.originalUnitPrice ?? lp.unitPrice;
        if (baseUnit == null) continue;
        const proposed = lp.productId
          ? proposedByProductId.get(lp.productId)
          : undefined;
        const effectiveUnit = proposed ?? lp.unitPrice ?? baseUnit;
        const qty = lp.quantity ?? 1;
        netVariance += (effectiveUnit - baseUnit) * qty;
      }

      const allowedVariance = (loanAmount * thresholdPercent) / 100;
      // Small epsilon so an exact ±threshold change isn't rejected by rounding.
      if (Math.abs(netVariance) > allowedVariance + 1e-6) {
        violations.push({
          farmerId: externalId,
          reason: "EXCEEDS_LOAN_THRESHOLD",
          loanAmount,
          totalVariance: Number(netVariance.toFixed(2)),
          allowedVariance: Number(allowedVariance.toFixed(2)),
          allowedPercent: thresholdPercent,
        });
      }
    }

    // ---- All-or-nothing: any violation rejects the entire batch. ----
    if (violations.length > 0) {
      await createAuditLog({
        actorId: "lersha-integration",
        action: "LERSHA_PRICE_CHANGE_REJECTED",
        entity: "LershaLoanPurpose",
        details: {
          batchId,
          thresholdPercent,
          requested: changes.length,
          violations,
        },
      });
      return NextResponse.json(
        {
          success: false,
          message: "Price change rejected",
          thresholdPercent,
          requested: changes.length,
          violations,
        },
        { status: 422 },
      );
    }

    // ---- Apply every update atomically. ----
    await prisma.$transaction(
      planned.map((u) =>
        prisma.lershaLoanPurpose.update({
          where: { id: u.id },
          data: {
            unitPrice: u.newUnitPrice,
            ...(u.newTotalCost != null ? { totalCost: u.newTotalCost } : {}),
          },
        }),
      ),
    );

    const applied = planned.map((u) => ({
      farmerId: u.farmerId,
      productId: u.productId,
      oldUnitPrice: u.oldUnitPrice,
      newUnitPrice: u.newUnitPrice,
      newTotalCost: u.newTotalCost,
    }));

    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_PRICE_CHANGE_APPLIED",
      entity: "LershaLoanPurpose",
      details: { batchId, thresholdPercent, applied },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Price change applied",
        batchId,
        thresholdPercent,
        applied,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[priceChange] Error:", error);
    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_PRICE_CHANGE_FAILED",
      entity: "LershaLoanPurpose",
      details: { batchId, error: (error as Error)?.message ?? String(error) },
    }).catch(() => null);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
