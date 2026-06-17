"use server";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import {
  calculateTotalRepayable,
  calculateInclusiveTax,
} from "@/lib/loan-calculator";
import { addDays } from "date-fns";
import { loanCreationSchema } from "@/lib/schemas";
import { checkLoanEligibility } from "@/actions/eligibility";
import { createAuditLog } from "@/lib/audit-log";
import {
  MiniAppAuthError,
  requireMiniAppAuthContext,
  assertBorrowerMatches,
} from "@/lib/miniapp-auth";
import { areDisbursementsEnabled } from "@/lib/disbursement-control";

async function handlePersonalLoan(
  data: z.infer<typeof loanCreationSchema> & { creditAccount?: string },
) {
  return await prisma.$transaction(async (tx) => {
    const loanApplication = await tx.loanApplication.create({
      data: {
        borrowerId: data.borrowerId,
        productId: data.productId,
        loanAmount: data.loanAmount,
        status: "DISBURSED",
      },
    });

    const [product, taxConfigs] = await Promise.all([
      tx.loanProduct.findUnique({
        where: { id: data.productId },
        include: {
          provider: {
            include: {
              ledgerAccounts: true,
            },
          },
        },
      }),
      tx.tax.findMany({ where: { status: "Active" } }),
    ]);

    if (!product) {
      throw new Error("Loan product not found.");
    }

    if (product.provider.initialBalance < data.loanAmount) {
      throw new Error(
        `Insufficient provider funds. Available: ${product.provider.initialBalance}, Requested: ${data.loanAmount}`,
      );
    }

    const provider = product.provider;

    const tempLoanForCalc = {
      id: "temp",
      loanAmount: data.loanAmount,
      disbursedDate: new Date(data.disbursedDate),
      dueDate: new Date(data.dueDate),
      serviceFee: 0,
      repaymentStatus: "Unpaid" as "Unpaid" | "Paid",
      payments: [],
      productName: product.name,
      providerName: product.provider.name,
      repaidAmount: 0,
      penaltyAmount: 0,
      product: product as any,
    };
    const { serviceFee: calculatedServiceFee, tax: calculatedTax } =
      calculateTotalRepayable(
        tempLoanForCalc as any,
        product as any,
        (taxConfigs ?? []) as any,
        new Date(data.disbursedDate),
      );

    // Calculate inclusive tax (deducted from principal before disbursement)
    const { taxAmount: inclusiveTaxAmount, netDisbursedAmount } =
      calculateInclusiveTax(data.loanAmount, (taxConfigs ?? []) as any);

    const principalReceivableAccount = provider.ledgerAccounts.find(
      (acc: any) => acc.category === "Principal" && acc.type === "Receivable",
    );
    const serviceFeeReceivableAccount = provider.ledgerAccounts.find(
      (acc: any) => acc.category === "ServiceFee" && acc.type === "Receivable",
    );
    const taxReceivableAccount = provider.ledgerAccounts.find(
      (acc: any) => acc.category === "Tax" && acc.type === "Receivable",
    );
    if (!principalReceivableAccount)
      throw new Error("Principal Receivable ledger account not found.");
    if (calculatedServiceFee > 0 && !serviceFeeReceivableAccount)
      throw new Error("Service Fee Receivable ledger account not found.");
    if ((calculatedTax > 0 || inclusiveTaxAmount > 0) && !taxReceivableAccount)
      throw new Error("Tax Receivable ledger account not found.");

    const createdLoan = await tx.loan.create({
      data: {
        borrowerId: data.borrowerId,
        productId: data.productId,
        loanApplicationId: loanApplication.id,
        loanAmount: data.loanAmount,
        disbursedDate: data.disbursedDate,
        dueDate: data.dueDate,
        serviceFee: calculatedServiceFee,
        penaltyAmount: 0,
        taxDeducted: inclusiveTaxAmount,
        netDisbursedAmount: netDisbursedAmount,
        repaymentStatus: "Unpaid",
        repaidAmount: 0,
      },
    });

    const journalEntry = await tx.journalEntry.create({
      data: {
        providerId: provider.id,
        loanId: createdLoan.id,
        date: new Date(data.disbursedDate),
        description: `Loan disbursement for ${product.name} to borrower ${data.borrowerId}`,
      },
    });

    await tx.ledgerEntry.createMany({
      data: [
        {
          journalEntryId: journalEntry.id,
          ledgerAccountId: principalReceivableAccount.id,
          type: "Debit",
          amount: data.loanAmount,
        },
      ],
    });

    if (calculatedServiceFee > 0 && serviceFeeReceivableAccount) {
      await tx.ledgerEntry.createMany({
        data: [
          {
            journalEntryId: journalEntry.id,
            ledgerAccountId: serviceFeeReceivableAccount.id,
            type: "Debit",
            amount: calculatedServiceFee,
          },
        ],
      });
      await tx.ledgerAccount.update({
        where: { id: serviceFeeReceivableAccount.id },
        data: { balance: { increment: calculatedServiceFee } },
      });
    }

    // Tax is applied to configured income components and accrued into Tax Receivable.
    const totalTaxForLedger = calculatedTax + inclusiveTaxAmount;
    if (totalTaxForLedger > 0.000001 && taxReceivableAccount) {
      await tx.ledgerEntry.createMany({
        data: [
          {
            journalEntryId: journalEntry.id,
            ledgerAccountId: taxReceivableAccount.id,
            type: "Debit",
            amount: totalTaxForLedger,
          },
        ],
      });
      await tx.ledgerAccount.update({
        where: { id: taxReceivableAccount.id },
        data: { balance: { increment: totalTaxForLedger } },
      });
    }

    await tx.ledgerAccount.update({
      where: { id: principalReceivableAccount.id },
      data: { balance: { increment: data.loanAmount } },
    });
    await tx.loanProvider.update({
      where: { id: provider.id },
      data: { initialBalance: { decrement: data.loanAmount } },
    });

    // Create installment schedule if product defines installments
    try {
      const installmentsCount = product.installments || null;
      const repaymentIntervalDays = product.repaymentIntervalDays ?? null;
      if (installmentsCount && installmentsCount > 0) {
        const round2 = (v: number) =>
          Math.round((v + Number.EPSILON) * 100) / 100;

        const interval =
          (repaymentIntervalDays ??
            Math.floor(
              (new Date(data.dueDate).getTime() -
                new Date(data.disbursedDate).getTime()) /
                (1000 * 60 * 60 * 24) /
                installmentsCount,
            )) ||
          0;

        // Installments represent principal-only. Interest/service-fee/tax accrue separately over time.
        const totalPrincipal = Number(data.loanAmount) || 0;
        let remaining = round2(totalPrincipal);
        for (let i = 1; i <= installmentsCount; i++) {
          const isLast = i === installmentsCount;
          const amount = isLast
            ? remaining
            : round2(
                Math.floor((totalPrincipal / installmentsCount) * 100) / 100,
              );
          const due = addDays(new Date(data.disbursedDate), interval * i);
          await tx.loanInstallment.create({
            data: {
              loanId: createdLoan.id,
              installmentNumber: i,
              dueDate: due,
              amount,
              isActive: i === 1,
            },
          });
          remaining = round2(remaining - amount);
        }
      }
    } catch (e) {
      console.error("Failed to create installments", e);
    }

    // Create a PENDING DisbursementTransaction record linked to this loan
    // This ensures every loan has a disbursement record from creation
    const forcedProviderId = process.env.FORCE_PROVIDER_ID ?? "PRO0001";
    const creditAccount =
      data.creditAccount || data.borrowerAccountNumber || "";

    let disbursementTransaction = null;
    if (creditAccount) {
      disbursementTransaction = await tx.disbursementTransaction.create({
        data: {
          loanId: createdLoan.id,
          providerId: forcedProviderId,
          originalProviderId: provider.id,
          creditAccount: creditAccount,
          amount: inclusiveTaxAmount > 0 ? netDisbursedAmount : data.loanAmount,
          disbursementStatus: "PENDING",
          requestPayload: JSON.stringify({
            creditAccount,
            providerId: forcedProviderId,
            amount:
              inclusiveTaxAmount > 0 ? netDisbursedAmount : data.loanAmount,
            loanId: createdLoan.id,
          }),
        } as any, // Type assertion until Prisma client is regenerated
      });
    }

    return {
      ...createdLoan,
      // Explicitly include computed tax fields to ensure they appear in the
      // JSON response even if the Prisma client hasn't been regenerated yet.
      taxDeducted: inclusiveTaxAmount,
      netDisbursedAmount: netDisbursedAmount,
      disbursementTransactionId: disbursementTransaction?.id,
    };
  });
}

export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return new NextResponse(null, {
      status: 405,
      statusText: "Method Not Allowed",
    });
  }
  // enforce CSRF for loan disbursement

  let loanDetailsForLogging: any = {};
  try {
    const ctx = await requireMiniAppAuthContext();

    const enabled = await areDisbursementsEnabled();
    if (!enabled) {
      return NextResponse.json(
        { error: "Disbursements are currently disabled." },
        { status: 503 },
      );
    }

    const body = await req.json();
    const data = loanCreationSchema.parse(body);
    loanDetailsForLogging = { ...data };

    assertBorrowerMatches(data.borrowerId, ctx);

    const product = await prisma.loanProduct.findUnique({
      where: { id: data.productId },
    });

    if (!product) {
      throw new Error("Loan product not found.");
    }

    const logDetails = {
      borrowerId: data.borrowerId,
      productId: data.productId,
      amount: data.loanAmount,
    };
    await createAuditLog({
      actorId: "system",
      action: "LOAN_DISBURSEMENT_INITIATED",
      entity: "LOAN",
      details: logDetails,
    });

    const { isEligible, maxLoanAmount, reason } = await checkLoanEligibility(
      data.borrowerId,
      product.providerId,
      product.id,
    );

    if (!isEligible) {
      throw new Error(`Loan denied: ${reason}`);
    }

    if (data.loanAmount > maxLoanAmount) {
      throw new Error(
        `Requested amount of ${data.loanAmount} exceeds the maximum allowed limit of ${maxLoanAmount}.`,
      );
    }

    const newLoan = await handlePersonalLoan(data);

    const successLogDetails = {
      loanId: newLoan.id,
      borrowerId: newLoan.borrowerId,
      productId: newLoan.productId,
      amount: newLoan.loanAmount,
      serviceFee: newLoan.serviceFee,
      taxDeducted: newLoan.taxDeducted,
      netDisbursedAmount: newLoan.netDisbursedAmount,
    };
    await createAuditLog({
      actorId: "system",
      action: "LOAN_DISBURSEMENT_SUCCESS",
      entity: "LOAN",
      entityId: newLoan.id,
      details: successLogDetails,
    });

    return NextResponse.json(newLoan, { status: 201 });
  } catch (error) {
    if (error instanceof MiniAppAuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    const errorMessage =
      error instanceof z.ZodError ? error.errors : (error as Error).message;
    const failureLogDetails = {
      ...loanDetailsForLogging,
      error: errorMessage,
    };
    await createAuditLog({
      actorId: "system",
      action: "LOAN_DISBURSEMENT_FAILED",
      entity: "LOAN",
      details: failureLogDetails,
    });

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Error in POST /api/loans:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
