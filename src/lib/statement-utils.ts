// Helper utilities and keyword lists for classifying and computing statement metrics
export const KEYWORDS = {
  ebirr: ['ebirr', 'e-birr', 'telebirr', 'tele-birr', 'telebirr debit', 'telebirr credit'],
  airtime: ['airtime', 'topup', 'telebirr', 'ethio telecom airtime', 'airtime dr'],
  biller: ['bill', 'payment', 'biller', 'electricity', 'water', 'internet', 'tv', 'dth'],
  withdrawal: ['atm', 'withdrawal', 'cash out', 'cashout', 'cash', 'atm withdrawal'],
};

function normText(s: any) {
  if (s == null) return '';
  return String(s).toLowerCase();
}

export function containsKeyword(...texts: any[]) {
  const joined = texts.map(normText).join(' ');
  return (arr: string[]) => arr.some(k => joined.includes(k));
}

export function parseNumber(v: any): number | null {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  if (isNaN(n)) return null;
  return n;
}

export function monthKeyFromDateString(s: string | null | undefined) {
  if (!s) return null;
  // Expect formats like '04 AUG 25' or '20250101'
  // Try YYYYMMDD first
  if (/^\d{8}$/.test(s)) {
    return s.slice(0,6); // YYYYMM
  }
  // Try parse with Date
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  // Fallback: try extract year from two-digit year
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const mon = new Date(`${m[2]} 1, 2000`).getMonth();
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return `${year}${String(mon+1).padStart(2,'0')}`;
  }
  return null;
}

export function iqrFilter(values: number[]) {
  if (!values || values.length === 0) return { min: -Infinity, max: Infinity };
  const sorted = values.slice().sort((a,b)=>a-b);
  const q1 = sorted[Math.floor((sorted.length-1)*0.25)];
  const q3 = sorted[Math.floor((sorted.length-1)*0.75)];
  const iqr = q3 - q1;
  const min = q1 - 1.5*iqr;
  const max = q3 + 1.5*iqr;
  return { min, max };
}

export type StatementLine = {
  bookDate?: string | null;
  valueDate?: string | null;
  reference?: string | null;
  description?: string | null;
  narrative?: string | null;
  debit?: number | null;
  credit?: number | null;
  closingBalance?: number | null;
};

export function computeMetrics(lines: StatementLine[], periodStart: string, periodEnd: string) {
  // Group lines by month key
  const isEbirr = containsKeyword;
  const isAirtime = containsKeyword;
  const isBiller = containsKeyword;
  const isWithdrawal = containsKeyword;

  const monthsSetForE = new Set<string>();

  const monthTo = new Map<string, { credits: number[]; creditSources: Set<string>; airtimeCount: number; airtimeValue: number; balances: number[]; withdrawals: number[]; }>();

  for (const row of lines) {
    const month = monthKeyFromDateString(row.valueDate ?? row.bookDate ?? null);
    if (!month) continue;
    const entry = monthTo.get(month) ?? { credits: [], creditSources: new Set(), airtimeCount: 0, airtimeValue: 0, balances: [], withdrawals: [] };

    const txtFields = [row.reference, row.description, row.narrative];
    if (isEbirr(...txtFields)(KEYWORDS.ebirr)) monthsSetForE.add(month);

    const credit = row.credit ?? null;
    const debit = row.debit ?? null;

    if (credit != null && credit > 0) {
      entry.credits.push(credit);
      // source key: reference|narrative|description
      const src = (String(row.reference ?? row.narrative ?? row.description ?? '')).replace(/\s+/g,' ').slice(0,200);
      if (src) entry.creditSources.add(src);
    }

    if (isAirtime(...txtFields)(KEYWORDS.airtime)) {
      entry.airtimeCount += 1;
      entry.airtimeValue += (credit ?? 0) + (debit ?? 0);
    }

    if ((row.closingBalance != null) && !isNaN(Number(row.closingBalance))) {
      entry.balances.push(Number(row.closingBalance));
    }

    if (debit != null && debit > 0) {
      // treat debits as withdrawals for ratio
      entry.withdrawals.push(debit);
    }

    monthTo.set(month, entry);
  }

  // Consider last 6 months by sorting month keys descending and taking up to 6
  const months = Array.from(monthTo.keys()).sort().slice(-6);

  // Months at e-birr
  const monthsAtEbirr = Array.from(monthsSetForE).filter(m => months.includes(m)).length;

  // Number of transactions (excluding cash out, and excluding credits < 50) - approximate
  let txCountRelevant = 0;
  let billPaymentsCount = 0;
  const monthlyDepositTotals: number[] = [];
  const uniqueDepositSourcesPerMonth: number[] = [];
  const monthlyAirtimeCounts: number[] = [];
  const monthlyAirtimeValues: number[] = [];
  const balancesAll: number[] = [];
  let totalWithdrawals = 0;
  let totalDeposits = 0;

  for (const m of months) {
    const e = monthTo.get(m)!;
    const creditsFiltered = e.credits.filter(c => c >= 50);
    txCountRelevant += creditsFiltered.length;

    // bill payments (approx): count creditSources that match biller keywords
    let bills = 0;
    for (const s of e.creditSources) {
      const low = s.toLowerCase();
      if (KEYWORDS.biller.some(k => low.includes(k))) bills++;
    }
    billPaymentsCount += bills;

    const monthlyTotal = e.credits.reduce((a,b)=>a+(b||0),0);
    monthlyDepositTotals.push(monthlyTotal);
    totalDeposits += monthlyTotal;

    uniqueDepositSourcesPerMonth.push(e.creditSources.size || 0);

    monthlyAirtimeCounts.push(e.airtimeCount || 0);
    monthlyAirtimeValues.push(e.airtimeValue || 0);

    balancesAll.push(...e.balances);

    totalWithdrawals += e.withdrawals.reduce((a,b)=>a+(b||0),0);
  }

  const { min: depositMin, max: depositMax } = iqrFilter(monthlyDepositTotals.filter(v=>v!=null));
  const cleanedMonthlyTotals = monthlyDepositTotals.filter(v => v >= depositMin && v <= depositMax);
  const avgMonthlyDeposit = cleanedMonthlyTotals.length ? cleanedMonthlyTotals.reduce((a,b)=>a+b,0)/cleanedMonthlyTotals.length : 0;

  const avgUniqueDepositSources = uniqueDepositSourcesPerMonth.length ? uniqueDepositSourcesPerMonth.reduce((a,b)=>a+b,0)/uniqueDepositSourcesPerMonth.length : 0;

  const avgMonthlyAirtimeCount = monthlyAirtimeCounts.length ? monthlyAirtimeCounts.reduce((a,b)=>a+b,0)/monthlyAirtimeCounts.length : 0;
  const avgMonthlyAirtimeValue = monthlyAirtimeValues.length ? monthlyAirtimeValues.reduce((a,b)=>a+b,0)/monthlyAirtimeValues.length : 0;

  const withdrawalToDepositRatio = totalDeposits > 0 ? (totalWithdrawals / totalDeposits) : null;

  const { min: balMin, max: balMax } = iqrFilter(balancesAll.filter(v=>v!=null));
  const cleanedBalances = balancesAll.filter(v => v >= balMin && v <= balMax);
  const avgBalance = cleanedBalances.length ? cleanedBalances.reduce((a,b)=>a+b,0)/cleanedBalances.length : null;

  return {
    monthsAtEbirr,
    txCountRelevant,
    billPaymentsCount,
    avgMonthlyDeposit,
    avgUniqueDepositSources,
    avgMonthlyAirtimeCount,
    avgMonthlyAirtimeValue,
    withdrawalToDepositRatio,
    avgBalance,
    derived: {
      monthsConsidered: months,
      monthlyDepositTotals,
      monthlyAirtimeCounts,
      monthlyAirtimeValues,
    }
  };
}

export default { KEYWORDS, computeMetrics };
