import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

export class MiniAppAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeSuperAppToken(token: string) {
  const trimmed = token.trim();
  return trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
}

export type MiniAppAuthContext = {
  superAppToken: string;
  borrowerId: string;
  sessionUserId: string | null;
};

/**
 * Resolves the current mini-app identity.
 * - Requires presence of a super app token.
 * - Derives the borrower (phone) for least-privilege checks.
 */
export async function requireMiniAppAuthContext(): Promise<MiniAppAuthContext> {
  const session = await getSession({ allowRefresh: false });
  const rawToken = session?.superAppToken;

  if (!rawToken) {
    throw new MiniAppAuthError(401, 'Not authenticated');
  }

  const superAppToken = normalizeSuperAppToken(String(rawToken));
  if (!superAppToken) {
    throw new MiniAppAuthError(401, 'Not authenticated');
  }

  const sessionUserId = session?.userId ? String(session.userId) : null;

  // We must be able to bind requests to a borrower to prevent IDOR.
  // Legacy sessions store the phone as userId; DB sessions store a UUID -> map to phone.
  let borrowerId: string | null = null;
  if (sessionUserId) {
    try {
      const user = await prisma.user.findUnique({ where: { id: sessionUserId }, select: { phoneNumber: true } });
      borrowerId = user?.phoneNumber ? String(user.phoneNumber) : sessionUserId;
    } catch {
      borrowerId = sessionUserId;
    }
  }

  if (!borrowerId) {
    throw new MiniAppAuthError(401, 'Not authenticated');
  }

  return { superAppToken, borrowerId, sessionUserId };
}

export function assertBorrowerMatches(requestedBorrowerId: string | null | undefined, ctx: MiniAppAuthContext) {
  if (!requestedBorrowerId) {
    throw new MiniAppAuthError(400, 'borrowerId is required');
  }

  if (String(requestedBorrowerId) !== String(ctx.borrowerId)) {
    throw new MiniAppAuthError(403, 'Forbidden');
  }
}
