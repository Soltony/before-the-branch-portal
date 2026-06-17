import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { parseCsvToMappings } from '@/lib/salary-advance';

export async function POST(req: Request) {
  const form = await req.formData();
  const providerId = String(form.get('providerId') || '');
  const name = String(form.get('name') || '');
  const description = String(form.get('description') || '');
  const icon = String(form.get('icon') || '');
  const isSalaryAdvance = String(form.get('isSalaryAdvance') || 'false') === 'true';
  const advancePercent = form.get('advancePercent') ? Number(form.get('advancePercent')) : null;

  if (!providerId) return NextResponse.json({ error: 'providerId required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!icon) return NextResponse.json({ error: 'icon required' }, { status: 400 });

  let salaryMappingsJson: string | undefined = undefined;
  const file = form.get('salaryFile') as File | null;
  if (isSalaryAdvance && file) {
    const buf = await file.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    const mappings = parseCsvToMappings(text);
    salaryMappingsJson = JSON.stringify(mappings);
  }

  const minLoanVal = form.get('minLoan') ? Number(form.get('minLoan')) : undefined;
  const maxLoanVal = form.get('maxLoan') ? Number(form.get('maxLoan')) : undefined;

  const created = await prisma.loanProduct.create({
    data: {
      providerId,
      name,
      description,
      icon,
      isSalaryAdvance,
      advancePercent: isSalaryAdvance ? advancePercent : null,
      salaryAdvanceMappings: salaryMappingsJson ?? undefined,
      minLoan: isSalaryAdvance ? undefined : minLoanVal,
      maxLoan: isSalaryAdvance ? undefined : maxLoanVal,
      duration: form.get('duration') ? Number(form.get('duration')) : 30,
    }
  });

  return NextResponse.json({ ok: true, product: created });
}
