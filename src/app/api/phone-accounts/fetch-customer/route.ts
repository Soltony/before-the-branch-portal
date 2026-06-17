import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { Prisma } from "@prisma/client";
import {
  MiniAppAuthError,
  requireMiniAppAuthContext,
} from "@/lib/miniapp-auth";

// POST { phoneNumber, accountNumber }
export async function POST(req: Request) {
  try {
    const ctx = await requireMiniAppAuthContext();
    const body = await req.json();
    const { phoneNumber, accountNumber, providerId } = body;
    if (!phoneNumber || !accountNumber)
      return NextResponse.json(
        { error: "phoneNumber and accountNumber required" },
        { status: 400 }
      );

    if (String(phoneNumber) !== String(ctx.borrowerId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Deterministic column mapping for ExternalCustomerInfo
    const desiredColumns = [
      {
        id: "col-ext-0",
        name: "AccountNumber",
        type: "string",
        isIdentifier: true,
        options: [],
      },
      {
        id: "col-ext-1",
        name: "AccountOpeningDate",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-2",
        name: "CustomerName",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-3",
        name: "Country",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-4",
        name: "Street",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-5",
        name: "City",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-6",
        name: "Nationality",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-7",
        name: "Residence",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-8",
        name: "NationalId",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-9",
        name: "ResidenceRegion",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-10",
        name: "Gender",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-11",
        name: "DateOfBirth",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-12",
        name: "MaritalStatus",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-13",
        name: "Occupation",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-14",
        name: "EmployersName",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-15",
        name: "NetMonthlyIncome",
        type: "number",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-16",
        name: "Woreda",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-17",
        name: "MotherName",
        type: "string",
        isIdentifier: false,
        options: [],
      },
      {
        id: "col-ext-18",
        name: "SubCity",
        type: "string",
        isIdentifier: false,
        options: [],
      },
    ];

    // Determine or create the target provider-scoped ExternalCustomerInfo config
    let config = null;
    if (providerId) {
      config = await prisma.dataProvisioningConfig.findFirst({
        where: { providerId: providerId, name: "ExternalCustomerInfo" },
      });
      if (!config) {
        const created = await prisma.dataProvisioningConfig.create({
          data: {
            providerId: providerId,
            name: "ExternalCustomerInfo",
            columns: JSON.stringify(desiredColumns),
          },
        });
        config = created;
      }
    } else {
      // No providerId supplied: attempt to find any provider-scoped ExternalCustomerInfo config
      config = await prisma.dataProvisioningConfig.findFirst({
        where: { name: "ExternalCustomerInfo" },
      });
      if (!config) {
        return NextResponse.json(
          {
            error:
              "No provider specified and no ExternalCustomerInfo config exists.",
          },
          { status: 400 }
        );
      }
    }

    // Ensure Borrower exists. Use phoneNumber as borrower id (as used in auth/connect).
    const borrowerId = String(phoneNumber);
    // Create borrower defensively. Prisma `upsert` on SQL Server can fail under
    // concurrency (unique constraint) so we use create + catch fallback to update.
    try {
      await prisma.borrower.create({
        data: { id: borrowerId, status: "Active" },
      });
    } catch (e: any) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        try {
          await prisma.borrower.update({
            where: { id: borrowerId },
            data: { status: "Active" },
          });
        } catch (err) {
          // ignore
        }
      } else {
        throw e;
      }
    }

    // Try to reuse an existing provisioned payload for the same borrower+accountNumber
    // Search across all ExternalCustomerInfo configs for this borrower and look for a matching accountNumber
    const existingAcross = await prisma.provisionedData.findMany({
      where: { borrowerId, config: { name: "ExternalCustomerInfo" } },
    });
    for (const ex of existingAcross) {
      try {
        const parsed = JSON.parse(ex.data as string);
        const candidate = parsed?.detail ?? parsed;
        const candidateAccount =
          candidate?.AccountNumber ??
          candidate?.accountNumber ??
          candidate?.account_number ??
          null;
        if (candidateAccount != null) {
          // Compare loosely since DB may store numbers or strings
          if (String(candidateAccount) === String(accountNumber)) {
            // Reuse this payload for the target provider config by upserting into its provisionedData
            const payload = parsed;
            const existingForTarget = await prisma.provisionedData.findFirst({
              where: { borrowerId, configId: config.id },
            });
            if (existingForTarget) {
              const updated = await prisma.provisionedData.update({
                where: { id: existingForTarget.id },
                data: { data: JSON.stringify(payload) },
              });
              return NextResponse.json({
                ok: true,
                copied: true,
                provisionedDataId: updated.id,
              });
            } else {
              const created = await prisma.provisionedData.create({
                data: {
                  borrowerId,
                  configId: config.id,
                  data: JSON.stringify(payload),
                },
              });
              return NextResponse.json({
                ok: true,
                copied: true,
                provisionedDataId: created.id,
              });
            }
          }
        }
      } catch (e) {
        // ignore parse errors for unrelated rows
      }
    }

    // No existing matched payload found: call the external customer info service
    const apiUrl = process.env.EXTERNAL_CUSTOMER_INFO_URL ?? "";
    const user = process.env.EXTERNAL_API_USERNAME;
    const pass = process.env.EXTERNAL_API_PASSWORD;
    const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

    // Call upstream customer info service
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ accountNumber }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => null);
      console.warn(
        "[phone-accounts][fetch-customer] upstream returned",
        res.status,
        text
      );

      return NextResponse.json(
        { error: "Upstream error", status: res.status, body: text },
        { status: 502 }
      );
    }

    const data = await res.json().catch(() => null);
    const detail = data?.detail ?? data?.details ?? data;

    // Save provisioned data as JSON string. We keep a single latest row per (borrower, config) per simplicity.
    const payload = {
      source: "external-customer-info",
      accountNumber,
      fetchedAt: new Date().toISOString(),
      detail,
    };

    const existing = await prisma.provisionedData.findFirst({
      where: { borrowerId, configId: config.id },
    });
    if (existing) {
      const updated = await prisma.provisionedData.update({
        where: { id: existing.id },
        data: { data: JSON.stringify(payload) },
      });
      return NextResponse.json({
        ok: true,
        saved: true,
        provisionedDataId: updated.id,
      });
    } else {
      const created = await prisma.provisionedData.create({
        data: {
          borrowerId,
          configId: config.id,
          data: JSON.stringify(payload),
        },
      });
      return NextResponse.json({
        ok: true,
        saved: true,
        provisionedDataId: created.id,
      });
    }
  } catch (err: any) {
    if (err instanceof MiniAppAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[phone-accounts][fetch-customer] error", err);
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
