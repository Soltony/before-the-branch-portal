import prisma from '../src/lib/prisma';

async function run() {
  const oldFt = 'FT252740H8NY';
  const newFt = 'FT26105VVCJ3';

  console.log(`Starting correction: ${oldFt} -> ${newFt}`);

  try {
    // 1. Check if the new FT already exists in PendingPayment to avoid unique constraint error
    const existingNew = await prisma.pendingPayment.findUnique({
      where: { transactionId: newFt }
    });
    if (existingNew) {
      console.error(`Error: The correct FT number ${newFt} already exists in PendingPayment (ID: ${existingNew.id}). Manual intervention required.`);
      process.exit(1);
    }

    // 2. Update PendingPayment
    const pendingPayment = await prisma.pendingPayment.findUnique({
      where: { transactionId: oldFt }
    });

    if (pendingPayment) {
      console.log(`Updating PendingPayment ${pendingPayment.id}...`);
      await prisma.pendingPayment.update({
        where: { id: pendingPayment.id },
        data: { transactionId: newFt }
      });
    } else {
      console.log(`No PendingPayment found with transactionId: ${oldFt}`);
    }

    // 3. Update JournalEntries
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        description: { contains: oldFt }
      }
    });

    if (journalEntries.length > 0) {
      for (const je of journalEntries) {
        const newDescription = je.description?.replace(oldFt, newFt);
        console.log(`Updating JournalEntry ${je.id} description...`);
        await prisma.journalEntry.update({
          where: { id: je.id },
          data: { description: newDescription }
        });
      }
    } else {
      console.log(`No JournalEntries found mentioning ${oldFt}`);
    }

    // 4. Update PaymentTransactions
    const paymentTransactions = await prisma.paymentTransaction.findMany({
      where: {
        OR: [
          { transactionId: oldFt },
          { txnRef: oldFt }
        ]
      }
    });

    if (paymentTransactions.length > 0) {
      for (const pt of paymentTransactions) {
        console.log(`Updating PaymentTransaction ${pt.id}...`);
        await prisma.paymentTransaction.update({
          where: { id: pt.id },
          data: {
            transactionId: pt.transactionId === oldFt ? newFt : pt.transactionId,
            txnRef: pt.txnRef === oldFt ? newFt : pt.txnRef
          }
        });
      }
    } else {
      console.log(`No PaymentTransactions found with ${oldFt}`);
    }

    // 5. Update PendingChange payloads (historical record)
    const pendingChanges = await prisma.pendingChange.findMany({
      where: {
        payload: { contains: oldFt }
      }
    });

    if (pendingChanges.length > 0) {
      for (const pc of pendingChanges) {
        console.log(`Updating PendingChange ${pc.id} payload...`);
        const newPayload = pc.payload?.replace(new RegExp(oldFt, 'g'), newFt);
        await prisma.pendingChange.update({
          where: { id: pc.id },
          data: { payload: newPayload }
        });
      }
    }

    console.log('Successfully corrected all instances of the FT number.');

  } catch (error) {
    console.error('An error occurred during the correction:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
