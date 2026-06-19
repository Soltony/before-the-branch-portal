import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { getUserFromSession } from "@/lib/user";
import { hasPermission, type PermissionSet } from "@/lib/permissions";
import { createAuditLog } from "@/lib/audit-log";

const MODULE = "insurance-payments";

async function authorize(action: PermissionSet) {
  const user = await getUserFromSession();
  if (!user?.id) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const allowed =
    user.role === "Super Admin" || hasPermission(user, MODULE, action);
  if (!allowed) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

const accountSchema = z.object({
  insuranceName: z.string().min(1),
  insuranceId: z.string().min(1),
  accountNumber: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

// GET — list all insurer → account mappings.
export async function GET() {
  const auth = await authorize("read");
  if (auth.error) return auth.error;

  try {
    const accounts = await prisma.insuranceAccount.findMany({
      orderBy: { insuranceName: "asc" },
    });
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("[insurance-accounts GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — create a mapping.
export async function POST(req: NextRequest) {
  const auth = await authorize("create");
  if (auth.error) return auth.error;

  try {
    const data = accountSchema.parse(await req.json());
    const created = await prisma.insuranceAccount.create({
      data: {
        insuranceName: data.insuranceName.trim(),
        insuranceId: data.insuranceId.trim(),
        accountNumber: data.accountNumber.trim(),
        status: data.status ?? "ACTIVE",
      },
    });
    await createAuditLog({
      actorId: auth.user!.id,
      action: "INSURANCE_ACCOUNT_CREATED",
      entity: "InsuranceAccount",
      entityId: created.id,
      details: { ...created },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    if ((error as any)?.code === "P2002") {
      return NextResponse.json(
        { error: "An insurance account with this insurer name already exists." },
        { status: 409 },
      );
    }
    console.error("[insurance-accounts POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT — update a mapping.
export async function PUT(req: NextRequest) {
  const auth = await authorize("update");
  if (auth.error) return auth.error;

  try {
    const data = accountSchema.extend({ id: z.string().min(1) }).parse(await req.json());
    const updated = await prisma.insuranceAccount.update({
      where: { id: data.id },
      data: {
        insuranceName: data.insuranceName.trim(),
        insuranceId: data.insuranceId.trim(),
        accountNumber: data.accountNumber.trim(),
        status: data.status ?? "ACTIVE",
      },
    });
    await createAuditLog({
      actorId: auth.user!.id,
      action: "INSURANCE_ACCOUNT_UPDATED",
      entity: "InsuranceAccount",
      entityId: updated.id,
      details: { ...updated },
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    if ((error as any)?.code === "P2002") {
      return NextResponse.json(
        { error: "An insurance account with this insurer name already exists." },
        { status: 409 },
      );
    }
    console.error("[insurance-accounts PUT] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE — remove a mapping (blocked if referenced by payments).
export async function DELETE(req: NextRequest) {
  const auth = await authorize("delete");
  if (auth.error) return auth.error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await prisma.insuranceAccount.delete({ where: { id } });
    await createAuditLog({
      actorId: auth.user!.id,
      action: "INSURANCE_ACCOUNT_DELETED",
      entity: "InsuranceAccount",
      entityId: id,
    });
    return NextResponse.json({ message: "Deleted" });
  } catch (error) {
    if ((error as any)?.code === "P2003") {
      return NextResponse.json(
        { error: "Cannot delete: this insurer is referenced by insurance payments. Set it INACTIVE instead." },
        { status: 409 },
      );
    }
    console.error("[insurance-accounts DELETE] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
