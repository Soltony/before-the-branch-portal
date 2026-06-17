"use server";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import {
  calculateTotalRepayable,
  calculateInclusiveTax,
} from "@/lib/loan-calculator";
import { loanCreationSchema } from "@/lib/schemas";
import { checkLoanEligibility } from "@/actions/eligibility";
import {
  getSalaryEntryForProduct,
  computeAllowedFromSalary,
} from "@/lib/salary-advance";
import { createAuditLog } from "@/lib/audit-log";

async function handlePersonalLoan(data: z.infer<typeof loanCreationSchema>) {
  return await prisma.$transaction(async (tx) => {
    const loanApplication = await tx.loanApplication.create({
      data: {
        borrowerId: data.borrowerId,
        productId: data.productId,
        loanAmount: data.loanAmount,
        status: "DISBURSED",
      },
    });

    const product = await tx.loanProduct.findUnique({
      where: { id: data.productId },
      include: {
        provider: {
          include: {
            ledgerAccounts: true,
          },
        },
      },
    });

    if (!product) {
      throw new Error("Loan product not found.");
    }

    if (product.provider.initialBalance < data.loanAmount) {
      throw new Error(
        `Insufficient provider funds. Available: ${product.provider.initialBalance}, Requested: ${data.loanAmount}`,
      );
    }

    const provider = product.provider;

    const taxConfigs = await tx.tax.findMany({ where: { status: "ACTIVE" } });

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

    // Record inclusive tax in the ledger (tax deducted upfront from principal)
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
    // Deduct the full loan amount from provider balance (the tax portion stays with the system)
    await tx.loanProvider.update({
      where: { id: provider.id },
      data: { initialBalance: { decrement: data.loanAmount } },
    });

    return createdLoan;
  });
}

export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return new NextResponse(null, {
      status: 405,
      statusText: "Method Not Allowed",
    });
  }
  let loanDetailsForLogging: any = {};
  try {
    const body = await req.json();
    const data = loanCreationSchema.parse(body);
    loanDetailsForLogging = { ...data };

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

    if (product.isSalaryAdvance) {
      // require borrowerAccountNumber to map salary entry
      const accountNumber =
        (body as any).borrowerAccountNumber ||
        (data as any).borrowerAccountNumber;
      if (!accountNumber) {
        throw new Error(
          "Borrower account number is required for salary-advance products.",
        );
      }
      const entry = await getSalaryEntryForProduct(product.id, accountNumber);
      if (!entry) {
        throw new Error("No salary entry found for borrower account number.");
      }
      const percent = product.advancePercent || 0;
      const allowed = computeAllowedFromSalary(
        Number(entry.salary),
        percent,
        product.maxLoan || undefined,
      );
      if (data.loanAmount > allowed) {
        throw new Error(
          `Requested amount of ${data.loanAmount} exceeds the salary-advance allowed amount of ${allowed}.`,
        );
      }
    } else {
      if (data.loanAmount > maxLoanAmount) {
        throw new Error(
          `Requested amount of ${data.loanAmount} exceeds the maximum allowed limit of ${maxLoanAmount}.`,
        );
      }
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
