/**
 * One-time repair: zero principal/interest/penalty/service/tax ledger positions
 * for REVERSED loans and fix active loans whose ledger nets to zero but status is Unpaid.
 *
 * Run: node scripts/repair-dashboard-ledger.mjs
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const PRINCIPAL_CATEGORIES = ['Principal', 'Interest', 'ServiceFee', 'Penalty', 'Tax'];

async function getLoanLedgerNet(loanId, accountIds, recvId, recvdId) {
  const entries = await p.ledgerEntry.findMany({
    where: {
      ledgerAccountId: { in: accountIds },
      journalEntry: { loanId },
    },
    select: { amount: true, type: true, ledgerAccountId: true },
  });

  const net = { recv: 0, recvd: 0, byCategory: {} };
  for (const cat of PRINCIPAL_CATEGORIES) {
    net.byCategory[cat] = { recv: 0, recvd: 0 };
  }

  const accounts = await p.ledgerAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, type: true, category: true },
  });
  const accMap = new Map(accounts.map((a) => [a.id, a]));

  for (const e of entries) {
    const acc = accMap.get(e.ledgerAccountId);
    if (!acc) continue;
    const signed = e.type === 'Debit' ? e.amount : -e.amount;
    if (acc.type === 'Receivable') {
      net.recv += signed;
      net.byCategory[acc.category].recv += signed;
    } else {
      net.recvd += signed;
      net.byCategory[acc.category].recvd += signed;
    }
  }
  return net;
}

async function postBalancingEntry(loan, providerId, description, adjustments) {
  const reversalJe = await p.journalEntry.create({
    data: {
      providerId,
      loanId: loan.id,
      date: new Date(),
      description,
    },
  });

  for (const { accountId, delta } of adjustments) {
    if (Math.abs(delta) < 0.0001) continue;
    const type = delta > 0 ? 'Debit' : 'Credit';
    const amount = Math.abs(delta);
    await p.ledgerEntry.create({
      data: {
        journalEntryId: reversalJe.id,
        ledgerAccountId: accountId,
        type,
        amount,
      },
    });
    await p.ledgerAccount.update({
      where: { id: accountId },
      data: { balance: { increment: delta } },
    });
  }
}

try {
  const providers = await p.loanProvider.findMany({
    include: {
      ledgerAccounts: {
        where: { category: { in: PRINCIPAL_CATEGORIES }, type: { in: ['Receivable', 'Received'] } },
      },
    },
  });

  let reversedFixed = 0;
  let orphanFixed = 0;

  for (const provider of providers) {
    const accounts = provider.ledgerAccounts;
    const accountIds = accounts.map((a) => a.id);
    if (!accountIds.length) continue;

    const reversedLoans = await p.loan.findMany({
      where: {
        repaymentStatus: 'REVERSED',
        product: { providerId: provider.id },
      },
      select: { id: true },
    });

    for (const loan of reversedLoans) {
      const net = await getLoanLedgerNet(loan.id, accountIds);
      const total = net.recv + net.recvd;
      const adjustments = [];

      for (const acc of accounts) {
        const catNet = net.byCategory[acc.category];
        const position = acc.type === 'Receivable' ? catNet.recv : catNet.recvd;
        if (Math.abs(position) > 0.01) {
          adjustments.push({ accountId: acc.id, delta: -position });
        }
      }

      if (adjustments.length > 0) {
        await postBalancingEntry(
          loan,
          provider.id,
          `Ledger repair: zero balance for reversed loan ${loan.id}`,
          adjustments,
        );
        reversedFixed++;
        console.log('Fixed REVERSED loan', loan.id, 'total net was', total);
      }
    }

    const activeLoans = await p.loan.findMany({
      where: {
        repaymentStatus: 'Unpaid',
        product: { providerId: provider.id },
      },
      select: { id: true, loanAmount: true, repaidAmount: true },
    });

    for (const loan of activeLoans) {
      const net = await getLoanLedgerNet(loan.id, accountIds);
      const principalRecv = accounts.find((a) => a.category === 'Principal' && a.type === 'Receivable');
      const principalRecvd = accounts.find((a) => a.category === 'Principal' && a.type === 'Received');
      const principalNet =
        (net.byCategory.Principal?.recv || 0) + (net.byCategory.Principal?.recvd || 0);

      if (Math.abs(principalNet) < 0.01 && loan.loanAmount > 0) {
        await p.loan.update({
          where: { id: loan.id },
          data: {
            repaymentStatus: 'REVERSED',
            repaymentBehavior: 'REVERSED',
            repaidAmount: 0,
          },
        });
        orphanFixed++;
        console.log('Marked orphan loan REVERSED', loan.id, 'loanAmount', loan.loanAmount);
      }
    }
  }

  console.log('Done. REVERSED loans repaired:', reversedFixed, 'orphan loans fixed:', orphanFixed);
} finally {
  await p.$disconnect();
}
