import prisma from "@/lib/prisma";
import { randomUUID } from "crypto";
import type { SendFarmerDetailInput } from "@/lib/lersha/types";
import { resolveStatusOnUpdate } from "@/lib/lersha/farmer-status";

export type LoanPurposePayload = SendFarmerDetailInput["loanPurposes"][number];

export function loanPurposeMatchKey(purpose: {
  loanPurpose: string;
  specificVarietyName?: string | null;
  totalCost: number;
  insuranceName?: string | null;
}): string {
  const loanPurpose = purpose.loanPurpose.trim().toLowerCase();
  if (loanPurpose === "insurance") {
    return [
      "insurance",
      (purpose.insuranceName ?? "").trim().toLowerCase(),
      purpose.totalCost.toFixed(2),
    ].join("::");
  }
  return [
    loanPurpose,
    (purpose.specificVarietyName ?? "").trim().toLowerCase(),
    purpose.totalCost.toFixed(2),
  ].join("::");
}

function purposeMatchKeyFromRecord(purpose: {
  loanPurpose: string;
  specificVarietyName: string | null;
  totalCost: number;
  insuranceName: string | null;
}): string {
  return loanPurposeMatchKey({
    loanPurpose: purpose.loanPurpose,
    specificVarietyName: purpose.specificVarietyName,
    totalCost: purpose.totalCost,
    insuranceName: purpose.insuranceName,
  });
}

/** SQL Server unique index on productId allows only one NULL — backfill legacy rows. */
async function backfillMissingProductIds(
  purposes: { id: string; productId: string | null }[],
): Promise<void> {
  for (const purpose of purposes) {
    if (!purpose.productId) {
      const productId = randomUUID();
      await prisma.lershaLoanPurpose.update({
        where: { id: purpose.id },
        data: { productId },
      });
      purpose.productId = productId;
    }
  }
}

export async function syncLoanPurposes(
  internalFarmerId: string,
  incomingPurposes: LoanPurposePayload[],
): Promise<
  {
    productId: string | null;
    loanPurpose: string;
    specificVarietyName: string | null;
  }[]
> {
  const existing = await prisma.lershaLoanPurpose.findMany({
    where: { farmerId: internalFarmerId },
  });

  await backfillMissingProductIds(existing);

  const existingByKey = new Map(
    existing.map((p) => [purposeMatchKeyFromRecord(p), p]),
  );
  const incomingKeys = new Set<string>();
  const results: {
    productId: string | null;
    loanPurpose: string;
    specificVarietyName: string | null;
  }[] = [];

  for (const purpose of incomingPurposes) {
    const key = loanPurposeMatchKey({
      loanPurpose: purpose.loanPurpose,
      specificVarietyName: purpose.specificVarietyName,
      totalCost: purpose.totalCost,
      insuranceName: purpose.Insurance?.insurance_name ?? null,
    });
    incomingKeys.add(key);
    const matched = existingByKey.get(key);

    const purposeData = {
      loanPurpose: purpose.loanPurpose,
      specificVarietyName: purpose.specificVarietyName ?? null,
      quantity: purpose.quantity ?? null,
      unitOfMeasurement: purpose.unitOfMeasurement ?? null,
      unitPrice: purpose.unitPrice ?? null,
      totalCost: purpose.totalCost,
      agroDealerName: purpose.agro_dealer?.agro_dealer_name ?? null,
      agroDealerAccountNo:
        purpose.agro_dealer?.agro_dealer_account_number ?? null,
      insuranceName: purpose.Insurance?.insurance_name ?? null,
    };

    if (matched) {
      await prisma.lershaLoanPurpose.update({
        where: { id: matched.id },
        data: purposeData,
      });
      results.push({
        productId: matched.productId,
        loanPurpose: purpose.loanPurpose,
        specificVarietyName: purpose.specificVarietyName ?? null,
      });
      continue;
    }

    const productId = randomUUID();
    const created = await prisma.lershaLoanPurpose.create({
      data: {
        farmerId: internalFarmerId,
        productId,
        ...purposeData,
      },
    });
    existingByKey.set(key, created);
    results.push({
      productId,
      loanPurpose: purpose.loanPurpose,
      specificVarietyName: purpose.specificVarietyName ?? null,
    });
  }

  for (const existingPurpose of existing) {
    if (incomingKeys.has(purposeMatchKeyFromRecord(existingPurpose))) {
      continue;
    }

    if (existingPurpose.productId) {
      const linkedRequest = await prisma.lershaLoanRequest.findFirst({
        where: { productId: existingPurpose.productId },
      });
      if (linkedRequest) {
        continue;
      }
    }

    await prisma.lershaLoanPurpose.delete({
      where: { id: existingPurpose.id },
    });
  }

  return results;
}

export function farmerProfileData(farmer: SendFarmerDetailInput) {
  return {
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
    scoreCalculationDate: new Date(farmer.scoreCalculationDate),
    emergencyContactName: farmer.emergencyContactName,
    emergencyContactPhone: farmer.emergencyContactPhone,
    emergencyContactRelationship: farmer.emergencyContactRelationship,
    emergencyContactAddress: farmer.emergencyContactAddress,
    marriageCertificateUrl: farmer.marriageCertificateUrl ?? null,
    address: farmer.address,
  };
}
