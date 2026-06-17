import prisma from './prisma';

export async function getSalaryEntryForProduct(productId: string, accountNumber: string) {
  if (!productId || !accountNumber) return null;
  const p = await prisma.loanProduct.findUnique({ where: { id: productId } });
  if (!p || !p.isSalaryAdvance || !p.salaryAdvanceMappings) return null;
  try {
    const mappings = JSON.parse(p.salaryAdvanceMappings as string) as Array<any>;
    return mappings.find(m => String(m.accountNumber) === String(accountNumber)) || null;
  } catch (e) {
    console.error('Failed to parse salaryAdvanceMappings', e);
    return null;
  }
}

export function computeAllowedFromSalary(salary: number, productPercent?: number, productCap?: number) {
  if (!salary || !productPercent) return 0;
  const allowed = (salary * productPercent) / 100;
  return productCap ? Math.min(allowed, productCap) : allowed;
}

export function parseCsvToMappings(csvText: string) {
  // very small CSV parser assuming header row and comma-separated values
  const lines = csvText.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cols = line.split(',');
    const obj: any = {};
    headers.forEach((h, i) => obj[h] = cols[i] ? cols[i].trim() : '');
    return obj;
  });
  return rows.map((r: any) => ({
    accountNumber: String(r.accountNumber || r.account || r.acct || r.account_no || ''),
    salary: Number(r.salary || r.Salary || r.amount || 0)
  })).filter((r: any) => r.accountNumber);
}
