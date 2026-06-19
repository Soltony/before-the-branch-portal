import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { resolveAgricultureProduct } from "@/lib/lersha/disbursement";
import logger from "@/lib/logger";
import {
  calculateTotalRepayable,
  calculateInclusiveTax,
} from "@/lib/loan-calculator";
import { addDays } from "date-fns";
import { areDisbursementsEnabled } from "@/lib/disbursement-control";
import { processExternalDisbursement } from "@/lib/external-disbursement";
import type { InsuranceConfirmationRequest } from "@/lib/lersha/types";

/**
 * Approve and book a farmer insurance payment.
 *
 * Mirrors `autoDisburseFarmerLoan` (src/lib/lersha/disbursement.ts): on approval
 * the insurance amount is booked as a repayable loan (LoanApplication + Loan +
 * ledger entries, provider fund decrement, installments) and the configured
 * insurer account is credited via the external CBS. The per-farmer result is
 * returned so the caller can batch the Lersha /nib/insuranceConfirmation call.
 */

export interface InsurancePaymentOutcome {
  paymentId: string;
  /** External Lersha farmer id (LershaFarmer.farmerId). */
  externalFarmerId: string;
  /** True when the payment was booked (loan created). */
  ok: boolean;
  message: string;
  error?: string;
  /** Soft errors (e.g. unmapped insurer, insufficient funds) leave the payment
   * REQUESTED so the admin can fix the cause and retry. No Lersha confirmation. */
  softError?: boolean;
  /** True when the payment was already SUCCESS (idempotent no-op). */
  alreadyProcessed?: boolean;
  loanId?: string;
  remainingBalance?: number;
  transactionId?: string | null;
  transactionAmount?: number | null;
  externalDisbursementAttempted?: boolean;
  externalDisbursementOk?: boolean;
  /** Present only when there is a SUCCESS result to report to Lersha. */
  confirmation?: InsuranceConfirmationRequest;
}

function softError(
  paymentId: string,
  externalFarmerId: string,
  message: string,
): InsurancePaymentOutcome {
  return {
    paymentId,
    externalFarmerId,
    ok: false,
    softError: true,
    message,
    error: message,
  };
}

/**
 * Remaining loan balance for a farmer = requested amount minus everything
 * already disbursed (loan-request purposes + successful insurance payments).
 * Used when reporting a FAILED/rejected insurance result to Lersha.
 */
export async function getFarmerRemainingBalance(
  farmerInternalId: string,
): Promise<number> {
  const farmer = await prisma.lershaFarmer.findUnique({
    where: { id: farmerInternalId },
    select: { requestedLoanAmount: true },
  });
  if (!farmer) return 0;

  const disbursedRequests = await prisma.lershaLoanRequest.findMany({
    where: { farmerId: farmerInternalId, status: "DISBURSED" },
    select: { productId: true },
  });
  const productIds = disbursedRequests
    .map((r) => r.productId)
    .filter((id): id is string => Boolean(id));

  let disbursed = 0;
  if (productIds.length > 0) {
    const purposes = await prisma.lershaLoanPurpose.findMany({
      where: { farmerId: farmerInternalId, productId: { in: productIds } },
      select: { totalCost: true },
    });
    disbursed += purposes.reduce((sum, p) => sum + p.totalCost, 0);
  }

  const successfulInsurance = await prisma.lershaInsurancePayment.findMany({
    where: { farmerId: farmerInternalId, status: "SUCCESS" },
    select: { insuranceAmount: true },
  });
  disbursed += successfulInsurance.reduce((sum, p) => sum + p.insuranceAmount, 0);

  return Number(Math.max(0, farmer.requestedLoanAmount - disbursed).toFixed(2));
}

export async function processInsurancePayment(
  insurancePaymentId: string,
  actorId: string,
): Promise<InsurancePaymentOutcome> {
  try {
    const payment = await prisma.lershaInsurancePayment.findUnique({
      where: { id: insurancePaymentId },
      include: { farmer: true, insuranceAccount: true },
    });

    if (!payment) {
      return {
        paymentId: insurancePaymentId,
        externalFarmerId: "",
        ok: false,
        message: "Insurance payment not found",
        error: "PAYMENT_NOT_FOUND",
      };
    }

    const farmer = payment.farmer;
    const externalFarmerId = farmer.farmerId;

    // Idempotency: already-booked payments are a no-op (no re-confirmation).
    if (payment.status === "SUCCESS") {
      return {
        paymentId: payment.id,
        externalFarmerId,
        ok: true,
        alreadyProcessed: true,
        message: "Insurance payment already processed",
        loanId: payment.loanId ?? undefined,
        remainingBalance: payment.remainingBalance ?? undefined,
        transactionId: payment.transactionId,
        transactionAmount: payment.transactionAmount,
      };
    }

    if (payment.status !== "REQUESTED") {
      return {
        paymentId: payment.id,
        externalFarmerId,
        ok: false,
        message: `Cannot approve a payment with status "${payment.status}".`,
        error: "INVALID_PAYMENT_STATUS",
      };
    }

    const farmerUpper = farmer.status.toUpperCase();
    if (farmerUpper === "REJECTED" || farmerUpper === "DECLINED") {
      return {
        paymentId: payment.id,
        externalFarmerId,
        ok: false,
        softError: true,
        message: "Farmer registration is rejected; cannot approve insurance.",
        error: "FARMER_REJECTED",
      };
    }

    // Re-resolve the insurer account mapping in case it was configured after the
    // request was received (or changed since).
    let insuranceAccount = payment.insuranceAccount;
    if (!insuranceAccount && payment.insuranceName) {
      insuranceAccount = await prisma.insuranceAccount.findFirst({
        where: { insuranceName: payment.insuranceName, status: "ACTIVE" },
      });
    }
    if (!insuranceAccount) {
      return softError(
        payment.id,
        externalFarmerId,
        `No active insurance account configured for "${payment.insuranceName ?? "this insurer"}". Configure it under Insurance Accounts before approving.`,
      );
    }

    const creditAccount = insuranceAccount.accountNumber?.trim() || "";
    if (!creditAccount) {
      return softError(
        payment.id,
        externalFarmerId,
        "Configured insurance account has no account number.",
      );
    }

    const disbursementAmount = payment.insuranceAmount;
    const borrowerId = farmer.farmerId;

    const product = await resolveAgricultureProduct();
    if (!product) {
      return softError(
        payment.id,
        externalFarmerId,
        "No active agriculture LoanProduct found. Please configure a LoanProduct first.",
      );
    }

    const provider = product.provider;
    if (provider.initialBalance < disbursementAmount) {
      return softError(
        payment.id,
        externalFarmerId,
        `Insufficient provider funds. Available: ${provider.initialBalance}, Requested: ${disbursementAmount}`,
      );
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
      return softError(
        payment.id,
        externalFarmerId,
        "Principal Receivable ledger account not found.",
      );
    }
    if (calculatedServiceFee > 0 && !serviceFeeReceivableAccount) {
      return softError(
        payment.id,
        externalFarmerId,
        "Service Fee Receivable ledger account not found.",
      );
    }
    if (
      (calculatedTax > 0 || inclusiveTaxAmount > 0) &&
      !taxReceivableAccount
    ) {
      return softError(
        payment.id,
        externalFarmerId,
        "Tax Receivable ledger account not found.",
      );
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
            description: `Insurance payment for ${farmer.farmerName} (Farm ID: ${farmer.farmerId}) — ${insuranceAccount!.insuranceName}`,
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
          console.error(
            "[processInsurancePayment] Failed to create installments",
            e,
          );
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
                insuranceId: insuranceAccount!.insuranceId,
              }),
            } as any,
          });
        }

        // Remaining loan balance reported to Lersha = requested loan amount
        // minus everything already disbursed for this farmer (across loan
        // requests AND prior successful insurance payments) minus this amount.
        const previousDisbursedRequests = await tx.lershaLoanRequest.findMany({
          where: {
            farmerId: farmer.id,
            status: "DISBURSED",
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

        const otherSuccessfulInsurance =
          await tx.lershaInsurancePayment.findMany({
            where: {
              farmerId: farmer.id,
              status: "SUCCESS",
              NOT: { id: payment.id },
            },
            select: { insuranceAmount: true },
          });
        const previousInsuranceAmount = otherSuccessfulInsurance.reduce(
          (sum, item) => sum + item.insuranceAmount,
          0,
        );

        const balance = Number(
          Math.max(
            0,
            farmer.requestedLoanAmount -
              previousDisbursedAmount -
              previousInsuranceAmount -
              disbursementAmount,
          ).toFixed(2),
        );

        await tx.lershaInsurancePayment.update({
          where: { id: payment.id },
          data: {
            status: "SUCCESS",
            loanId: createdLoan.id,
            remainingBalance: balance,
            transactionAmount: disbursementTransferAmount,
            insuranceAccountId: insuranceAccount!.id,
            insuranceId: insuranceAccount!.insuranceId,
            creditAccount,
            approvedByUserId: actorId,
            confirmedAt: new Date(),
          },
        });

        return {
          loan: createdLoan,
          journalEntryId: journalEntry.id,
          remainingBalance: balance,
        };
      });

    // External CBS credit (best-effort, mirrors autoDisburseFarmerLoan: the loan
    // stays booked and the result is reported as SUCCESS even if the upstream
    // transfer fails — the DisbursementTransaction tracks retry state).
    let externalDisbursementAttempted = false;
    let externalDisbursementOk = false;
    let upstreamTransactionId: string | null = null;

    if (creditAccount) {
      const disbursementsEnabled = await areDisbursementsEnabled();
      if (disbursementsEnabled) {
        externalDisbursementAttempted = true;
        const ext = await processExternalDisbursement({
          creditAccount,
          providerId: provider.id,
          amount: disbursementTransferAmount,
          loanId: loan.id,
          actorId,
        });
        externalDisbursementOk = ext.ok;
        upstreamTransactionId = ext.transactionId ?? null;
        if (!ext.ok) {
          logger.error(
            `[processInsurancePayment] External disbursement failed for loan ${loan.id}: ${ext.error}`,
          );
        }
      } else {
        logger.warn(
          `[processInsurancePayment] Disbursements disabled; insurance loan ${loan.id} posted internally only`,
        );
      }
    }

    // Always report a transaction id to Lersha: prefer the upstream CBS id, else
    // fall back to a stable internal reference (when disbursements are disabled
    // or the upstream response carries no id).
    const transactionId =
      upstreamTransactionId ||
      `INS-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID()
        .slice(0, 6)
        .toUpperCase()}`;

    await prisma.lershaInsurancePayment
      .update({
        where: { id: payment.id },
        data: { transactionId },
      })
      .catch(() => null);

    await createAuditLog({
      actorId,
      action: "LERSHA_INSURANCE_APPROVED",
      entity: "LershaInsurancePayment",
      entityId: payment.id,
      details: {
        farmerId: farmer.farmerId,
        farmerName: farmer.farmerName,
        borrowerId,
        loanId: loan.id,
        insuranceName: insuranceAccount.insuranceName,
        insuranceId: insuranceAccount.insuranceId,
        insuranceAmount: disbursementAmount,
        serviceFee: calculatedServiceFee,
        taxDeducted: inclusiveTaxAmount,
        netDisbursedAmount,
        remainingBalance,
        journalEntryId,
        creditAccount,
        transactionId,
        externalDisbursementAttempted,
        externalDisbursementOk,
      },
    });

    return {
      paymentId: payment.id,
      externalFarmerId,
      ok: true,
      message: "Insurance payment approved and booked",
      loanId: loan.id,
      remainingBalance,
      transactionId,
      transactionAmount: disbursementTransferAmount,
      externalDisbursementAttempted,
      externalDisbursementOk,
      confirmation: {
        farmer_id: externalFarmerId,
        status: "SUCCESS",
        remaining_balance: remainingBalance,
        transaction_id: transactionId,
        transaction_amount: disbursementTransferAmount,
      },
    };
  } catch (error: any) {
    console.error("[processInsurancePayment] Error:", error);
    return {
      paymentId: insurancePaymentId,
      externalFarmerId: "",
      ok: false,
      message: "Failed to process insurance payment",
      error: error?.message ?? String(error),
    };
  }
}
