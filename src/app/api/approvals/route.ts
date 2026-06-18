"use server";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";
import { z, ZodError } from "zod";
import { validationErrorResponse, handleApiError } from "@/lib/error-utils";
import { createAuditLog } from "@/lib/audit-log";
import ExcelJS from "exceljs";
import { toCamelCase } from "@/lib/utils";
import { Prisma } from "@prisma/client";
import { startOfDay, isBefore, isEqual, differenceInDays } from "date-fns";
import sendSms from "@/lib/sms";
import { calculateTotalRepayable } from "@/lib/loan-calculator";
import { reverseAllLoanJournalEntries } from "@/lib/loan-ledger-reversal";

const approvalSchema = z.object({
  changeId: z.string(),
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
});

const defaultLedgerAccounts = [
  // Assets (Receivables)
  { name: "Principal Receivable", type: "Receivable", category: "Principal" },
  { name: "Interest Receivable", type: "Receivable", category: "Interest" },
  {
    name: "Service Fee Receivable",
    type: "Receivable",
    category: "ServiceFee",
  },
  { name: "Penalty Receivable", type: "Receivable", category: "Penalty" },
  { name: "Tax Receivable", type: "Receivable", category: "Tax" },
  // Cash / Received
  { name: "Principal Received", type: "Received", category: "Principal" },
  { name: "Interest Received", type: "Received", category: "Interest" },
  { name: "Service Fee Received", type: "Received", category: "ServiceFee" },
  { name: "Penalty Received", type: "Received", category: "Penalty" },
  { name: "Tax Received", type: "Received", category: "Tax" },
  // Income
  { name: "Interest Income", type: "Income", category: "Interest" },
  { name: "Service Fee Income", type: "Income", category: "ServiceFee" },
  { name: "Penalty Income", type: "Income", category: "Penalty" },
];

// Server-side file size limit (10MB)
const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;

async function applyDataProvisioningUpload(change: any, data: any) {
  const { fileContent, fileName, configId } = data.created;

  // Server-side file size validation
  if (!fileContent) {
    throw new Error("File upload failed. Please try again.");
  }
  const buffer = Buffer.from(fileContent, "base64");
  if (buffer.length > MAX_UPLOAD_FILE_SIZE) {
    throw new Error("File upload failed. Please try again.");
  }

  const config = await prisma.dataProvisioningConfig.findUnique({
    where: { id: configId },
  });
  if (!config) throw new Error("Data Provisioning Config not found.");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];

  const columnCount = worksheet.columnCount || 0;
  const jsonData: any[][] = [];
  worksheet.eachRow((row) => {
    const rowArr: any[] = [];
    for (let i = 1; i <= columnCount; i++) {
      rowArr.push(row.getCell(i).value);
    }
    jsonData.push(rowArr);
  });

  const originalHeaders =
    jsonData.length > 0 ? jsonData[0].map((h) => String(h)) : [];
  const camelCaseHeaders = originalHeaders.map(toCamelCase);
  const rows = jsonData.length > 1 ? jsonData.slice(1) : [];

  const idColumnConfig = JSON.parse(config.columns as string).find(
    (c: any) => c.isIdentifier
  );
  if (!idColumnConfig)
    throw new Error("No identifier column found in config");
  const idColumnCamelCase = toCamelCase(idColumnConfig.name);

  // First, create the upload record outside of the batched transaction
  const newUpload = await prisma.dataProvisioningUpload.create({
    data: {
      configId: configId,
      fileName: fileName,
      rowCount: rows.length,
      uploadedBy: change.createdById,
    },
  });

  // Process rows in batches to avoid transaction timeout
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    
    // Process each batch in a transaction with extended timeout
    await prisma.$transaction(
      async (tx) => {
        for (const row of batch) {
          const newRowData: { [key: string]: any } = {};
          camelCaseHeaders.forEach((header, index) => {
            newRowData[header] = row[index];
          });

          const borrowerId = String(newRowData[idColumnCamelCase]);
          if (!borrowerId || borrowerId.trim() === '') continue;

          await tx.borrower.upsert({
            where: { id: borrowerId },
            update: {},
            create: { id: borrowerId },
          });

          const compoundId = { borrowerId, configId, uploadId: newUpload.id };

          const existingData = await tx.provisionedData.findUnique({
            where: { borrowerId_configId_uploadId: compoundId },
          });

          let mergedData = newRowData;
          if (existingData?.data) {
            mergedData = {
              ...JSON.parse(existingData.data as string),
              ...newRowData,
            };
          }

          await tx.provisionedData.upsert({
            where: { borrowerId_configId_uploadId: compoundId },
            update: { data: JSON.stringify(mergedData) },
            create: { ...compoundId, data: JSON.stringify(mergedData) },
          });
        }
      },
      {
        maxWait: 60000, // 60 seconds max wait to acquire lock
        timeout: 120000, // 2 minutes timeout for each batch transaction
      }
    );
  }
}

async function applyEligibilityList(change: any, data: any) {
  const { productId, fileContent, configId, fileName } = data.created;

  // Server-side file size validation
  if (!fileContent) {
    throw new Error("File upload failed. Please try again.");
  }
  const buffer = Buffer.from(fileContent, "base64");
  if (buffer.length > MAX_UPLOAD_FILE_SIZE) {
    throw new Error("File upload failed. Please try again.");
  }

  const config = await prisma.dataProvisioningConfig.findUnique({
    where: { id: configId },
  });
  if (!config) throw new Error("Data Provisioning Config not found.");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];

  const columnCount = worksheet.columnCount || 0;
  const jsonData: any[][] = [];
  worksheet.eachRow((row) => {
    const rowArr: any[] = [];
    for (let i = 1; i <= columnCount; i++) {
      rowArr.push(row.getCell(i).value);
    }
    jsonData.push(rowArr);
  });

  const originalHeaders =
    jsonData.length > 0 ? jsonData[0].map((h) => String(h)) : [];
  const rows = jsonData.length > 1 ? jsonData.slice(1) : [];

  const idColumnConfig = JSON.parse(config.columns as string).find(
    (c: any) => c.isIdentifier
  );
  if (!idColumnConfig) throw new Error("No identifier column found in config");

  const idColumnName = idColumnConfig.name;
  const idColumnIndex = originalHeaders.findIndex((h) => h === idColumnName);
  if (idColumnIndex === -1)
    throw new Error(
      `Identifier column "${idColumnName}" not found in uploaded file.`
    );

  const borrowerIds = rows
    .map((row) => String(row[idColumnIndex]).trim())
    .filter(Boolean);

  if (borrowerIds.length === 0) {
    throw new Error("No identifiers found in the uploaded file.");
  }

  const filterString = borrowerIds.join(",");
  const filterObject = JSON.stringify({ [idColumnName]: filterString });

  // Create upload record first (outside batched transactions)
  const newUpload = await prisma.dataProvisioningUpload.create({
    data: {
      configId: configId,
      fileName: fileName,
      rowCount: rows.length,
      uploadedBy: change.createdById,
    },
  });

  // Process rows in batches to avoid transaction timeout
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    
    await prisma.$transaction(
      async (tx) => {
        for (const row of batch) {
          const rowData: { [key: string]: any } = {};
          originalHeaders.forEach((header, index) => {
            rowData[header] = row[index];
          });

          const borrowerId = String(rowData[idColumnName]);
          if (!borrowerId || borrowerId.trim() === '') continue;

          await tx.borrower.upsert({
            where: { id: borrowerId },
            update: {},
            create: { id: borrowerId },
          });

          await tx.provisionedData.upsert({
            where: {
              borrowerId_configId_uploadId: {
                borrowerId,
                configId,
                uploadId: newUpload.id,
              },
            },
            update: { data: JSON.stringify(rowData) },
            create: {
              borrowerId,
              configId,
              uploadId: newUpload.id,
              data: JSON.stringify(rowData),
            },
          });
        }
      },
      {
        maxWait: 60000, // 60 seconds max wait to acquire lock
        timeout: 120000, // 2 minutes timeout for each batch transaction
      }
    );
  }

  // Update product with eligibility info (separate transaction)
  await prisma.loanProduct.update({
    where: { id: productId },
    data: {
      eligibilityUploadId: newUpload.id,
      eligibilityFilter: filterObject,
    },
  });
}

// Main function to apply an approved change
async function resolveDisbursementTransaction(
  data: any,
  entityId?: string | null
) {
  const created = data?.created || {};
  const disbursementTransactionId =
    created?.disbursementTransactionId || entityId || null;
  const transactionId = created?.transactionId || null;
  const creditAccount =
    created?.creditAccount != null ? String(created.creditAccount) : null;
  const originalProviderId = created?.originalProviderId || null;
  const providerId = created?.providerId || null;
  const amount =
    created?.amount != null && !Number.isNaN(Number(created.amount))
      ? Number(created.amount)
      : null;

  if (disbursementTransactionId) {
    const byId = await prisma.disbursementTransaction.findUnique({
      where: { id: String(disbursementTransactionId) },
    });
    if (byId) return byId;
  }

  if (transactionId) {
    const byTransactionId = await prisma.disbursementTransaction.findFirst({
      where: { transactionId: String(transactionId) },
      orderBy: { createdAt: "desc" },
    });
    if (byTransactionId) return byTransactionId;
  }

  if (creditAccount) {
    const providerIds = [originalProviderId, providerId].filter(
      (v): v is string => Boolean(v)
    );

    const byHeuristics = await prisma.disbursementTransaction.findFirst({
      where: {
        creditAccount,
        ...(amount != null ? { amount } : {}),
        ...(providerIds.length > 0
          ? {
              OR: providerIds.flatMap((pid) => [
                { providerId: pid },
                { originalProviderId: pid },
              ]),
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (byHeuristics) return byHeuristics;
  }

  const details = {
    disbursementTransactionId,
    transactionId,
    creditAccount,
    originalProviderId,
    providerId,
    amount,
    entityId,
  };
  throw new Error(
    `DisbursementTransaction not found for approval payload: ${JSON.stringify(details)}`
  );
}

async function applyChange(
  change: any,
  context?: { actorId?: string; ipAddress?: string; userAgent?: string }
) {
  const { entityType, entityId, changeType, payload } = change;
  const data = JSON.parse(payload);

  switch (entityType) {
    case "DisbursementReversal":
      if (changeType !== "CREATE") {
        throw new Error("Invalid changeType for DisbursementReversal");
      }

      {
        const actorId = context?.actorId;
        const ipAddress = context?.ipAddress || "N/A";
        const userAgent = context?.userAgent || "N/A";
        const tx = await resolveDisbursementTransaction(data, entityId);

        const statusCode = tx.statusCode;
        const isFailure =
          statusCode == null ? true : statusCode < 200 || statusCode >= 300;
        if (!isFailure)
          throw new Error(
            "This disbursement is not marked as failed; reversal is blocked."
          );

        const alreadyReversed = await prisma.auditLog.findFirst({
          where: {
            action: "DISBURSEMENT_REVERSED",
            entity: "DisbursementTransaction",
            entityId: tx.id,
          },
          select: { id: true },
        });
        if (alreadyReversed) {
          return;
        }

        const loanInclude = {
          payments: {
            select: {
              id: true,
              amount: true,
              date: true,
              installmentId: true,
              outstandingBalanceBeforePayment: true,
              journalEntryId: true,
              journalEntry: { include: { entries: true } },
            },
          },
          pendingPayments: { select: { id: true, status: true } },
          product: {
            include: { provider: { include: { ledgerAccounts: true } } },
          },
          journalEntries: { include: { entries: true } },
          installments: {
            select: { id: true, installmentNumber: true, amount: true, paidAmount: true, status: true, penaltyAmount: true },
          },
        } as const;

        const internalProviderId = tx.originalProviderId || tx.providerId;

        // Prefer direct loanId from the disbursement transaction if available
        let loan = tx.loanId
          ? await prisma.loan.findUnique({
              where: { id: tx.loanId },
              include: loanInclude,
            })
          : null;

        // Fallback: heuristic match by borrower, amount, time window, and provider
        if (!loan) {
          const phoneMap = await prisma.phoneAccount.findFirst({
            where: { accountNumber: String(tx.creditAccount) },
            select: { phoneNumber: true },
          });
          const borrowerId = phoneMap?.phoneNumber;
          if (!borrowerId)
            throw new Error(
              "Cannot resolve borrower (no phone-account mapping for creditAccount)."
            );
          const windowStart = new Date(tx.createdAt.getTime() - 60 * 60 * 1000);
          const windowEnd = new Date(tx.createdAt.getTime() + 60 * 60 * 1000);

          loan = await prisma.loan.findFirst({
            where: {
              borrowerId,
              ...(tx.amount != null ? { loanAmount: Number(tx.amount) } : {}),
              createdAt: { gte: windowStart, lte: windowEnd },
              product: { providerId: internalProviderId },
            },
            include: loanInclude,
            orderBy: { createdAt: "desc" },
          });
        }

        if (!loan)
          throw new Error(
            "No matching loan found to reverse for this failed disbursement."
          );

        // Track repayment activity that will be reversed
        const completedPendingPayments = (loan.pendingPayments || []).filter(
          (pp: { status: string }) => pp.status === 'COMPLETED'
        );
        const hasRepaymentActivity =
          (loan.payments?.length ?? 0) > 0 ||
          completedPendingPayments.length > 0;
        const reversedPayments = (loan.payments || []).map((p: any) => ({
          paymentId: p.id,
          amount: p.amount,
          date: p.date,
          installmentId: p.installmentId,
          outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
        }));
        const totalRepaid = reversedPayments.reduce((s: number, p: any) => s + (p.amount || 0), 0);

        const hasDisbursementEntry = (loan.journalEntries || []).some((j) =>
          String(j.description || "")
            .toLowerCase()
            .includes("disbursement")
        );
        if (!hasDisbursementEntry)
          throw new Error(
            "No loan disbursement journal entry found; reversal is blocked."
          );

        const provider = loan.product.provider;

        const reversalResult = await prisma.$transaction(async (db) => {
          const reversalJournalEntryId = await reverseAllLoanJournalEntries(
            db,
            provider.id,
            loan.id,
            loan.journalEntries || [],
            `Reversal: failed external disbursement for loan ${loan.id} (tx ${tx.id})`,
          );
          if (!reversalJournalEntryId) {
            throw new Error("No journal entries found to reverse for this loan.");
          }

          // Reset installments that had payments
          if (loan.installments?.length) {
            for (const inst of loan.installments) {
              await db.loanInstallment.update({
                where: { id: inst.id },
                data: {
                  paidAmount: 0,
                  paidAt: null,
                  status: "REVERSED",
                },
              });
            }
          }

          // Delete payment records
          if (loan.payments?.length) {
            await db.payment.deleteMany({
              where: { loanId: loan.id },
            });
          }

          // Delete completed pending payments
          if (completedPendingPayments.length > 0) {
            await db.pendingPayment.deleteMany({
              where: {
                loanId: loan.id,
                status: "COMPLETED",
              },
            });
          }

          await db.loanProvider.update({
            where: { id: provider.id },
            data: { initialBalance: { increment: loan.loanAmount } },
          });

          await db.loan.update({
            where: { id: loan.id },
            data: {
              repaymentStatus: "REVERSED",
              repaymentBehavior: "REVERSED",
              repaidAmount: 0,
              // Reset accrual tracking so the reversed loan doesn't
              // carry orphaned receivable balances.
              interestAccruedAmount: 0,
              interestAccruedThroughDate: null,
              penaltyAccruedAmount: 0,
              penaltyAccruedThroughDate: null,
              penaltyAmount: 0,
            },
          });

          await db.loanApplication
            .update({
              where: { id: loan.loanApplicationId },
              data: { status: "REVERSED" },
            })
            .catch(() => null);

          // Delete all DisbursementTransaction records associated with this loan
          await db.disbursementTransaction.deleteMany({
            where: { loanId: loan.id } as any, // Type assertion until Prisma client is regenerated
          });

          return { loanId: loan.id, reversalJournalEntryId };
        });

        await createAuditLog({
          actorId: actorId || "N/A",
          action: "DISBURSEMENT_REVERSED",
          entity: "DisbursementTransaction",
          entityId: tx.id,
          details: {
            disbursementTransactionId: tx.id,
            loanId: reversalResult.loanId,
            reversalJournalEntryId: reversalResult.reversalJournalEntryId,
            creditAccount: tx.creditAccount,
            providerId: internalProviderId,
            statusCode: tx.statusCode,
            hasRepaymentActivity,
            totalRepaid,
            reversedPayments,
            reversedPaymentCount: reversedPayments.length,
          },
          ipAddress,
          userAgent,
        });
      }
      break;

    case "DisbursementCancel":
      if (changeType !== "CREATE") {
        throw new Error("Invalid changeType for DisbursementCancel");
      }

      {
        const actorId = context?.actorId;
        const ipAddress = context?.ipAddress || "N/A";
        const userAgent = context?.userAgent || "N/A";
        const disbursementTransactionId =
          data?.created?.disbursementTransactionId || entityId;
        const cbsTransactionId = data?.created?.cbsTransactionId;

        if (!cbsTransactionId) throw new Error("Missing cbsTransactionId");

        const tx = await resolveDisbursementTransaction(data, entityId);

        // Check if already cancelled
        const alreadyCancelled = await prisma.auditLog.findFirst({
          where: {
            action: "DISBURSEMENT_CANCELLED",
            entity: "DisbursementTransaction",
            entityId: tx.id,
          },
          select: { id: true },
        });
        if (alreadyCancelled) {
          return;
        }

        // Check if already reversed
        const alreadyReversed = await prisma.auditLog.findFirst({
          where: {
            action: "DISBURSEMENT_REVERSED",
            entity: "DisbursementTransaction",
            entityId: tx.id,
          },
          select: { id: true },
        });
        if (alreadyReversed) {
          throw new Error(
            "This disbursement has already been reversed and cannot be cancelled."
          );
        }

        const previousTransactionId = tx.transactionId;
        const previousStatusCode = tx.statusCode;

        // Update the disbursement transaction with the CBS transaction ID and mark as success
        await prisma.disbursementTransaction.update({
          where: { id: disbursementTransactionId },
          data: {
            transactionId: cbsTransactionId,
            statusCode: 200,
          },
        });

        await createAuditLog({
          actorId: actorId || "N/A",
          action: "DISBURSEMENT_CANCELLED",
          entity: "DisbursementTransaction",
          entityId: tx.id,
          details: {
            disbursementTransactionId: tx.id,
            cbsTransactionId,
            previousTransactionId,
            previousStatusCode,
            newStatusCode: 200,
            providerId: tx.providerId,
            creditAccount: tx.creditAccount,
            amount: tx.amount,
            loanId: (tx as any).loanId ?? data?.created?.loanId ?? null,
          },
          ipAddress,
          userAgent,
        });
      }
      break;

    case "LoanReversal":
      // Handle reversal for "posted" loans that don't have a DisbursementTransaction
      if (changeType !== "CREATE") {
        throw new Error("Invalid changeType for LoanReversal");
      }

      {
        const actorId = context?.actorId;
        const ipAddress = context?.ipAddress || "N/A";
        const userAgent = context?.userAgent || "N/A";
        const loanId = data?.created?.loanId || entityId;

        if (!loanId) throw new Error("Missing loanId for LoanReversal");

        // Check if already reversed
        const alreadyReversedLoan = await prisma.auditLog.findFirst({
          where: {
            action: "LOAN_REVERSED",
            entity: "Loan",
            entityId: loanId,
          },
          select: { id: true },
        });
        if (alreadyReversedLoan) {
          return; // Already processed, silently succeed
        }

        const loan = await prisma.loan.findUnique({
          where: { id: loanId },
          include: {
            payments: {
              select: {
                id: true,
                amount: true,
                date: true,
                installmentId: true,
                outstandingBalanceBeforePayment: true,
                journalEntryId: true,
                journalEntry: { include: { entries: true } },
              },
            },
            pendingPayments: { select: { id: true, status: true } },
            product: {
              include: { provider: { include: { ledgerAccounts: true } } },
            },
            journalEntries: { include: { entries: true } },
            installments: {
              select: { id: true, installmentNumber: true, amount: true, paidAmount: true, status: true, penaltyAmount: true },
            },
          },
        });

        if (!loan) throw new Error("Loan not found for reversal");

        // Track repayment activity that will be reversed
        const completedPendingPayments = (loan.pendingPayments || []).filter(
          (pp: { status: string }) => pp.status === 'COMPLETED'
        );
        const hasRepaymentActivity =
          (loan.payments?.length ?? 0) > 0 ||
          completedPendingPayments.length > 0;
        const reversedPayments = (loan.payments || []).map((p: any) => ({
          paymentId: p.id,
          amount: p.amount,
          date: p.date,
          installmentId: p.installmentId,
          outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
        }));
        const totalRepaid = reversedPayments.reduce((s: number, p: any) => s + (p.amount || 0), 0);

        const provider = loan.product?.provider;
        if (!provider) throw new Error("Provider not found for loan reversal");

        await prisma.$transaction(async (db) => {
          await reverseAllLoanJournalEntries(
            db,
            provider.id,
            loan.id,
            loan.journalEntries || [],
            `Reversal: posted loan ${loan.id}`,
          );

          // Reset installments that had payments
          if (loan.installments?.length) {
            for (const inst of loan.installments) {
              await db.loanInstallment.update({
                where: { id: inst.id },
                data: {
                  paidAmount: 0,
                  paidAt: null,
                  status: "REVERSED",
                },
              });
            }
          }

          // Delete payment records
          if (loan.payments?.length) {
            await db.payment.deleteMany({
              where: { loanId: loan.id },
            });
          }

          // Delete completed pending payments
          if (completedPendingPayments.length > 0) {
            await db.pendingPayment.deleteMany({
              where: {
                loanId: loan.id,
                status: "COMPLETED",
              },
            });
          }

          // Restore provider balance
          await db.loanProvider.update({
            where: { id: provider.id },
            data: { initialBalance: { increment: loan.loanAmount } },
          });

          // Mark loan as reversed
          await db.loan.update({
            where: { id: loan.id },
            data: {
              repaymentStatus: "REVERSED",
              repaymentBehavior: "REVERSED",
              repaidAmount: 0,
              interestAccruedAmount: 0,
              interestAccruedThroughDate: null,
              penaltyAccruedAmount: 0,
              penaltyAccruedThroughDate: null,
              penaltyAmount: 0,
            },
          });

          // Update loan application status if it exists
          if (loan.loanApplicationId) {
            await db.loanApplication
              .update({
                where: { id: loan.loanApplicationId },
                data: { status: "REVERSED" },
              })
              .catch(() => null);
          }

          // Delete any disbursement transaction records for this loan (if any exist)
          await db.disbursementTransaction.deleteMany({
            where: { loanId: loan.id } as any,
          });
        });

        await createAuditLog({
          actorId: actorId || "N/A",
          action: "LOAN_REVERSED",
          entity: "Loan",
          entityId: loan.id,
          details: {
            loanId: loan.id,
            borrowerId: loan.borrowerId,
            providerId: provider.id,
            amount: loan.loanAmount,
            isPosted: true,
            hasRepaymentActivity,
            totalRepaid,
            reversedPayments,
            reversedPaymentCount: reversedPayments.length,
          },
          ipAddress,
          userAgent,
        });
      }
      break;

    case "LoanCancel":
      // Handle cancel for "posted" loans - marks the loan as having a valid CBS transaction
      if (changeType !== "CREATE") {
        throw new Error("Invalid changeType for LoanCancel");
      }

      {
        const actorId = context?.actorId;
        const ipAddress = context?.ipAddress || "N/A";
        const userAgent = context?.userAgent || "N/A";
        const loanId = data?.created?.loanId || entityId;
        const cbsTransactionId = data?.created?.cbsTransactionId;

        if (!loanId) throw new Error("Missing loanId for LoanCancel");
        if (!cbsTransactionId)
          throw new Error("Missing cbsTransactionId for LoanCancel");

        // Check if already cancelled or reversed
        const alreadyProcessedLoan = await prisma.auditLog.findFirst({
          where: {
            action: { in: ["LOAN_CANCELLED", "LOAN_REVERSED"] },
            entity: "Loan",
            entityId: loanId,
          },
          select: { id: true, action: true },
        });
        if (alreadyProcessedLoan) {
          return; // Already processed, silently succeed
        }

        const loan = await prisma.loan.findUnique({
          where: { id: loanId },
          include: {
            product: { include: { provider: true } },
          },
        });

        if (!loan) throw new Error("Loan not found for cancel");

        const provider = loan.product?.provider;
        if (!provider) throw new Error("Provider not found for loan cancel");

        // Create a disbursement transaction record with success status
        await prisma.disbursementTransaction.create({
          data: {
            loanId: loan.id,
            transactionId: cbsTransactionId,
            providerId: provider.id,
            originalProviderId: provider.id,
            creditAccount: loan.borrowerId,
            amount: loan.loanAmount,
            disbursementStatus: "SUCCESS",
            statusCode: 200,
            requestPayload: JSON.stringify({ loanId, cbsTransactionId }),
            responsePayload: JSON.stringify({ status: "cancelled" }),
          } as any,
        });

        await createAuditLog({
          actorId: actorId || "N/A",
          action: "LOAN_CANCELLED",
          entity: "Loan",
          entityId: loan.id,
          details: {
            loanId: loan.id,
            cbsTransactionId,
            borrowerId: loan.borrowerId,
            providerId: provider.id,
            amount: loan.loanAmount,
            isPosted: true,
          },
          ipAddress,
          userAgent,
        });
      }
      break;

    case "EligibilityList":
      if (changeType === "CREATE") {
        await applyEligibilityList(change, data);
      }
      break;
    case "DataProvisioningConfig":
      if (changeType === "UPDATE") {
        await prisma.dataProvisioningConfig.update({
          where: { id: entityId },
          data: {
            name: data.updated.name,
            columns: JSON.stringify(data.updated.columns),
          },
        });
      } else if (changeType === "CREATE") {
        await prisma.dataProvisioningConfig.create({
          data: {
            ...data.created,
            providerId: data.created.providerId,
            columns: JSON.stringify(data.created.columns),
          },
        });
      } else if (changeType === "DELETE") {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.loanProduct.updateMany({
            where: { dataProvisioningConfigId: entityId },
            data: {
              dataProvisioningConfigId: null,
              eligibilityUploadId: null,
              eligibilityFilter: null,
            },
          });

          await tx.provisionedData.deleteMany({
            where: { configId: entityId },
          });
          await tx.dataProvisioningUpload.deleteMany({
            where: { configId: entityId },
          });
          await tx.dataProvisioningConfig.delete({ where: { id: entityId } });
        });
      }
      break;
    case "DataProvisioningUpload":
      if (changeType === "CREATE") {
        await applyDataProvisioningUpload(change, data);
      }
      break;
    case "LoanProvider":
      if (changeType === "UPDATE") {
        const {
          id,
          products,
          dataProvisioningConfigs,
          termsAndConditions,
          ledgerAccounts,
          ...providerData
        } = data.updated;

        // Remove nested relation arrays or other non-scalar fields before updating
        const updateData: any = { ...providerData, status: "Active" };
        for (const k of Object.keys(updateData)) {
          if (Array.isArray(updateData[k])) {
            delete updateData[k];
          }
        }

        await prisma.loanProvider.update({
          where: { id: entityId },
          data: updateData,
        });
      } else if (changeType === "CREATE") {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const providerToCreate = {
            ...data.created,
            initialBalance: data.created.startingCapital,
            status: "Active",
          };
          const newProvider = await tx.loanProvider.create({
            data: providerToCreate,
          });

          const accountsToCreate = defaultLedgerAccounts.map((acc) => ({
            ...acc,
            providerId: newProvider.id,
          }));

          await tx.ledgerAccount.createMany({
            data: accountsToCreate,
          });

          const desiredColumns = [
            {
              id: "col-ext-0",
              name: "AccountNumber",
              type: "string",
              isIdentifier: true,
              options: [],
            },
            {
              id: "col-ext-1",
              name: "AccountOpeningDate",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-2",
              name: "CustomerName",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-3",
              name: "Country",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-4",
              name: "Street",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-5",
              name: "City",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-6",
              name: "Nationality",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-7",
              name: "Residence",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-8",
              name: "NationalId",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-9",
              name: "ResidenceRegion",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-10",
              name: "Gender",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-11",
              name: "DateOfBirth",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-12",
              name: "MaritalStatus",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-13",
              name: "Occupation",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-14",
              name: "EmployersName",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-15",
              name: "NetMonthlyIncome",
              type: "number",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-16",
              name: "Woreda",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-17",
              name: "MotherName",
              type: "string",
              isIdentifier: false,
              options: [],
            },
            {
              id: "col-ext-18",
              name: "SubCity",
              type: "string",
              isIdentifier: false,
              options: [],
            },
          ];

          try {
            await tx.dataProvisioningConfig.create({
              data: {
                providerId: newProvider.id,
                name: "ExternalCustomerInfo",
                columns: JSON.stringify(desiredColumns),
              },
            });
          } catch (e) {
            // ignore create conflicts
          }

          return newProvider;
        });
      } else if (changeType === "DELETE") {
        const productCount = await prisma.loanProduct.count({
          where: { providerId: entityId },
        });
        if (productCount > 0) {
          throw new Error(
            "Cannot delete provider with associated products. Remove or reassign products before approving deletion."
          );
        }

        // Remove any DataProvisioningConfig and its dependent rows for this provider
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const configs = await tx.dataProvisioningConfig.findMany({
            where: { providerId: entityId },
            select: { id: true },
          });
          const configIds = configs.map((c) => c.id);

          if (configIds.length > 0) {
            await tx.loanProduct.updateMany({
              where: { dataProvisioningConfigId: { in: configIds } },
              data: {
                dataProvisioningConfigId: null,
                eligibilityUploadId: null,
                eligibilityFilter: null,
              },
            });

            await tx.provisionedData.deleteMany({
              where: { configId: { in: configIds } },
            });
            await tx.dataProvisioningUpload.deleteMany({
              where: { configId: { in: configIds } },
            });
            await tx.dataProvisioningConfig.deleteMany({
              where: { id: { in: configIds } },
            });
          }

          await tx.loanProvider.delete({ where: { id: entityId } });
        });
      }
      break;
    case "LoanProduct":
      if (changeType === "UPDATE") {
        const activeLoanCount = await prisma.loan.count({
          where: {
            productId: entityId,
            repaymentStatus: "Unpaid",
          },
        });

        // Fields that are safe to update even with active loans.
        // These don't change the terms of existing loan contracts.
        const safeFieldsWithActiveLoans = new Set([
          "salaryAdvanceMappings", // Just controls who can apply for NEW loans
          "status",                // Enable/disable product for new applications
          "eligibilityFilter",     // Controls eligibility for NEW loans
          "eligibilityUploadId",   // Related to eligibility for NEW loans
          "dataProvisioningEnabled", // Data provisioning settings
          "dataProvisioningConfigId",
        ]);

        const { loanAmountTiers, eligibilityUpload, ...restOfUpdateData } =
          data.updated;
        const originalData = data.original || {};

        // Determine which fields actually changed by comparing original vs updated
        const actuallyChangedFields: string[] = [];
        for (const key of Object.keys(restOfUpdateData)) {
          if (key === 'id') continue;
          const oldVal = JSON.stringify(originalData[key] ?? null);
          const newVal = JSON.stringify(restOfUpdateData[key] ?? null);
          if (oldVal !== newVal) {
            actuallyChangedFields.push(key);
          }
        }

        const hasUnsafeChanges = actuallyChangedFields.some(field => !safeFieldsWithActiveLoans.has(field));

        if (activeLoanCount > 0 && hasUnsafeChanges) {
          const unsafeFields = actuallyChangedFields.filter(f => !safeFieldsWithActiveLoans.has(f));
          throw new Error(
            `Cannot approve edits to this loan product because it has active loans (${activeLoanCount}). ` +
              `The following fields cannot be changed: ${unsafeFields.join(', ')}. ` +
              "Create a new product/version for new terms to preserve contract integrity. " +
              "Note: You can still update salary mappings, eligibility filters, and product status."
          );
        }

        // Keep product disabled even after an approved update per requested policy
        const updateData = { ...restOfUpdateData, status: "Disabled" };

        if (
          updateData.serviceFee &&
          typeof updateData.serviceFee === "object"
        ) {
          updateData.serviceFee = JSON.stringify(updateData.serviceFee);
        }
        if (updateData.dailyFee && typeof updateData.dailyFee === "object") {
          updateData.dailyFee = JSON.stringify(updateData.dailyFee);
        }
        if (updateData.penaltyRules && Array.isArray(updateData.penaltyRules)) {
          updateData.penaltyRules = JSON.stringify(updateData.penaltyRules);
        }

        // Convert any relation-id scalars (fields ending with 'Id') into
        // nested relation updates that Prisma expects (connect/disconnect).
        for (const key of Object.keys(updateData)) {
          if (key === "id") continue;
          if (key.endsWith("Id")) {
            const relName = key.substring(0, key.length - 2);
            const relVal = updateData[key];
            if (relVal === null || relVal === undefined) {
              updateData[relName] = { disconnect: true };
            } else {
              updateData[relName] = { connect: { id: relVal } };
            }
            delete updateData[key];
          }
        }

        // Sanitize update data: only include allowed scalar fields and known
        // nested relation keys for LoanProduct. This prevents accidental
        // unknown-argument errors when the change payload contains newer
        // fields that aren't present in the current Prisma model (e.g.
        // `penaltyPerInstallment`).
        const allowedScalars = new Set([
          "name",
          "description",
          "icon",
          "minLoan",
          "maxLoan",
          "isSalaryAdvance",
          "advancePercent",
          "salaryAdvanceMappings",
          "duration",
          "installments",
          "repaymentIntervalDays",
          "status",
          "allowConcurrentLoans",
          "serviceFee",
          "serviceFeeEnabled",
          "dailyFee",
          "dailyFeeEnabled",
          "penaltyRules",
          "penaltyRulesEnabled",
          "dataProvisioningEnabled",
          "eligibilityFilter",
          "penaltyPerInstallment",
        ]);

        const allowedRelations = new Set([
          "provider",
          "dataProvisioningConfig",
          "loanCycleConfig",
          "eligibilityUpload",
          "loans",
          "loanAmountTiers",
          "scoringConfiguration",
          "loanApplications",
          "requiredDocuments",
        ]);

        const sanitizedData: any = {};
        for (const [k, v] of Object.entries(updateData)) {
          if (allowedScalars.has(k) || allowedRelations.has(k)) {
            sanitizedData[k] = v;
          } else {
            // Skip unknown fields (they may belong to a newer schema).
            // Keep a lightweight server-side log for debugging.
            console.warn(
              `[approvals] skipping unknown field on LoanProduct.update: ${k}`
            );
          }
        }

        // Replace updateData with the sanitized object used for Prisma update.
        const finalUpdateData = sanitizedData;

        await prisma.$transaction(async (tx) => {
          await tx.loanProduct.update({
            where: { id: entityId },
            data: finalUpdateData,
          });

          await tx.loanAmountTier.deleteMany({
            where: { productId: entityId },
          });
          if (
            loanAmountTiers &&
            Array.isArray(loanAmountTiers) &&
            loanAmountTiers.length > 0
          ) {
            await tx.loanAmountTier.createMany({
              data: loanAmountTiers.map((tier: any) => ({
                productId: entityId,
                fromScore: parseInt(String(tier.fromScore), 10),
                toScore: parseInt(String(tier.toScore), 10),
                loanAmount: parseInt(String(tier.loanAmount), 10),
              })),
            });
          }
        });
      } else if (changeType === "CREATE") {
        const productToCreate = {
          ...data.created,
          status: "Disabled",
          serviceFee: JSON.stringify(
            data.created.serviceFee || { type: "percentage", value: 0 }
          ),
          dailyFee: JSON.stringify(
            data.created.dailyFee || {
              type: "percentage",
              value: 0,
              calculationBase: "principal",
            }
          ),
          penaltyRules: JSON.stringify(data.created.penaltyRules || []),
        };
        await prisma.loanProduct.create({
          data: productToCreate,
        });
      } else if (changeType === "DELETE") {
        await prisma.loanProduct.delete({ where: { id: entityId } });
      }
      break;
    case "LoanCycleConfig":
      if (changeType === "UPDATE") {
        const prodId = entityId;
        const updated = data.updated || {};
        await prisma.loanCycleConfig.updateMany({
          where: { productId: prodId },
          data: {
            metric: updated.metric,
            enabled:
              typeof updated.enabled === "boolean" ? updated.enabled : true,
            cycleRanges: updated.cycleRanges
              ? JSON.stringify(updated.cycleRanges)
              : undefined,
            grades: updated.grades ? JSON.stringify(updated.grades) : undefined,
          },
        });
      } else if (changeType === "CREATE") {
        const prodId = entityId;
        const created = data.created || {};
        await prisma.loanCycleConfig.create({
          data: {
            productId: prodId as string,
            metric: created.metric,
            enabled:
              typeof created.enabled === "boolean" ? created.enabled : true,
            cycleRanges: created.cycleRanges
              ? JSON.stringify(created.cycleRanges)
              : JSON.stringify([]),
            grades: created.grades
              ? JSON.stringify(created.grades)
              : JSON.stringify([]),
          },
        });
      } else if (changeType === "DELETE") {
        await prisma.loanCycleConfig.deleteMany({
          where: { productId: entityId },
        });
      }
      break;
    case "ScoringRules":
      await prisma.$transaction(async (tx) => {
        const historyRecord = await tx.scoringConfigurationHistory.create({
          data: {
            providerId: entityId,
            parameters: JSON.stringify(data.updated),
          },
        });

        if (data.appliedProductIds && data.appliedProductIds.length > 0) {
          await tx.scoringConfigurationProduct.createMany({
            data: data.appliedProductIds.map((productId: string) => ({
              configId: historyRecord.id,
              productId: productId,
              assignedBy: change.createdById,
            })),
          });
        }

        await tx.scoringParameter.deleteMany({
          where: { providerId: entityId },
        });
        for (const param of data.updated) {
          await tx.scoringParameter.create({
            data: {
              providerId: entityId,
              name: param.name,
              weight: param.weight,
              rules: {
                create: param.rules.map((rule: any) => ({
                  field: rule.field,
                  condition: rule.condition,
                  value: String(rule.value),
                  score: rule.score,
                })),
              },
            },
          });
        }
      });
      break;
    case "TermsAndConditions":
      await prisma.$transaction(async (tx) => {
        const {
          providerId,
          content,
          contentAm,
          contentOm,
          contentTi,
          contentSo,
          contentSid,
        } = data.updated;
        await tx.termsAndConditions.updateMany({
          where: { providerId },
          data: { isActive: false },
        });

        const latestVersion = await tx.termsAndConditions.findFirst({
          where: { providerId },
          orderBy: { version: "desc" },
        });
        const newVersionNumber = (latestVersion?.version || 0) + 1;

        await tx.termsAndConditions.create({
          data: {
            providerId,
            content,
            contentAm: contentAm ?? null,
            contentOm: contentOm ?? null,
            contentTi: contentTi ?? null,
            contentSo: contentSo ?? null,
            contentSid: contentSid ?? null,
            version: newVersionNumber,
            isActive: true,
            publishedAt: new Date(),
          },
        });
      });
      break;
    case "Tax":
      if (changeType === "UPDATE") {
        await prisma.tax.update({
          where: { id: entityId },
          data: { ...data.updated, status: "Active" },
        });
      } else if (changeType === "CREATE") {
        const { id, ...creationData } = data.created;
        await prisma.tax.create({
          data: { ...creationData, status: "Active" },
        });
      } else if (changeType === "DELETE") {
        await prisma.tax.delete({ where: { id: entityId } });
      }
      break;

    case "PendingPaymentResolve":
      if (changeType !== "CREATE") {
        throw new Error("Invalid changeType for PendingPaymentResolve");
      }

      {
        const actorId = context?.actorId;
        const ipAddress = context?.ipAddress || "N/A";
        const userAgent = context?.userAgent || "N/A";
        const pendingPaymentId = data?.created?.pendingPaymentId || entityId;
        const ftReference = data?.created?.ftReference;
        const loanId = data?.created?.loanId;
        const paymentAmount = Number(data?.created?.amount);
        const manualPaymentDate = data?.created?.paymentDate ? new Date(data.created.paymentDate) : new Date();

        if (!pendingPaymentId) throw new Error("Missing pendingPaymentId");
        if (!ftReference) throw new Error("Missing FT reference number");
        if (!loanId) throw new Error("Missing loanId");

        const pendingPayment = await prisma.pendingPayment.findUnique({
          where: { id: pendingPaymentId },
        });

        if (!pendingPayment) throw new Error("Pending payment not found");
        if (pendingPayment.status !== "PENDING") {
          return; // Already processed, silently succeed
        }

        const [loan, taxConfigs] = await Promise.all([
          prisma.loan.findUnique({
            where: { id: loanId },
            include: {
              product: {
                include: {
                  provider: {
                    include: { ledgerAccounts: true },
                  },
                },
              },
              installments: {
                orderBy: { installmentNumber: "asc" },
              },
            },
          }),
          prisma.tax.findMany({ where: { status: "ACTIVE" } }),
        ]);

        if (!loan) throw new Error("Loan not found");
        const provider = loan.product?.provider;
        if (!provider) throw new Error("Provider not found for loan");

        const paymentDate = manualPaymentDate;

        // Record the repayment within a transaction
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Calculate totals as of the payment date
          const totals = calculateTotalRepayable(
            loan as any,
            loan.product as any,
            (taxConfigs ?? []) as any,
            paymentDate,
            true
          );

          const alreadyRepaid = loan.repaidAmount || 0;
          const totalDue = totals.total - alreadyRepaid;

          const alreadyPaidPenalty = Math.min(totals.penalty, alreadyRepaid);
          const alreadyPaidServiceFee = Math.min(totals.serviceFee, Math.max(0, alreadyRepaid - totals.penalty));
          const alreadyPaidInterest = Math.min(totals.interest, Math.max(0, alreadyRepaid - totals.penalty - totals.serviceFee));
          const alreadyPaidTax = Math.min(totals.tax, Math.max(0, alreadyRepaid - totals.penalty - totals.serviceFee - totals.interest));
          const alreadyPaidPrincipal = Math.min(totals.principal, Math.max(0, alreadyRepaid - totals.penalty - totals.serviceFee - totals.interest - totals.tax));

          const penaltyDue = Math.max(0, totals.penalty - alreadyPaidPenalty);
          const serviceFeeDue = Math.max(0, totals.serviceFee - alreadyPaidServiceFee);
          const interestDue = Math.max(0, totals.interest - alreadyPaidInterest);
          const taxDue = Math.max(0, totals.tax - alreadyPaidTax);
          const principalDue = Math.max(0, totals.principal - alreadyPaidPrincipal);

          // Find ledger accounts
          const principalReceivable = provider.ledgerAccounts.find(a => a.category === 'Principal' && a.type === 'Receivable');
          const interestReceivable = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Receivable');
          const penaltyReceivable = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Receivable');
          const serviceFeeReceivable = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Receivable');
          const taxReceivable = provider.ledgerAccounts.find(a => a.category === 'Tax' && a.type === 'Receivable');

          const principalReceived = provider.ledgerAccounts.find(a => a.category === 'Principal' && a.type === 'Received');
          const interestReceived = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Received');
          const penaltyReceived = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Received');
          const serviceFeeReceived = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Received');
          const taxReceived = provider.ledgerAccounts.find(a => a.category === 'Tax' && a.type === 'Received');

          const interestIncome = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Income');
          const penaltyIncome = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Income');
          const serviceFeeIncome = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Income');

          if (!principalReceivable || !interestReceivable || !penaltyReceivable || !serviceFeeReceivable || !taxReceivable ||
              !principalReceived || !interestReceived || !penaltyReceived || !serviceFeeReceived || !taxReceived) {
              throw new Error('Ledger accounts not configured properly');
          }

          // Create journal entry
          const journalEntry = await tx.journalEntry.create({
            data: {
              providerId: provider.id,
              loanId: loan.id,
              date: paymentDate,
              description: `Manual resolution for pending payment ${pendingPaymentId} (FT: ${ftReference})`,
            },
          });

          let amountToApply = paymentAmount;

          // Allocate to penalty
          const penaltyToPay = Math.min(amountToApply, penaltyDue);
          if (penaltyToPay > 0) {
              await tx.ledgerAccount.update({ where: { id: penaltyReceivable.id }, data: { balance: { decrement: penaltyToPay } } });
              await tx.ledgerAccount.update({ where: { id: penaltyReceived.id }, data: { balance: { increment: penaltyToPay } } });
              if (penaltyIncome) await tx.ledgerAccount.update({ where: { id: penaltyIncome.id }, data: { balance: { increment: penaltyToPay } } });
              await tx.ledgerEntry.createMany({ data: [
                  { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceivable.id, type: 'Credit', amount: penaltyToPay },
                  { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceived.id, type: 'Debit', amount: penaltyToPay },
                  ...(penaltyIncome ? [{ journalEntryId: journalEntry.id, ledgerAccountId: penaltyIncome.id, type: 'Credit', amount: penaltyToPay }] : [])
              ]});
              amountToApply -= penaltyToPay;
          }

          // Allocate to service fee
          const serviceFeeToPay = Math.min(amountToApply, serviceFeeDue);
          if (serviceFeeToPay > 0) {
              await tx.ledgerAccount.update({ where: { id: serviceFeeReceivable.id }, data: { balance: { decrement: serviceFeeToPay } } });
              await tx.ledgerAccount.update({ where: { id: serviceFeeReceived.id }, data: { balance: { increment: serviceFeeToPay } } });
              if (serviceFeeIncome) await tx.ledgerAccount.update({ where: { id: serviceFeeIncome.id }, data: { balance: { increment: serviceFeeToPay } } });
              await tx.ledgerEntry.createMany({ data: [
                  { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceivable.id, type: 'Credit', amount: serviceFeeToPay },
                  { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceived.id, type: 'Debit', amount: serviceFeeToPay },
                  ...(serviceFeeIncome ? [{ journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeIncome.id, type: 'Credit', amount: serviceFeeToPay }] : [])
              ]});
              amountToApply -= serviceFeeToPay;
          }

          // Allocate to interest
          const interestToPay = Math.min(amountToApply, interestDue);
          if (interestToPay > 0) {
              await tx.ledgerAccount.update({ where: { id: interestReceivable.id }, data: { balance: { decrement: interestToPay } } });
              await tx.ledgerAccount.update({ where: { id: interestReceived.id }, data: { balance: { increment: interestToPay } } });
              if (interestIncome) await tx.ledgerAccount.update({ where: { id: interestIncome.id }, data: { balance: { increment: interestToPay } } });
              await tx.ledgerEntry.createMany({ data: [
                  { journalEntryId: journalEntry.id, ledgerAccountId: interestReceivable.id, type: 'Credit', amount: interestToPay },
                  { journalEntryId: journalEntry.id, ledgerAccountId: interestReceived.id, type: 'Debit', amount: interestToPay },
                  ...(interestIncome ? [{ journalEntryId: journalEntry.id, ledgerAccountId: interestIncome.id, type: 'Credit', amount: interestToPay }] : [])
              ]});
              amountToApply -= interestToPay;
          }

          // Allocate to tax
          const taxToPay = Math.min(amountToApply, taxDue);
          if (taxToPay > 0) {
              await tx.ledgerAccount.update({ where: { id: taxReceivable.id }, data: { balance: { decrement: taxToPay } } });
              await tx.ledgerAccount.update({ where: { id: taxReceived.id }, data: { balance: { increment: taxToPay } } });
              await tx.ledgerEntry.createMany({ data: [
                  { journalEntryId: journalEntry.id, ledgerAccountId: taxReceivable.id, type: 'Credit', amount: taxToPay },
                  { journalEntryId: journalEntry.id, ledgerAccountId: taxReceived.id, type: 'Debit', amount: taxToPay }
              ]});
              amountToApply -= taxToPay;
          }

          // Allocate to principal
          const principalToPay = Math.min(amountToApply, principalDue);
          if (principalToPay > 0) {
              await tx.ledgerAccount.update({ where: { id: principalReceivable.id }, data: { balance: { decrement: principalToPay } } });
              await tx.ledgerAccount.update({ where: { id: principalReceived.id }, data: { balance: { increment: principalToPay } } });
              await tx.ledgerEntry.createMany({ data: [
                  { journalEntryId: journalEntry.id, ledgerAccountId: principalReceivable.id, type: 'Credit', amount: principalToPay },
                  { journalEntryId: journalEntry.id, ledgerAccountId: principalReceived.id, type: 'Debit', amount: principalToPay }
              ]});
              amountToApply -= principalToPay;
          }

          // Update installment if applicable
          let installmentId: string | undefined;
          if (loan.installments.length > 0) {
            const activeInstallment = loan.installments.find((inst) => inst.isActive);
            if (activeInstallment) {
              installmentId = activeInstallment.id;
              // For installments, only principal and penalty allocation count towards its paidAmount
              const installmentPaymentAmount = penaltyToPay + principalToPay;
              const newPaidAmount = (activeInstallment.paidAmount || 0) + installmentPaymentAmount;
              const isFullyPaid = newPaidAmount >= activeInstallment.amount + (activeInstallment.penaltyApplied || 0) - 1e-9;

              await tx.loanInstallment.update({
                where: { id: activeInstallment.id },
                data: {
                  paidAmount: newPaidAmount,
                  paidAt: paymentDate,
                  status: isFullyPaid ? "Paid" : (differenceInDays(paymentDate, activeInstallment.dueDate) > 0 ? "Overdue" : activeInstallment.status),
                  isActive: !isFullyPaid,
                },
              });

              if (isFullyPaid) {
                const nextPayable = await tx.loanInstallment.findFirst({
                  where: {
                    loanId: loan.id,
                    installmentNumber: { gt: activeInstallment.installmentNumber },
                    status: { notIn: ["Merged", "Paid"] },
                    amount: { gt: 0 },
                  },
                  orderBy: { installmentNumber: "asc" },
                });
                if (nextPayable) {
                  await tx.loanInstallment.update({ where: { id: nextPayable.id }, data: { isActive: true } });
                }
              }
            }
          }

          // Create payment record
          await tx.payment.create({
            data: {
              loanId: loan.id,
              amount: paymentAmount,
              date: paymentDate,
              outstandingBalanceBeforePayment: totalDue,
              journalEntryId: journalEntry.id,
              ...(installmentId && { installmentId }),
            },
          });

          // Update loan repaidAmount and status
          const newRepaidAmount = (loan.repaidAmount || 0) + paymentAmount;
          const isFullyPaid = newRepaidAmount >= totals.total - 0.01;
          
          let repaymentBehavior: any = null;
          if (isFullyPaid) {
            const payDay = startOfDay(paymentDate);
            const dueDate = startOfDay(loan.dueDate);
            if (isBefore(payDay, dueDate)) repaymentBehavior = "EARLY";
            else if (isEqual(payDay, dueDate)) repaymentBehavior = "ON_TIME";
            else repaymentBehavior = "LATE";
          }

          await tx.loan.update({
            where: { id: loan.id },
            data: {
              repaidAmount: newRepaidAmount,
              repaymentStatus: isFullyPaid ? "Paid" : "Unpaid",
              ...(isFullyPaid && { penaltyAmount: 0 }),
              ...(repaymentBehavior && { repaymentBehavior }),
            },
          });

          // Mark pending payment as COMPLETED
          await tx.pendingPayment.update({
            where: { id: pendingPaymentId },
            data: {
              status: "COMPLETED",
              transactionId: ftReference,
            },
          });
        });

        // Send SMS outside transaction
        (async () => {
          try {
            const phone = loan.borrowerId;
            const msg = `Payment of ${paymentAmount} ETB received for loan ${loan.id}. Thank you.`;
            await sendSms(String(phone), msg);
          } catch (e) {
            console.error('[approvals] sms notify error', e);
          }
        })();

        await createAuditLog({
          actorId: actorId || "N/A",
          action: "PENDING_PAYMENT_RESOLVED",
          entity: "PendingPayment",
          entityId: pendingPaymentId,
          details: {
            pendingPaymentId,
            ftReference,
            loanId: loan.id,
            borrowerId: loan.borrowerId,
            amount: paymentAmount,
            paymentDate: paymentDate.toISOString(),
          },
          ipAddress,
          userAgent,
        });
      }
      break;

    default:
      throw new Error(`Unknown entity type for approval: ${entityType}`);
  }
}

export async function POST(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || (!user.permissions?.["approvals"]?.update && !user.permissions?.["reversal-approval"]?.update)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const ipAddress =
    (req as any).ip || req.headers.get("x-forwarded-for") || "N/A";
  const userAgent = req.headers.get("user-agent") || "N/A";

  try {
    const body = await req.json();
    const { changeId, approved, rejectionReason } = approvalSchema.parse(body);

    const change = await prisma.pendingChange.findUnique({
      where: { id: changeId },
    });

    if (!change) {
      return NextResponse.json(
        { error: "Change request not found." },
        { status: 404 }
      );
    }

    if (change.createdById === user.id) {
      return NextResponse.json(
        { error: "You cannot approve or reject your own changes." },
        { status: 403 }
      );
    }

    if (change.status !== "PENDING") {
      return NextResponse.json(
        { error: "This change has already been processed." },
        { status: 409 }
      );
    }

    if (approved) {
      await applyChange(change, { actorId: user.id, ipAddress, userAgent });

      await prisma.pendingChange.update({
        where: { id: changeId },
        data: {
          status: "APPROVED",
          approvedById: user.id,
          approvedAt: new Date(),
        },
      });

      await createAuditLog({
        actorId: user.id,
        action: "CHANGE_APPROVED",
        entity: change.entityType,
        entityId: change.entityId ?? undefined,
        details: { changeId },
      });
    } else {
      // Rejected
      if (!rejectionReason) {
        return NextResponse.json(
          { error: "A reason is required for rejection." },
          { status: 400 }
        );
      }

      await prisma.pendingChange.update({
        where: { id: changeId },
        data: {
          status: "REJECTED",
          approvedById: user.id,
          approvedAt: new Date(),
          rejectionReason,
        },
      });

      const entityId = change.entityId;
      if (entityId && change.changeType !== "CREATE") {
        // Try to restore the original status if present in the pending-change payload
        let originalStatus: string | null = null;
        try {
          const parsed = JSON.parse(change.payload || "{}");
          originalStatus =
            parsed.original?.status ?? parsed.created?.status ?? null;
        } catch (e) {
          // ignore
        }

        if (change.entityType === "LoanProvider") {
          await prisma.loanProvider.update({
            where: { id: entityId },
            data: { status: originalStatus || "Active" },
          });
        } else if (change.entityType === "LoanProduct") {
          await prisma.loanProduct.update({
            where: { id: entityId },
            data: { status: originalStatus || "Active" },
          });
        } else if (
          change.entityType === "Tax" &&
          change.changeType !== "CREATE"
        ) {
          await prisma.tax.update({
            where: { id: entityId },
            data: { status: originalStatus || "Active" },
          });
        }
      }

      await createAuditLog({
        actorId: user.id,
        action: "CHANGE_REJECTED",
        entity: change.entityType,
        entityId: change.entityId ?? undefined,
        details: { changeId, reason: rejectionReason },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error processing change request:", error);
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
    }
    return handleApiError(error, { operation: "POST /api/approvals" });
  }
}
