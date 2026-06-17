
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkLoanEligibility } from '@/actions/eligibility';


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const borrowerId = params.id;
  const { searchParams } = new URL(req.url);
  const providerId = searchParams.get('providerId');

  if (!borrowerId || !providerId) {
    return NextResponse.json({ error: 'Borrower ID and Provider ID are required.' }, { status: 400 });
  }

  try {
    const [borrower, provider] = await Promise.all([
      // Check borrower existence directly.
      prisma.borrower.findUnique({ where: { id: borrowerId } }),
        prisma.loanProvider.findUnique({
            where: { id: providerId },
            include: { products: { where: { status: 'Active' } } }
        })
    ]);

    if (!borrower) {
        return NextResponse.json({ error: 'Borrower not found.' }, { status: 404 });
    }
    
    if (!provider) {
        return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
    }

    if (!provider.products || provider.products.length === 0) {
        return NextResponse.json({ score: 0, limits: [] });
    }

    let overallScore = 0;
    const limits = [];

    for (const product of provider.products) {
        const { score, maxLoanAmount } = await checkLoanEligibility(borrowerId, providerId, product.id);
        // The score should be consistent across products for the same provider, so we can just take the last one.
        overallScore = score;
        limits.push({
            productId: product.id,
            productName: product.name,
            limit: maxLoanAmount
        });
    }

    return NextResponse.json({
        score: overallScore,
        limits: limits
    });

  } catch (error) {
    console.error('Eligibility check failed:', error);
    return NextResponse.json({ error: 'An internal server error occurred during the scoring calculation.' }, { status: 500 });
  }
}
