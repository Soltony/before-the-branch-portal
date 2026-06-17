import { startOfDay } from 'date-fns';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import type { LoanDetails, LoanProduct, Tax } from '@/lib/types';

// Minimal runnable example: daily fee with a mid-period partial repayment
async function main() {
  const product: LoanProduct = {
    id: 'p1',
    providerId: 'prov1',
    name: 'Example Product',
    description: 'Example',
    icon: '',
    duration: 10,
    status: 'Active',
    serviceFee: { type: 'fixed', value: 0 },
    serviceFeeEnabled: false,
    dailyFee: { type: 'percentage', value: 0.1, calculationBase: 'principal' },
    dailyFeeEnabled: true,
    penaltyRules: [],
    penaltyRulesEnabled: false,
    dataProvisioningEnabled: false,
    requiredDocuments: [],
  } as any;

  const loan: LoanDetails = {
    id: 'L1',
    borrowerId: 'B1',
    providerName: 'Provider',
    productName: product.name,
    loanAmount: 1000,
    serviceFee: 0,
    disbursedDate: new Date('2026-01-01T10:00:00Z'),
    dueDate: new Date('2026-01-10T10:00:00Z'),
    repaymentStatus: 'Unpaid',
    repaidAmount: 0,
    payments: [
      { id: 'P1', amount: 500, date: new Date('2026-01-03T12:00:00Z') },
    ],
    penaltyAmount: 0,
    product,
  };

  const taxConfigs: Tax[] = [];

  const asOf = startOfDay(new Date('2026-01-06T00:00:00Z'));
  const result = calculateTotalRepayable(loan, product, taxConfigs, asOf);

  // For 5 days (Jan 1..5): interest should be 1.00 + 1.00 + 0.50 + 0.50 + 0.50 = 3.50
  console.log('asOf:', asOf.toISOString().slice(0, 10));
  console.log(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
