import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { agroDealerChangeRequestSchema } from "@/lib/lersha/types";
import { createAuditLog } from "@/lib/audit-log";

/**
 * POST /api/v1/nib/agroDealerChange
 *
 * Updates the agro-dealer (name + account number) on a batch of farmers' loan
 * purposes. Agro-dealer changes are woreda-level too, so Lersha sends all
 * affected (farmerId, productId) pairs in one request. Kept separate from
 * /api/v1/nib/priceChange so the dealer can change without touching the product
 * price (and vice-versa).
 *
 * Validation is all-or-nothing: if any (farmerId, productId) can't be resolved
 * — or the same productId appears twice — the entire batch is rejected (HTTP
 * 422) and nothing is written, preserving woreda-level consistency. A fully
 * valid batch is applied atomically in one transaction. Unlike price changes
 * there is no woreda-wide tolerance to enforce.
 *
 * Public endpoint, matching the other /api/farmer/* and /api/v1/nib/* Lersha
 * integration endpoints.
 */
export async function POST(req: NextRequest) {
  const batchId = randomUUID();
  try {
    const body = await req.json().catch(() => null);
    const parsed = agroDealerChangeRequestSchema.safeParse(body);
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
          message: "Agro-dealer change rejected",
          violations: Array.from(duplicateProductIds).map((productId) => ({
            productId,
            reason: "DUPLICATE_IN_REQUEST",
          })),
        },
        { status: 422 },
      );
    }

    const productIds = changes.map((c) => c.productId);
    const purposes = await prisma.lershaLoanPurpose.findMany({
      where: { productId: { in: productIds } },
      include: { farmer: { select: { farmerId: true } } },
    });
    const purposeByProductId = new Map(
      purposes.map((p) => [p.productId as string, p]),
    );

    type Violation = { farmerId: string; productId: string; reason: string };
    type PlannedUpdate = {
      id: string;
      farmerId: string;
      productId: string;
      previous: {
        agroDealerName: string | null;
        agroDealerAccountNo: string | null;
      };
      agroDealerName: string;
      agroDealerAccountNo: string;
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

      planned.push({
        id: purpose.id,
        farmerId: change.farmerId,
        productId: change.productId,
        previous: {
          agroDealerName: purpose.agroDealerName,
          agroDealerAccountNo: purpose.agroDealerAccountNo,
        },
        agroDealerName: change.agro_dealer_name,
        agroDealerAccountNo: change.agro_dealer_account_number,
      });
    }

    // ---- All-or-nothing: any violation rejects the entire batch. ----
    if (violations.length > 0) {
      await createAuditLog({
        actorId: "lersha-integration",
        action: "LERSHA_AGRO_DEALER_CHANGE_REJECTED",
        entity: "LershaLoanPurpose",
        details: { batchId, requested: changes.length, violations },
      });
      return NextResponse.json(
        {
          success: false,
          message: "Agro-dealer change rejected",
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
            agroDealerName: u.agroDealerName,
            agroDealerAccountNo: u.agroDealerAccountNo,
          },
        }),
      ),
    );

    const applied = planned.map((u) => ({
      farmerId: u.farmerId,
      productId: u.productId,
      agroDealerName: u.agroDealerName,
      agroDealerAccountNo: u.agroDealerAccountNo,
    }));

    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_AGRO_DEALER_CHANGE_APPLIED",
      entity: "LershaLoanPurpose",
      details: {
        batchId,
        applied: planned.map((u) => ({
          farmerId: u.farmerId,
          productId: u.productId,
          previous: u.previous,
          updated: {
            agroDealerName: u.agroDealerName,
            agroDealerAccountNo: u.agroDealerAccountNo,
          },
        })),
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Agro-dealer change applied",
        batchId,
        applied,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[agroDealerChange] Error:", error);
    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_AGRO_DEALER_CHANGE_FAILED",
      entity: "LershaLoanPurpose",
      details: { batchId, error: (error as Error)?.message ?? String(error) },
    }).catch(() => null);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
