import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { MiniAppAuthError, requireMiniAppAuthContext } from '@/lib/miniapp-auth';

// GET /api/phone-accounts?phoneNumber=...
export async function GET(req: Request) {
  try {
    const ctx = await requireMiniAppAuthContext();
    const url = new URL(req.url);
    const phoneNumber = url.searchParams.get('phoneNumber');
    console.info(`[phone-accounts][GET] phoneNumber=${phoneNumber}`);
    if (!phoneNumber) return NextResponse.json({ error: 'phoneNumber is required' }, { status: 400 });

    if (String(phoneNumber) !== String(ctx.borrowerId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const items = await prisma.phoneAccount.findMany({
      where: { phoneNumber },
      orderBy: { isActive: 'desc' },
    });

    console.info(`[phone-accounts][GET] found ${items.length} associations for ${phoneNumber}`);

    return NextResponse.json(items);
  } catch (err: any) {
    if (err instanceof MiniAppAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}

// POST /api/phone-accounts
// body: { phoneNumber, accountNumber, customerName, isActive }
export async function POST(req: Request) {
  try {
    const ctx = await requireMiniAppAuthContext();
    const body = await req.json();
    console.info('[phone-accounts][POST] body=', body);
    const { phoneNumber, accountNumber, customerName, isActive } = body;
    if (!phoneNumber || !accountNumber) return NextResponse.json({ error: 'phoneNumber and accountNumber are required' }, { status: 400 });

    if (String(phoneNumber) !== String(ctx.borrowerId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const accNum = String(accountNumber);

    // If setting active, deactivate others for this phone first
    return await prisma.$transaction(async (tx) => {
      if (isActive) {
        console.info(`[phone-accounts][POST] deactivating other accounts for ${phoneNumber}`);
        await tx.phoneAccount.updateMany({ where: { phoneNumber }, data: { isActive: false } });
      }

      const upserted = await tx.phoneAccount.upsert({
        where: { phoneNumber_accountNumber: { phoneNumber, accountNumber: accNum } },
        update: { customerName, isActive: !!isActive },
        create: { phoneNumber, accountNumber: accNum, customerName, isActive: !!isActive },
      });

      console.info('[phone-accounts][POST] upserted=', upserted);

      return NextResponse.json(upserted);
    });
  } catch (err: any) {
    if (err instanceof MiniAppAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[phone-accounts][POST] error', err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}

// PATCH /api/phone-accounts
// body: { phoneNumber, accountNumber } -> sets that account as active and deactivates others
export async function PATCH(req: Request) {
  try {
    const ctx = await requireMiniAppAuthContext();
    const body = await req.json();
    console.info('[phone-accounts][PATCH] body=', body);
    const { phoneNumber, accountNumber } = body;
    if (!phoneNumber || !accountNumber) return NextResponse.json({ error: 'phoneNumber and accountNumber are required' }, { status: 400 });

    if (String(phoneNumber) !== String(ctx.borrowerId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const accNum = String(accountNumber);

    const result = await prisma.$transaction(async (tx) => {
      console.info(`[phone-accounts][PATCH] deactivating others for ${phoneNumber}`);
      await tx.phoneAccount.updateMany({ where: { phoneNumber }, data: { isActive: false } });
      const updated = await tx.phoneAccount.update({
        where: { phoneNumber_accountNumber: { phoneNumber, accountNumber: accNum } },
        data: { isActive: true },
      });
      console.info('[phone-accounts][PATCH] updated=', updated);
      return updated;
    });

    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof MiniAppAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[phone-accounts][PATCH] error', err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
