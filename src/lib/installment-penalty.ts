import { differenceInDays, startOfDay } from 'date-fns';
import type { PenaltyRule } from '@/lib/types';

const roundCurrency = (amount: number): number => {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

export function calculateInstallmentPenalty(params: {
  dueDate: Date;
  principalOutstanding: number;
  penaltyRules: PenaltyRule[];
  asOfDate?: Date;
}): number {
  const { dueDate, principalOutstanding, penaltyRules, asOfDate = new Date() } = params;

  const principal = Math.max(0, Number(principalOutstanding) || 0);

  // Penalty only applies while there is outstanding principal for the installment.
  // Once the installment principal is fully repaid, no further penalty accrues
  // (including flat "fixed" penalties). This keeps the per-installment penalty
  // consistent with the loan-level totals in calculateTotalRepayable, which skip
  // any installment whose outstanding principal is <= 0.
  if (principal <= 0) return 0;

  const finalDate = startOfDay(asOfDate);
  const instDue = startOfDay(new Date(dueDate));
  if (finalDate <= instDue) return 0;

  const daysOverdue = Math.max(0, differenceInDays(finalDate, instDue));
  if (daysOverdue <= 0) return 0;

  let penaltyComponent = 0;

  for (const rule of penaltyRules || []) {
    const fromDay = (rule as any).fromDay === '' ? 1 : Number((rule as any).fromDay);
    const toDayRaw = (rule as any).toDay === '' || (rule as any).toDay === null ? Infinity : Number((rule as any).toDay);
    const toDay = Number.isFinite(toDayRaw) ? toDayRaw : Infinity;
    const value = (rule as any).value === '' ? 0 : Number((rule as any).value);

    if (!Number.isFinite(fromDay) || fromDay <= 0) continue;
    if (!Number.isFinite(value) || value <= 0) continue;

    if (daysOverdue >= fromDay) {
      const applicableDaysInTier = Math.min(daysOverdue, toDay) - fromDay + 1;
      const isOneTime = (rule as any).frequency === 'one-time';
      const daysToCalculate = isOneTime ? 1 : applicableDaysInTier;
      if (daysToCalculate <= 0) continue;

      if ((rule as any).type === 'fixed') {
        penaltyComponent += value * daysToCalculate;
      } else if ((rule as any).type === 'percentageOfPrincipal') {
        if (principal <= 0) continue;
        penaltyComponent += principal * (value / 100) * daysToCalculate;
      } else if ((rule as any).type === 'percentageOfCompound') {
        if (principal <= 0) continue;
        let compoundBase = principal;
        for (let i = 0; i < daysToCalculate; i++) {
          const dailyPenalty = roundCurrency(compoundBase * (value / 100));
          penaltyComponent += dailyPenalty;
          if (!isOneTime) compoundBase += dailyPenalty;
        }
      }
    }
  }

  return roundCurrency(penaltyComponent);
}
