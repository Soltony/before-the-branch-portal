import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { getUserFromSession } from "@/lib/user";
import { hasPermission, type PermissionSet } from "@/lib/permissions";
import { createAuditLog } from "@/lib/audit-log";
import logger from "@/lib/logger";
import {
  processInsurancePayment,
  getFarmerRemainingBalance,
  type InsurancePaymentOutcome,
} from "@/lib/lersha/insurance";
import { sendInsuranceConfirmation } from "@/lib/lersha/client";
import type { InsuranceConfirmationRequest } from "@/lib/lersha/types";

const MODULE = "insurance-payments";

async function authorize(action: PermissionSet) {
  const user = await getUserFromSession();
  if (!user?.id) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const allowed =
    user.role === "Super Admin" || hasPermission(user, MODULE, action);
  if (!allowed) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

// GET — paginated list of insurance payments for admin review.
export async function GET(req: NextRequest) {
  const auth = await authorize("read");
  if (auth.error) return auth.error;

  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
    const search = sp.get("search")?.trim() || "";
    const status = sp.get("status")?.trim() || "";

    // Scalar-only filter (groupBy can't filter on relations). Resolve a farmer
    // search to internal ids first.
    const where: any = {};
    if (status) where.status = status;
    if (search) {
      const matchingFarmers = await prisma.lershaFarmer.findMany({
        where: {
          OR: [
            { farmerId: { contains: search } },
            { farmerName: { contains: search } },
            { phoneNumber: { contains: search } },
          ],
        },
        select: { id: true },
      });
      where.OR = [
        { insuranceName: { contains: search } },
        { creditAccount: { contains: search } },
        ...(matchingFarmers.length
          ? [{ farmerId: { in: matchingFarmers.map((f) => f.id) } }]
          : []),
      ];
    }

    // Page over distinct batches (one /insuranceRequest call), newest first.
    const groups = await prisma.lershaInsurancePayment.groupBy({
      by: ["batchId"],
      where,
      _max: { requestedAt: true },
      orderBy: { _max: { requestedAt: "desc" } },
    });
    const total = groups.length;
    const pageGroups = groups.slice((page - 1) * limit, (page - 1) * limit + limit);
    const batchIds = pageGroups
      .map((g) => g.batchId)
      .filter((b): b is string => b !== null);

    const payments = batchIds.length
      ? await prisma.lershaInsurancePayment.findMany({
          where: { ...where, batchId: { in: batchIds } },
          include: {
            farmer: {
              select: {
                id: true,
                farmerId: true,
                farmerName: true,
                phoneNumber: true,
                requestedLoanAmount: true,
                status: true,
              },
            },
            insuranceAccount: {
              select: { id: true, insuranceName: true, insuranceId: true, accountNumber: true, status: true },
            },
          },
          orderBy: [{ requestedAt: "desc" }],
        })
      : [];

    // Rows requested before their insurer was mapped have a null account
    // snapshot. Approval re-resolves the mapping by insurer name, so surface the
    // currently-active account here too — otherwise the UI would block them.
    const unresolvedNames = Array.from(
      new Set(
        payments
          .filter((p) => !p.creditAccount && p.insuranceName)
          .map((p) => p.insuranceName as string),
      ),
    );
    if (unresolvedNames.length > 0) {
      const activeAccounts = await prisma.insuranceAccount.findMany({
        where: { insuranceName: { in: unresolvedNames }, status: "ACTIVE" },
      });
      const byName = new Map(
        activeAccounts.map((a) => [a.insuranceName.trim().toLowerCase(), a]),
      );
      for (const p of payments) {
        if (!p.creditAccount && p.insuranceName) {
          const acc = byName.get(p.insuranceName.trim().toLowerCase());
          if (acc) {
            p.creditAccount = acc.accountNumber;
            p.insuranceId = acc.insuranceId;
            (p as any).insuranceAccount = {
              id: acc.id,
              insuranceName: acc.insuranceName,
              insuranceId: acc.insuranceId,
              accountNumber: acc.accountNumber,
              status: acc.status,
            };
          }
        }
      }
    }

    // Assemble batches in the paged order.
    const byBatch = new Map<string, typeof payments>();
    for (const p of payments) {
      const key = p.batchId ?? p.id;
      if (!byBatch.has(key)) byBatch.set(key, []);
      byBatch.get(key)!.push(p);
    }

    const batches = batchIds.map((bid) => {
      const ps = byBatch.get(bid) ?? [];
      const requestedAt = ps.reduce<Date | null>(
        (max, p) => (!max || p.requestedAt > max ? p.requestedAt : max),
        null,
      );
      const totalAmount = ps.reduce((s, p) => s + p.insuranceAmount, 0);
      const insurers = Array.from(
        new Set(ps.map((p) => p.insuranceName).filter(Boolean) as string[]),
      );
      const statusCounts = ps.reduce<Record<string, number>>((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {});
      const requestedCount = ps.filter((p) => p.status === "REQUESTED").length;
      const approvableCount = ps.filter(
        (p) => p.status === "REQUESTED" && !!p.creditAccount,
      ).length;
      return {
        batchId: bid,
        requestedAt,
        farmerCount: ps.length,
        totalAmount,
        insurers,
        statusCounts,
        requestedCount,
        approvableCount,
        payments: ps,
      };
    });

    return NextResponse.json({
      batches,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    console.error("[insurance-payments GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const actionSchema = z.object({
  paymentIds: z.array(z.string().min(1)).min(1),
  action: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().optional(),
});

// POST — approve or reject one or many insurance payments.
export async function POST(req: NextRequest) {
  const auth = await authorize("update");
  if (auth.error) return auth.error;
  const user = auth.user!;

  try {
    const body = await req.json().catch(() => null);
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { paymentIds, action, rejectionReason } = parsed.data;
    const uniqueIds = Array.from(new Set(paymentIds));

    if (action === "REJECT") {
      return await handleReject(uniqueIds, rejectionReason, user.id);
    }
    return await handleApprove(uniqueIds, user.id);
  } catch (error) {
    console.error("[insurance-payments POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handleApprove(paymentIds: string[], actorId: string) {
  const outcomes: InsurancePaymentOutcome[] = [];
  for (const id of paymentIds) {
    outcomes.push(await processInsurancePayment(id, actorId));
  }

  // Batch the SUCCESS confirmations into a single Lersha call.
  const toConfirm = outcomes.filter((o) => o.confirmation && !o.alreadyProcessed);
  let lershaNotified = false;
  if (toConfirm.length > 0) {
    try {
      const requests = toConfirm.map(
        (o) => o.confirmation as InsuranceConfirmationRequest,
      );
      const result = await sendInsuranceConfirmation({ requests });
      lershaNotified = result.ok;
      const sentAt = new Date();
      const responseStr = JSON.stringify(result.data ?? null);
      await Promise.all(
        toConfirm.map((o) =>
          prisma.lershaInsurancePayment
            .update({
              where: { id: o.paymentId },
              data: {
                lershaConfirmationSentAt: sentAt,
                lershaConfirmationResponse: responseStr,
              },
            })
            .catch(() => null),
        ),
      );
      if (!result.ok) {
        logger.error(
          `[insurance-payments] Lersha confirmation responded ${result.status}`,
        );
      }
    } catch (err) {
      logger.error(`[insurance-payments] Failed to notify Lersha: ${err}`);
    }
  }

  const approvedCount = outcomes.filter((o) => o.ok && !o.alreadyProcessed).length;
  return NextResponse.json({
    success: true,
    action: "APPROVE",
    lershaNotified,
    approvedCount,
    results: outcomes.map((o) => ({
      paymentId: o.paymentId,
      farmerId: o.externalFarmerId,
      ok: o.ok,
      alreadyProcessed: o.alreadyProcessed ?? false,
      softError: o.softError ?? false,
      message: o.message,
      error: o.error,
      loanId: o.loanId,
      remainingBalance: o.remainingBalance,
      transactionId: o.transactionId,
      transactionAmount: o.transactionAmount,
    })),
  });
}

async function handleReject(
  paymentIds: string[],
  rejectionReason: string | undefined,
  actorId: string,
) {
  const confirmations: InsuranceConfirmationRequest[] = [];
  const confirmedPaymentIds: string[] = [];
  const results: { paymentId: string; ok: boolean; message: string }[] = [];

  for (const id of paymentIds) {
    const payment = await prisma.lershaInsurancePayment.findUnique({
      where: { id },
      include: { farmer: { select: { id: true, farmerId: true } } },
    });
    if (!payment) {
      results.push({ paymentId: id, ok: false, message: "Not found" });
      continue;
    }
    if (payment.status !== "REQUESTED") {
      results.push({
        paymentId: id,
        ok: false,
        message: `Cannot reject a payment with status "${payment.status}".`,
      });
      continue;
    }

    const remaining = await getFarmerRemainingBalance(payment.farmerId);

    await prisma.lershaInsurancePayment.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectionReason: rejectionReason ?? null,
        remainingBalance: remaining,
        approvedByUserId: actorId,
        confirmedAt: new Date(),
      },
    });

    confirmations.push({
      farmer_id: payment.farmer.farmerId,
      status: "FAILED",
      remaining_balance: remaining,
    });
    confirmedPaymentIds.push(id);
    results.push({ paymentId: id, ok: true, message: "Rejected" });

    await createAuditLog({
      actorId,
      action: "LERSHA_INSURANCE_REJECTED",
      entity: "LershaInsurancePayment",
      entityId: id,
      details: {
        farmerId: payment.farmer.farmerId,
        insuranceName: payment.insuranceName,
        insuranceAmount: payment.insuranceAmount,
        rejectionReason: rejectionReason ?? null,
        remainingBalance: remaining,
      },
    });
  }

  let lershaNotified = false;
  if (confirmations.length > 0) {
    try {
      const result = await sendInsuranceConfirmation({ requests: confirmations });
      lershaNotified = result.ok;
      const sentAt = new Date();
      const responseStr = JSON.stringify(result.data ?? null);
      await Promise.all(
        confirmedPaymentIds.map((id) =>
          prisma.lershaInsurancePayment
            .update({
              where: { id },
              data: {
                lershaConfirmationSentAt: sentAt,
                lershaConfirmationResponse: responseStr,
              },
            })
            .catch(() => null),
        ),
      );
    } catch (err) {
      logger.error(`[insurance-payments] Failed to notify Lersha (reject): ${err}`);
    }
  }

  return NextResponse.json({
    success: true,
    action: "REJECT",
    lershaNotified,
    rejectedCount: results.filter((r) => r.ok).length,
    results,
  });
}
