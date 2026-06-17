import { differenceInDays, startOfDay } from "date-fns";
import type { LoanDetails, LoanProduct, PenaltyRule, Tax } from "./types";
import {
  calculateInterestWithPayments,
  calculateInterestWithPaymentsDetailed,
  normalizePayments,
  roundCurrency,
} from "./interest-accrual";
import { calculateInstallmentPenalty } from "./installment-penalty";

interface CalculatedRepayment {
  total: number;
  principal: number;
  interest: number;
  penalty: number;
  serviceFee: number;
  tax: number;
}

export interface CalculatedRepaymentDetailed extends CalculatedRepayment {
  interestPaid: number;
  serviceFeePaid: number;
  principalPaidFromInterestCalc: number;
}

/**
 * Calculate the inclusive tax that should be deducted upfront from the loan principal.
 * Only tax configs marked as `isInclusive` are considered.
 * The tax is computed as a percentage of the gross loan amount.
 *
 * @returns An object with `taxAmount` (total inclusive tax) and `netDisbursedAmount` (amount after deduction).
 */
export const calculateInclusiveTax = (
  grossLoanAmount: number,
  taxConfigs: Tax[],
): { taxAmount: number; netDisbursedAmount: number } => {
  let totalInclusiveTaxRate = 0;

  for (const taxConfig of taxConfigs) {
    if (taxConfig.isInclusive && taxConfig.rate > 0) {
      totalInclusiveTaxRate += taxConfig.rate;
    }
  }

  if (totalInclusiveTaxRate <= 0) {
    return { taxAmount: 0, netDisbursedAmount: grossLoanAmount };
  }

  const taxAmount = roundCurrency(
    grossLoanAmount * (totalInclusiveTaxRate / 100),
  );
  const netDisbursedAmount = roundCurrency(grossLoanAmount - taxAmount);

  return { taxAmount, netDisbursedAmount };
};

export const calculateTotalRepayable = (
  loanDetails: LoanDetails,
  loanProduct: LoanProduct,
  taxConfigs: Tax[],
  asOfDate: Date = new Date(),
  forceCalculate: boolean = false,
): CalculatedRepayment => {
  const loanStartDate = startOfDay(new Date(loanDetails.disbursedDate));
  const finalDate = startOfDay(asOfDate);
  const dueDate = startOfDay(new Date(loanDetails.dueDate));

  const principal = loanDetails.loanAmount;
  let serviceFee = 0;
  let interestComponent = 0;
  let penaltyComponent = 0;
  let taxComponent = 0;

  // Safely parse JSON fields from the product, as they might be strings from the DB
  const safeParse = (field: any, defaultValue: any) => {
    if (typeof field === "string") {
      try {
        return JSON.parse(field);
      } catch (e) {
        return defaultValue;
      }
    }
    return field ?? defaultValue;
  };

  const serviceFeeRule = safeParse(loanProduct.serviceFee, undefined);
  const dailyFeeRule = safeParse(loanProduct.dailyFee, undefined);
  const penaltyRules = safeParse(loanProduct.penaltyRules, []);

  // 1. Service Fee (One-time charge)
  if (
    loanProduct.serviceFeeEnabled &&
    serviceFeeRule &&
    serviceFeeRule.value > 0
  ) {
    const feeValue =
      typeof serviceFeeRule.value === "string"
        ? parseFloat(serviceFeeRule.value)
        : serviceFeeRule.value;
    if (serviceFeeRule.type === "fixed") {
      serviceFee = feeValue;
    } else if (serviceFeeRule.type === "percentage") {
      serviceFee = principal * (feeValue / 100);
    }
  }
  serviceFee = roundCurrency(serviceFee);

  // 2. Daily Fee (Interest) - Calculated only up to the due date.
  if (loanProduct.dailyFeeEnabled && dailyFeeRule && dailyFeeRule.value > 0) {
    const feeValue =
      typeof dailyFeeRule.value === "string"
        ? parseFloat(dailyFeeRule.value)
        : dailyFeeRule.value;
    const interestEndDate = finalDate > dueDate ? dueDate : finalDate;
    const payments = normalizePayments((loanDetails as any).payments);

    interestComponent = calculateInterestWithPayments({
      principal,
      loanStartDate,
      interestEndDate,
      dailyFeeRule: {
        type: dailyFeeRule.type,
        value: feeValue,
        calculationBase: dailyFeeRule.calculationBase,
      },
      serviceFee,
      payments,
    });
  }
  interestComponent = roundCurrency(interestComponent);

  const runningBalanceForPenalty = principal + interestComponent + serviceFee;

  // 3. Penalty - Calculated only if overdue.
  // If the loan is paid, we return 0 penalty unless forceCalculate is true.
  // This is used for reports and historical views to see what the penalty was.
  if (loanDetails.repaymentStatus === "Paid" && !forceCalculate) {
    penaltyComponent = 0;
  } else if (
    loanProduct.penaltyRulesEnabled &&
    penaltyRules &&
    penaltyRules.length > 0
  ) {
    // If penaltyPerInstallment is enabled, compute penalty per-installment
    if (
      (loanProduct as any).penaltyPerInstallment &&
      Array.isArray(loanDetails.installments) &&
      loanDetails.installments.length > 0
    ) {
      // Sum penalties for each installment that is overdue as of finalDate
      for (const inst of loanDetails.installments) {
        const instDue = startOfDay(new Date(inst.dueDate));
        if (finalDate <= instDue) continue;
        const daysOverdue = differenceInDays(finalDate, instDue);
        const principalForInst = Math.max(
          0,
          (inst.amount || 0) - (inst.paidAmount || 0),
        );
        if (principalForInst <= 0) continue;

        penaltyRules.forEach((rule: PenaltyRule) => {
          const fromDay = rule.fromDay === "" ? 1 : Number(rule.fromDay);
          const toDayRaw =
            rule.toDay === "" || rule.toDay === null
              ? Infinity
              : Number(rule.toDay);
          const toDay = isNaN(toDayRaw) ? Infinity : toDayRaw;
          const value = rule.value === "" ? 0 : Number(rule.value);

          if (daysOverdue >= fromDay) {
            const applicableDaysInTier =
              Math.min(daysOverdue, toDay) - fromDay + 1;
            const isOneTime = rule.frequency === "one-time";
            const daysToCalculate = isOneTime ? 1 : applicableDaysInTier;
            if (daysToCalculate > 0) {
              let penaltyForThisRule = 0;
              if (rule.type === "fixed") {
                penaltyForThisRule = value * daysToCalculate;
              } else if (rule.type === "percentageOfPrincipal") {
                penaltyForThisRule =
                  principalForInst * (value / 100) * daysToCalculate;
              } else if (rule.type === "percentageOfCompound") {
                let compoundPenaltyBase = principalForInst;
                for (let i = 0; i < daysToCalculate; i++) {
                  const dailyPenalty = roundCurrency(
                    compoundPenaltyBase * (value / 100),
                  );
                  penaltyForThisRule += dailyPenalty;
                  if (!isOneTime) compoundPenaltyBase += dailyPenalty;
                }
              }
              penaltyComponent += penaltyForThisRule;
            }
          }
        });
      }
    } else {
      // Loan-level penalty calculation (legacy behavior)
      if (finalDate > dueDate) {
        const penaltyStartDate =
          loanProduct.duration === 0
            ? startOfDay(
                new Date(loanDetails.disbursedDate.getTime() + 86400000),
              )
            : dueDate;
        const daysOverdueTotal = differenceInDays(finalDate, penaltyStartDate);

        penaltyRules.forEach((rule: PenaltyRule) => {
          const fromDay = rule.fromDay === "" ? 1 : Number(rule.fromDay);
          const toDayRaw =
            rule.toDay === "" || rule.toDay === null
              ? Infinity
              : Number(rule.toDay);
          const toDay = isNaN(toDayRaw) ? Infinity : toDayRaw;
          const value = rule.value === "" ? 0 : Number(rule.value);

          if (daysOverdueTotal >= fromDay) {
            const applicableDaysInTier =
              Math.min(daysOverdueTotal, toDay) - fromDay + 1;
            const isOneTime = rule.frequency === "one-time";

            if (applicableDaysInTier > 0) {
              let penaltyForThisRule = 0;
              const daysToCalculate = isOneTime ? 1 : applicableDaysInTier;

              if (rule.type === "fixed") {
                penaltyForThisRule = value * daysToCalculate;
              } else if (rule.type === "percentageOfPrincipal") {
                penaltyForThisRule =
                  principal * (value / 100) * daysToCalculate;
              } else if (rule.type === "percentageOfCompound") {
                let compoundPenaltyBase =
                  runningBalanceForPenalty + penaltyComponent;
                for (let i = 0; i < daysToCalculate; i++) {
                  const dailyPenalty = roundCurrency(
                    compoundPenaltyBase * (value / 100),
                  );
                  penaltyForThisRule += dailyPenalty;
                  if (!isOneTime) {
                    compoundPenaltyBase += dailyPenalty;
                  }
                }
              }
              penaltyComponent += penaltyForThisRule;
            }
          }
        });
      }
    }
  }
  penaltyComponent = roundCurrency(penaltyComponent);

  // 4. Tax Calculation for all configured taxes
  taxConfigs.forEach((taxConfig) => {
    const taxRate = taxConfig.rate;
    const taxAppliedTo = JSON.parse(taxConfig.appliedTo);

    if (taxRate > 0) {
      let taxableAmount = 0;
      if (taxAppliedTo.includes("serviceFee")) {
        taxableAmount += serviceFee;
      }
      if (taxAppliedTo.includes("interest")) {
        taxableAmount += interestComponent;
      }
      if (taxAppliedTo.includes("penalty")) {
        taxableAmount += penaltyComponent;
      }
      taxComponent += taxableAmount * (taxRate / 100);
    }
  });
  taxComponent = roundCurrency(taxComponent);

  const totalDebt = roundCurrency(
    principal +
      serviceFee +
      interestComponent +
      penaltyComponent +
      taxComponent,
  );

  return {
    total: totalDebt,
    principal: principal,
    serviceFee: serviceFee,
    interest: interestComponent,
    penalty: penaltyComponent,
    tax: taxComponent,
  };
};

/**
 * Same as calculateTotalRepayable but also returns how much of interest/serviceFee/principal
 * has been paid based on the payments array in loanDetails.
 */
export const calculateTotalRepayableDetailed = (
  loanDetails: LoanDetails,
  loanProduct: LoanProduct,
  taxConfigs: Tax[],
  asOfDate: Date = new Date(),
): CalculatedRepaymentDetailed => {
  const loanStartDate = startOfDay(new Date(loanDetails.disbursedDate));
  const finalDate = startOfDay(asOfDate);
  const dueDate = startOfDay(new Date(loanDetails.dueDate));

  const principal = loanDetails.loanAmount;
  let serviceFee = 0;
  let interestComponent = 0;
  let penaltyComponent = 0;
  let taxComponent = 0;
  let interestPaid = 0;
  let serviceFeePaid = 0;
  let principalPaidFromInterestCalc = 0;

  const safeParse = (field: any, defaultValue: any) => {
    if (typeof field === "string") {
      try {
        return JSON.parse(field);
      } catch (e) {
        return defaultValue;
      }
    }
    return field ?? defaultValue;
  };

  const serviceFeeRule = safeParse(loanProduct.serviceFee, undefined);
  const dailyFeeRule = safeParse(loanProduct.dailyFee, undefined);
  const penaltyRules = safeParse(loanProduct.penaltyRules, []);

  // 1. Service Fee
  if (
    loanProduct.serviceFeeEnabled &&
    serviceFeeRule &&
    serviceFeeRule.value > 0
  ) {
    const feeValue =
      typeof serviceFeeRule.value === "string"
        ? parseFloat(serviceFeeRule.value)
        : serviceFeeRule.value;
    if (serviceFeeRule.type === "fixed") {
      serviceFee = feeValue;
    } else if (serviceFeeRule.type === "percentage") {
      serviceFee = principal * (feeValue / 100);
    }
  }
  serviceFee = roundCurrency(serviceFee);

  // 2. Daily Fee (Interest) with detailed breakdown
  if (loanProduct.dailyFeeEnabled && dailyFeeRule && dailyFeeRule.value > 0) {
    const feeValue =
      typeof dailyFeeRule.value === "string"
        ? parseFloat(dailyFeeRule.value)
        : dailyFeeRule.value;
    const interestEndDate = finalDate > dueDate ? dueDate : finalDate;
    const payments = normalizePayments((loanDetails as any).payments);

    const detailed = calculateInterestWithPaymentsDetailed({
      principal,
      loanStartDate,
      interestEndDate,
      dailyFeeRule: {
        type: dailyFeeRule.type,
        value: feeValue,
        calculationBase: dailyFeeRule.calculationBase,
      },
      serviceFee,
      payments,
    });

    interestComponent = detailed.totalInterest;
    interestPaid = detailed.interestPaid;
    serviceFeePaid = detailed.serviceFeePaid;
    principalPaidFromInterestCalc = detailed.principalPaid;
  }
  interestComponent = roundCurrency(interestComponent);

  const runningBalanceForPenalty = principal + interestComponent + serviceFee;

  // 3. Penalty (same logic as calculateTotalRepayable)
  if (loanDetails.repaymentStatus === 'Paid') {
    penaltyComponent = 0;
  } else if (
    loanProduct.penaltyRulesEnabled &&
    penaltyRules &&
    penaltyRules.length > 0
  ) {
    if (
      (loanProduct as any).penaltyPerInstallment &&
      Array.isArray(loanDetails.installments) &&
      loanDetails.installments.length > 0
    ) {
      for (const inst of loanDetails.installments) {
        const instDue = startOfDay(new Date(inst.dueDate));
        if (finalDate <= instDue) continue;
        const daysOverdue = differenceInDays(finalDate, instDue);
        const principalForInst = Math.max(
          0,
          (inst.amount || 0) - (inst.paidAmount || 0),
        );
        if (principalForInst <= 0) continue;

        penaltyRules.forEach((rule: PenaltyRule) => {
          const fromDay = rule.fromDay === "" ? 1 : Number(rule.fromDay);
          const toDayRaw =
            rule.toDay === "" || rule.toDay === null
              ? Infinity
              : Number(rule.toDay);
          const toDay = isNaN(toDayRaw) ? Infinity : toDayRaw;
          const value = rule.value === "" ? 0 : Number(rule.value);

          if (daysOverdue >= fromDay) {
            const applicableDaysInTier =
              Math.min(daysOverdue, toDay) - fromDay + 1;
            const isOneTime = rule.frequency === "one-time";
            const daysToCalculate = isOneTime ? 1 : applicableDaysInTier;
            if (daysToCalculate > 0) {
              let penaltyForThisRule = 0;
              if (rule.type === "fixed") {
                penaltyForThisRule = value * daysToCalculate;
              } else if (rule.type === "percentageOfPrincipal") {
                penaltyForThisRule =
                  principalForInst * (value / 100) * daysToCalculate;
              } else if (rule.type === "percentageOfCompound") {
                let compoundPenaltyBase = principalForInst;
                for (let i = 0; i < daysToCalculate; i++) {
                  const dailyPenalty = roundCurrency(
                    compoundPenaltyBase * (value / 100),
                  );
                  penaltyForThisRule += dailyPenalty;
                  if (!isOneTime) compoundPenaltyBase += dailyPenalty;
                }
              }
              penaltyComponent += penaltyForThisRule;
            }
          }
        });
      }
    } else {
      if (finalDate > dueDate) {
        const penaltyStartDate =
          loanProduct.duration === 0
            ? startOfDay(
                new Date(loanDetails.disbursedDate.getTime() + 86400000),
              )
            : dueDate;
        const daysOverdueTotal = differenceInDays(finalDate, penaltyStartDate);

        penaltyRules.forEach((rule: PenaltyRule) => {
          const fromDay = rule.fromDay === "" ? 1 : Number(rule.fromDay);
          const toDayRaw =
            rule.toDay === "" || rule.toDay === null
              ? Infinity
              : Number(rule.toDay);
          const toDay = isNaN(toDayRaw) ? Infinity : toDayRaw;
          const value = rule.value === "" ? 0 : Number(rule.value);

          if (daysOverdueTotal >= fromDay) {
            const applicableDaysInTier =
              Math.min(daysOverdueTotal, toDay) - fromDay + 1;
            const isOneTime = rule.frequency === "one-time";

            if (applicableDaysInTier > 0) {
              let penaltyForThisRule = 0;
              const daysToCalculate = isOneTime ? 1 : applicableDaysInTier;

              if (rule.type === "fixed") {
                penaltyForThisRule = value * daysToCalculate;
              } else if (rule.type === "percentageOfPrincipal") {
                penaltyForThisRule =
                  principal * (value / 100) * daysToCalculate;
              } else if (rule.type === "percentageOfCompound") {
                let compoundPenaltyBase =
                  runningBalanceForPenalty + penaltyComponent;
                for (let i = 0; i < daysToCalculate; i++) {
                  const dailyPenalty = roundCurrency(
                    compoundPenaltyBase * (value / 100),
                  );
                  penaltyForThisRule += dailyPenalty;
                  if (!isOneTime) {
                    compoundPenaltyBase += dailyPenalty;
                  }
                }
              }
              penaltyComponent += penaltyForThisRule;
            }
          }
        });
      }
    }
  }
  penaltyComponent = roundCurrency(penaltyComponent);

  // 4. Tax
  taxConfigs.forEach((taxConfig) => {
    const taxRate = taxConfig.rate;
    const taxAppliedTo = JSON.parse(taxConfig.appliedTo);

    if (taxRate > 0) {
      let taxableAmount = 0;
      if (taxAppliedTo.includes("serviceFee")) {
        taxableAmount += serviceFee;
      }
      if (taxAppliedTo.includes("interest")) {
        taxableAmount += interestComponent;
      }
      if (taxAppliedTo.includes("penalty")) {
        taxableAmount += penaltyComponent;
      }
      taxComponent += taxableAmount * (taxRate / 100);
    }
  });
  taxComponent = roundCurrency(taxComponent);

  const totalDebt = roundCurrency(
    principal +
      serviceFee +
      interestComponent +
      penaltyComponent +
      taxComponent,
  );

  return {
    total: totalDebt,
    principal: principal,
    serviceFee: serviceFee,
    interest: interestComponent,
    penalty: penaltyComponent,
    tax: taxComponent,
    interestPaid: interestPaid,
    serviceFeePaid: serviceFeePaid,
    principalPaidFromInterestCalc: principalPaidFromInterestCalc,
  };
};

export interface InstallmentDueBreakdown {
  principalRemaining: number;
  penaltyRemaining: number;
  serviceFeeDue: number;
  interestDue: number;
  taxDue: number;
  totalDue: number;
}

/**
 * Computes the amount due for the *current installment payment* plus any
 * loan-level buckets (service fee / interest / tax) that are still unpaid.
 *
 * This is the same breakdown used for repayment validation in the payment callback.
 */
export const calculateInstallmentDueBreakdown = (params: {
  loanDetails: LoanDetails;
  loanProduct: LoanProduct;
  taxConfigs: Tax[];
  activeInstallment: { amount?: number | null; paidAmount?: number | null; dueDate: Date | string };
  asOfDate?: Date;
}): InstallmentDueBreakdown => {
  const { loanDetails, loanProduct, taxConfigs, activeInstallment, asOfDate = new Date() } = params;

  const totals = calculateTotalRepayableDetailed(loanDetails, loanProduct, taxConfigs, asOfDate);
  const alreadyRepaid = Number((loanDetails as any).repaidAmount ?? 0);

  const serviceFeeDue = Math.max(0, totals.serviceFee - totals.serviceFeePaid);
  const interestDue = Math.max(0, totals.interest - totals.interestPaid);

  // Tax priority is after interest. Infer how much tax has already been covered
  // by repayments that are beyond (penalty + serviceFee + interest + principalPaidFromInterestCalc).
  const taxPaidSoFar = Math.max(
    0,
    alreadyRepaid -
      totals.penalty -
      totals.serviceFeePaid -
      totals.interestPaid -
      totals.principalPaidFromInterestCalc,
  );
  const taxDue = Math.max(0, totals.tax - taxPaidSoFar);

  const penaltyRules = (() => {
    const raw: any = (loanProduct as any).penaltyRules;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    return Array.isArray(raw) ? raw : [];
  })();

  const penaltyPerInstallment = Boolean((loanProduct as any).penaltyPerInstallment);
  const penaltyDueDate = penaltyPerInstallment
    ? new Date(activeInstallment.dueDate)
    : new Date((loanDetails as any).dueDate);

  const installmentAmount = Math.max(0, Number(activeInstallment.amount ?? 0));
  const installmentPaidAmount = Math.max(0, Number(activeInstallment.paidAmount ?? 0));

  // Installment payments settle: penalty first, then principal.
  // Penalty itself depends on remaining principal, so compute with a small fixed-point iteration.
  let principalPaidSoFar = Math.min(installmentAmount, installmentPaidAmount);
  let principalOutstanding = Math.max(0, installmentAmount - principalPaidSoFar);
  let penaltyForInstallment = calculateInstallmentPenalty({
    dueDate: penaltyDueDate,
    principalOutstanding,
    penaltyRules,
    asOfDate,
  });

  for (let i = 0; i < 2; i++) {
    const penaltyPaid = Math.min(installmentPaidAmount, penaltyForInstallment);
    principalPaidSoFar = Math.min(
      installmentAmount,
      Math.max(0, installmentPaidAmount - penaltyPaid),
    );
    principalOutstanding = Math.max(0, installmentAmount - principalPaidSoFar);
    penaltyForInstallment = calculateInstallmentPenalty({
      dueDate: penaltyDueDate,
      principalOutstanding,
      penaltyRules,
      asOfDate,
    });
  }

  const penaltyPaidSoFar = Math.min(installmentPaidAmount, penaltyForInstallment);
  const penaltyRemaining = Math.max(0, penaltyForInstallment - penaltyPaidSoFar);
  const principalRemaining = Math.max(0, installmentAmount - Math.max(0, installmentPaidAmount - penaltyPaidSoFar));

  const totalDue = roundCurrency(
    principalRemaining + penaltyRemaining + serviceFeeDue + interestDue + taxDue,
  );

  return {
    principalRemaining: roundCurrency(principalRemaining),
    penaltyRemaining: roundCurrency(penaltyRemaining),
    serviceFeeDue: roundCurrency(serviceFeeDue),
    interestDue: roundCurrency(interestDue),
    taxDue: roundCurrency(taxDue),
    totalDue: roundCurrency(Math.max(0, totalDue)),
  };
};
