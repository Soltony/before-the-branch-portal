import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  differenceInDays,
  isValid,
  format,
} from "date-fns";
import { calculateTotalRepayable } from "@/lib/loan-calculator";
import { getUserFromSession } from "@/lib/user";
import { applyBranchFilterToLoanWhere, getBranchCodeFromUser } from "@/lib/branch-filter";

const getDates = (timeframe: string, from?: string, to?: string) => {
  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isValid(fromDate) && isValid(toDate)) {
      return { gte: startOfDay(fromDate), lte: endOfDay(toDate) };
    }
  }
  const now = new Date();
  switch (timeframe) {
    case "daily":
      return { gte: startOfDay(now), lte: endOfDay(now) };
    case "weekly":
      return {
        gte: startOfWeek(now, { weekStartsOn: 1 }),
        lte: endOfWeek(now, { weekStartsOn: 1 }),
      };
    case "monthly":
      return { gte: startOfMonth(now), lte: endOfMonth(now) };
    case "quarterly": {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const qStart = startOfMonth(
        new Date(now.getFullYear(), qStartMonth, 1)
      );
      const qEnd = endOfMonth(
        new Date(now.getFullYear(), qStartMonth + 2, 1)
      );
      return { gte: qStart, lte: qEnd };
    }
    case "semiAnnually": {
      const year = now.getFullYear();
      if (now.getMonth() < 6) {
        return {
          gte: startOfMonth(new Date(year, 0, 1)),
          lte: endOfMonth(new Date(year, 5, 1)),
        };
      }
      return {
        gte: startOfMonth(new Date(year, 6, 1)),
        lte: endOfMonth(new Date(year, 11, 1)),
      };
    }
    case "annually":
    case "yearly":
      return { gte: startOfYear(now), lte: endOfYear(now) };
    case "overall":
    default:
      return { gte: undefined, lte: undefined };
  }
};

/**
 * Extracts a field from a flattened data object by trying multiple key aliases (case-insensitive).
 */
function extractField(
  data: Record<string, any>,
  ...aliases: string[]
): string {
  const lowerAliases = aliases.map((a) => a.toLowerCase());
  for (const key of Object.keys(data)) {
    if (lowerAliases.includes(key.toLowerCase())) {
      const val = data[key];
      if (val != null && val !== "") return String(val);
    }
  }
  return "";
}

/**
 * Flatten provisioned data entries. The raw JSON may have a nested `detail` object
 * (e.g. from external-customer-info) or flat key/value pairs from data uploads.
 * We merge everything into a single flat record, with `detail.*` fields taking priority.
 */
function flattenProvisionedData(entries: { data: string }[]): Record<string, any> {
  let result: Record<string, any> = {};
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.data);
      // If there's a nested `detail` object, spread it at the top level
      if (parsed.detail && typeof parsed.detail === "object") {
        result = { ...result, ...parsed, ...parsed.detail };
      } else {
        result = { ...result, ...parsed };
      }
    } catch {
      // skip unparseable entries
    }
  }
  return result;
}

/**
 * Split a full name like "GEMECHU URGE SEGNI" into first / middle / last.
 * Returns [first, middle, last]. If only two parts, middle is empty.
 */
function splitFullName(fullName: string): [string, string, string] {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 3) {
    return [parts[0], parts[1], parts.slice(2).join(" ")];
  }
  if (parts.length === 2) {
    return [parts[0], "", parts[1]];
  }
  return [parts[0] || "", "", ""];
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.["reports"]?.read) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  let providerId = searchParams.get("providerId");
  const timeframe = searchParams.get("timeframe") || "overall";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const search = searchParams.get("search")?.trim();
  const dateRange = getDates(timeframe, from ?? undefined, to ?? undefined);

  const DEFAULT_PAGE_SIZE = 50;
  const MAX_PAGE_SIZE = 200;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      parseInt(
        searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE),
        10
      )
    )
  );
  const skip = (page - 1) * pageSize;

  const whereClause: any = {
    repaymentStatus: { not: "REVERSED" },
  };

  if (dateRange.gte && dateRange.lte) {
    whereClause.disbursedDate = { gte: dateRange.gte, lte: dateRange.lte };
  }

  if (user.loanProviderId) {
    providerId = user.loanProviderId;
  }

  if (providerId && providerId !== "all" && providerId !== "none") {
    whereClause.product = { providerId };
  }

  if (providerId === "none") {
    return NextResponse.json({
      data: [],
      total: 0,
      page: 1,
      pageSize,
      totalPages: 0,
    });
  }

  if (search) {
    const matchingPhoneAccounts = await prisma.phoneAccount.findMany({
      where: {
        OR: [
          { accountNumber: { contains: search } },
          { phoneNumber: { contains: search } },
        ],
      },
      select: { phoneNumber: true },
      take: 500,
    });
    const matchingBorrowerIds = [
      ...new Set(matchingPhoneAccounts.map((pa) => pa.phoneNumber)),
    ];
    if (matchingBorrowerIds.length === 0) {
      return NextResponse.json({
        data: [],
        total: 0,
        page: 1,
        pageSize,
        totalPages: 0,
      });
    }
    whereClause.borrowerId = { in: matchingBorrowerIds };
  }

  const branchCode = getBranchCodeFromUser(user);
  const branchOk = await applyBranchFilterToLoanWhere(whereClause, branchCode);
  if (!branchOk) {
    return NextResponse.json({
      data: [],
      total: 0,
      page: 1,
      pageSize,
      totalPages: 0,
    });
  }

  try {
    const totalCount = await prisma.loan.count({ where: whereClause });
    const totalPages = Math.ceil(totalCount / pageSize);

    const [loans, taxConfigs] = await Promise.all([
      prisma.loan.findMany({
        where: whereClause,
        include: {
          product: {
            include: {
              provider: true,
            },
          },
          payments: true,
          installments: {
            orderBy: { installmentNumber: "asc" },
          },
          loanApplication: true,
          borrower: {
            include: {
              provisionedData: {
                orderBy: { createdAt: "desc" },
              },
            },
          },
        },
        orderBy: { disbursedDate: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.tax.findMany(),
    ]);

    const borrowerIds = [...new Set(loans.map((loan: any) => loan.borrowerId))];
    const phoneAccounts = borrowerIds.length
      ? await prisma.phoneAccount.findMany({
          where: { phoneNumber: { in: borrowerIds } },
          select: {
            phoneNumber: true,
            customerName: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: [
            { phoneNumber: "asc" },
            { isActive: "desc" },
            { createdAt: "desc" },
          ],
        })
      : [];

    const phoneNameByBorrower = new Map<string, string>();
    for (const account of phoneAccounts) {
      if (!phoneNameByBorrower.has(account.phoneNumber) && account.customerName) {
        phoneNameByBorrower.set(account.phoneNumber, account.customerName.trim());
      }
    }

    const today = new Date();

    const reportData = loans.map((loan: any) => {
      // Flatten all provisioned data (handles nested `detail` from external-customer-info)
      const borrowerData = flattenProvisionedData(
        loan.borrower?.provisionedData || []
      );

      // Primary source: PhoneAccount.customerName
      // Fallback source: provisioned data fields
      let firstName = extractField(borrowerData, "firstName", "first_name", "first name");
      let middleName = extractField(
        borrowerData, "middleName", "middle_name", "middle name",
        "fatherName", "father_name"
      );
      let lastName = extractField(
        borrowerData, "lastName", "last_name", "last name",
        "grandFatherName", "grandfather_name"
      );

      const phoneAccountName = phoneNameByBorrower.get(loan.borrowerId) || "";
      if (phoneAccountName) {
        [firstName, middleName, lastName] = splitFullName(phoneAccountName);
      } else if (!firstName) {
        // If individual name parts are empty, split the full name from provisioned data
        const fullName = extractField(
          borrowerData, "CustomerName", "customername", "fullName",
          "full_name", "full name", "name"
        );
        if (fullName) {
          [firstName, middleName, lastName] = splitFullName(fullName);
        }
      }

      const gender = extractField(
        borrowerData, "gender", "sex", "Gender"
      );
      const personalIncomeLevel = extractField(
        borrowerData, "NetMonthlyIncome", "netMonthlyIncome",
        "income", "incomeLevel", "income_level",
        "personalIncome", "personal_income", "salary", "monthlyIncome"
      );
      const nationalId = extractField(
        borrowerData, "NationalId", "nationalId", "national_id",
        "faydaNo", "fayda_no", "faydaNumber", "nationalIdNo"
      );
      const tin = extractField(borrowerData, "tin", "TIN", "taxId", "tax_id");
      const otherIdNo = extractField(
        borrowerData, "otherIdNo", "other_id", "otherId", "idNo", "id_no",
        "AccountNumber", "accountNumber"
      );
      const region = extractField(
        borrowerData, "ResidenceRegion", "residenceRegion", "region", "Region"
      );
      const zone = extractField(
        borrowerData, "zone", "Zone", "Street", "street"
      );
      const subCity = extractField(
        borrowerData, "SubCity", "subCity", "sub_city", "subcity", "City", "city"
      );
      const woreda = extractField(
        borrowerData, "Woreda", "woreda", "worda"
      );
      const kebele = extractField(borrowerData, "kebele", "Kebele");
      const houseNo = extractField(
        borrowerData, "houseNo", "house_no", "houseNumber", "HouseNo"
      );
      const phoneNo = loan.borrowerId; // borrower ID is the phone number

      // Loan type classification (columns 16-21)
      const productName = (loan.product?.name || "").toLowerCase();
      const isSalaryAdvance = loan.product?.isSalaryAdvance || false;
      const personalLoan =
        !isSalaryAdvance &&
        (productName.includes("personal") || productName.includes("consumer"))
          ? loan.loanAmount
          : 0;
      const workingCapitalLoan =
        productName.includes("working") || productName.includes("capital")
          ? loan.loanAmount
          : 0;
      const buyNowPayLater = productName.includes("bnpl") ||
        productName.includes("buy now pay later")
          ? loan.loanAmount
          : 0;
      const revolvingCredit = productName.includes("revolving") ||
        productName.includes("credit limit")
          ? loan.loanAmount
          : 0;
      const msmeLoans =
        productName.includes("msme") || productName.includes("micro")
          ? loan.loanAmount
          : 0;
      // If none of the above matched, classify as "other"
      const otherLoanType =
        personalLoan === 0 &&
        workingCapitalLoan === 0 &&
        buyNowPayLater === 0 &&
        revolvingCredit === 0 &&
        msmeLoans === 0
          ? loan.loanAmount
          : 0;

      // Financials
      const applicationAmount = loan.loanApplication?.loanAmount ?? loan.loanAmount;
      const purposeOfLoan =
        extractField(borrowerData, "purpose", "loanPurpose", "loan_purpose") ||
        loan.product?.name ||
        "";
      const loanAccountRefNo = loan.id;
      const approvedAmount = loan.loanAmount;
      const disbursementDate = loan.disbursedDate
        ? format(new Date(loan.disbursedDate), "yyyy-MM-dd")
        : "";

      // Repayment frequency
      const intervalDays = loan.product?.repaymentIntervalDays;
      const installmentCount = loan.product?.installments;
      let repaymentFrequency = "One-time";
      if (installmentCount && installmentCount > 1 && intervalDays) {
        if (intervalDays <= 7) repaymentFrequency = "Weekly";
        else if (intervalDays <= 15) repaymentFrequency = "Bi-weekly";
        else if (intervalDays <= 31) repaymentFrequency = "Monthly";
        else if (intervalDays <= 92) repaymentFrequency = "Quarterly";
        else repaymentFrequency = `Every ${intervalDays} days`;
      }

      const durationDays = loan.product?.duration || 0;

      // Outstanding balance
      const { total, principal } = calculateTotalRepayable(
        loan,
        loan.product,
        taxConfigs,
        today,
        true
      );
      const totalRepaid = loan.repaidAmount || 0;
      const outstandingBalance = Math.max(0, total - totalRepaid);

      // Settlement date
      const settlementDate =
        loan.repaymentStatus === "Paid" && loan.payments?.length > 0
          ? format(
              new Date(
                Math.max(
                  ...loan.payments.map((p: any) => new Date(p.date).getTime())
                )
              ),
              "yyyy-MM-dd"
            )
          : "";

      // Loan status / classification
      const daysOverdue = differenceInDays(today, loan.dueDate);
      let loanClassification = "Pass";
      const isOutstandingZero = outstandingBalance <= 0.01;

      if (loan.repaymentStatus === "Paid" || isOutstandingZero) {
        loanClassification = "Closed";
      } else if (daysOverdue > 360) {
        loanClassification = "Loss";
      } else if (daysOverdue > 180) {
        loanClassification = "Doubtful";
      } else if (daysOverdue > 90) {
        loanClassification = "Substandard";
      } else if (daysOverdue > 30) {
        loanClassification = "Special Mention";
      }

      // Loan cycle - count previous loans for this borrower
      // (we just use the count from available data, not a separate query for perf)
      const loanCycle = ""; // will be filled from a subquery if needed

      // Interest rate (from daily fee)
      let interestRate = "";
      try {
        const dailyFee = JSON.parse(loan.product?.dailyFee || "{}");
        if (dailyFee.value != null && dailyFee.value !== "") {
          interestRate =
            dailyFee.type === "percentage"
              ? `${dailyFee.value}%`
              : String(dailyFee.value);
        }
      } catch {
        // skip
      }

      // Service charge
      let serviceCharge = "";
      try {
        const sf = JSON.parse(loan.product?.serviceFee || "{}");
        if (sf.value != null && sf.value !== "") {
          serviceCharge =
            sf.type === "percentage"
              ? `${sf.value}%`
              : String(sf.value);
        }
      } catch {
        // skip
      }

      // Credit score - try to extract from provisioned data
      const creditScore = extractField(
        borrowerData,
        "creditScore",
        "credit_score",
        "score"
      );

      return {
        firstName,
        middleName,
        lastName,
        gender,
        personalIncomeLevel,
        nationalId,
        tin,
        otherIdNo,
        region,
        zone,
        subCity,
        woreda,
        kebele,
        houseNo,
        phoneNo,
        personalLoan,
        workingCapitalLoan,
        buyNowPayLater,
        revolvingCredit,
        msmeLoans,
        otherLoanType,
        applicationAmount,
        purposeOfLoan,
        loanAccountRefNo,
        approvedAmount,
        disbursementDate,
        repaymentFrequency,
        durationDays,
        outstandingBalance,
        settlementDate,
        loanClassification,
        loanCycle,
        interestRate,
        serviceCharge,
        creditScore,
      };
    });

    return NextResponse.json({
      data: reportData,
      total: totalCount,
      page,
      pageSize,
      totalPages,
    });
  } catch (error: any) {
    console.error("National Bank report error:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}
