import { addDays, differenceInDays, startOfDay } from 'date-fns';
import type { PenaltyRule } from './types';
import { roundCurrency } from './interest-accrual';

export type SafeInstallmentPayment = {
  amount: number;
  date: Date;
  installmentId?: string | null;
};

export const normalizeInstallmentPayments = (payments: any): SafeInstallmentPayment[] => {
  if (!Array.isArray(payments)) return [];
  return payments
    .map((p: any) => ({
      amount: typeof p?.amount === 'string' ? Number(p.amount) : Number(p?.amount),
      date: new Date(p?.date),
      installmentId: p?.installmentId ?? null,
    }))
    .filter(p => Number.isFinite(p.amount) && p.amount > 0 && !Number.isNaN(p.date.getTime()));
};

const toNumberOrDefault = (value: any, defaultValue: number): number => {
  if (value === '' || value === null || value === undefined) return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
};

const ruleToTier = (rule: PenaltyRule) => {
  const fromDay = toNumberOrDefault((rule as any).fromDay, 1);
  const toDayRaw = (rule as any).toDay === '' || (rule as any).toDay === null ? Infinity : toNumberOrDefault((rule as any).toDay, Infinity);
  const toDay = Number.isFinite(toDayRaw) ? toDayRaw : Infinity;
  const value = toNumberOrDefault((rule as any).value, 0);
  const frequency = (rule as any).frequency as PenaltyRule['frequency'];
  const type = (rule as any).type as PenaltyRule['type'];
  return { fromDay, toDay, value, frequency, type };
};

export type PenaltyInstallmentInput = {
  id: string;
  dueDate: Date;
  amount: number;
};

export const calculatePenaltyWithPayments = (params: {
  penaltyStartDate: Date;
  penaltyEndDate: Date;
  penaltyRules: PenaltyRule[];
  penaltyPerInstallment: boolean;
  principal: number;
  runningBalanceForCompound: number;
  installments?: PenaltyInstallmentInput[];
  payments?: SafeInstallmentPayment[];
}): { totalPenalty: number; installmentPenaltyById?: Record<string, number> } => {
  const {
    penaltyStartDate,
    penaltyEndDate,
    penaltyRules,
    penaltyPerInstallment,
    principal,
    runningBalanceForCompound,
    installments = [],
    payments = [],
  } = params;

  const start = startOfDay(penaltyStartDate);
  const end = startOfDay(penaltyEndDate);

  const days = differenceInDays(end, start);
  if (days <= 0) return { totalPenalty: 0, installmentPenaltyById: penaltyPerInstallment ? {} : undefined };

  const rules = (penaltyRules || []).map(ruleToTier).filter(r => r.fromDay > 0 && r.value > 0);
  if (rules.length === 0) return { totalPenalty: 0, installmentPenaltyById: penaltyPerInstallment ? {} : undefined };

  if (!penaltyPerInstallment) {
    let totalPenalty = 0;
    let compoundBase = Math.max(0, Number(runningBalanceForCompound) || 0);

    for (let dayIndex = 0; dayIndex < days; dayIndex++) {
      const daysOverdue = dayIndex + 1;

      for (const rule of rules) {
        if (daysOverdue < rule.fromDay) continue;
        if (daysOverdue > rule.toDay) continue;

        const isOneTime = rule.frequency === 'one-time';
        if (isOneTime && daysOverdue !== rule.fromDay) continue;

        let dailyPenalty = 0;
        if (rule.type === 'fixed') {
          dailyPenalty = roundCurrency(rule.value);
        } else if (rule.type === 'percentageOfPrincipal') {
          dailyPenalty = roundCurrency(Math.max(0, principal) * (rule.value / 100));
        } else if (rule.type === 'percentageOfCompound') {
          dailyPenalty = roundCurrency(Math.max(0, compoundBase) * (rule.value / 100));
        }

        if (dailyPenalty <= 0) continue;
        totalPenalty += dailyPenalty;

        if (rule.type === 'percentageOfCompound' && !isOneTime) {
          compoundBase += dailyPenalty;
        }
      }
    }

    return { totalPenalty: roundCurrency(totalPenalty) };
  }

  // Installment-level penalty accrual
  const byId: Record<string, number> = {};

  // Payments grouped per day per installment
  const paymentsByDayAndInstallment = new Map<string, number>();
  for (const p of payments) {
    if (!p.installmentId) continue;
    const day = startOfDay(p.date);
    if (day < start) continue;
    if (day >= end) continue;
    const key = `${day.getTime()}|${p.installmentId}`;
    paymentsByDayAndInstallment.set(key, (paymentsByDayAndInstallment.get(key) ?? 0) + p.amount);
  }

  for (const inst of installments) {
    const instDue = startOfDay(new Date(inst.dueDate));
    if (end <= instDue) {
      byId[inst.id] = 0;
      continue;
    }

    // Penalty starts accruing from the installment due date (same convention as loan-calculator's daysOverdue).
    const instStart = instDue;
    const instDays = differenceInDays(end, instStart);
    if (instDays <= 0) {
      byId[inst.id] = 0;
      continue;
    }

    let paidSoFar = 0;
    let principalOutstanding = Math.max(0, Number(inst.amount) || 0);
    let compoundBase = principalOutstanding;

    let instPenalty = 0;

    for (let dayIndex = 0; dayIndex < instDays; dayIndex++) {
      const day = addDays(instStart, dayIndex);

      // Apply installment payments at start-of-day
      const paidToday = paymentsByDayAndInstallment.get(`${day.getTime()}|${inst.id}`) ?? 0;
      if (paidToday > 0) {
        paidSoFar += paidToday;
        const principalToPay = Math.min(paidToday, principalOutstanding);
        principalOutstanding = Math.max(0, principalOutstanding - principalToPay);
        compoundBase = Math.max(0, compoundBase - principalToPay);
      }

      if (principalOutstanding <= 0) {
        // Once principal is fully paid, stop accruing penalty for future days.
        break;
      }

      const daysOverdue = dayIndex + 1;

      for (const rule of rules) {
        if (daysOverdue < rule.fromDay) continue;
        if (daysOverdue > rule.toDay) continue;

        const isOneTime = rule.frequency === 'one-time';
        if (isOneTime && daysOverdue !== rule.fromDay) continue;

        let dailyPenalty = 0;
        if (rule.type === 'fixed') {
          dailyPenalty = roundCurrency(rule.value);
        } else if (rule.type === 'percentageOfPrincipal') {
          dailyPenalty = roundCurrency(principalOutstanding * (rule.value / 100));
        } else if (rule.type === 'percentageOfCompound') {
          dailyPenalty = roundCurrency(compoundBase * (rule.value / 100));
        }

        if (dailyPenalty <= 0) continue;
        instPenalty += dailyPenalty;

        if (rule.type === 'percentageOfCompound' && !isOneTime) {
          compoundBase += dailyPenalty;
        }
      }
    }

    byId[inst.id] = roundCurrency(instPenalty);
  }

  const totalPenalty = roundCurrency(Object.values(byId).reduce((sum, v) => sum + v, 0));
  return { totalPenalty, installmentPenaltyById: byId };
};
