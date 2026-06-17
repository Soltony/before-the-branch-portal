
import { Logo } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { LoanProvider, FeeRule, PenaltyRule, Tax } from '@/lib/types';
import { ApplyClient } from './client';
import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';

const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
};

async function getProvider(providerId: string): Promise<LoanProvider | null> {
    const provider = await prisma.loanProvider.findUnique({
        where: { id: providerId },
        include: {
            products: {
                where: {
                    status: 'Active'
                },
                orderBy: {
                    name: 'asc'
                }
            }
        }
    });

    if (!provider) return null;

    return {
        id: provider.id,
        name: provider.name,
        icon: provider.icon,
        colorHex: provider.colorHex,
        displayOrder: provider.displayOrder,
        accountNumber: provider.accountNumber,
        startingCapital: provider.startingCapital,
        initialBalance: provider.initialBalance,
        allowCrossProviderLoans: provider.allowCrossProviderLoans,
        nplThresholdDays: provider.nplThresholdDays,
        products: provider.products.map(prod => ({
            ...prod,
            serviceFee: safeJsonParse(prod.serviceFee, { type: 'percentage', value: 0 }) as FeeRule,
            dailyFee: safeJsonParse(prod.dailyFee, { type: 'percentage', value: 0 }) as FeeRule,
            penaltyRules: safeJsonParse(prod.penaltyRules, []) as PenaltyRule[],
        }))
    } as LoanProvider;
}

async function getTaxConfigs(): Promise<Tax[] | null> {
    return await prisma.tax.findMany();
}


export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const sp = await searchParams;
    const rawProviderId = sp?.providerId;
    const providerId = Array.isArray(rawProviderId) ? rawProviderId[0] : rawProviderId;

    if (!providerId || typeof providerId !== 'string') {
        notFound();
    }
    
    const [selectedProvider, taxConfigs] = await Promise.all([
        getProvider(providerId),
        getTaxConfigs()
    ]);


    if (!selectedProvider) {
        return (
             <div className="flex flex-col min-h-screen bg-background items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center">
                    <Logo className="h-12 w-12 text-destructive" />
                    <h2 className="text-xl font-semibold">Provider Not Found</h2>
                    <p className="text-muted-foreground max-w-sm">The loan provider you selected could not be found. It may no longer be available.</p>
                    <Button asChild>
                        <a href="/loan">Go Back to Dashboard</a>
                    </Button>
                </div>
            </div>
        )
    }

    return <ApplyClient provider={selectedProvider} taxConfigs={taxConfigs} />;
}
