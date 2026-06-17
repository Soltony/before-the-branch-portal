
'use server';
/**
 * @fileOverview Implements a loan eligibility check and credit scoring.
 *
 * - checkLoanEligibility - First checks for basic eligibility, then calculates a credit score to determine the maximum loan amount.
 * - recalculateScoreAndLoanLimit - Calculates a credit score for a given provider and returns the max loan amount.
 */

import prisma from '@/lib/prisma';
import { getSalaryEntryForProduct, computeAllowedFromSalary } from '@/lib/salary-advance';
import { evaluateCondition } from '@/lib/utils';
import { getPhoneNumbersForAccount } from '@/lib/account-utils';
import type { ScoringParameter as ScoringParameterType } from '@/lib/types';
import { Loan, LoanProduct, Prisma } from '@prisma/client';


// Helper to convert strings to camelCase
const toCamelCase = (str: string) => {
    if (!str) return '';
    // This regex handles various separators (space, underscore, hyphen) and capitalizes the next letter.
    return str.replace(/[^a-zA-Z0-9]+(.)?/g, (match, chr) => chr ? chr.toUpperCase() : '').replace(/^./, (match) => match.toLowerCase());
};

async function getBorrowerDataForScoring(
    borrowerId: string, 
    providerId: string, 
): Promise<Record<string, any>> {

    // Borrowers are identified by phone number in the mini-app/USSD flows.
    // Some provisioned datasets (e.g., salary lists) may be uploaded keyed by AccountNumber.
    // To make scoring consistent, also merge provisioned data keyed by the borrower's active account.
    const activeAccount = await prisma.phoneAccount.findFirst({
        where: { phoneNumber: borrowerId, isActive: true },
        select: { accountNumber: true },
    });

    // Get all phone numbers linked to this account to support phone number changes
    // This ensures we find provisioned data and account info even after phone number update
    const allPhoneNumbersForAccount = await getPhoneNumbersForAccount(borrowerId);

    const borrowerIdsToFetch = Array.from(
        new Set([...allPhoneNumbersForAccount, activeAccount?.accountNumber].filter((v): v is string => Boolean(v && String(v).trim())))
    );

    // Load provisioned data for:
    // - ExternalCustomerInfo across all providers (shared customer info)
    // - any provider-scoped provisioning for the requested provider
    const provisionedDataEntries = await prisma.provisionedData.findMany({
        where: {
            borrowerId: { in: borrowerIdsToFetch },
            OR: [
                { config: { name: 'ExternalCustomerInfo' } },
                { config: { providerId } },
            ],
        },
        include: { config: true },
        orderBy: { createdAt: 'desc' },
    });


    const combinedData: Record<string, any> = { id: borrowerId };
    
    for (const entry of provisionedDataEntries) {
        try {
            const parsed = JSON.parse(entry.data as string);
            // Some payloads are stored as { detail: { ...fields } } (from external API)
            // while others may be flat objects. Normalize by preferring `detail` when present.
            const sourceContent = (parsed && typeof parsed === 'object' && parsed.detail && typeof parsed.detail === 'object') ? parsed.detail : parsed;

            const standardizedData: Record<string, any> = {};
            for (const key in sourceContent) {
                if (!Object.prototype.hasOwnProperty.call(sourceContent, key)) continue;
                let val = sourceContent[key];
                // Convert numeric-like strings to numbers so rules comparing numbers work.
                if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) {
                    const maybeNum = Number(val);
                    // Only coerce if the string is an integer or float representation
                    if (String(maybeNum) === val.trim() || /^\d+(\.\d+)?$/.test(val.trim())) {
                        val = maybeNum;
                    }
                }
                standardizedData[toCamelCase(key)] = val;
            }

            for (const key in standardizedData) {
                if (!Object.prototype.hasOwnProperty.call(combinedData, key)) {
                    combinedData[key] = standardizedData[key];
                }
            }
        } catch (e) {
            console.error(`Failed to parse data for entry ${entry.id}:`, e);
        }
    }
    // Merge latest account statement metrics for borrower (if any)
    // Check all phone numbers linked to this account to find metrics after phone changes
    try {
        const metric = await prisma.accountStatementMetrics.findFirst({
            where: { borrowerId: { in: allPhoneNumbersForAccount } },
            orderBy: { computedAt: 'desc' }
        });
        if (metric) {
            // Expose metric fields as top-level properties for scoring rules
            const m = metric as any;
            combinedData['monthsAtEbirr'] = m.monthsAtEbirr ?? combinedData['monthsAtEbirr'];
            combinedData['txCountRelevant'] = m.txCountRelevant ?? combinedData['txCountRelevant'];
            combinedData['billPaymentsCount'] = m.billPaymentsCount ?? combinedData['billPaymentsCount'];
            combinedData['avgMonthlyDeposit'] = m.avgMonthlyDeposit ?? combinedData['avgMonthlyDeposit'];
            combinedData['avgUniqueDepositSources'] = m.avgUniqueDepositSources ?? combinedData['avgUniqueDepositSources'];
            combinedData['avgMonthlyAirtimeCount'] = m.avgMonthlyAirtimeCount ?? combinedData['avgMonthlyAirtimeCount'];
            combinedData['avgMonthlyAirtimeValue'] = m.avgMonthlyAirtimeValue ?? combinedData['avgMonthlyAirtimeValue'];
            combinedData['withdrawalToDepositRatio'] = m.withdrawalToDepositRatio ?? combinedData['withdrawalToDepositRatio'];
            combinedData['avgBalance'] = m.avgBalance ?? combinedData['avgBalance'];
            try { combinedData['accountMetricsRaw'] = JSON.parse(m.derived || '{}'); } catch(e) { combinedData['accountMetricsRaw'] = m.derived || {}; }
        }
    } catch (e) {
        console.error('Failed to load account statement metrics for scoring:', e);
    }
    
    // Fetch all previous loans across all phone numbers linked to this account
    // This ensures credit history is visible even after phone number changes
    const previousLoans = await prisma.loan.findMany({
        where: { borrowerId: { in: allPhoneNumbersForAccount } },
        select: { repaymentBehavior: true },
    });

    combinedData['totalLoansCount'] = previousLoans.length;
    combinedData['loansOnTime'] = previousLoans.filter(l => l.repaymentBehavior === 'ON_TIME').length;
    combinedData['loansLate'] = previousLoans.filter(l => l.repaymentBehavior === 'LATE').length;
    combinedData['loansEarly'] = previousLoans.filter(l => l.repaymentBehavior === 'EARLY').length;
    
    // Fetch the latest Top-5 repayment transactions (combined across loans) and compute counts by category
    // Check payments across all phone numbers linked to this account for complete history
    try {
        const recentPayments = await prisma.payment.findMany({
            where: { loan: { is: { borrowerId: { in: allPhoneNumbersForAccount } } } },
            include: { loan: { select: { dueDate: true } } },
            orderBy: { date: 'desc' },
            take: 5,
        });

        const recentCounts = { loansOnTimeTop5: 0, loansLateTop5: 0, loansEarlyTop5: 0 };
        recentPayments.forEach(p => {
            try {
                const { startOfDay, isBefore, isEqual } = require('date-fns');
                const due = p.loan?.dueDate ? startOfDay(new Date(p.loan.dueDate)) : null;
                const paid = startOfDay(new Date(p.date));
                if (due) {
                    if (isBefore(paid, due)) recentCounts.loansEarlyTop5++;
                    else if (isEqual(paid, due)) recentCounts.loansOnTimeTop5++;
                    else recentCounts.loansLateTop5++;
                }
            } catch (e) {
                // ignore malformed dates for a single payment
            }
        });

        combinedData['loansOnTimeTop5'] = recentCounts.loansOnTimeTop5;
        combinedData['loansLateTop5'] = recentCounts.loansLateTop5;
        combinedData['loansEarlyTop5'] = recentCounts.loansEarlyTop5;
    } catch (e) {
        console.error('Failed to fetch recent payments for top-5 scoring:', e);
        combinedData['loansOnTimeTop5'] = 0;
        combinedData['loansLateTop5'] = 0;
        combinedData['loansEarlyTop5'] = 0;
    }
    
    return combinedData;
}


async function calculateScoreForProvider(
    borrowerId: string,
    providerId: string,
): Promise<number> {
    
    const borrowerDataForScoring = await getBorrowerDataForScoring(borrowerId, providerId);
    
    const parameters: ScoringParameterType[] = await prisma.scoringParameter.findMany({
        where: { providerId },
        include: {
            rules: true,
        },
    });
    
    if (parameters.length === 0) {
        return 0;
    }
    
    let totalScore = 0;

    parameters.forEach(param => {
        let maxScoreForParam = 0;
        const relevantRules = param.rules || [];
        
        relevantRules.forEach(rule => {
            const fieldNameInCamelCase = toCamelCase(rule.field);
            // For repayment-type fields, prefer Top-5 counts when available
            let inputValue = borrowerDataForScoring[fieldNameInCamelCase];
            if (fieldNameInCamelCase === 'loansOnTime' && typeof borrowerDataForScoring['loansOnTimeTop5'] !== 'undefined') {
                inputValue = borrowerDataForScoring['loansOnTimeTop5'];
            } else if (fieldNameInCamelCase === 'loansLate' && typeof borrowerDataForScoring['loansLateTop5'] !== 'undefined') {
                inputValue = borrowerDataForScoring['loansLateTop5'];
            } else if (fieldNameInCamelCase === 'loansEarly' && typeof borrowerDataForScoring['loansEarlyTop5'] !== 'undefined') {
                inputValue = borrowerDataForScoring['loansEarlyTop5'];
            }

            if (evaluateCondition(inputValue, rule.condition, rule.value)) {
                if (rule.score > maxScoreForParam) {
                    maxScoreForParam = rule.score;
                }
            }
        });
        
        const scoreForThisParam = Math.min(maxScoreForParam, param.weight);
        totalScore += scoreForThisParam;
    });

    return Math.round(totalScore);
}

export async function checkLoanEligibility(borrowerId: string, providerId: string, productId: string): Promise<{isEligible: boolean; reason: string; score: number, maxLoanAmount: number}> {
  try {
    const borrower = await prisma.borrower.findUnique({
        where: { id: borrowerId }
    });

    if (!borrower) {
      return { isEligible: false, reason: 'Borrower profile not found.', score: 0, maxLoanAmount: 0 };
    }

    if (borrower.status === 'NPL') {
        return { isEligible: false, reason: 'Your account is currently restricted due to a non-performing loan. Please contact support.', score: 0, maxLoanAmount: 0 };
    }
    
    const product = await prisma.loanProduct.findUnique({ 
        where: { id: productId },
    });

    if (!product) {
        return { isEligible: false, reason: 'Loan product not found.', score: 0, maxLoanAmount: 0 };
    }
    
    type LoanWithProduct = Loan & { product: LoanProduct };
    
    // Get all phone numbers associated with this account to prevent phone number change bypass
    const allPhoneNumbersForAccount = await getPhoneNumbersForAccount(borrowerId);
    
    const allActiveLoans: LoanWithProduct[] = await prisma.loan.findMany({
        where: {
            borrowerId: { in: allPhoneNumbersForAccount },
            repaymentStatus: 'Unpaid'
        },
        include: { product: true }
    });

    const hasActiveLoanOfSameType = allActiveLoans.some((loan: LoanWithProduct) => loan.productId === productId);
    if (hasActiveLoanOfSameType) {
        return { isEligible: false, reason: `You already have an active loan for the "${product.name}" product.`, score: 0, maxLoanAmount: 0 };
    }
    
    if (!product.allowConcurrentLoans && allActiveLoans.length > 0) {
        const otherProductNames = allActiveLoans.map(l => `"${l.product.name}"`).join(', ');
        return { isEligible: false, reason: `This is an exclusive loan product. You must repay your active loans (${otherProductNames}) before applying.`, score: 0, maxLoanAmount: 0 };
    }
    
    const borrowerDataForScoring = await getBorrowerDataForScoring(borrowerId, providerId);
    
    if (product.dataProvisioningEnabled && product.eligibilityFilter) {
        const filter = JSON.parse(product.eligibilityFilter as string);
        const filterKeys = Object.keys(filter);

        const isMatch = filterKeys.every(key => {
            const filterValue = String(filter[key]).toLowerCase();
            const borrowerValue = String(borrowerDataForScoring[toCamelCase(key)] || '').toLowerCase();
            return filterValue.split(',').map(s => s.trim()).includes(borrowerValue);
        });

        if (!isMatch) {
            return { isEligible: false, reason: 'This loan product is not available for your profile.', score: 0, maxLoanAmount: 0 };
        }
    }


    // If this product is a salary advance, bypass provider scoring and compute limit from salary mapping
    if (product.isSalaryAdvance) {
        try {
            const activeAccount = await prisma.phoneAccount.findFirst({ where: { phoneNumber: borrowerId, isActive: true } });
            if (!activeAccount || !activeAccount.accountNumber) {
                return { isEligible: false, reason: 'No active account selected. Please select your salary account to apply.', score: 0, maxLoanAmount: 0 };
            }

            const mapping = await getSalaryEntryForProduct(productId, activeAccount.accountNumber);
            if (!mapping || typeof mapping.salary === 'undefined' || mapping.salary === null) {
                return { isEligible: false, reason: 'No salary record found for your active account. Please contact the provider.', score: 0, maxLoanAmount: 0 };
            }

            const allowed = computeAllowedFromSalary(Number(mapping.salary), Number(product.advancePercent || 0), Number(product.maxLoan || 0));
            const allowedRounded = Math.floor(Number(allowed) || 0);
            if (allowedRounded <= 0) {
                return { isEligible: false, reason: 'Configured salary advance yields no available amount for your account.', score: 0, maxLoanAmount: 0 };
            }

            return { isEligible: true, reason: 'Salary advance available.', score: 0, maxLoanAmount: allowedRounded };
        } catch (e) {
            console.error('Salary-advance eligibility check failed:', e);
            return { isEligible: false, reason: 'Failed to determine salary advance eligibility.', score: 0, maxLoanAmount: 0 };
        }
    }

    const scoringParameterCount = await prisma.scoringParameter.count({ where: { providerId } });
    if (scoringParameterCount === 0) {
        return { isEligible: false, reason: 'This provider has not configured their credit scoring rules.', score: 0, maxLoanAmount: 0 };
    }

    const score = await calculateScoreForProvider(borrowerId, providerId);

    const applicableTier = await prisma.loanAmountTier.findFirst({
        where: {
            productId: productId,
            fromScore: { lte: score },
            toScore: { gte: score },
        }
    });
        
    const productMaxLoan = applicableTier?.loanAmount || 0;

    // --- Loan Cycle logic (limits accessible amount based on cycle progression) ---
    let cyclePercentage = 1; // default 100%
    try {
        const cycleConfig = await prisma.loanCycleConfig.findUnique({ where: { productId: productId } });
        if (cycleConfig && (cycleConfig.enabled === undefined || cycleConfig.enabled === true)) {
            // determine metric count
            let metricCount = 0;
            switch ((cycleConfig.metric || '').toUpperCase()) {
                case 'PAID_EARLY':
                    metricCount = borrowerDataForScoring['loansEarly'] || 0;
                    break;
                case 'PAID_LATE':
                    metricCount = borrowerDataForScoring['loansLate'] || 0;
                    break;
                case 'PAID_ON_TIME':
                    metricCount = borrowerDataForScoring['loansOnTime'] || 0;
                    break;
                case 'TOTAL_COUNT':
                    metricCount = borrowerDataForScoring['totalLoansCount'] || 0;
                    break;
                default:
                    metricCount = 0;
            }

            // Prefer new grade-based structure when present
            if (cycleConfig.grades && cycleConfig.cycleRanges) {
                const grades = typeof cycleConfig.grades === 'string' ? JSON.parse(cycleConfig.grades) as Array<{ label: string; minScore: number; percentages: number[] }> : (cycleConfig.grades as any[]);
                const ranges = typeof cycleConfig.cycleRanges === 'string' ? JSON.parse(cycleConfig.cycleRanges) as Array<{ label?: string; min: number; max: number }> : (cycleConfig.cycleRanges as any[]);

                // determine which range index the metricCount falls into
                let idx = -1;
                for (let i = 0; i < ranges.length; i++) {
                    const r = ranges[i];
                    if (typeof r?.min === 'number' && typeof r?.max === 'number') {
                        if (metricCount >= r.min && metricCount <= r.max) {
                            idx = i;
                            break;
                        }
                    }
                }
                
                if (idx === -1 && ranges.length > 0) {
                    idx = ranges.length - 1;
                }

                // find matching grade by score - choose highest minScore <= score
                let matchedGrade = null as null | (typeof grades)[0];
                const sortedGrades = (grades || []).slice().sort((a, b) => (b?.minScore ?? 0) - (a?.minScore ?? 0));
                for (const g of sortedGrades) {
                    if (typeof g?.minScore === 'number' && score >= g.minScore) {
                        matchedGrade = g;
                        break;
                    }
                }

                if (matchedGrade && Array.isArray(matchedGrade.percentages)) {
                    const pct = matchedGrade.percentages[Math.max(0, Math.min(matchedGrade.percentages.length - 1, idx))];
                    if (typeof pct === 'number') {
                        cyclePercentage = Math.max(0, Math.min(1, pct / 100));
                    }
                } else if (cycleConfig.cycles) {
                    // fallback to legacy cycles if present
                    try {
                        const cyclesArr = typeof cycleConfig.cycles === 'string' ? JSON.parse(cycleConfig.cycles) as number[] : (cycleConfig.cycles as number[]);
                        const legacyIdx = Math.min(metricCount + 1, Math.max(1, cyclesArr.length)) - 1;
                        const pct = cyclesArr[Math.max(0, Math.min(cyclesArr.length - 1, legacyIdx))];
                        if (typeof pct === 'number') {
                            cyclePercentage = Math.max(0, Math.min(1, pct / 100));
                        }
                    } catch (e) {
                        // ignore fallback errors
                    }
                }

            } else if (cycleConfig.cycles) {
                // legacy single-dimension cycles behavior
                const cyclesArr = typeof cycleConfig.cycles === 'string' ? JSON.parse(cycleConfig.cycles) as number[] : (cycleConfig.cycles as number[]);
                // progression rule: 0 -> cycle 1, 1 -> cycle 2, etc., capped to cycles length
                const idx = Math.min(metricCount + 1, Math.max(1, cyclesArr.length)) - 1; // index in array
                const pct = cyclesArr[Math.max(0, Math.min(cyclesArr.length - 1, idx))];
                if (typeof pct === 'number') {
                    cyclePercentage = Math.max(0, Math.min(1, pct / 100));
                }
            }
        }
    } catch (e) {
        console.error('Failed to compute loan cycle for product', productId, e);
    }

    // accessible amount based on cycle
    const accessibleByCycle = Math.floor(productMaxLoan * cyclePercentage);

    if (productMaxLoan <= 0) {
        return { isEligible: false, reason: 'Your credit score does not meet the minimum requirement for a loan with this provider.', score, maxLoanAmount: 0 };
    }
    
    const totalOutstandingPrincipal = allActiveLoans.reduce((sum, loan) => sum + loan.loanAmount - (loan.repaidAmount || 0), 0);
    
    // Effective cap for borrower is the cycle-limited amount
    const effectiveMaxForBorrower = Math.min(productMaxLoan, accessibleByCycle);

    const availableToBorrow = Math.max(0, effectiveMaxForBorrower - totalOutstandingPrincipal);
    
    if (availableToBorrow <= 0 && allActiveLoans.length > 0) {
         return { isEligible: true, reason: `You have reached your credit limit with this provider. Your current outstanding balance is ${totalOutstandingPrincipal}. Please repay your active loans to be eligible for more.`, score, maxLoanAmount: 0 };
    }
        
    return { isEligible: true, reason: 'Congratulations! You are eligible for a loan.', score, maxLoanAmount: availableToBorrow };

  } catch (error) {
    console.error('Error in checkLoanEligibility:', error);
    return { isEligible: false, reason: 'An unexpected server error occurred.', score: 0, maxLoanAmount: 0 };
  }
}
