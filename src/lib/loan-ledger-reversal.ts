import type { Prisma } from '@prisma/client';

type JournalEntryWithEntries = {
  id: string;
  description: string | null;
  entries: {
    id: string;
    ledgerAccountId: string;
    type: string;
    amount: number;
  }[];
};

function isReversalJournal(description: string | null): boolean {
  return String(description || '')
    .toLowerCase()
    .startsWith('reversal:');
}

/**
 * Reverse every non-reversal journal entry on a loan so ledger nets to zero.
 */
export async function reverseAllLoanJournalEntries(
  db: Prisma.TransactionClient,
  providerId: string,
  loanId: string,
  journalEntries: JournalEntryWithEntries[],
  reversalDescription: string,
): Promise<string | null> {
  const toReverse = journalEntries.filter((je) => !isReversalJournal(je.description));
  if (toReverse.length === 0) return null;

  const reversalJe = await db.journalEntry.create({
    data: {
      providerId,
      loanId,
      date: new Date(),
      description: reversalDescription,
    },
  });

  for (const je of toReverse) {
    for (const e of je.entries) {
      const reverseType = e.type === 'Debit' ? 'Credit' : 'Debit';
      await db.ledgerEntry.create({
        data: {
          journalEntryId: reversalJe.id,
          ledgerAccountId: e.ledgerAccountId,
          type: reverseType,
          amount: e.amount,
        },
      });

      const delta = e.type === 'Debit' ? -e.amount : e.amount;
      await db.ledgerAccount.update({
        where: { id: e.ledgerAccountId },
        data: { balance: { increment: delta } },
      });
    }
  }

  return reversalJe.id;
}
