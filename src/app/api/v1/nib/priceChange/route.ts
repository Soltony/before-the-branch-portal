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
 * (farmerId, productId) pairs with the proposed new unit price, and validates
 * ALL of them against the bank's configured tolerance (default ±10%, see
 * PriceChangeControl) BEFORE applying anything. Agro-dealer changes are handled
 * separately via /api/v1/nib/agroDealerChange.
 *
 * If the change breaches the threshold for even one farmer — or any
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

    type Violation = {
      farmerId: string;
      productId: string;
      reason: string;
      oldUnitPrice?: number | null;
      originalUnitPrice?: number | null;
      newUnitPrice?: number;
      changePercent?: number;
      allowedPercent?: number;
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
      // Task 3: the tolerance is measured against the ORIGINAL registered price,
      // not the last changed value, so repeated small changes can't drift the
      // price past the threshold. Fall back to the current price for any legacy
      // row whose baseline wasn't captured/backfilled.
      const baselineUnitPrice = purpose.originalUnitPrice ?? oldUnitPrice;
      if (baselineUnitPrice == null || baselineUnitPrice <= 0) {
        // No baseline price → can't validate a percentage change.
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

      const changePercent =
        (Math.abs(change.newUnitPrice - baselineUnitPrice) / baselineUnitPrice) *
        100;
      // Small epsilon so an exact ±threshold change isn't rejected by rounding.
      if (changePercent > thresholdPercent + 1e-9) {
        violations.push({
          farmerId: change.farmerId,
          productId: change.productId,
          reason: "EXCEEDS_THRESHOLD",
          oldUnitPrice,
          originalUnitPrice: baselineUnitPrice,
          newUnitPrice: change.newUnitPrice,
          changePercent: Number(changePercent.toFixed(4)),
          allowedPercent: thresholdPercent,
        });
        continue;
      }

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
