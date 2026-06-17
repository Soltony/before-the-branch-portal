import prisma from '@/lib/prisma';
import { differenceInDays, startOfDay } from 'date-fns';
import { calculateTotalRepayable } from '@/lib/loan-calculator';

export interface NplBorrowerAggregate {
    borrowerId: string;
    borrowerName: string;
    accountNumber: string;
    providerName: string;
    daysOverdue: number;
    principalOutstanding: number;
    interestOutstanding: number;
    serviceFeeOutstanding: number;
    penaltyOutstanding: number;
    totalOutstanding: number;
}

function getBorrowerNameFromProvisioned(pdRaw: string | undefined | null): string | null {
    if (!pdRaw) return null;
    try {
        const pd = JSON.parse(pdRaw as string);
        const nameKeys = ['FullName', 'fullName', 'fullname', 'name', 'customerName', 'CustomerName'];
        for (const k of nameKeys) {
            if (pd[k]) return String(pd[k]);
        }
        for (const v of Object.values(pd)) {
            if (typeof v === 'string' && v.length > 2) return v;
        }
    } catch {
        /* ignore */
    }
    return null;
}

/**
 * Same dataset as GET /api/npl-borrowers: borrowers flagged NPL with unpaid loans,
 * aggregated per borrower + loan provider with outstanding balances.
 */
export async function getNplBorrowerAggregates(asOf: Date = new Date()): Promise<NplBorrowerAggregate[]> {
    const today = startOfDay(asOf);

    const nplLoans = await prisma.loan.findMany({
        where: {
            borrower: { status: 'NPL' },
            repaymentStatus: 'Unpaid',
        },
        select: {
            id: true,
            borrowerId: true,
            productId: true,
            dueDate: true,
            disbursedDate: true,
            loanAmount: true,
            repaidAmount: true,
            installments: true,
            payments: true,
        },
    });

    if (nplLoans.length === 0) return [];

    const uniqueBorrowerIds = Array.from(new Set(nplLoans.map((l) => l.borrowerId)));
    const uniqueProductIds = Array.from(new Set(nplLoans.map((l) => l.productId)));

    const [phoneAccounts, borrowers, products, taxConfigs] = await Promise.all([
        prisma.phoneAccount.findMany({
            where: { phoneNumber: { in: uniqueBorrowerIds }, isActive: true },
            select: { phoneNumber: true, accountNumber: true, customerName: true },
        }),
        prisma.borrower.findMany({
            where: { id: { in: uniqueBorrowerIds } },
            include: {
                provisionedData: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
        }),
        prisma.loanProduct.findMany({
            where: { id: { in: uniqueProductIds } },
            include: { provider: true },
        }),
        prisma.tax.findMany(),
    ]);

    const phoneMap = new Map(
        phoneAccounts.map((p) => [p.phoneNumber, { accountNumber: p.accountNumber, customerName: p.customerName }])
    );
    const productMap = new Map(products.map((p) => [p.id, p]));
    const borrowerMap = new Map(borrowers.map((b) => [b.id, b]));

    const result: NplBorrowerAggregate[] = [];
    const aggregation: Record<string, NplBorrowerAggregate> = {};

    for (const loan of nplLoans) {
        const borrower = borrowerMap.get(loan.borrowerId);
        const product = productMap.get(loan.productId);
        if (!borrower || !product) continue;

        const provider = product.provider;
        const key = `${borrower.id}_${provider.id}`;

        if (!aggregation[key]) {
            const pdRaw = borrower.provisionedData?.[0]?.data;
            const phoneInfo = phoneMap.get(borrower.id);

            const borrowerName = phoneInfo?.customerName || getBorrowerNameFromProvisioned(pdRaw) || borrower.id;

            let borrowerAccount = '';
            if (phoneInfo?.accountNumber) {
                borrowerAccount = phoneInfo.accountNumber;
            } else if (pdRaw) {
                try {
                    const pd = JSON.parse(pdRaw as string);
                    const candidate =
                        pd.AccountNumber ??
                        pd.accountNumber ??
                        pd.account_number ??
                        pd.accountNo ??
                        pd.account_no ??
                        null;
                    if (candidate) borrowerAccount = String(candidate);
                } catch {
                    /* ignore */
                }
            }

            aggregation[key] = {
                borrowerId: borrower.id,
                borrowerName,
                accountNumber: borrowerAccount,
                providerName: provider.name,
                daysOverdue: 0,
                principalOutstanding: 0,
                interestOutstanding: 0,
                serviceFeeOutstanding: 0,
                penaltyOutstanding: 0,
                totalOutstanding: 0,
            };
        }

        const { total, principal, interest, penalty, serviceFee } = calculateTotalRepayable(
            loan as any,
            product as any,
            taxConfigs,
            today,
            true
        );

        const totalRepaid = loan.repaidAmount || 0;
        const totalOutstanding = Math.max(0, total - totalRepaid);

        if (totalOutstanding <= 0.01) continue;

        const daysOverdue = Math.max(0, differenceInDays(today, loan.dueDate));
        if (daysOverdue > aggregation[key].daysOverdue) {
            aggregation[key].daysOverdue = daysOverdue;
        }

        const penaltyPaid = Math.min(totalRepaid, penalty);
        const penaltyOutstanding = penalty - penaltyPaid;

        const serviceFeePaid = Math.min(Math.max(0, totalRepaid - penalty), serviceFee);
        const serviceFeeOutstanding = serviceFee - serviceFeePaid;

        const interestPaid = Math.min(Math.max(0, totalRepaid - penalty - serviceFee), interest);
        const interestOutstanding = interest - interestPaid;

        const principalPaid = Math.max(0, totalRepaid - penalty - serviceFee - interest);
        const principalOutstanding = principal - principalPaid;

        aggregation[key].principalOutstanding += principalOutstanding;
        aggregation[key].interestOutstanding += interestOutstanding;
        aggregation[key].serviceFeeOutstanding += serviceFeeOutstanding;
        aggregation[key].penaltyOutstanding += penaltyOutstanding;
        aggregation[key].totalOutstanding += totalOutstanding;
    }

    for (const pg of Object.values(aggregation)) {
        pg.totalOutstanding =
            pg.principalOutstanding +
            pg.interestOutstanding +
            pg.serviceFeeOutstanding +
            pg.penaltyOutstanding;
        result.push(pg);
    }

    return result;
}
