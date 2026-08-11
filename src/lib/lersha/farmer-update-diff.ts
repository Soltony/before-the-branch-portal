/**
 * Review-baseline snapshots and field-level diffs for Lersha farmer updates.
 *
 * When Lersha re-sends Send Farmer Details for a farmer who is still awaiting
 * approval, we snapshot the record as it was BEFORE the update (once — the
 * first unreviewed update wins, so successive updates accumulate against the
 * same baseline). The detail API then diffs baseline vs. current so reviewers
 * see exactly which fields changed. The baseline is cleared when a reviewer
 * approves or rejects the farmer.
 *
 * This module is pure (no prisma import): API routes use the functions and
 * the client UI imports only the types.
 */

import { getDistrictLabel } from "../districts";

export type DiffValueKind = "text" | "number" | "currency" | "date" | "url";

export interface FieldChange {
  field: string;
  label: string;
  kind: DiffValueKind;
  previous: string | number | null;
  current: string | number | null;
}

/** The purpose fields Lersha controls, as stored on LershaLoanPurpose. */
export interface PurposeSnapshot {
  loanPurpose: string;
  specificVarietyName: string | null;
  quantity: number | null;
  unitOfMeasurement: string | null;
  unitPrice: number | null;
  totalCost: number;
  agroDealerName: string | null;
  agroDealerAccountNo: string | null;
  insuranceName: string | null;
}

export interface PurposeChange {
  /** Human-readable identity, e.g. "Fertilizer — DAP". */
  label: string;
  totalCost: number;
  /** Same identity key syncLoanPurposes matches on; lets callers tag rows. */
  matchKey: string;
  /** Field-level changes; present only for modified purposes. */
  changes?: FieldChange[];
}

export interface PendingUpdateDiff {
  /** When the pre-update snapshot was taken (ISO). */
  baselineCapturedAt: string | null;
  fields: FieldChange[];
  purposes: {
    added: PurposeChange[];
    removed: PurposeChange[];
    modified: PurposeChange[];
  };
  hasChanges: boolean;
}

/** Farmer profile fields as stored in a baseline (dates as ISO strings). */
export interface ProfileSnapshot {
  farmerName: string;
  phoneNumber: string;
  address: string;
  kebeleIdDocUrl: string;
  landCertificateDocUrl: string;
  marriageCertificateUrl: string | null;
  totalFarmSizeInHectare: number;
  cultivatedAreaInHectare: number;
  primaryCropType: string;
  farmRegistryNumber: string;
  requestedLoanAmount: number;
  repaymentSource: string;
  requestedLoanTermInMonth: number;
  applicationChannel: string;
  creditScoreValue: number;
  scoreCalculationDate: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  emergencyContactAddress: string;
  /** Stored as the readable label ("07 - Bahirdar District") so diffs read well. */
  districtCode: string | null;
}

export interface ReviewBaseline {
  capturedAt: string;
  profile: ProfileSnapshot;
  purposes: PurposeSnapshot[];
}

/** A LershaFarmer row (or anything shaped like its profile fields). */
export type FarmerProfileLike = Omit<
  ProfileSnapshot,
  "scoreCalculationDate" | "districtCode"
> & {
  scoreCalculationDate: Date | string;
  districtCode: number | null;
};

const PROFILE_FIELDS: {
  field: keyof ProfileSnapshot;
  label: string;
  kind: DiffValueKind;
}[] = [
  { field: "farmerName", label: "Farmer Name", kind: "text" },
  { field: "phoneNumber", label: "Phone Number", kind: "text" },
  { field: "address", label: "Address", kind: "text" },
  { field: "districtCode", label: "District", kind: "text" },
  { field: "primaryCropType", label: "Primary Crop", kind: "text" },
  { field: "farmRegistryNumber", label: "Farm Registry Number", kind: "text" },
  { field: "totalFarmSizeInHectare", label: "Total Farm Size (ha)", kind: "number" },
  { field: "cultivatedAreaInHectare", label: "Cultivated Area (ha)", kind: "number" },
  { field: "requestedLoanAmount", label: "Requested Loan Amount", kind: "currency" },
  { field: "requestedLoanTermInMonth", label: "Requested Loan Term (months)", kind: "number" },
  { field: "repaymentSource", label: "Repayment Source", kind: "text" },
  { field: "applicationChannel", label: "Application Channel", kind: "text" },
  { field: "creditScoreValue", label: "Credit Score", kind: "number" },
  { field: "scoreCalculationDate", label: "Score Calculation Date", kind: "date" },
  { field: "emergencyContactName", label: "Emergency Contact Name", kind: "text" },
  { field: "emergencyContactPhone", label: "Emergency Contact Phone", kind: "text" },
  { field: "emergencyContactRelationship", label: "Emergency Contact Relationship", kind: "text" },
  { field: "emergencyContactAddress", label: "Emergency Contact Address", kind: "text" },
  { field: "kebeleIdDocUrl", label: "Kebele ID Document", kind: "url" },
  { field: "landCertificateDocUrl", label: "Land Certificate", kind: "url" },
  { field: "marriageCertificateUrl", label: "Marriage Certificate", kind: "url" },
];

const PURPOSE_FIELDS: {
  field: keyof PurposeSnapshot;
  label: string;
  kind: DiffValueKind;
}[] = [
  { field: "quantity", label: "Quantity", kind: "number" },
  { field: "unitOfMeasurement", label: "Unit", kind: "text" },
  { field: "unitPrice", label: "Unit Price", kind: "currency" },
  { field: "agroDealerName", label: "Agro Dealer", kind: "text" },
  { field: "agroDealerAccountNo", label: "Agro Dealer Account", kind: "text" },
  { field: "insuranceName", label: "Insurance Provider", kind: "text" },
];

/**
 * Identity key for a loan purpose. Insurance rows are identified by insurer,
 * everything else by variety; totalCost is part of the identity in both cases
 * (mirrors what syncLoanPurposes matches on — keep the two in sync).
 */
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

function toIso(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export function toProfileSnapshot(farmer: FarmerProfileLike): ProfileSnapshot {
  return {
    farmerName: farmer.farmerName,
    phoneNumber: farmer.phoneNumber,
    address: farmer.address,
    kebeleIdDocUrl: farmer.kebeleIdDocUrl,
    landCertificateDocUrl: farmer.landCertificateDocUrl,
    marriageCertificateUrl: farmer.marriageCertificateUrl ?? null,
    totalFarmSizeInHectare: farmer.totalFarmSizeInHectare,
    cultivatedAreaInHectare: farmer.cultivatedAreaInHectare,
    primaryCropType: farmer.primaryCropType,
    farmRegistryNumber: farmer.farmRegistryNumber,
    requestedLoanAmount: farmer.requestedLoanAmount,
    repaymentSource: farmer.repaymentSource,
    requestedLoanTermInMonth: farmer.requestedLoanTermInMonth,
    applicationChannel: farmer.applicationChannel,
    creditScoreValue: farmer.creditScoreValue,
    scoreCalculationDate: toIso(farmer.scoreCalculationDate),
    emergencyContactName: farmer.emergencyContactName,
    emergencyContactPhone: farmer.emergencyContactPhone,
    emergencyContactRelationship: farmer.emergencyContactRelationship,
    emergencyContactAddress: farmer.emergencyContactAddress,
    districtCode:
      farmer.districtCode == null ? null : getDistrictLabel(farmer.districtCode),
  };
}

export function toPurposeSnapshot(purpose: PurposeSnapshot): PurposeSnapshot {
  return {
    loanPurpose: purpose.loanPurpose,
    specificVarietyName: purpose.specificVarietyName ?? null,
    quantity: purpose.quantity ?? null,
    unitOfMeasurement: purpose.unitOfMeasurement ?? null,
    unitPrice: purpose.unitPrice ?? null,
    totalCost: purpose.totalCost,
    agroDealerName: purpose.agroDealerName ?? null,
    agroDealerAccountNo: purpose.agroDealerAccountNo ?? null,
    insuranceName: purpose.insuranceName ?? null,
  };
}

/** Serialize the pre-update state for storage in LershaFarmer.reviewBaseline. */
export function buildReviewBaseline(
  farmer: FarmerProfileLike,
  purposes: PurposeSnapshot[],
): string {
  const baseline: ReviewBaseline = {
    capturedAt: new Date().toISOString(),
    profile: toProfileSnapshot(farmer),
    purposes: purposes.map(toPurposeSnapshot),
  };
  return JSON.stringify(baseline);
}

export function parseReviewBaseline(json: string | null): ReviewBaseline | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || !parsed.profile) return null;
    return {
      capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : "",
      profile: parsed.profile as ProfileSnapshot,
      purposes: Array.isArray(parsed.purposes)
        ? (parsed.purposes as PurposeSnapshot[])
        : [],
    };
  } catch {
    return null;
  }
}

function normalize(value: unknown, kind: DiffValueKind): string | number | null {
  if (value == null) return null;
  if (kind === "date") {
    const t = new Date(value as string | Date).getTime();
    return Number.isNaN(t) ? String(value) : t;
  }
  if (typeof value === "number") return value;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function displayValue(value: unknown): string | number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return value;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/** Field-level changes between two profile snapshots. */
export function diffProfiles(
  previous: ProfileSnapshot,
  current: ProfileSnapshot,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const { field, label, kind } of PROFILE_FIELDS) {
    const before = previous?.[field];
    const after = current?.[field];
    if (normalize(before, kind) !== normalize(after, kind)) {
      changes.push({
        field,
        label,
        kind,
        previous: displayValue(before),
        current: displayValue(after),
      });
    }
  }
  return changes;
}

function purposeLabel(purpose: PurposeSnapshot): string {
  const detail =
    purpose.loanPurpose.trim().toLowerCase() === "insurance"
      ? purpose.insuranceName
      : purpose.specificVarietyName;
  return detail ? `${purpose.loanPurpose} — ${detail}` : purpose.loanPurpose;
}

function toPurposeChange(purpose: PurposeSnapshot): PurposeChange {
  return {
    label: purposeLabel(purpose),
    totalCost: purpose.totalCost,
    matchKey: loanPurposeMatchKey(purpose),
  };
}

/** Added / removed / modified purposes, matched by identity key. */
export function diffPurposes(
  previous: PurposeSnapshot[],
  current: PurposeSnapshot[],
): PendingUpdateDiff["purposes"] {
  const previousByKey = new Map(
    previous.map((p) => [loanPurposeMatchKey(p), p]),
  );
  const currentByKey = new Map(current.map((p) => [loanPurposeMatchKey(p), p]));

  const added: PurposeChange[] = [];
  const removed: PurposeChange[] = [];
  const modified: PurposeChange[] = [];

  for (const [key, purpose] of currentByKey) {
    const before = previousByKey.get(key);
    if (!before) {
      added.push(toPurposeChange(purpose));
      continue;
    }
    const changes: FieldChange[] = [];
    for (const { field, label, kind } of PURPOSE_FIELDS) {
      if (normalize(before[field], kind) !== normalize(purpose[field], kind)) {
        changes.push({
          field,
          label,
          kind,
          previous: displayValue(before[field]),
          current: displayValue(purpose[field]),
        });
      }
    }
    if (changes.length > 0) {
      modified.push({ ...toPurposeChange(purpose), changes });
    }
  }

  for (const [key, purpose] of previousByKey) {
    if (!currentByKey.has(key)) {
      removed.push(toPurposeChange(purpose));
    }
  }

  return { added, removed, modified };
}

/**
 * Diff the stored baseline against the farmer's current record. Returns null
 * when there is no (valid) baseline — i.e. nothing is awaiting review.
 */
export function computePendingUpdate(
  baselineJson: string | null,
  currentFarmer: FarmerProfileLike,
  currentPurposes: PurposeSnapshot[],
): PendingUpdateDiff | null {
  const baseline = parseReviewBaseline(baselineJson);
  if (!baseline) return null;

  const fields = diffProfiles(baseline.profile, toProfileSnapshot(currentFarmer));
  const purposes = diffPurposes(
    baseline.purposes.map(toPurposeSnapshot),
    currentPurposes.map(toPurposeSnapshot),
  );

  return {
    baselineCapturedAt: baseline.capturedAt || null,
    fields,
    purposes,
    hasChanges:
      fields.length > 0 ||
      purposes.added.length > 0 ||
      purposes.removed.length > 0 ||
      purposes.modified.length > 0,
  };
}
