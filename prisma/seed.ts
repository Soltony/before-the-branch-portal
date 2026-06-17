import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const permissions = {
  superAdmin: {
    dashboard: { create: true, read: true, update: true, delete: true },
    reports: { create: true, read: true, update: true, delete: true },
    "access-control": { create: true, read: true, update: true, delete: true },
    "scoring-engine": { create: true, read: true, update: true, delete: true },
    settings: { create: true, read: true, update: true, delete: true },
    providers: { create: true, read: true, update: true, delete: true },
    products: { create: true, read: true, update: true, delete: true },
    tax: { create: true, read: true, update: true, delete: true },
    approvals: { create: true, read: true, update: true, delete: true },
    npl: { create: true, read: true, update: true, delete: true },
    "audit-logs": { create: true, read: true, update: true, delete: true },
  },
  loanProvider: {
    dashboard: { create: false, read: true, update: false, delete: false },
    reports: { create: true, read: true, update: false, delete: false },
    "access-control": {
      create: false,
      read: false,
      update: false,
      delete: false,
    },
    "scoring-engine": {
      create: false,
      read: true,
      update: true,
      delete: false,
    },
    settings: { create: false, read: true, update: true, delete: false },
    products: { create: true, read: true, update: true, delete: true },
    tax: { create: false, read: true, update: false, delete: false },
    approvals: { create: false, read: false, update: false, delete: false },
    npl: { create: false, read: false, update: false, delete: false },
    "audit-logs": { create: false, read: false, update: false, delete: false },
  },
  reconciliation: {
    dashboard: { create: false, read: true, update: false, delete: false },
    reports: { create: false, read: true, update: false, delete: false },
    "access-control": {
      create: false,
      read: false,
      update: false,
      delete: false,
    },
    "scoring-engine": {
      create: false,
      read: false,
      update: false,
      delete: false,
    },
    settings: { create: false, read: false, update: false, delete: false },
    products: { create: false, read: false, update: false, delete: false },
    tax: { create: false, read: true, update: false, delete: false },
    approvals: { create: false, read: false, update: false, delete: false },
    npl: { create: false, read: false, update: false, delete: false },
    "audit-logs": { create: false, read: false, update: false, delete: false },
  },
};

async function main() {
  console.log("Start seeding...");

  // Seed Roles
  const superAdminRole = await prisma.role.upsert({
    where: { name: "Super Admin" },
    update: {
      permissions: JSON.stringify(permissions.superAdmin),
    },
    create: {
      name: "Super Admin",
      permissions: JSON.stringify(permissions.superAdmin),
    },
  });

  await prisma.role.upsert({
    where: { name: "Loan Provider" },
    update: {
      permissions: JSON.stringify(permissions.loanProvider),
    },
    create: {
      name: "Loan Provider",
      permissions: JSON.stringify(permissions.loanProvider),
    },
  });

  await prisma.role.upsert({
    where: { name: "Reconciliation" },
    update: {
      permissions: JSON.stringify(permissions.reconciliation),
    },
    create: {
      name: "Reconciliation",
      permissions: JSON.stringify(permissions.reconciliation),
    },
  });

  await prisma.role.upsert({
    where: { name: "Approver" },
    update: {
      permissions: JSON.stringify(permissions.superAdmin),
    },
    create: {
      name: "Approver",
      permissions: JSON.stringify(permissions.superAdmin),
    },
  });

  console.log("Roles seeded.");

  // Seed Super Admin User
  const hashedPassword = await bcrypt.hash("SuperAdm!2025", 10);
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: { password: hashedPassword },
    create: {
      fullName: "Super Admin",
      email: "admin@example.com",
      phoneNumber: "0900000000",
      password: hashedPassword,
      status: "Active",
      role: {
        connect: {
          id: superAdminRole.id,
        },
      },
    },
  });

  console.log("Super Admin user seeded.");
  console.log("Seeding finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
