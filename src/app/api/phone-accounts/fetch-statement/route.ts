import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { Prisma } from '@prisma/client';
import statementUtils, { StatementLine } from '@/lib/statement-utils';
import { MiniAppAuthError, requireMiniAppAuthContext } from '@/lib/miniapp-auth';

type Body = {
  phoneNumber: string;
  accountNumber: string;
  startDate?: string; // YYYYMMDD
  endDate?: string;   // YYYYMMDD
}

export async function POST(req: Request) {
  try {
    const ctx = await requireMiniAppAuthContext();
    const body: Body = await req.json();
    const { phoneNumber, accountNumber, startDate, endDate } = body;
    if (!phoneNumber || !accountNumber) return NextResponse.json({ error: 'phoneNumber and accountNumber required' }, { status: 400 });

    if (String(phoneNumber) !== String(ctx.borrowerId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Ensure borrower exists
    const borrowerId = String(phoneNumber);
    // Use create with a fallback update to avoid SQL Server race-condition where
    // concurrent upserts can trigger unique constraint failures.
    try {
      await prisma.borrower.create({ data: { id: borrowerId, status: 'Active' } });
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Another concurrent request created the borrower first — ensure status is set
        try {
          await prisma.borrower.update({ where: { id: borrowerId }, data: { status: 'Active' } });
        } catch (err) {
          // swallow update errors — we'll continue
        }
      } else {
        throw e;
      }
    }

    const apiUrl = process.env.EXTERNAL_STATEMENT_URL || process.env.EXTERNAL_CUSTOMER_STATEMENT_URL;
    const user = process.env.EXTERNAL_API_USERNAME;
    const pass = process.env.EXTERNAL_API_PASSWORD;

    if (!apiUrl) return NextResponse.json({ error: 'Missing EXTERNAL_STATEMENT_URL env var' }, { status: 500 });

    const auth = user && pass ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : undefined;

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({ accountNumber, startDate, endDate }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => null);
      console.warn('[phone-accounts][fetch-statement] upstream returned', res.status, txt);

      return NextResponse.json({ error: 'Upstream error', status: res.status, body: txt }, { status: 502 });
    }

    const payload = await res.json().catch(() => null);
    const details = payload?.details ?? payload?.details ?? payload?.details ?? payload?.response ?? payload;

    // Normalize fields from sample
    const d = details?.details ?? details?.detail ?? details?.details ?? details;
    const root = details?.details ? details : details;

    const stmtRoot = payload?.details ?? payload?.details ?? payload?.details ?? payload?.details ?? payload?.details ?? payload?.details ?? payload;

    const statementInfo = payload?.details ?? payload?.details ?? payload;

    // Extract common top-level fields if present
    const customerName = statementInfo?.CustomerName ?? statementInfo?.customerName ?? null;
    const currency = statementInfo?.Currency ?? null;
    const openingBalance = statementInfo?.OpeningBalance ?? null;
    const closingBalance = statementInfo?.ClosingBalance ?? null;

    const statementDetails = statementInfo?.statementDetails ?? statementInfo?.statementDetails ?? statementInfo?.statementDetails ?? [];

    // Upsert AccountStatement (unique per borrower+account+start+end)
    const startKey = startDate ?? '';
    const endKey = endDate ?? '';

    // Prepare raw JSON string
    const raw = JSON.stringify(payload);

    // Try to find existing
    const existing = await prisma.accountStatement.findFirst({ where: { borrowerId, accountNumber, startDate: startKey, endDate: endKey } });
    if (existing) {
      // Update raw and summary fields and replace lines
      await prisma.accountStatementLine.deleteMany({ where: { statementId: existing.id } });
      const updated = await prisma.accountStatement.update({ where: { id: existing.id }, data: { raw, customerName, currency, openingBalance: openingBalance ? String(openingBalance) : null, closingBalance: closingBalance ? String(closingBalance) : null, fetchedAt: new Date() } });
      // insert lines
      const linesToCreate = (statementDetails || []).map((row: any) => ({
        statementId: existing.id,
        bookDate: row.BookDate ?? row.bookDate ?? null,
        reference: row.Reference ?? row.reference ?? null,
        description: row.Description ?? row.description ?? null,
        narrative: row.Narrative != null ? String(row.Narrative) : (row.narrative != null ? String(row.narrative) : null),
        valueDate: row.ValueDate ?? row.valueDate ?? null,
        debit: row.Debit != null ? (Number(String(row.Debit).replace(/[^0-9.-]+/g, '')) || null) : null,
        credit: row.Credit != null ? (Number(String(row.Credit).replace(/[^0-9.-]+/g, '')) || null) : null,
        closingBalance: row.ClosingBalance != null ? (Number(String(row.ClosingBalance).replace(/[^0-9.-]+/g, '')) || null) : null,
      }));
      if (linesToCreate.length > 0) await prisma.accountStatementLine.createMany({ data: linesToCreate });
      return NextResponse.json({ ok: true, updated: true, statementId: updated.id });
    }

    // Create new statement
    const created = await prisma.accountStatement.create({ data: {
      borrowerId,
      accountNumber: String(accountNumber),
      customerName: customerName ?? null,
      currency: currency ?? null,
      openingBalance: openingBalance ? String(openingBalance) : null,
      closingBalance: closingBalance ? String(closingBalance) : null,
      startDate: startKey,
      endDate: endKey,
      raw,
    }});

    // create lines
    const lines = (statementDetails || []).map((row: any) => ({
      statementId: created.id,
      bookDate: row.BookDate ?? row.bookDate ?? null,
      reference: row.Reference ?? row.reference ?? null,
      description: row.Description ?? row.description ?? null,
      narrative: row.Narrative != null ? String(row.Narrative) : (row.narrative != null ? String(row.narrative) : null),
      valueDate: row.ValueDate ?? row.valueDate ?? null,
      debit: row.Debit != null ? (Number(String(row.Debit).replace(/[^0-9.-]+/g, '')) || null) : null,
      credit: row.Credit != null ? (Number(String(row.Credit).replace(/[^0-9.-]+/g, '')) || null) : null,
      closingBalance: row.ClosingBalance != null ? (Number(String(row.ClosingBalance).replace(/[^0-9.-]+/g, '')) || null) : null,
    }));

    if (lines.length > 0) {
      await prisma.accountStatementLine.createMany({ data: lines });
    }

    // Compute derived metrics for the saved statement and persist
    try {
      // Build StatementLine[] for metrics
      const normalizedLines: StatementLine[] = (statementDetails || []).map((row: any) => ({
        bookDate: row.BookDate ?? row.bookDate ?? null,
        valueDate: row.ValueDate ?? row.valueDate ?? null,
        reference: row.Reference ?? row.reference ?? null,
        description: row.Description ?? row.description ?? null,
        narrative: row.Narrative != null ? String(row.Narrative) : (row.narrative != null ? String(row.narrative) : null),
        debit: row.Debit != null ? (Number(String(row.Debit).replace(/[^0-9.-]+/g, '')) || null) : null,
        credit: row.Credit != null ? (Number(String(row.Credit).replace(/[^0-9.-]+/g, '')) || null) : null,
        closingBalance: row.ClosingBalance != null ? (Number(String(row.ClosingBalance).replace(/[^0-9.-]+/g, '')) || null) : null,
      }));

      const metrics = statementUtils.computeMetrics(normalizedLines, startKey, endKey);

      await prisma.accountStatementMetrics.create({ data: {
        borrowerId,
        accountNumber: String(accountNumber),
        periodStart: startKey,
        periodEnd: endKey,
        monthsAtEbirr: metrics.monthsAtEbirr ?? null,
        txCountRelevant: metrics.txCountRelevant ?? null,
        billPaymentsCount: metrics.billPaymentsCount ?? null,
        avgMonthlyDeposit: metrics.avgMonthlyDeposit ?? null,
        avgUniqueDepositSources: metrics.avgUniqueDepositSources ?? null,
        avgMonthlyAirtimeCount: metrics.avgMonthlyAirtimeCount ?? null,
        avgMonthlyAirtimeValue: metrics.avgMonthlyAirtimeValue ?? null,
        withdrawalToDepositRatio: metrics.withdrawalToDepositRatio ?? null,
        avgBalance: metrics.avgBalance ?? null,
        derived: JSON.stringify(metrics.derived ?? {}),
      }});
    } catch (e) {
      console.warn('[phone-accounts][fetch-statement] metrics compute/save failed', e);
    }

    return NextResponse.json({ ok: true, statementId: created.id });

  } catch (err: any) {
    if (err instanceof MiniAppAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[phone-accounts][fetch-statement] error', err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
