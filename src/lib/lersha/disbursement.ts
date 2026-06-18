import prisma from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { sendDisbursementConfirmation } from "@/lib/lersha/client";
import logger from "@/lib/logger";
import {
  calculateTotalRepayable,
  calculateInclusiveTax,
} from "@/lib/loan-calculator";
import { addDays } from "date-fns";
import { areDisbursementsEnabled } from "@/lib/disbursement-control";
import { processExternalDisbursement } from "@/lib/external-disbursement";

/**
 * Auto-disbursement for farmer loans after OTP verification.
 * Mirrors the standard personal-loan disbursement in /api/loans (handlePersonalLoan).
 */

interface AutoDisbursementResult {
  success: boolean;
  message: string;
  loanId?: string;
  borrowerId?: string;
  remainingBalance?: number;
  lershaNotified?: boolean;
  externalDisbursementAttempted?: boolean;
  externalDisbursementOk?: boolean;
  error?: string;
}

async function resolveAgricultureProduct() {
  const configuredId = process.env.LERSHA_LOAN_PRODUCT_ID;
  if (configuredId) {
    const byId = await prisma.loanProduct.findFirst({
      where: { id: configuredId, status: "Active" },
      include: { provider: { include: { ledgerAccounts: true } } },
    });
    if (byId) return byId;
  }

  return prisma.loanProduct.findFirst({
    where: {
      name: { contains: "agriculture" },
      status: "Active",
    },
    include: { provider: { include: { ledgerAccounts: true } } },
  });
}

/**
 * Resolve the LoanProvider used by the Lersha farmer flow (the provider whose
 * loan product Lersha disburses against). Used to locate the right
 * TermsAndConditions when generating loan contracts.
 */
export async function resolveLershaProvider() {
  const product = await resolveAgricultureProduct();
  return product?.provider ?? null;
}

/**
 * Automatically disburse a farmer's loan after OTP verification.
 */
export async function autoDisburseFarmerLoan(
  lershaLoanRequestId: string,
): Promise<AutoDisbursementResult> {
  try {
    const loanRequest = await prisma.lershaLoanRequest.findUnique({
      where: { id: lershaLoanRequestId },
      include: { farmer: true },
    });

    if (!loanRequest) {
      return {
        success: false,
        message: "Loan request not found",
        error: "LOAN_REQUEST_NOT_FOUND",
      };
    }

    if (loanRequest.status === "DISBURSED") {
      return {
        success: true,
        message: "Loan already disbursed",
        remainingBalance: loanRequest.remainingBalance ?? undefined,
      };
    }

    if (loanRequest.status !== "OTP_VERIFIED") {
      return {
        success: false,
        message: `Cannot disburse loan with status: ${loanRequest.status}`,
        error: "INVALID_LOAN_STATUS",
      };
    }

    const farmer = loanRequest.farmer;
    const borrowerId = farmer.farmerId;

    const selectedLoanPurpose = await prisma.lershaLoanPurpose.findUnique({
      where: { productId: loanRequest.productId },
    });

    if (!selectedLoanPurpose) {
      return {
        success: false,
        message: "Loan purpose not found for requested product",
        error: "LOAN_PURPOSE_NOT_FOUND",
      };
    }

    const disbursementAmount = selectedLoanPurpose.totalCost;
    const creditAccount = selectedLoanPurpose.agroDealerAccountNo?.trim() || "";

    const product = await resolveAgricultureProduct();
    if (!product) {
      return {
        success: false,
        message:
          "No active agriculture LoanProduct found. Please configure a LoanProduct first.",
        error: "NO_AGRICULTURE_PRODUCT",
      };
    }

    const provider = product.provider;
    if (provider.initialBalance < disbursementAmount) {
      return {
        success: false,
        message: `Insufficient provider funds. Available: ${provider.initialBalance}, Requested: ${disbursementAmount}`,
        error: "INSUFFICIENT_PROVIDER_FUNDS",
      };
    }

    let borrower = await prisma.borrower.findUnique({
      where: { id: borrowerId },
    });
    if (!borrower) {
      borrower = await prisma.borrower.create({
        data: { id: borrowerId, status: "Active" },
      });
    }

    const disbursedDate = new Date();
    const dueDate = new Date(
      Date.now() + farmer.requestedLoanTermInMonth * 30 * 24 * 60 * 60 * 1000,
    );

    const taxConfigs = await prisma.tax.findMany({
      where: { status: "Active" },
    });

    const tempLoanForCalc = {
      id: "temp",
      loanAmount: disbursementAmount,
      disbursedDate,
      dueDate,
      serviceFee: 0,
      repaymentStatus: "Unpaid" as const,
      payments: [],
      productName: product.name,
      providerName: provider.name,
      repaidAmount: 0,
      penaltyAmount: 0,
      product: product as any,
    };

    const { serviceFee: calculatedServiceFee, tax: calculatedTax } =
      calculateTotalRepayable(
        tempLoanForCalc as any,
        product as any,
        taxConfigs as any,
        disbursedDate,
      );

    const { taxAmount: inclusiveTaxAmount, netDisbursedAmount } =
      calculateInclusiveTax(disbursementAmount, taxConfigs as any);

    const principalReceivableAccount = provider.ledgerAccounts.find(
      (acc) => acc.category === "Principal" && acc.type === "Receivable",
    );
    const serviceFeeReceivableAccount = provider.ledgerAccounts.find(
      (acc) => acc.category === "ServiceFee" && acc.type === "Receivable",
    );
    const taxReceivableAccount = provider.ledgerAccounts.find(
      (acc) => acc.category === "Tax" && acc.type === "Receivable",
    );

    if (!principalReceivableAccount) {
      return {
        success: false,
        message: "Principal Receivable ledger account not found.",
        error: "MISSING_LEDGER_ACCOUNTS",
      };
    }
    if (calculatedServiceFee > 0 && !serviceFeeReceivableAccount) {
      return {
        success: false,
        message: "Service Fee Receivable ledger account not found.",
        error: "MISSING_LEDGER_ACCOUNTS",
      };
    }
    if (
      (calculatedTax > 0 || inclusiveTaxAmount > 0) &&
      !taxReceivableAccount
    ) {
      return {
        success: false,
        message: "Tax Receivable ledger account not found.",
        error: "MISSING_LEDGER_ACCOUNTS",
      };
    }

    const forcedProviderId = process.env.FORCE_PROVIDER_ID ?? "PRO0001";
    const disbursementTransferAmount =
      inclusiveTaxAmount > 0 ? netDisbursedAmount : disbursementAmount;

    const { loan, journalEntryId, remainingBalance } =
      await prisma.$transaction(async (tx) => {
        const loanApplication = await tx.loanApplication.create({
          data: {
            borrowerId,
            productId: product.id,
            loanAmount: disbursementAmount,
            status: "DISBURSED",
          },
        });

        const createdLoan = await tx.loan.create({
          data: {
            borrowerId,
            productId: product.id,
            loanApplicationId: loanApplication.id,
            loanAmount: disbursementAmount,
            disbursedDate,
            dueDate,
            serviceFee: calculatedServiceFee,
            penaltyAmount: 0,
            taxDeducted: inclusiveTaxAmount,
            netDisbursedAmount,
            repaymentStatus: "Unpaid",
            repaidAmount: 0,
          },
        });

        const journalEntry = await tx.journalEntry.create({
          data: {
            providerId: provider.id,
            loanId: createdLoan.id,
            date: disbursedDate,
            description: `Farmer loan disbursement for ${farmer.farmerName} (Farm ID: ${farmer.farmerId})`,
          },
        });

        await tx.ledgerEntry.createMany({
          data: [
            {
              journalEntryId: journalEntry.id,
              ledgerAccountId: principalReceivableAccount.id,
              type: "Debit",
              amount: disbursementAmount,
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
          data: { balance: { increment: disbursementAmount } },
        });

        await tx.loanProvider.update({
          where: { id: provider.id },
          data: { initialBalance: { decrement: disbursementAmount } },
        });

        try {
          const installmentsCount = product.installments || null;
          const repaymentIntervalDays = product.repaymentIntervalDays ?? null;
          if (installmentsCount && installmentsCount > 0) {
            const round2 = (v: number) =>
              Math.round((v + Number.EPSILON) * 100) / 100;
            const interval =
              (repaymentIntervalDays ??
                Math.floor(
                  (dueDate.getTime() - disbursedDate.getTime()) /
                    (1000 * 60 * 60 * 24) /
                    installmentsCount,
                )) || 0;
            const totalPrincipal = Number(disbursementAmount) || 0;
            let remaining = round2(totalPrincipal);
            for (let i = 1; i <= installmentsCount; i++) {
              const isLast = i === installmentsCount;
              const amount = isLast
                ? remaining
                : round2(
                    Math.floor((totalPrincipal / installmentsCount) * 100) /
                      100,
                  );
              const due = addDays(disbursedDate, interval * i);
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
          console.error("[autoDisburseFarmerLoan] Failed to create installments", e);
        }

        if (creditAccount) {
          await tx.disbursementTransaction.create({
            data: {
              loanId: createdLoan.id,
              providerId: forcedProviderId,
              originalProviderId: provider.id,
              creditAccount,
              amount: disbursementTransferAmount,
              disbursementStatus: "PENDING",
              requestPayload: JSON.stringify({
                creditAccount,
                providerId: forcedProviderId,
                amount: disbursementTransferAmount,
                loanId: createdLoan.id,
              }),
            } as any,
          });
        }

        const previousDisbursedRequests = await tx.lershaLoanRequest.findMany({
          where: {
            farmerId: farmer.id,
            status: "DISBURSED",
            NOT: { id: lershaLoanRequestId },
          },
          select: { productId: true },
        });
        const previousDisbursedProductIds = previousDisbursedRequests
          .map((r) => r.productId)
          .filter((id): id is string => Boolean(id));

        let previousDisbursedAmount = 0;
        if (previousDisbursedProductIds.length > 0) {
          const previousPurposes = await tx.lershaLoanPurpose.findMany({
            where: {
              farmerId: farmer.id,
              productId: { in: previousDisbursedProductIds },
            },
            select: { totalCost: true },
          });
          previousDisbursedAmount = previousPurposes.reduce(
            (sum, item) => sum + item.totalCost,
            0,
          );
        }

        const balance = Number(
          Math.max(
            0,
            farmer.requestedLoanAmount -
              previousDisbursedAmount -
              disbursementAmount,
          ).toFixed(2),
        );

        await tx.lershaLoanRequest.update({
          where: { id: lershaLoanRequestId },
          data: {
            status: "DISBURSED",
            remainingBalance: balance,
            disbursementConfirmedAt: new Date(),
          },
        });

        return {
          loan: createdLoan,
          journalEntryId: journalEntry.id,
          remainingBalance: balance,
        };
      });

    let externalDisbursementAttempted = false;
    let externalDisbursementOk = false;

    if (creditAccount) {
      const disbursementsEnabled = await areDisbursementsEnabled();
      if (disbursementsEnabled) {
        externalDisbursementAttempted = true;
        const ext = await processExternalDisbursement({
          creditAccount,
          providerId: provider.id,
          amount: disbursementTransferAmount,
          loanId: loan.id,
          actorId: "lersha-integration",
        });
        externalDisbursementOk = ext.ok;
        if (!ext.ok) {
          logger.error(
            `[autoDisburseFarmerLoan] External disbursement failed for loan ${loan.id}: ${ext.error}`,
          );
        }
      } else {
        logger.warn(
          `[autoDisburseFarmerLoan] Disbursements disabled; loan ${loan.id} posted internally only`,
        );
      }
    } else {
      logger.warn(
        `[autoDisburseFarmerLoan] No agro-dealer account for product ${loanRequest.productId}; skipping CBS transfer`,
      );
    }

    let lershaNotified = false;
    try {
      if (!loanRequest.referenceNo) {
        throw new Error(
          "referenceNo is required before Lersha disbursement confirmation",
        );
      }
      const lershaPayload = {
        farmer_id: farmer.farmerId,
        remaining_balance: remainingBalance,
        productId: loanRequest.productId,
        referenceNo: loanRequest.referenceNo,
        status: "DISBURSED" as const,
      };
      const lershaResult = await sendDisbursementConfirmation(lershaPayload);
      lershaNotified = lershaResult.ok;
      if (!lershaResult.ok) {
        logger.error(
          `[autoDisburseFarmerLoan] Lersha confirmation failed (${lershaResult.status}) for ${lershaLoanRequestId}`,
        );
      }
    } catch (err) {
      logger.error(
        `[autoDisburseFarmerLoan] Failed to notify Lersha for ${lershaLoanRequestId}: ${err}`,
      );
    }

    await createAuditLog({
      actorId: "lersha-integration",
      action: "LERSHA_AUTO_DISBURSEMENT",
      entity: "LershaLoanRequest",
      entityId: lershaLoanRequestId,
      details: {
        farmerId: farmer.farmerId,
        farmerName: farmer.farmerName,
        borrowerId,
        loanId: loan.id,
        loanAmount: disbursementAmount,
        serviceFee: calculatedServiceFee,
        taxDeducted: inclusiveTaxAmount,
        netDisbursedAmount,
        remainingBalance,
        journalEntryId,
        productId: loanRequest.productId,
        loanPurpose: selectedLoanPurpose.loanPurpose,
        creditAccount: creditAccount || null,
        lershaNotified,
        externalDisbursementAttempted,
        externalDisbursementOk,
      },
    });

    return {
      success: true,
      message: "Loan disbursed successfully",
      loanId: loan.id,
      borrowerId: borrower.id,
      remainingBalance,
      lershaNotified,
      externalDisbursementAttempted,
      externalDisbursementOk,
    };
  } catch (error: any) {
    console.error("[autoDisburseFarmerLoan] Error:", error);
    return {
      success: false,
      message: "Failed to disburse loan",
      error: error.message,
    };
  }
}
