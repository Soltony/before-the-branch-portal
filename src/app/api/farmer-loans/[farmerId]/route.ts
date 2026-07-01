import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  derivePurposeDisplayStatus,
  deriveLoanRequestDisplayStatus,
  type PurposeDisplayStatus,
} from "@/lib/lersha/farmer-purpose-status";

type RouteParams = { params: Promise<{ farmerId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { farmerId } = await params;

    const farmer = await prisma.lershaFarmer.findFirst({
      where: {
        OR: [{ id: farmerId }, { farmerId }],
      },
      include: {
        loanPurposes: { orderBy: { createdAt: "asc" } },
        loanRequests: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!farmer) {
      return NextResponse.json({ error: "Farmer not found." }, { status: 404 });
    }

    const borrowerLoans = await prisma.loan.findMany({
      where: { borrowerId: farmer.farmerId },
      select: {
        id: true,
        loanAmount: true,
        repaymentStatus: true,
        disbursedDate: true,
        dueDate: true,
        serviceFee: true,
        netDisbursedAmount: true,
        repaidAmount: true,
        product: { select: { name: true } },
      },
      orderBy: { disbursedDate: "desc" },
    });

    // loanRequests are ordered newest-first, and a product can have several
    // requests (e.g. retries after an OTP expired). Keep the most recent request
    // per product so the purpose reflects the latest attempt, not a stale one.
    const requestsByProduct = new Map<
      string,
      (typeof farmer.loanRequests)[number]
    >();
    for (const r of farmer.loanRequests) {
      if (!requestsByProduct.has(r.productId)) {
        requestsByProduct.set(r.productId, r);
      }
    }

    const loanPurposesWithStatus = farmer.loanPurposes.map((purpose) => {
      const loanRequest = purpose.productId
        ? requestsByProduct.get(purpose.productId) ?? null
        : null;

      let linkedLoan: (typeof borrowerLoans)[0] | null = null;
      if (loanRequest?.status === "DISBURSED") {
        linkedLoan =
          borrowerLoans.find(
            (l) => Math.abs(l.loanAmount - purpose.totalCost) < 0.01,
          ) ??
          borrowerLoans.find((l) => {
            const disbursedAt = loanRequest.disbursementConfirmedAt;
            if (!disbursedAt || !l.disbursedDate) return false;
            const diff = Math.abs(
              new Date(l.disbursedDate).getTime() -
                new Date(disbursedAt).getTime(),
            );
            return diff < 7 * 24 * 60 * 60 * 1000;
          }) ??
          null;
      }

      const displayStatus: PurposeDisplayStatus = derivePurposeDisplayStatus({
        farmerStatus: farmer.status,
        productId: purpose.productId,
        loanRequest: loanRequest
          ? {
              status: loanRequest.status,
              createdAt: loanRequest.createdAt,
              disbursementConfirmedAt: loanRequest.disbursementConfirmedAt,
              otpExpiresAt: loanRequest.otpExpiresAt,
              otpVerified: loanRequest.otpVerified,
            }
          : null,
        linkedLoan: linkedLoan
          ? {
              repaymentStatus: linkedLoan.repaymentStatus,
              loanAmount: linkedLoan.loanAmount,
            }
          : null,
      });

      return {
        ...purpose,
        displayStatus,
        loanRequest: loanRequest
          ? {
              id: loanRequest.id,
              status: loanRequest.status,
              referenceNo: loanRequest.referenceNo,
              otpVerified: loanRequest.otpVerified,
              remainingBalance: loanRequest.remainingBalance,
              disbursementConfirmedAt: loanRequest.disbursementConfirmedAt,
              lershaDecisionSentAt: loanRequest.lershaDecisionSentAt,
              createdAt: loanRequest.createdAt,
              updatedAt: loanRequest.updatedAt,
            }
          : null,
        linkedLoan: linkedLoan
          ? {
              id: linkedLoan.id,
              loanAmount: linkedLoan.loanAmount,
              repaymentStatus: linkedLoan.repaymentStatus,
              disbursedDate: linkedLoan.disbursedDate,
              dueDate: linkedLoan.dueDate,
              repaidAmount: linkedLoan.repaidAmount,
              productName: linkedLoan.product?.name ?? null,
            }
          : null,
      };
    });

    const purposesTotal = farmer.loanPurposes.reduce(
      (sum, p) => sum + p.totalCost,
      0,
    );

    const isUpdated =
      farmer.updatedAt.getTime() - farmer.createdAt.getTime() > 60_000;

    return NextResponse.json({
      farmer: {
        id: farmer.id,
        farmerId: farmer.farmerId,
        farmerName: farmer.farmerName,
        phoneNumber: farmer.phoneNumber,
        kebeleIdDocUrl: farmer.kebeleIdDocUrl,
        landCertificateDocUrl: farmer.landCertificateDocUrl,
        totalFarmSizeInHectare: farmer.totalFarmSizeInHectare,
        cultivatedAreaInHectare: farmer.cultivatedAreaInHectare,
        primaryCropType: farmer.primaryCropType,
        farmRegistryNumber: farmer.farmRegistryNumber,
        requestedLoanAmount: farmer.requestedLoanAmount,
        repaymentSource: farmer.repaymentSource,
        requestedLoanTermInMonth: farmer.requestedLoanTermInMonth,
        applicationChannel: farmer.applicationChannel,
        creditScoreValue: farmer.creditScoreValue,
        scoreCalculationDate: farmer.scoreCalculationDate,
        emergencyContactName: farmer.emergencyContactName,
        emergencyContactPhone: farmer.emergencyContactPhone,
        emergencyContactRelationship: farmer.emergencyContactRelationship,
        emergencyContactAddress: farmer.emergencyContactAddress,
        status: farmer.status,
        marriageCertificateUrl: farmer.marriageCertificateUrl,
        address: farmer.address,
        createdAt: farmer.createdAt,
        updatedAt: farmer.updatedAt,
        loanPurposes: loanPurposesWithStatus,
        loanRequests: farmer.loanRequests.map((r) => ({
          id: r.id,
          productId: r.productId,
          status: r.status,
          displayStatus: deriveLoanRequestDisplayStatus(r),
          referenceNo: r.referenceNo,
          otpVerified: r.otpVerified,
          remainingBalance: r.remainingBalance,
          disbursementConfirmedAt: r.disbursementConfirmedAt,
          lershaDecisionSentAt: r.lershaDecisionSentAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        purposesTotal,
        isUpdated,
        borrowerLoans: borrowerLoans.map((loan) => ({
          id: loan.id,
          loanAmount: loan.loanAmount,
          repaymentStatus: loan.repaymentStatus,
          disbursedDate: loan.disbursedDate,
          dueDate: loan.dueDate,
          repaidAmount: loan.repaidAmount,
          productName: loan.product?.name ?? null,
        })),
      },
    });
  } catch (error: any) {
    console.error("[farmer-loans detail API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
