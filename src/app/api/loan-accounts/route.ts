import { NextResponse } from "next/server";
import {
  accountDetailsFromResponse,
  fetchAccountsByPhone,
} from "@/lib/external-loan-accounts";
import {
  MiniAppAuthError,
  requireMiniAppAuthContext,
} from "@/lib/miniapp-auth";

export async function POST(req: Request) {
  try {
    const ctx = await requireMiniAppAuthContext();
    const body = await req.json();
    const { phoneNumber } = body;
    if (!phoneNumber) {
      return NextResponse.json(
        { error: "phoneNumber is required" },
        { status: 400 }
      );
    }

    if (String(phoneNumber) !== String(ctx.borrowerId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    console.info(
      `[loan-accounts] proxy request phone=${phoneNumber}`
    );

    const { status, data } = await fetchAccountsByPhone(phoneNumber);
    const detailsCount = accountDetailsFromResponse(data).length;
    console.info(
      `[loan-accounts] upstream status=${status} details=${detailsCount}`
    );
    return NextResponse.json(
      data ?? { status: "Error", status_code: status },
      { status }
    );
  } catch (err: any) {
    if (err instanceof MiniAppAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[loan-accounts] error", err);
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
