import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const ext = await prisma.provisionedData.count({ where: { data: { contains: "external-customer-info" } } });
  console.log("external-customer-info rows:", ext);
  const sample = await prisma.provisionedData.findFirst({ where: { data: { contains: "external-customer-info" } }, select: { borrowerId: true, data: true } });
  if (sample) {
    console.log("borrowerId:", sample.borrowerId);
    try {
      const p = JSON.parse(sample.data);
      const detail = p.detail ?? p;
      console.log("detail keys:", Object.keys(detail));
      console.log("branch-ish:", Object.entries(detail).filter(([k]) => /branch|code/i.test(k)));
    } catch (e) { console.log("parse err", e); }
    console.log("raw tail:", sample.data.slice(-250));
  }
  // also: any row mentioning branch in any casing
  const anyBranch = await prisma.provisionedData.count({ where: { data: { contains: "ranch" } } });
  console.log("rows containing 'ranch':", anyBranch);
  await prisma.$disconnect();
})();
