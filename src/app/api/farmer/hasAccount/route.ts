import { NextRequest, NextResponse } from "next/server";
import {
  accountDetailsFromResponse,
  fetchAccountsByPhone,
} from "@/lib/external-loan-accounts";
import { hasAccountQuerySchema } from "@/lib/lersha/types";

export async function GET(req: NextRequest) {
  const logPrefix = "[hasAccount]";
  try {
    console.log(`${logPrefix} Request received`);
    const phone = req.nextUrl.searchParams.get("phone");
    console.log(`${logPrefix} Query phone param:`, phone ?? "(missing)");

    const parsed = hasAccountQuerySchema.safeParse({ phone });
    if (!parsed.success) {
      console.warn(`${logPrefix} Validation failed:`, parsed.error.flatten());
      return NextResponse.json(
        { error: "Missing or invalid 'phone' query parameter." },
        { status: 400 },
      );
    }
    console.log(`${logPrefix} Phone validated:`, parsed.data.phone);

    console.log(`${logPrefix} Fetching accounts from external banking API...`);
    const { status, data } = await fetchAccountsByPhone(parsed.data.phone);
    console.log(`${logPrefix} External API response status:`, status);

    if (status < 200 || status >= 300) {
      console.warn(
        `${logPrefix} Upstream error — status=${status} phone=${parsed.data.phone}`,
        data,
      );
      return NextResponse.json(
        { error: "Unable to verify account with banking service." },
        { status: 502 },
      );
    }

    const details = accountDetailsFromResponse(data);
    const hasAccount = details.length > 0;
    console.log(`${logPrefix} Account details count:`, details.length);
    console.log(`${logPrefix} Result — hasAccount:`, hasAccount);

    return NextResponse.json({ hasAccount }, { status: 200 });
  } catch (error: unknown) {
    console.error(`${logPrefix} Error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
