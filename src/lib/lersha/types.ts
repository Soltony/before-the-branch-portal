import { z } from "zod";
import { LANGUAGE_CODES } from "./contract-languages";

// ============================================================
// Zod schemas for incoming requests (APIs we expose for Lersha)
// ============================================================

const agroDealerSchema = z.object({
  agro_dealer_name: z.string().min(1),
  agro_dealer_account_number: z.string().min(1),
});

const insuranceSchema = z.object({
  insurance_name: z.string().min(1),
});

const loanPurposeItemSchema = z.object({
  loanPurpose: z.string().min(1),
  specificVarietyName: z.string().optional(),
  quantity: z.number().optional(),
  unitOfMeasurement: z.string().optional(),
  unitPrice: z.number().optional(),
  totalCost: z.number(),
  agro_dealer: agroDealerSchema.optional(),
  Insurance: insuranceSchema.optional(),
});

export const sendFarmerDetailSchema = z.object({
  farmerId: z.string().min(1),
  farmerName: z.string().min(1),
  phoneNumber: z.string().min(1),
  kebeleIdDocUrl: z.string().url(),
  landCertificateDocUrl: z.string().url(),
  totalFarmSizeInHectare: z.number().positive(),
  cultivatedAreaInHectare: z.number().positive(),
  primaryCropType: z.string().min(1),
  farmRegistryNumber: z.string().min(1),
  requestedLoanAmount: z.number().positive(),
  repaymentSource: z.string().min(1),
  requestedLoanTermInMonth: z.number().int().positive(),
  applicationChannel: z.string().min(1),
  creditScoreValue: z.number(),
  scoreCalculationDate: z.string(), // ISO date string
  emergencyContactName: z.string().min(1),
  emergencyContactPhone: z.string().min(1),
  emergencyContactRelationship: z.string().min(1),
  emergencyContactAddress: z.string().min(1),
  status: z.string().default("PENDING"),
  marriageCertificateUrl: z.string().url().optional().nullable(),
  address: z.string().min(1),
  loanPurposes: z.array(loanPurposeItemSchema).min(1),
});

/** Lersha sends an array of farmer details */
export const sendFarmerDetailArraySchema = z.array(sendFarmerDetailSchema).min(1);

export const loanRequestSchema = z.object({
  farmer_id: z.string().min(1),
  product_id: z.string().min(1),
});

export const otpConfirmationSchema = z.object({
  uniqueRequestIdentifier: z.string().min(1),
  otp: z.string().min(1),
});

/** Lersha requests a loan contract in the farmer's chosen language. */
export const contractRequestSchema = z.object({
  farmer_id: z.string().min(1),
  language_code: z.enum(LANGUAGE_CODES),
});

/** Lersha submits the Contract ID the farmer received via SMS to sign it. */
export const contractVerifySchema = z.object({
  farmer_id: z.string().min(1),
  contract_id: z.string().min(1),
});

export const hasAccountQuerySchema = z.object({
  phone: z.string().min(1),
});

/** Lersha requests insurance payments for a list of farmers. */
export const insuranceRequestSchema = z.object({
  farmerIDs: z.array(z.string().min(1)).min(1),
});

/**
 * A single proposed product-price change for one farmer's loan purpose.
 * `productId` is the LershaLoanPurpose.productId. Agro-dealer changes are
 * handled separately via /api/v1/nib/agroDealerChange.
 */
const priceChangeItemSchema = z.object({
  farmerId: z.string().min(1),
  productId: z.string().min(1),
  newUnitPrice: z.number().positive(),
});

/**
 * Lersha prices products at the woreda level, so one price change affects every
 * farmer in that woreda. Lersha sends the full batch of affected farmers; the
 * bank validates all of them against its tolerance and applies all-or-nothing.
 */
export const priceChangeRequestSchema = z.object({
  changes: z.array(priceChangeItemSchema).min(1),
});

/**
 * A single agro-dealer change for one farmer's loan purpose. `productId` is the
 * LershaLoanPurpose.productId.
 */
const agroDealerChangeItemSchema = z.object({
  farmerId: z.string().min(1),
  productId: z.string().min(1),
  agro_dealer_name: z.string().min(1),
  agro_dealer_account_number: z.string().min(1),
});

/**
 * Agro-dealer changes are woreda-level too, so Lersha sends the full batch of
 * affected farmers at once. Kept separate from price changes so the two
 * concerns can be requested independently. Validated all-or-nothing like
 * priceChange (no tolerance applies — any resolvable pair can be updated).
 */
export const agroDealerChangeRequestSchema = z.object({
  changes: z.array(agroDealerChangeItemSchema).min(1),
});

// ============================================================
// Zod schemas for Lersha APIs we consume (outgoing requests)
// ============================================================

export const loanDecisionPayloadSchema = z.object({
  farmer_id: z.string().min(1),
  decision: z.enum(["APPROVED", "DECLINED"]),
  comment: z.string().optional(),
  reference_no: z.string().min(1),
});

/** Inbound payload for NIB's /api/farmer/disbursement */
export const disbursementConfirmationPayloadSchema = z.object({
  farmer_id: z.string().min(1),
  remaining_balance: z.number(),
});

/** Outbound payload for Lersha POST /nib/disbursement-confirmation */
export const lershaDisbursementConfirmationPayloadSchema = z.object({
  farmer_id: z.string().min(1),
  remaining_balance: z.number(),
  productId: z.string().min(1),
  referenceNo: z.string().min(1),
  status: z.literal("DISBURSED"),
});

/** A single insurance-confirmation result reported back to Lersha. */
export const insuranceConfirmationRequestSchema = z.object({
  farmer_id: z.string().min(1),
  status: z.enum(["SUCCESS", "FAILED"]),
  remaining_balance: z.number(),
  transaction_id: z.string().optional(),
  transaction_amount: z.number().optional(),
});

/** Outbound payload for Lersha POST /nib/insuranceConfirmation */
export const insuranceConfirmationPayloadSchema = z.object({
  requests: z.array(insuranceConfirmationRequestSchema).min(1),
});

// ============================================================
// TypeScript types derived from schemas
// ============================================================

export type SendFarmerDetailInput = z.infer<typeof sendFarmerDetailSchema>;
export type LoanRequestInput = z.infer<typeof loanRequestSchema>;
export type OtpConfirmationInput = z.infer<typeof otpConfirmationSchema>;
export type LoanDecisionPayload = z.infer<typeof loanDecisionPayloadSchema>;
export type DisbursementConfirmationPayload = z.infer<
  typeof disbursementConfirmationPayloadSchema
>;
export type LershaDisbursementConfirmationPayload = z.infer<
  typeof lershaDisbursementConfirmationPayloadSchema
>;
export type ContractRequestInput = z.infer<typeof contractRequestSchema>;
export type ContractVerifyInput = z.infer<typeof contractVerifySchema>;
export type InsuranceRequestInput = z.infer<typeof insuranceRequestSchema>;
export type PriceChangeRequestInput = z.infer<typeof priceChangeRequestSchema>;
export type AgroDealerChangeRequestInput = z.infer<
  typeof agroDealerChangeRequestSchema
>;
export type InsuranceConfirmationRequest = z.infer<
  typeof insuranceConfirmationRequestSchema
>;
export type InsuranceConfirmationPayload = z.infer<
  typeof insuranceConfirmationPayloadSchema
>;
