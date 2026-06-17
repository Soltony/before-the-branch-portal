"use server";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit-log";
import { getUserFromSession } from "@/lib/user";
import { hasPermission } from "@/lib/require-permission";

function getTaxTransferSimulationDelegate() {
  const delegate = (prisma as any).taxTransferSimulation;
  if (!delegate) {
    const err = new Error(
      "Tax transfer model is unavailable in Prisma client. Run `npx prisma generate` and restart the dev server."
    ) as Error & { status?: number };
    err.status = 500;
    throw err;
  }
  return delegate;
}

function destinationLedgerAccountName(destinationAccountName: string) {
  return `Tax Destination: ${destinationAccountName}`.slice(0, 255);
}

// Validation schema for creating a tax transfer simulation
const taxTransferCreateSchema = z.object({
  providerId: z.string().min(1, "Provider ID is required"),
  transferAmount: z.preprocess((v) => {
    if (typeof v === "string") return Number(v.replace(/,/g, ""));
    return v;
  }, z.number().positive("Transfer amount must be positive")),
  destinationAccountName: z.string().min(1, "Destination account is required"),
  transferReference: z
    .string()
    .min(1, "Transfer reference is required")
    .max(100, "Transfer reference must be less than 100 characters"),
  transferDate: z.string().datetime("Invalid transfer date"),
  notes: z.string().optional(),
});

// Validation schema for reversing a tax transfer
const taxTransferReverseSchema = z.object({
  transferSimulationId: z.string().min(1, "Transfer simulation ID is required"),
  reversalReason: z
    .string()
    .min(1, "Reversal reason is required")
    .min(10, "Reversal reason must be at least 10 characters"),
});

export async function GET(request: NextRequest) {
  try {
    // Check user permissions
    const user = await getUserFromSession();
    if (!user || !hasPermission(user, "tax-transfers", "read")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const summary = searchParams.get("summary") === "true";

    if (summary) {
      if (!providerId) {
        return NextResponse.json(
          { error: "providerId is required for summary" },
          { status: 400 }
        );
      }

      const provider = await prisma.loanProvider.findUnique({
        where: { id: providerId },
        include: { ledgerAccounts: true },
      });

      if (!provider) {
        return NextResponse.json({ error: "Provider not found" }, { status: 404 });
      }

      const taxHolding = provider.ledgerAccounts.find(
        (a) => a.category === "Tax" && a.type === "Receivable"
      );

      const destinationAccounts = provider.ledgerAccounts
        .filter(
          (a) =>
            a.category === "Tax" &&
            a.type === "Received" &&
            String(a.name || "").startsWith("Tax Destination:")
        )
        .map((a) => ({
          id: a.id,
          name: a.name,
          balance: a.balance,
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      return NextResponse.json({
        providerId,
        taxHoldingAccount: taxHolding
          ? { id: taxHolding.id, name: taxHolding.name, balance: taxHolding.balance }
          : null,
        destinationAccounts,
      });
    }

    const where: any = {};
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;
    const taxTransferSimulation = getTaxTransferSimulationDelegate();

    const [transfers, total] = await Promise.all([
      taxTransferSimulation.findMany({
        where,
        include: {
          provider: true,
          recordedByUser: {
            select: { id: true, fullName: true, email: true },
          },
          reversedByUser: {
            select: { id: true, fullName: true, email: true },
          },
          journalEntry: {
            include: {
              entries: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      taxTransferSimulation.count({ where }),
    ]);

    return NextResponse.json({
      data: transfers,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("Error fetching tax transfers:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to fetch tax transfers",
      },
      { status: error.status || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check user permissions
    const user = await getUserFromSession();
    if (!user || !hasPermission(user, "tax-transfers", "create")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const data = taxTransferCreateSchema.parse(body);

    // Validate transfer amount doesn't exceed available balance
    const provider = await prisma.loanProvider.findUnique({
      where: { id: data.providerId },
      include: {
        ledgerAccounts: {
          where: { category: "Tax", type: "Receivable" }, // Collected inclusive tax balance in this deployment
        },
      },
    });

    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 }
      );
    }

    // Get current collected tax balance
    const taxHoldingAccount = provider.ledgerAccounts[0];
    const currentBalance = taxHoldingAccount?.balance || 0;
    if (!taxHoldingAccount) {
      return NextResponse.json(
        { error: "Tax holding ledger account (Tax Receivable) is not configured for this provider." },
        { status: 400 }
      );
    }

    if (data.transferAmount > currentBalance) {
      return NextResponse.json(
        {
          error: `Transfer amount exceeds available balance. Available: ${currentBalance}, Requested: ${data.transferAmount}`,
        },
        { status: 400 }
      );
    }
    const taxTransferSimulation = getTaxTransferSimulationDelegate();

    // Check for duplicate transfer reference
    const existingTransfer = await taxTransferSimulation.findUnique({
      where: { transferReference: data.transferReference },
    });

    if (existingTransfer) {
      return NextResponse.json(
        { error: "This transfer reference already exists. Please use a unique reference." },
        { status: 400 }
      );
    }

    // Create the tax transfer within a transaction
    const result = await prisma.$transaction(async (tx) => {
      const holdingLive = await tx.ledgerAccount.findUnique({
        where: { id: taxHoldingAccount.id },
      });
      const liveBalance = holdingLive?.balance ?? 0;
      if (!holdingLive) {
        throw new Error("Tax holding ledger account not found.");
      }
      if (data.transferAmount > liveBalance) {
        throw new Error(
          `Transfer amount exceeds available balance. Available: ${liveBalance}, Requested: ${data.transferAmount}`
        );
      }

      // Destination "real account" (tracked as a separate Tax/Received ledger account)
      // Keep this as Received so transferring out of Tax Receivable does not
      // re-appear under Tax Receivable in reporting.
      const destLedgerName = destinationLedgerAccountName(
        data.destinationAccountName
      );
      const destinationAccount =
        (await tx.ledgerAccount.findFirst({
          where: { providerId: data.providerId, name: destLedgerName },
        })) ??
        (await tx.ledgerAccount.create({
          data: {
            providerId: data.providerId,
            name: destLedgerName,
            type: "Received",
            category: "Tax",
            balance: 0,
          },
        }));

      // Create journal entry for the transfer
      const journalEntry = await tx.journalEntry.create({
        data: {
          providerId: data.providerId,
          date: new Date(data.transferDate),
          description: `Tax transfer simulation - Ref: ${data.transferReference}`,
          entries: {
            create: [
              {
                // Debit: destination (real) account
                ledgerAccountId: destinationAccount.id,
                type: "Debit",
                amount: data.transferAmount,
              },
              {
                // Credit: tax holding (reduce collected balance)
                ledgerAccountId: taxHoldingAccount!.id,
                type: "Credit",
                amount: data.transferAmount,
              },
            ],
          },
        },
        include: { entries: true },
      });

      // Apply balances:
      // - Decrement Tax Receivable (holding in this deployment)
      // - Increment destination Tax Received
      await tx.ledgerAccount.update({
        where: { id: holdingLive.id },
        data: { balance: { decrement: data.transferAmount } },
      });
      await tx.ledgerAccount.update({
        where: { id: destinationAccount.id },
        data: { balance: { increment: data.transferAmount } },
      });

      // Create tax transfer simulation record
      const txTaxTransferSimulation = (tx as any).taxTransferSimulation;
      if (!txTaxTransferSimulation) {
        throw new Error(
          "Tax transfer model is unavailable in Prisma transaction client. Run `npx prisma generate` and restart the dev server."
        );
      }

      const transfer = await txTaxTransferSimulation.create({
        data: {
          providerId: data.providerId,
          transferAmount: data.transferAmount,
          destinationAccountName: data.destinationAccountName,
          transferReference: data.transferReference,
          transferDate: new Date(data.transferDate),
          journalEntryId: journalEntry.id,
          recordedByUserId: user.id,
          status: "SIMULATED",
          notes: data.notes,
        },
        include: {
          provider: true,
          recordedByUser: {
            select: { id: true, fullName: true, email: true },
          },
          journalEntry: {
            include: { entries: true },
          },
        },
      });

      // Create audit log
      await createAuditLog({
        actorId: user.id,
        action: "CREATE_TAX_TRANSFER_SIMULATION",
        entity: "TaxTransferSimulation",
        entityId: transfer.id,
        details: JSON.stringify({
          amount: data.transferAmount,
          reference: data.transferReference,
          destination: data.destinationAccountName,
        }),
      });

      return transfer;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("Error creating tax transfer:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: error.message || "Failed to create tax transfer",
      },
      { status: error.status || 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Check user permissions
    const user = await getUserFromSession();
    if (!user || !hasPermission(user, "tax-transfers", "update")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const data = taxTransferReverseSchema.parse(body);
    const taxTransferSimulation = getTaxTransferSimulationDelegate();

    // Find the transfer
    const transfer = await taxTransferSimulation.findUnique({
      where: { id: data.transferSimulationId },
      include: {
        provider: {
          include: {
            ledgerAccounts: {
              where: { category: "Tax", type: "Receivable" }, // Tax holding (collected) account
            },
          },
        },
        journalEntry: { include: { entries: true } },
      },
    });

    if (!transfer) {
      return NextResponse.json(
        { error: "Tax transfer not found" },
        { status: 404 }
      );
    }

    if (transfer.status === "REVERSED") {
      return NextResponse.json(
        { error: "This transfer has already been reversed" },
        { status: 400 }
      );
    }

    // Reverse the transfer within a transaction
    const result = await prisma.$transaction(async (tx) => {
      const taxHoldingAccount = transfer.provider.ledgerAccounts[0];

      // Create reversal journal entry
      if (transfer.journalEntry && taxHoldingAccount) {
        const originalEntries = transfer.journalEntry.entries || [];
        await tx.journalEntry.create({
          data: {
            providerId: transfer.providerId,
            date: new Date(),
            description: `Reversal of tax transfer - Ref: ${transfer.transferReference}`,
            entries: {
              create: originalEntries.map((e) => ({
                ledgerAccountId: e.ledgerAccountId,
                type: e.type === "Debit" ? "Credit" : "Debit",
                amount: e.amount,
              })),
            },
          },
        });

        // Restore balances: specifically undo the simulation balances.
        // Holding (Tax Receivable) was decremented; destination was incremented.
        const destLedgerName = destinationLedgerAccountName(
          transfer.destinationAccountName
        );
        const destinationAccount = await tx.ledgerAccount.findFirst({
          where: { providerId: transfer.providerId, name: destLedgerName },
        });

        await tx.ledgerAccount.update({
          where: { id: taxHoldingAccount.id },
          data: { balance: { increment: transfer.transferAmount } },
        });

        if (destinationAccount) {
          await tx.ledgerAccount.update({
            where: { id: destinationAccount.id },
            data: { balance: { decrement: transfer.transferAmount } },
          });
        }
      }

      // Update transfer status
      const txTaxTransferSimulation = (tx as any).taxTransferSimulation;
      if (!txTaxTransferSimulation) {
        throw new Error(
          "Tax transfer model is unavailable in Prisma transaction client. Run `npx prisma generate` and restart the dev server."
        );
      }

      const reversedTransfer = await txTaxTransferSimulation.update({
        where: { id: data.transferSimulationId },
        data: {
          status: "REVERSED",
          reversedByUserId: user.id,
          reversalReason: data.reversalReason,
          reversedAt: new Date(),
        },
        include: {
          provider: true,
          recordedByUser: {
            select: { id: true, fullName: true, email: true },
          },
          reversedByUser: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      // Create audit log
      await createAuditLog({
        actorId: user.id,
        action: "REVERSE_TAX_TRANSFER_SIMULATION",
        entity: "TaxTransferSimulation",
        entityId: reversedTransfer.id,
        details: JSON.stringify({
          amount: transfer.transferAmount,
          reason: data.reversalReason,
        }),
      });

      return reversedTransfer;
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error reversing tax transfer:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: error.message || "Failed to reverse tax transfer",
      },
      { status: error.status || 500 }
    );
  }
}
