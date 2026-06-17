import { z } from "zod";

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

export const hasAccountQuerySchema = z.object({
  phone: z.string().min(1),
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
