import { describe, it, expect } from "vitest";
import {
  buildReviewBaseline,
  computePendingUpdate,
  diffProfiles,
  diffPurposes,
  parseReviewBaseline,
  toProfileSnapshot,
  type FarmerProfileLike,
  type PurposeSnapshot,
} from "./farmer-update-diff";

const baseFarmer: FarmerProfileLike = {
  farmerName: "Abebe Kebede",
  phoneNumber: "+251911000001",
  address: "Oromia, West Shewa Zone, Ambo Woreda",
  kebeleIdDocUrl: "https://docs.example.com/kebele.pdf",
  landCertificateDocUrl: "https://docs.example.com/land.pdf",
  marriageCertificateUrl: null,
  totalFarmSizeInHectare: 3.5,
  cultivatedAreaInHectare: 2,
  primaryCropType: "Wheat",
  farmRegistryNumber: "FR-2026-001",
  requestedLoanAmount: 50000,
  repaymentSource: "Crop Sale",
  requestedLoanTermInMonth: 12,
  applicationChannel: "Lersha",
  creditScoreValue: 720,
  scoreCalculationDate: new Date("2026-03-15T00:00:00.000Z"),
  emergencyContactName: "Almaz Kebede",
  emergencyContactPhone: "+251911000002",
  emergencyContactRelationship: "Spouse",
  emergencyContactAddress: "Addis Ababa, Bole Sub City",
  districtCode: 7,
};

const seedPurpose: PurposeSnapshot = {
  loanPurpose: "Seed",
  specificVarietyName: "Improved Wheat Seed",
  quantity: 3,
  unitOfMeasurement: "Quintal",
  unitPrice: 5000,
  totalCost: 15000,
  agroDealerName: "Seed Corp Ethiopia",
  agroDealerAccountNo: "100098765432",
  insuranceName: null,
};

const insurancePurpose: PurposeSnapshot = {
  loanPurpose: "Insurance",
  specificVarietyName: null,
  quantity: 1,
  unitOfMeasurement: null,
  unitPrice: null,
  totalCost: 634.47,
  agroDealerName: "Nyala insurance S.C.",
  agroDealerAccountNo: "7000101737506",
  insuranceName: "Nyala insurance S.C.",
};

describe("buildReviewBaseline / parseReviewBaseline", () => {
  it("round-trips profile and purposes", () => {
    const json = buildReviewBaseline(baseFarmer, [seedPurpose]);
    const parsed = parseReviewBaseline(json);

    expect(parsed).not.toBeNull();
    expect(parsed!.profile.farmerName).toBe("Abebe Kebede");
    expect(parsed!.profile.scoreCalculationDate).toBe(
      "2026-03-15T00:00:00.000Z",
    );
    expect(parsed!.purposes).toHaveLength(1);
    expect(parsed!.capturedAt).toBeTruthy();
  });

  it("returns null for null, malformed, or shape-less JSON", () => {
    expect(parseReviewBaseline(null)).toBeNull();
    expect(parseReviewBaseline("not json {")).toBeNull();
    expect(parseReviewBaseline('{"foo":1}')).toBeNull();
  });
});

describe("diffProfiles", () => {
  it("reports no changes for identical snapshots", () => {
    const snapshot = toProfileSnapshot(baseFarmer);
    expect(diffProfiles(snapshot, snapshot)).toEqual([]);
  });

  it("detects changed text, number, and url fields with labels", () => {
    const before = toProfileSnapshot(baseFarmer);
    const after = toProfileSnapshot({
      ...baseFarmer,
      phoneNumber: "+251911999999",
      requestedLoanAmount: 60000,
      marriageCertificateUrl: "https://docs.example.com/marriage.pdf",
    });

    const changes = diffProfiles(before, after);
    const byField = new Map(changes.map((c) => [c.field, c]));

    expect(changes).toHaveLength(3);
    expect(byField.get("phoneNumber")).toMatchObject({
      label: "Phone Number",
      previous: "+251911000001",
      current: "+251911999999",
    });
    expect(byField.get("requestedLoanAmount")).toMatchObject({
      kind: "currency",
      previous: 50000,
      current: 60000,
    });
    expect(byField.get("marriageCertificateUrl")).toMatchObject({
      kind: "url",
      previous: null,
      current: "https://docs.example.com/marriage.pdf",
    });
  });

  it("treats equivalent dates and trimmed strings as unchanged", () => {
    const before = toProfileSnapshot(baseFarmer);
    const after = toProfileSnapshot({
      ...baseFarmer,
      scoreCalculationDate: "2026-03-15T00:00:00.000Z",
      primaryCropType: " Wheat ",
    });
    expect(diffProfiles(before, after)).toEqual([]);
  });

  it("detects a changed score calculation date", () => {
    const before = toProfileSnapshot(baseFarmer);
    const after = toProfileSnapshot({
      ...baseFarmer,
      scoreCalculationDate: new Date("2026-06-01T00:00:00.000Z"),
    });
    const changes = diffProfiles(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "scoreCalculationDate",
      kind: "date",
    });
  });
});

describe("diffPurposes", () => {
  it("reports added and removed purposes by identity key", () => {
    const newFertilizer: PurposeSnapshot = {
      loanPurpose: "Fertilizer",
      specificVarietyName: "DAP",
      quantity: 5,
      unitOfMeasurement: "Quintal",
      unitPrice: 4590,
      totalCost: 22001,
      agroDealerName: "Green Fields Agro",
      agroDealerAccountNo: "1000123456789",
      insuranceName: null,
    };

    const result = diffPurposes([seedPurpose], [seedPurpose, newFertilizer]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].label).toBe("Fertilizer — DAP");
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);

    const removedResult = diffPurposes([seedPurpose, newFertilizer], [seedPurpose]);
    expect(removedResult.removed).toHaveLength(1);
    expect(removedResult.removed[0].totalCost).toBe(22001);
  });

  it("reports field-level changes for a matched purpose", () => {
    const updated: PurposeSnapshot = {
      ...seedPurpose,
      agroDealerName: "New Agro Dealer",
      agroDealerAccountNo: "2000000000000",
    };

    const result = diffPurposes([seedPurpose], [updated]);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes?.map((c) => c.field)).toEqual([
      "agroDealerName",
      "agroDealerAccountNo",
    ]);
  });

  it("labels insurance purposes by insurer and matches on it", () => {
    const result = diffPurposes([insurancePurpose], [insurancePurpose]);
    expect(result.added).toHaveLength(0);
    expect(result.modified).toHaveLength(0);

    const swapped = diffPurposes(
      [insurancePurpose],
      [{ ...insurancePurpose, insuranceName: "Other Insurance" }],
    );
    // Different insurer = different identity: one added, one removed.
    expect(swapped.added).toHaveLength(1);
    expect(swapped.added[0].label).toBe("Insurance — Other Insurance");
    expect(swapped.removed).toHaveLength(1);
  });
});

describe("computePendingUpdate", () => {
  it("returns null when there is no baseline", () => {
    expect(computePendingUpdate(null, baseFarmer, [seedPurpose])).toBeNull();
    expect(computePendingUpdate("{bad", baseFarmer, [seedPurpose])).toBeNull();
  });

  it("reports hasChanges=false for an identical resend", () => {
    const baseline = buildReviewBaseline(baseFarmer, [seedPurpose]);
    const diff = computePendingUpdate(baseline, baseFarmer, [seedPurpose]);
    expect(diff).not.toBeNull();
    expect(diff!.hasChanges).toBe(false);
    expect(diff!.fields).toEqual([]);
  });

  it("combines profile and purpose changes", () => {
    const baseline = buildReviewBaseline(baseFarmer, [seedPurpose]);
    const diff = computePendingUpdate(
      baseline,
      { ...baseFarmer, requestedLoanAmount: 65000 },
      [seedPurpose, insurancePurpose],
    );

    expect(diff!.hasChanges).toBe(true);
    expect(diff!.fields.map((c) => c.field)).toEqual(["requestedLoanAmount"]);
    expect(diff!.purposes.added.map((p) => p.label)).toEqual([
      "Insurance — Nyala insurance S.C.",
    ]);
    expect(diff!.baselineCapturedAt).toBeTruthy();
  });
});
