import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 });

  const config = await prisma.loanCycleConfig.findUnique({ where: { productId } });
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await req.json();
    const { productId, metric, enabled, cycleRanges, grades } = body;

    if (!productId || !metric) return NextResponse.json({ error: 'productId and metric are required' }, { status: 400 });

    // Basic shape validation
    if (cycleRanges && !Array.isArray(cycleRanges)) return NextResponse.json({ error: 'cycleRanges must be an array' }, { status: 400 });
    if (grades && !Array.isArray(grades)) return NextResponse.json({ error: 'grades must be an array' }, { status: 400 });

    // If both provided, ensure grade percentage arrays align with cycleRanges length
    if (cycleRanges && grades) {
      const expectedLen = cycleRanges.length;
      for (const g of grades) {
        if (!Array.isArray(g.percentages) || g.percentages.length !== expectedLen) {
          return NextResponse.json({ error: 'Each grade must have a percentages array matching the length of cycleRanges' }, { status: 400 });
        }
      }
    }

    // if exists update else create
    const existing = await prisma.loanCycleConfig.findUnique({ where: { productId } });
    let result;
    if (existing) {
      result = await prisma.loanCycleConfig.update({ where: { id: existing.id }, data: { metric, enabled: enabled ?? true, cycleRanges: cycleRanges ? JSON.stringify(cycleRanges) : undefined, grades: grades ? JSON.stringify(grades) : undefined } });
    } else {
      result = await prisma.loanCycleConfig.create({ data: { productId, metric, enabled: enabled ?? true, cycleRanges: cycleRanges ? JSON.stringify(cycleRanges) : JSON.stringify([]), grades: grades ? JSON.stringify(grades) : JSON.stringify([]) } });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error updating loan cycle config', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
