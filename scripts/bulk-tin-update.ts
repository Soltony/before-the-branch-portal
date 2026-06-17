import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

async function migrateTins() {
  const csvPath = path.join(__dirname, "tins.csv");
  
  if (!fs.existsSync(csvPath)) {
    console.error("❌ tins.csv not found in the scripts folder!");
    return;
  }

  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== "");
  
  console.log(`🚀 Starting bulk TIN migration for ${lines.length} records...`);

  let config = await prisma.dataProvisioningConfig.findFirst({
    where: { name: "ExternalCustomerInfo" },
  });

  if (!config) {
    console.error("❌ ExternalCustomerInfo configuration not found.");
    return;
  }

  let updatedCount = 0;
  let skippedCount = 0;

  for (const line of lines) {
    const [accNo, tin] = line.split(",").map(s => s.trim());
    if (!accNo || !tin) continue;

    const phoneAccount = await prisma.phoneAccount.findFirst({
      where: { accountNumber: accNo },
    });

    if (!phoneAccount) {
      skippedCount++;
      continue;
    }

    const borrowerId = phoneAccount.phoneNumber;
    const existingDataEntry = await prisma.provisionedData.findFirst({
      where: { borrowerId, configId: config.id },
      orderBy: { createdAt: "desc" },
    });

    let dataPayload: any = {
      source: "bulk-migration",
      accountNumber: accNo,
      fetchedAt: new Date().toISOString(),
      detail: { Tinno: tin },
    };

    if (existingDataEntry) {
      try {
        const parsed = JSON.parse(existingDataEntry.data);
        dataPayload = {
          ...parsed,
          detail: { ...(parsed.detail || {}), Tinno: tin },
          updatedAt: new Date().toISOString(),
        };
        await prisma.provisionedData.update({
          where: { id: existingDataEntry.id },
          data: { data: JSON.stringify(dataPayload) },
        });
      } catch (e) {
        await prisma.provisionedData.update({
          where: { id: existingDataEntry.id },
          data: { data: JSON.stringify(dataPayload) },
        });
      }
    } else {
      await prisma.provisionedData.create({
        data: { borrowerId, configId: config.id, data: JSON.stringify(dataPayload) },
      });
    }

    updatedCount++;
    if (updatedCount % 100 === 0) console.log(`✅ Processed ${updatedCount} / ${lines.length}...`);
  }

  console.log(`\n✨ Finished! Updated: ${updatedCount}, Skipped: ${skippedCount}`);
}

migrateTins().finally(() => prisma.$disconnect());
