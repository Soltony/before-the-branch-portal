
import { z } from 'zod';

export const productSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  icon: z.string().min(1, 'Icon is required'),
  minLoan: z.number().positive().nullable(),
  maxLoan: z.number().positive().nullable(),
  duration: z.number().int().min(0, 'Duration cannot be negative').optional(),
});

export const createProductSchema = z.object({
  providerId: z.string(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  icon: z.string().min(1, 'Icon is required'),
  minLoan: z.number().min(0, 'Min loan cannot be negative'),
  maxLoan: z.number().min(0, 'Max loan cannot be negative'),
  duration: z.number().int().min(0, 'Duration must be a non-negative number of days'),
  isSalaryAdvance: z.boolean().optional(),
  advancePercent: z.number().nullable().optional(),
  salaryAdvanceMappings: z.string().optional(),
  installments: z.number().int().positive().nullable().optional(),
  repaymentIntervalDays: z.number().int().positive().nullable().optional(),
  penaltyPerInstallment: z.boolean().optional(),
}).refine(data => data.maxLoan >= data.minLoan, {
  message: "Max loan must be greater than or equal to min loan",
  path: ["maxLoan"],
});


const feeRuleSchema = z.object({
    type: z.enum(['fixed', 'percentage']),
    value: z.number().or(z.string().regex(/^\d*\.?\d*$/).transform(v => v === '' ? '' : Number(v))),
});

const dailyFeeRuleSchema = feeRuleSchema.extend({
    calculationBase: z.enum(['principal', 'compound']).optional(),
});


const penaltyRuleSchema = z.object({
    id: z.string(),
    fromDay: z.number().or(z.string().regex(/^\d*$/).transform(v => v === '' ? '' : Number(v))),
    toDay: z.number().or(z.string().regex(/^\d*$/).transform(v => v === '' ? null : Number(v))).nullable(),
    type: z.enum(['fixed', 'percentageOfPrincipal', 'percentageOfCompound']),
    value: z.number().or(z.string().regex(/^\d*\.?\d*$/).transform(v => v === '' ? '' : Number(v))),
    frequency: z.enum(['daily', 'one-time']),
});


export const updateProductSchema = productSchema.partial().extend({
  id: z.string(),
  status: z.enum(['Active', 'Disabled']).optional(),
  allowConcurrentLoans: z.boolean().optional(),
  isSalaryAdvance: z.boolean().optional(),
  advancePercent: z.number().nullable().optional(),
  salaryAdvanceMappings: z.string().nullable().optional(),
  installments: z.number().int().positive().nullable().optional(),
  repaymentIntervalDays: z.number().int().positive().nullable().optional(),
  serviceFee: feeRuleSchema.optional(),
  dailyFee: dailyFeeRuleSchema.optional(),
  penaltyRules: z.array(penaltyRuleSchema).optional(),
  penaltyPerInstallment: z.boolean().optional(),
  serviceFeeEnabled: z.boolean().nullable().optional(),
  dailyFeeEnabled: z.boolean().nullable().optional(),
  penaltyRulesEnabled: z.boolean().nullable().optional(),
  dataProvisioningEnabled: z.boolean().nullable().optional(),
  dataProvisioningConfigId: z.string().nullable().optional(),
  eligibilityFilter: z.string().nullable().optional(),
});

export const loanCreationSchema = z.object({
  borrowerId: z.string(),
  borrowerAccountNumber: z.string().optional(),
    productId: z.string(),
    loanApplicationId: z.string().optional(),
    loanAmount: z.number(),
    disbursedDate: z.string().datetime(),
    dueDate: z.string().datetime(),
});

export const requiredDocumentSchema = z.object({
  productId: z.string(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
});
