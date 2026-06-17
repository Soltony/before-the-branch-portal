import { describe, expect, test } from 'vitest';
import { startOfDay } from 'date-fns';
import { calculateInterestWithPayments, simulateDailyInterestAccrual } from './interest-accrual';

describe('interest accrual', () => {
  test('simple percentage interest reduces after partial principal payment (payment at start-of-day)', () => {
    const loanStartDate = startOfDay(new Date('2026-01-01T10:00:00Z'));
    const interestEndDate = startOfDay(new Date('2026-01-06T10:00:00Z')); // 5 days: 1..5

    const principal = 1000;
    const dailyRatePercent = 0.1; // 0.1% per day

    const result = simulateDailyInterestAccrual({
      principal,
      loanStartDate,
      interestEndDate,
      dailyFeeRule: { type: 'percentage', value: dailyRatePercent, calculationBase: 'principal' },
      serviceFee: 0,
      payments: [
        // pay 500 on Jan 03 start-of-day => principal becomes 500 before Jan 03 interest
        { amount: 500, date: new Date('2026-01-03T12:00:00Z') },
      ],
    });

    expect(result.accruals.map(a => a.interest)).toEqual([1.0, 1.0, 0.5, 0.5, 0.5]);
    expect(calculateInterestWithPayments({
      principal,
      loanStartDate,
      interestEndDate,
      dailyFeeRule: { type: 'percentage', value: dailyRatePercent, calculationBase: 'principal' },
      serviceFee: 0,
      payments: [{ amount: 500, date: new Date('2026-01-03T12:00:00Z') }],
    })).toBe(3.5);
  });

  test('compound interest is reduced when accrued interest is paid before accrual', () => {
    const loanStartDate = startOfDay(new Date('2026-01-01T00:00:00Z'));
    const interestEndDate = startOfDay(new Date('2026-01-03T00:00:00Z')); // 2 days

    const principal = 1000;
    const dailyRatePercent = 1; // 1% per day

    // Pay 10 on day 2, which should pay the day-1 accrued interest first.
    const total = calculateInterestWithPayments({
      principal,
      loanStartDate,
      interestEndDate,
      dailyFeeRule: { type: 'percentage', value: dailyRatePercent, calculationBase: 'compound' },
      serviceFee: 0,
      payments: [{ amount: 10, date: new Date('2026-01-02T08:00:00Z') }],
    });

    // Day1: 1000 * 1% = 10.00 (base becomes 1010)
    // Day2: payment 10 pays accrued interest => base returns to 1000 before interest => 10.00
    expect(total).toBe(20.0);
  });
});
