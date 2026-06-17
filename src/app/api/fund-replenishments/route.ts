"use server";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit-log";
import { getUserFromSession } from "@/lib/user";
import { hasPermission } from "@/lib/require-permission";

const fundReplenishmentCreateSchema = z.object({
  providerId: z.string().min(1, "Provider ID is required"),
  amount: z.preprocess((v) => {
    if (typeof v === "string") return Number(String(v).replace(/,/g, ""));
    return v;
  }, z.number().positive("Amount must be positive")),
  remarks: z.string().optional(),
  replenishmentDate: z.string().datetime("Invalid replenishment date"),
});

function getFundReplenishmentDelegate() {
  const delegate = (prisma as any).fundReplenishment;
  if (!delegate) {
    const err = new Error(
      "Fund replenishment model is unavailable in Prisma client. Run `npx prisma generate` and restart the dev server.",
    ) as Error & { status?: number };
    err.status = 500;
    throw err;
  }
  return delegate;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user || !hasPermission(user, "revolving-fund", "read")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");
    const summary = searchParams.get("summary") === "true";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");

    if (summary) {
      if (!providerId) {
        return NextResponse.json(
          { error: "providerId is required for summary" },
          { status: 400 },
        );
      }

      const provider = await prisma.loanProvider.findUnique({
        where: { id: providerId },
        select: {
          id: true,
          name: true,
          startingCapital: true,
          initialBalance: true,
        },
      });

      if (!provider) {
        return NextResponse.json({ error: "Provider not found" }, { status: 404 });
      }

      const fundReplenishment = getFundReplenishmentDelegate();
      const aggregate = await fundReplenishment.aggregate({
        where: { providerId },
        _sum: { amount: true },
      });

      const totalReplenished = aggregate._sum.amount ?? 0;
      const maxReplenishable = Math.max(
        0,
        provider.startingCapital - provider.initialBalance,
      );

      return NextResponse.json({
        providerId: provider.id,
        providerName: provider.name,
        startingCapital: provider.startingCapital,
        initialBalance: provider.initialBalance,
        totalReplenished,
        maxReplenishable,
      });
    }

    const where: { providerId?: string } = {};
    if (providerId) where.providerId = providerId;

    const fundReplenishment = getFundReplenishmentDelegate();
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      fundReplenishment.findMany({
        where,
        orderBy: [{ replenishmentDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
        include: {
          recordedByUser: {
            select: { id: true, fullName: true, email: true },
          },
        },
      }),
      fundReplenishment.count({ where }),
    ]);

    return NextResponse.json({
      data: records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("Error fetching fund replenishments:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch fund replenishments" },
      { status: error.status || 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user || !hasPermission(user, "revolving-fund", "create")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const data = fundReplenishmentCreateSchema.parse(body);

    const provider = await prisma.loanProvider.findUnique({
      where: { id: data.providerId },
      select: {
        id: true,
        name: true,
        startingCapital: true,
        initialBalance: true,
      },
    });

    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const maxReplenishable =
      provider.startingCapital - provider.initialBalance;
    if (data.amount > maxReplenishable + 1e-6) {
      return NextResponse.json(
        {
          error: `Amount exceeds replenishable headroom. Maximum addable: ${maxReplenishable.toFixed(2)} ETB (initial fund ${provider.startingCapital.toFixed(2)} minus current available ${provider.initialBalance.toFixed(2)}).`,
        },
        { status: 400 },
      );
    }

    const balanceBefore = provider.initialBalance;
    const balanceAfter = balanceBefore + data.amount;

    const result = await prisma.$transaction(async (tx) => {
      const live = await tx.loanProvider.findUnique({
        where: { id: data.providerId },
        select: { startingCapital: true, initialBalance: true },
      });
      if (!live) throw new Error("Provider not found.");

      const liveMax = live.startingCapital - live.initialBalance;
      if (data.amount > liveMax + 1e-6) {
        throw new Error(
          `Amount exceeds replenishable headroom. Maximum addable: ${liveMax.toFixed(2)} ETB.`,
        );
      }

      await tx.loanProvider.update({
        where: { id: data.providerId },
        data: { initialBalance: { increment: data.amount } },
      });

      const txFundReplenishment = (tx as any).fundReplenishment;
      if (!txFundReplenishment) {
        throw new Error(
          "Fund replenishment model is unavailable in Prisma transaction client. Run `npx prisma generate` and restart the dev server.",
        );
      }

      const record = await txFundReplenishment.create({
        data: {
          providerId: data.providerId,
          amount: data.amount,
          remarks: data.remarks?.trim() || null,
          replenishmentDate: new Date(data.replenishmentDate),
          balanceBefore: live.initialBalance,
          balanceAfter: live.initialBalance + data.amount,
          recordedByUserId: user.id,
        },
        include: {
          recordedByUser: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      await createAuditLog({
        actorId: user.id,
        action: "RECORD_FUND_REPLENISHMENT",
        entity: "FundReplenishment",
        entityId: record.id,
        details: {
          providerId: data.providerId,
          providerName: provider.name,
          amount: data.amount,
          remarks: data.remarks,
          replenishmentDate: data.replenishmentDate,
          balanceBefore: live.initialBalance,
          balanceAfter: live.initialBalance + data.amount,
        },
      });

      return record;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("Error recording fund replenishment:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors.map((e) => e.message).join(", ") },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: error.message || "Failed to record fund replenishment" },
      { status: error.status || 500 },
    );
  }
}
