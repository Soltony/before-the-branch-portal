import { describe, it, expect } from "vitest";
import {
  getDistrictLabel,
  isValidDistrictCode,
  normalizeDistrictCode,
} from "./districts";
import { sendFarmerDetailSchema } from "./lersha/types";

describe("normalizeDistrictCode", () => {
  it("accepts the padded string form Lersha sends for codes below 10", () => {
    expect(normalizeDistrictCode("01")).toBe(1);
    expect(normalizeDistrictCode("07")).toBe(7);
    expect(normalizeDistrictCode("09")).toBe(9);
  });

  it("accepts plain numbers and unpadded strings", () => {
    expect(normalizeDistrictCode(7)).toBe(7);
    expect(normalizeDistrictCode("7")).toBe(7);
    expect(normalizeDistrictCode(20)).toBe(20);
    expect(normalizeDistrictCode(" 17 ")).toBe(17);
  });

  it("treats absent and empty values as no district", () => {
    expect(normalizeDistrictCode(null)).toBeNull();
    expect(normalizeDistrictCode(undefined)).toBeNull();
    expect(normalizeDistrictCode("")).toBeNull();
  });

  it("rejects codes outside the known district list", () => {
    expect(normalizeDistrictCode(0)).toBeNull();
    expect(normalizeDistrictCode(21)).toBeNull();
    expect(normalizeDistrictCode(99)).toBeNull();
    expect(normalizeDistrictCode("abc")).toBeNull();
    expect(normalizeDistrictCode(7.5)).toBeNull();
  });
});

describe("district lookup", () => {
  it("knows every code in the EB.DISTRICT default list", () => {
    for (let code = 1; code <= 20; code++) {
      expect(isValidDistrictCode(code)).toBe(true);
    }
  });

  it("labels codes with their padded id and name", () => {
    expect(getDistrictLabel(7)).toBe("07 - Bahirdar District");
    expect(getDistrictLabel(17)).toBe("17 - Adama District");
    expect(getDistrictLabel(null)).toBe("N/A");
  });
});

const baseFarmerPayload = {
  farmerId: "F-001",
  farmerName: "Abebe Kebede",
  phoneNumber: "0911000001",
  kebeleIdDocUrl: "https://docs.example.com/kebele.pdf",
  landCertificateDocUrl: "https://docs.example.com/land.pdf",
  totalFarmSizeInHectare: 3.5,
  cultivatedAreaInHectare: 2,
  primaryCropType: "Wheat",
  farmRegistryNumber: "FR-2026-001",
  requestedLoanAmount: 50000,
  repaymentSource: "Crop Sale",
  requestedLoanTermInMonth: 12,
  applicationChannel: "Lersha",
  creditScoreValue: 720,
  scoreCalculationDate: "2026-03-15T00:00:00.000Z",
  emergencyContactName: "Almaz Kebede",
  emergencyContactPhone: "0911000002",
  emergencyContactRelationship: "Spouse",
  emergencyContactAddress: "Addis Ababa, Bole Sub City",
  address: "Amhara, Bahir Dar",
  loanPurposes: [
    {
      loanPurpose: "Seed",
      specificVarietyName: "Improved Wheat Seed",
      quantity: 3,
      unitOfMeasurement: "Quintal",
      unitPrice: 5000,
      totalCost: 15000,
    },
  ],
};

describe("sendFarmerDetail district code", () => {
  it("normalizes the padded districtCode Lersha sends", () => {
    const parsed = sendFarmerDetailSchema.parse({
      ...baseFarmerPayload,
      districtCode: "07",
    });
    expect(parsed.districtCode).toBe(7);
  });

  it("accepts the snake_case and legacy aliases", () => {
    expect(
      sendFarmerDetailSchema.parse({ ...baseFarmerPayload, district_code: "07" })
        .districtCode,
    ).toBe(7);
    expect(
      sendFarmerDetailSchema.parse({ ...baseFarmerPayload, districtId: 7 })
        .districtCode,
    ).toBe(7);
    expect(
      sendFarmerDetailSchema.parse({ ...baseFarmerPayload, district: "07" })
        .districtCode,
    ).toBe(7);
  });

  it("registers farmers with no district rather than rejecting them", () => {
    const parsed = sendFarmerDetailSchema.parse(baseFarmerPayload);
    expect(parsed.districtCode).toBeNull();
  });

  it("rejects an unknown district instead of silently dropping it", () => {
    const result = sendFarmerDetailSchema.safeParse({
      ...baseFarmerPayload,
      districtCode: "99",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Unknown district code");
    }
  });
});
