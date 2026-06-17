 'use server';

import prisma from '@/lib/prisma';
import { createAuditLog, newAuditCorrelationId } from '@/lib/audit-log';
import { format, startOfDay, subDays } from 'date-fns';
import { logger } from '@/lib/logger';

type DistributionBreakdown = {
  interestAmount: number;
  serviceFeeAmount: number;
  penaltyAmount: number;
  taxAmount: number;
};

type UpstreamDistributionSuccess = {
  status?: string;
  providerId?: string;
  distributionDate?: string;
  totalDistributedAmount?: number;
  distributionReference?: string;
  [k: string]: any;
};

function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function isUpstreamSuccess(payload: any): payload is UpstreamDistributionSuccess {
  const status = String(payload?.status ?? '').toUpperCase();
  return status === 'SUCCESS' || status === 'SUCCESSFUL' || status === 'OK';
}

function getUpstreamConfig() {
  const url = process.env.EXTERNAL_DISTRIBUTION_URL ?? 'http://192.168.100.56:8280/nibtera-loan/distribution';
  const user = process.env.EXTERNAL_API_USERNAME ?? 'nibLoan';
  const pass = process.env.EXTERNAL_API_PASSWORD ?? '123456';
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  return { url, auth };
}

export type ProviderDistributionRunResult = {
  distributionDate: string;
  processedProviders: number;
  skippedProviders: number;
  alreadyDistributed: number;
  errors: number;
};

export async function runProviderDistributionOnce(input?: { distributionDate?: Date }): Promise<ProviderDistributionRunResult> {
  const distributionDate = startOfDay(input?.distributionDate ?? subDays(new Date(), 1));
  const distributionDateStr = format(distributionDate, 'yyyy-MM-dd');
  const runId = newAuditCorrelationId();

  logger.info(`Provider distribution run started for date=${distributionDateStr}`);

  try {
    const providers = await prisma.loanProvider.findMany({
      include: { ledgerAccounts: true },
    });

    await createAuditLog({
      actorId: 'system',
      action: 'PROVIDER_DISTRIBUTION_RUN_STARTED',
      entity: 'Service',
      entityId: 'provider-distribution',
      details: {
        runId,
        distributionDate: distributionDateStr,
        providerCount: providers.length,
      },
    });

    logger.info(`Found ${providers.length} providers for distribution run`);

    const upstream = getUpstreamConfig();

    let processedProviders = 0;
    let skippedProviders = 0;
    let alreadyDistributed = 0;
    let errors = 0;

    for (const provider of providers) {
      try {
        logger.info(`Processing provider ${provider.id} (${provider.name})`);
      // Income balances represent amounts collected (cash-basis income).
      // Provider distribution sends these balances upstream and clears them on success.
      const interestIncome = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Income');
      const serviceFeeIncome = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Income');
      const penaltyIncome = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Income');
      // Tax is tracked in Tax Received (no Tax Income account).
      const taxReceived = provider.ledgerAccounts.find(a => a.category === 'Tax' && a.type === 'Received');

      const breakdown: DistributionBreakdown = {
        interestAmount: roundCurrency(interestIncome?.balance ?? 0),
        serviceFeeAmount: roundCurrency(serviceFeeIncome?.balance ?? 0),
        penaltyAmount: roundCurrency(penaltyIncome?.balance ?? 0),
        taxAmount: roundCurrency(taxReceived?.balance ?? 0),
      };

      const total = roundCurrency(
        breakdown.interestAmount + breakdown.serviceFeeAmount + breakdown.penaltyAmount + breakdown.taxAmount,
      );

      logger.info(
        `Provider ${provider.id} distributable balances (income/tax): interest=${breakdown.interestAmount} serviceFee=${breakdown.serviceFeeAmount} penalty=${breakdown.penaltyAmount} tax=${breakdown.taxAmount} total=${total}`,
      );

      if (total <= 0) {
        skippedProviders++;
        logger.info(`Skipping provider ${provider.id}: nothing to distribute (total=0)`);
        continue;
      }

      const existing = await prisma.providerDistribution.findUnique({
        where: {
          providerId_distributionDate: {
            providerId: provider.id,
            distributionDate,
          },
        },
        select: { id: true },
      });

      if (existing) {
        alreadyDistributed++;
        logger.warn(`Provider ${provider.id} already has a distribution for ${distributionDateStr}, skipping`);
        continue;
      }

      const externalProviderId = provider.accountNumber ?? provider.id;

      const payload = {
        providerId: externalProviderId,
        distributionDate: distributionDateStr,
        breakdown,
      };

      logger.info(`Posting distribution to upstream for provider ${provider.id} -> externalId=${externalProviderId}`);

      const res = await fetch(upstream.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: upstream.auth,
        },
        body: JSON.stringify(payload),
      });

      const responseJson = await res.json().catch(() => null);

      if (!res.ok || !isUpstreamSuccess(responseJson)) {
        const details = {
          runId,
          providerId: provider.id,
          externalProviderId,
          distributionDate: distributionDateStr,
          upstreamStatus: res.status,
          upstreamBody: responseJson,
        };
        logger.error(`Upstream failed for provider ${provider.id}: status=${res.status} body=${JSON.stringify(responseJson)}`);
        await createAuditLog({
          actorId: 'system',
          action: 'PROVIDER_DISTRIBUTION_FAILED',
          entity: 'LoanProvider',
          entityId: provider.id,
          details,
        });
        errors++;
        continue;
      }

      const distributionReference = String(responseJson?.distributionReference ?? '');
      await prisma.$transaction(async tx => {
        await tx.providerDistribution.create({
          data: {
            providerId: provider.id,
            externalProviderId,
            distributionDate,
            interestAmount: breakdown.interestAmount,
            serviceFeeAmount: breakdown.serviceFeeAmount,
            penaltyAmount: breakdown.penaltyAmount,
            taxAmount: breakdown.taxAmount,
            totalDistributedAmount: total,
            distributionReference: distributionReference || null,
          },
        });

        // Clear distributable balances after successful distribution.
        const updates: Array<Promise<any>> = [];
        if (interestIncome) updates.push(tx.ledgerAccount.update({ where: { id: interestIncome.id }, data: { balance: 0 } }));
        if (serviceFeeIncome) updates.push(tx.ledgerAccount.update({ where: { id: serviceFeeIncome.id }, data: { balance: 0 } }));
        if (penaltyIncome) updates.push(tx.ledgerAccount.update({ where: { id: penaltyIncome.id }, data: { balance: 0 } }));
        if (taxReceived) updates.push(tx.ledgerAccount.update({ where: { id: taxReceived.id }, data: { balance: 0 } }));

        await Promise.all(updates);
      });
      await createAuditLog({
        actorId: 'system',
        action: 'PROVIDER_DISTRIBUTION_SUCCESS',
        entity: 'LoanProvider',
        entityId: provider.id,
        details: {
          runId,
          providerId: provider.id,
          externalProviderId,
          distributionDate: distributionDateStr,
          breakdown,
          totalDistributedAmount: total,
          distributionReference: distributionReference || null,
        },
      });

      logger.info(`Provider ${provider.id} distribution succeeded total=${total} ref=${distributionReference || 'n/a'}`);

      processedProviders++;
      } catch (e: any) {
        errors++;
        logger.error(`Provider ${provider.id} distribution error: ${String(e?.message ?? e)}`);
        await createAuditLog({
          actorId: 'system',
          action: 'PROVIDER_DISTRIBUTION_ERROR',
          entity: 'LoanProvider',
          entityId: provider.id,
          details: {
            runId,
            providerId: provider.id,
            distributionDate: distributionDateStr,
            error: String(e?.message ?? e),
          },
        });
      }
    }

    const result = {
      distributionDate: distributionDateStr,
      processedProviders,
      skippedProviders,
      alreadyDistributed,
      errors,
    };

    await createAuditLog({
      actorId: 'system',
      action: 'PROVIDER_DISTRIBUTION_RUN_FINISHED',
      entity: 'Service',
      entityId: 'provider-distribution',
      details: {
        runId,
        ...result,
      },
    });

    logger.info(`Provider distribution run finished: ${JSON.stringify(result)}`);
    return result;
  } catch (e: any) {
    await createAuditLog({
      actorId: 'system',
      action: 'PROVIDER_DISTRIBUTION_RUN_FAILED',
      entity: 'Service',
      entityId: 'provider-distribution',
      details: {
        runId,
        distributionDate: distributionDateStr,
        error: String(e?.message ?? e),
      },
    });
    throw e;
  }
}
