
'use server';
/**
 * @fileOverview Standalone worker process for running background tasks.
 * This script is intended to be executed by a scheduler (e.g., cron) or run as a long-running service.
 *
 * Usage:
 * To run a one-off task (like NPL check):
 * npm run run:worker -- npl
 *
 * To start the continuous repayment service:
 * npm run run:worker -- repayment-service
 */

import { logger } from './lib/logger';
import { getAsOfDate } from './lib/date-utils';

const REPAYMENT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PROVIDER_DISTRIBUTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const INTEREST_ACCRUAL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PENALTY_ACCRUAL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CBS_NPL_UPLOAD_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function runProviderDistributionServiceLoop() {
  while (true) {
    try {
      logger.info('Starting provider distribution scheduled run');
      const { runProviderDistributionOnce } = await import('./actions/provider-distribution');
      await runProviderDistributionOnce();
      logger.info('Provider distribution scheduled run finished');
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error during provider distribution cycle:`, error);
      logger.error(`Error during provider distribution cycle: ${String(error)}`);
    }
    logger.info(`Provider distribution service sleeping for ${Math.round(PROVIDER_DISTRIBUTION_INTERVAL_MS / (60 * 60 * 1000))}h`);
    await new Promise(resolve => setTimeout(resolve, PROVIDER_DISTRIBUTION_INTERVAL_MS));
  }
}

async function runInterestAccrualServiceLoop() {
  logger.info('Interest accrual service started');
  while (true) {
    try {
      const asOfDate = getAsOfDate();
      logger.info(`Interest accrual tick at ${asOfDate.toISOString()}`);
      logger.info('Starting daily interest accrual scheduled run');
      const { runDailyInterestAccrualOnce } = await import('./actions/interest-accrual');
      const result = await runDailyInterestAccrualOnce(asOfDate);
      logger.info(`Daily interest accrual finished processedLoans=${result.processedLoans} totalAccrued=${result.totalAccrued}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error during interest accrual cycle:`, error);
      logger.error(`Error during interest accrual cycle: ${String(error)}`);
    }
    logger.info(`Interest accrual service sleeping for ${Math.round(INTEREST_ACCRUAL_INTERVAL_MS / (60 * 60 * 1000))}h`);
    await new Promise(resolve => setTimeout(resolve, INTEREST_ACCRUAL_INTERVAL_MS));
  }
}

async function runPenaltyAccrualServiceLoop() {
  logger.info('Penalty accrual service started');
  while (true) {
    try {
      const asOfDate = getAsOfDate();
      logger.info(`Penalty accrual tick at ${asOfDate.toISOString()}`);
      logger.info('Starting daily penalty accrual scheduled run');
      const { runDailyPenaltyAccrualOnce } = await import('./actions/penalty-accrual');
      const result = await runDailyPenaltyAccrualOnce(asOfDate);
      logger.info(`Daily penalty accrual finished processedLoans=${result.processedLoans} totalAccrued=${result.totalAccrued}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error during penalty accrual cycle:`, error);
      logger.error(`Error during penalty accrual cycle: ${String(error)}`);
    }
    logger.info(`Penalty accrual service sleeping for ${Math.round(PENALTY_ACCRUAL_INTERVAL_MS / (60 * 60 * 1000))}h`);
    await new Promise(resolve => setTimeout(resolve, PENALTY_ACCRUAL_INTERVAL_MS));
  }
}


async function runCbsNplUploadServiceLoop() {
  logger.info('CBS NPL upload service started');
  while (true) {
    try {
      logger.info('Starting daily CBS NPL bulk upload scheduled run');
      const { uploadNplListToCbs } = await import('./actions/cbs-npl');
      const result = await uploadNplListToCbs({ source: 'SCHEDULED' });
      logger.info(
        `Daily CBS NPL upload finished success=${result.success} batch=${result.batchId} sent=${result.accountsSentCount} inserted=${result.insertedCount ?? 'n/a'} existing=${result.alreadyExistsCount ?? 'n/a'}`,
      );
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error during CBS NPL upload cycle:`, error);
      logger.error(`Error during CBS NPL upload cycle: ${String(error)}`);
    }
    logger.info(`CBS NPL upload service sleeping for ${Math.round(CBS_NPL_UPLOAD_INTERVAL_MS / (60 * 60 * 1000))}h`);
    await new Promise((resolve) => setTimeout(resolve, CBS_NPL_UPLOAD_INTERVAL_MS));
  }
}

async function main() {
  const task = process.argv[2];

  if (!task) {
    console.error('Error: No task specified.');
    process.exit(1);
  }

  // start task log removed to reduce console noise
  logger.info(`Worker started task=${task}`);

  try {
    switch (task) {
      case 'provider-distribution-service':
        logger.info('Starting provider-distribution-service long-running loop');
        await runProviderDistributionServiceLoop();
        break;
      case 'provider-distribution':
        logger.info('Running one-off provider-distribution');
        {
          const { runProviderDistributionOnce } = await import('./actions/provider-distribution');
          await runProviderDistributionOnce();
        }
        logger.info('One-off provider-distribution finished');
        process.exit(0);
        break;
      case 'interest-accrual-service':
        logger.info('Starting interest-accrual-service long-running loop');
        await runInterestAccrualServiceLoop();
        break;
      case 'interest-accrual':
        logger.info('Running one-off interest-accrual');
        {
          const { runDailyInterestAccrualOnce } = await import('./actions/interest-accrual');
          await runDailyInterestAccrualOnce(new Date());
        }
        logger.info('One-off interest-accrual finished');
        process.exit(0);
        break;
      case 'penalty-accrual-service':
        logger.info('Starting penalty-accrual-service long-running loop');
        await runPenaltyAccrualServiceLoop();
        break;
      case 'penalty-accrual':
        logger.info('Running one-off penalty-accrual');
        {
          const { runDailyPenaltyAccrualOnce } = await import('./actions/penalty-accrual');
          await runDailyPenaltyAccrualOnce(new Date());
        }
        logger.info('One-off penalty-accrual finished');
        process.exit(0);
        break;
      case 'npl':
        // This is a one-off task.
        {
          const { updateNplStatusJob } = await import('./actions/npl');
          await updateNplStatusJob();
        }
        process.exit(0);
        break;
      case 'cbs-npl-upload':
        logger.info('Running one-off cbs-npl-upload');
        {
          const { uploadNplListToCbs } = await import('./actions/cbs-npl');
          const result = await uploadNplListToCbs({ source: 'SCHEDULED' });
          logger.info(
            `One-off CBS NPL upload finished success=${result.success} batch=${result.batchId} sent=${result.accountsSentCount}`,
          );
        }
        process.exit(0);
        break;
      case 'cbs-npl-upload-service':
        logger.info('Starting cbs-npl-upload-service long-running loop');
        await runCbsNplUploadServiceLoop();
        break;
      default:
        console.error(`Error: Unknown task "${task}".`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error executing task "${task}":`, error);
    process.exit(1);
  }
}

main();
