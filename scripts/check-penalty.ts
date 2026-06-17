import prisma from '../src/lib/prisma';
import { calculateTotalRepayable } from '../src/lib/loan-calculator';

async function run() {
  const loanId = process.argv[2];
  const asOf = process.argv[3]; // optional ISO date string

  if (!loanId) {
    console.error('Usage: npx ts-node scripts/check-penalty.ts <loanId> [asOfDate]');
    process.exit(1);
  }

  const loan = await prisma.loan.findUnique({ where: { id: loanId }, include: { product: true } });
  if (!loan) {
    console.error('Loan not found:', loanId);
    process.exit(1);
  }

  const asOfDate = asOf ? new Date(asOf) : new Date();

  // Load global tax settings for the product's provider (or pass empty array)
  const taxes = await prisma.tax.findMany();

  const result = calculateTotalRepayable(loan as any, loan.product as any, taxes as any, asOfDate);

 

  await prisma.$disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});