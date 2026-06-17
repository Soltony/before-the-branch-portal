import { NextRequest, NextResponse } from "next/server";
import { getUserFromSession } from "@/lib/user";
import { attemptRepayForNotification } from "@/actions/cbs-npl";

const REQUIRED_PERMS = ["npl-collection", "npl"] as const;

function userHasAnyPerm(user: any, action: "update"): boolean {
  if (!user?.permissions) return false;
  return REQUIRED_PERMS.some((key) => Boolean(user.permissions[key]?.[action]));
}

interface Ctx {
  params: Promise<{ id: string }> | { id: string };
}

/** Manual retry of /repay for a previously failed/unmatched notification. */
export async function POST(req: NextRequest, ctx: Ctx) {
  void req;
  const user = await getUserFromSession({ allowRefresh: false });
  if (!user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!userHasAnyPerm(user, "update")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const params = await Promise.resolve(ctx.params);
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing notification id" }, { status: 400 });
  }

  try {
    const result = await attemptRepayForNotification(id, user.id);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
