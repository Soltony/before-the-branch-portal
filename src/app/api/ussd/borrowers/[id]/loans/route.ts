
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import type { LoanDetails, LoanProduct } from '@/lib/types';


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const borrowerId = params.id;

  if (!borrowerId) {
    return NextResponse.json({ error: 'Borrower ID is required.' }, { status: 400 });
  }

  try {
    const [loans, taxConfigs] = await Promise.all([
        prisma.loan.findMany({
            where: { borrowerId: borrowerId },
            include: {
                product: true,
            },
            orderBy: {
                disbursedDate: 'desc',
            },
        }),
        prisma.tax.findMany()
    ]);

    const formattedLoans = loans.map(loan => {
      // The loan.product from prisma might have fee/penalty rules as JSON strings.
      // The calculator expects them to be parsed objects.
      const parsedProduct: LoanProduct = {
          ...loan.product,
          serviceFee: typeof loan.product.serviceFee === 'string' ? JSON.parse(loan.product.serviceFee) : loan.product.serviceFee,
          dailyFee: typeof loan.product.dailyFee === 'string' ? JSON.parse(loan.product.dailyFee) : loan.product.dailyFee,
          penaltyRules: typeof loan.product.penaltyRules === 'string' ? JSON.parse(loan.product.penaltyRules) : loan.product.penaltyRules,
      };

      // Use the centralized calculator with the fully parsed product data
      const { total } = calculateTotalRepayable(loan as any, parsedProduct, taxConfigs, new Date(), true);
      const totalRepayable = total;

      return {
        id: loan.id,
        providerId: loan.product.providerId,
        productId: loan.productId,
        productName: loan.product.name,
        loanAmount: loan.loanAmount,
        totalRepayableAmount: totalRepayable, // Add the calculated total
        repaidAmount: loan.repaidAmount || 0,
        penaltyAmount: loan.penaltyAmount,
        dueDate: loan.dueDate,
        repaymentStatus: loan.repaymentStatus,
      }
    });

    return NextResponse.json(formattedLoans);

  } catch (error) {
    console.error('Failed to fetch loans for borrower:', error);
    return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
  }
}
