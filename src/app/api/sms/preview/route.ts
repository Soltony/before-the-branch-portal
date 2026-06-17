import { NextRequest, NextResponse } from "next/server";
import { getUserFromSession } from "@/lib/user";
import { hasPermission } from "@/lib/permissions";
import {
  replacePlaceholders,
  getLoanContextForPhone,
  hasPlaceholders,
} from "@/actions/sms";
import prisma from "@/lib/prisma";

// Preview how a message will look with placeholders replaced
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromSession();
    if (!user || !hasPermission(user, "sms-management", "read")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { templateContent, loanId, recipientPhone } = await request.json();

    if (!templateContent) {
      return NextResponse.json(
        { error: "Template content is required" },
        { status: 400 },
      );
    }

    // If recipientPhone is provided (Quick Send preview), try to resolve with real loan data
    if (recipientPhone && (await hasPlaceholders(templateContent))) {
      const context = await getLoanContextForPhone(recipientPhone);
      if (context) {
        const preview = await replacePlaceholders(templateContent, context);
        return NextResponse.json({ preview, resolved: true });
      }
      return NextResponse.json({
        preview: templateContent,
        resolved: false,
        message:
          "No loan found for this phone number. Placeholders will be sent as-is.",
      });
    }

    // If a loanId is provided, use real data for preview
    if (loanId) {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          product: { include: { provider: true } },
          payments: true,
        },
      });

      if (!loan) {
        return NextResponse.json({ error: "Loan not found" }, { status: 404 });
      }

      const totalPaid = loan.payments.reduce((sum, p) => sum + p.amount, 0);
      const outstandingAmount =
        loan.loanAmount +
        loan.serviceFee +
        loan.penaltyAmount +
        loan.interestAccruedAmount -
        totalPaid;

      const preview = await replacePlaceholders(templateContent, {
        borrowerId: loan.borrowerId,
        loanAmount: loan.loanAmount,
        outstandingAmount: Math.max(0, outstandingAmount),
        dueDate: loan.dueDate,
        disbursedDate: loan.disbursedDate,
        productName: loan.product.name,
        providerName: loan.product.provider.name,
        penaltyAmount: loan.penaltyAmount,
      });

      return NextResponse.json({ preview });
    }

    // Use sample data for preview
    const samplePreview = await replacePlaceholders(templateContent, {
      borrowerId: "0912345678",
      borrowerName: "Sample Borrower",
      loanAmount: 10000,
      outstandingAmount: 8500,
      dueDate: new Date(),
      disbursedDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      productName: "Personal Loan",
      providerName: "Sample Provider",
      penaltyAmount: 250,
    });

    return NextResponse.json({ preview: samplePreview });
  } catch (error: any) {
    console.error("[API] POST /api/sms/preview error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
