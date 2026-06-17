import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { format } from 'date-fns';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const borrowerId = params.id;

  if (!borrowerId) {
    return NextResponse.json({ error: 'Borrower ID is required.' }, { status: 400 });
  }

  try {
    const loans = await prisma.loan.findMany({
      where: { borrowerId: borrowerId },
      include: {
        product: true,
        payments: {
          orderBy: {
            date: 'asc'
          }
        },
      },
      orderBy: {
        disbursedDate: 'asc',
      },
    });

    const transactions = [];

    for (const loan of loans) {
      // Loan Disbursement
      transactions.push({
        date: format(new Date(loan.disbursedDate), 'yyyy-MM-dd'),
        description: `Loan disbursement for ${loan.product.name}`,
        amount: loan.loanAmount,
      });

      // Repayments for that loan
      for (const payment of loan.payments) {
        transactions.push({
          date: format(new Date(payment.date), 'yyyy-MM-dd'),
          description: 'Repayment',
          amount: -payment.amount, // Repayments are negative
        });
      }
    }
    
    // Sort all transactions by date
    transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());


    return NextResponse.json(transactions);

  } catch (error) {
    console.error('Failed to fetch transactions for borrower:', error);
    return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
  }
}
