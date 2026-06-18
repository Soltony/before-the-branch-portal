import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isSupportedLanguage, labelForLanguage } from "@/lib/lersha/contract-languages";
import { resolveActiveLershaTerms, pickContractText } from "@/lib/lersha/contract";

/**
 * Diagram steps 1–2: Lersha fetches the loan contract text in the farmer's
 * chosen language so the agent can display and review it with the farmer.
 *
 * GET /api/farmer/contract/content?farmer_id=...&language_code=om
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const farmerId = searchParams.get("farmer_id");
    const languageCode = searchParams.get("language_code");

    if (!farmerId || !languageCode) {
      return NextResponse.json(
        { error: "farmer_id and language_code are required." },
        { status: 400 },
      );
    }

    if (!isSupportedLanguage(languageCode)) {
      return NextResponse.json(
        { error: `Unsupported language_code: ${languageCode}` },
        { status: 400 },
      );
    }

    const farmer = await prisma.lershaFarmer.findUnique({
      where: { farmerId },
      select: { id: true },
    });
    if (!farmer) {
      return NextResponse.json({ error: "Farmer not found." }, { status: 404 });
    }

    const terms = await resolveActiveLershaTerms();
    if (!terms) {
      return NextResponse.json(
        { error: "No active terms and conditions are configured." },
        { status: 404 },
      );
    }

    const content = pickContractText(terms, languageCode);

    return NextResponse.json({
      farmerId,
      languageCode,
      languageLabel: labelForLanguage(languageCode),
      version: terms.version,
      content,
    });
  } catch (error: any) {
    console.error("[contract/content] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
