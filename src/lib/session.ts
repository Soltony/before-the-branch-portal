

 'use server';

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secretKey = process.env.SESSION_SECRET;
const key = new TextEncoder().encode(secretKey);

const ACCESS_TOKEN_EXP = '15m'; // access token expiry
const REFRESH_TOKEN_DAYS = 7; // refresh token expiry days

function uuid() {
  // Edge Runtime-safe UUID generation.
  // Next.js Edge provides Web Crypto; Node 18+ also provides globalThis.crypto.
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Extremely defensive fallback (should not be hit in supported runtimes).
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function isProd() {
  return process.env.NODE_ENV === 'production';
}

export async function encryptJwt(payload: any, expiresIn: string) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function decryptJwt(token: string): Promise<any | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return payload;
  } catch (err) {
    return null;
  }
}

function expiryDateFromDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function expiryDateFromMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function createSession(userId: string, superAppToken?: string, permissions?: any) {
  const { default: prisma } = await import('./prisma');
  const userWithRole = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!userWithRole) throw new Error("User not found during session creation.");

  // Enforce session concurrency: only allow a single active session per user.
  // Any existing active sessions are revoked when a new login occurs.

  // Create a DB session (refresh token storage) and issue access + refresh tokens.
  const refreshExpiresAt = expiryDateFromDays(REFRESH_TOKEN_DAYS);

  // create a random opaque refresh token (safer than storing long-lived JWTs client-side)
  const refreshToken = await encryptJwt({ userId, t: 'refresh' }, `${REFRESH_TOKEN_DAYS}d`);

  // generate a JTI (JWT ID) for the access token and persist it on the DB session
  const jti = uuid();

  const sessionRecord = await prisma.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, jti: null },
    });

    return await tx.session.create({
      data: {
        userId,
        refreshToken,
        jti,
        expiresAt: refreshExpiresAt,
        revoked: false,
      },
    });
  });

  // Build access token payload including session id so we can track activity
  const accessPayload: any = {
    userId,
    sessionId: sessionRecord.id,
    jti: jti,
    // Keep only essential claims in access token. Permissions are authoritative from DB.
    passwordChangeRequired: userWithRole.passwordChangeRequired,
  };

  if (superAppToken) accessPayload.superAppToken = superAppToken;
  
  const accessToken = await encryptJwt(accessPayload, ACCESS_TOKEN_EXP);

  // set cookies: access token short-lived, refresh token long-lived
  const accessExpires = expiryDateFromMinutes(15);
  const refreshExpires = refreshExpiresAt;

  const cookiesStore = await cookies();
  cookiesStore.set('accessToken', accessToken, { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: accessExpires });
  cookiesStore.set('refreshToken', refreshToken, { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: refreshExpires });

  // Backwards-compat: if a super app token is provided (used by the mini-app connect flow),
  // create a legacy `session` cookie with the userId and the superAppToken inside so the
  // mini-app can continue to read a single `session` cookie as before.
  if (superAppToken) {
    const sessionExpires = expiryDateFromDays(1);
    const legacySessionPayload = { userId, expires: sessionExpires, superAppToken };
    const legacySessionJwt = await encryptJwt(legacySessionPayload, '1d');
    cookiesStore.set('session', legacySessionJwt, { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: sessionExpires });
  }

  return { accessToken, refreshToken, sessionId: sessionRecord.id };
}

export async function revokeAllUserSessions(userId: string) {
  const { default: prisma } = await import('./prisma');
  await prisma.session.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true, jti: null },
  });
}

// Create a legacy-only session cookie for flows where the external token
// should log the user into the mini-app without creating a DB-backed session.
export async function createLegacySession(phone: string, superAppToken: string) {
  const cookiesStore = await cookies();
  const sessionExpires = expiryDateFromDays(1);
  const legacySessionPayload = { userId: phone, expires: sessionExpires, superAppToken };
  const legacySessionJwt = await encryptJwt(legacySessionPayload, '1d');
  cookiesStore.set('session', legacySessionJwt, { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: sessionExpires });
  return { session: legacySessionJwt };
}

export async function getSession(options?: { allowRefresh?: boolean }) {
  const allowRefresh = options?.allowRefresh !== false;
  const cookiesStore = await cookies();
  const access = cookiesStore.get('accessToken')?.value;
  const refresh = cookiesStore.get('refreshToken')?.value;

  // 1) Validate access token if present and return if valid and bound to a DB session
  if (access) {
    const payload = await decryptJwt(access);
    if (payload?.userId && payload?.sessionId) {
      try {
        const { default: prisma } = await import('./prisma');
        const sessionRecord = await prisma.session.findUnique({ where: { id: payload.sessionId } });
        if (sessionRecord && !sessionRecord.revoked && sessionRecord.expiresAt > new Date() && sessionRecord.userId === payload.userId) {
            // Ensure access token JTI matches the one stored on the DB session.
            if (payload?.jti && sessionRecord.jti && payload.jti !== sessionRecord.jti) {
              return null;
            }
          // Ensure the access token is bound to the same DB session as the refresh cookie.
          // This prevents someone from swapping in an access token for another session
          // while still holding a different refresh token cookie.
          const currentRefresh = cookiesStore.get('refreshToken')?.value;
          if (!currentRefresh || currentRefresh !== sessionRecord.refreshToken) {
            // Access token does not match the refresh token on this client; treat as invalid
            // so the refresh flow (if present) can continue using the client's refresh cookie.
            return null;
          }

          // update last activity timestamp
          await prisma.session.update({ where: { id: sessionRecord.id }, data: { lastActivity: new Date() } });
          return payload;
        }
      } catch (e) {
        console.error('Error validating access token session in getSession:', e);
        return null;
      }
    }
  }

  // 2) Access token not valid/expired -> attempt refresh flow using httpOnly refresh token
  if (refresh) {
    try {
      const { default: prisma } = await import('./prisma');
      const sessionRecord = await prisma.session.findUnique({ where: { refreshToken: refresh } });
      if (!sessionRecord) return null;
      if (sessionRecord.revoked) return null;
      if (sessionRecord.expiresAt < new Date()) return null;

      // If refresh is not allowed (e.g., Server Components or internal middleware checks),
      // validate the refresh token without rotating it and without setting cookies.
      if (!allowRefresh) {
        const userWithRole = await prisma.user.findUnique({ where: { id: sessionRecord.userId }, include: { role: true } });
        if (!userWithRole) return null;

        // update last activity timestamp (DB-only; safe in all contexts)
        await prisma.session.update({ where: { id: sessionRecord.id }, data: { lastActivity: new Date() } });

        return {
          userId: sessionRecord.userId,
          sessionId: sessionRecord.id,
          jti: sessionRecord.jti,
          passwordChangeRequired: userWithRole.passwordChangeRequired,
        };
      }

      // rotate refresh token for additional security
      const newRefreshToken = await encryptJwt({ userId: sessionRecord.userId, t: 'refresh' }, `${REFRESH_TOKEN_DAYS}d`);
      const refreshExpiresAt = expiryDateFromDays(REFRESH_TOKEN_DAYS);

      // fetch user role for authoritative permissions
      const userWithRole = await prisma.user.findUnique({ where: { id: sessionRecord.userId }, include: { role: true } });
      if (!userWithRole) return null; // user might have been deleted

      // generate new jti for the rotated access token and persist it
      const newJti = uuid();

      // update DB session with rotated refresh token, new jti and new expiry/lastActivity
      await prisma.session.update({ where: { id: sessionRecord.id }, data: { refreshToken: newRefreshToken, expiresAt: refreshExpiresAt, lastActivity: new Date(), jti: newJti } });

      // issue a new short-lived access token bound to this session
      const accessPayload: any = {
        userId: sessionRecord.userId,
        sessionId: sessionRecord.id,
        // include the new jti so access tokens can be revoked by comparing against DB
        jti: await (async () => {
          // fetch the updated session to get the persisted new jti (defensive)
          try {
            const { default: prisma2 } = await import('./prisma');
            const updated = await prisma2.session.findUnique({ where: { id: sessionRecord.id } });
            return updated?.jti;
          } catch (e) {
            return undefined;
          }
        })(),
        // Do not include permissions in the token; fetch from DB for authoritative source.
        passwordChangeRequired: userWithRole.passwordChangeRequired,
      };
      const newAccessToken = await encryptJwt(accessPayload, ACCESS_TOKEN_EXP);

      const accessExpires = expiryDateFromMinutes(15);

      // set rotated refresh token and new access token as httpOnly cookies
      const cookiesStore2 = await cookies();
      cookiesStore2.set('accessToken', newAccessToken, { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: accessExpires });
      cookiesStore2.set('refreshToken', newRefreshToken, { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: refreshExpiresAt });

      return accessPayload;
    } catch (e) {
      console.error('Refresh flow failed in getSession:', e);
      return null;
    }
  }

  // 3) Legacy mini-app support: check for a legacy `session` cookie which
  // may contain the `superAppToken` (created by `createLegacySession`) or a
  // direct `superAppToken` cookie (created by `save-token` redirect flows).
  try {
    const legacyJwt = cookiesStore.get('session')?.value;
    if (legacyJwt) {
      const legacyPayload = await decryptJwt(legacyJwt);
      if (legacyPayload?.superAppToken) {
        return legacyPayload;
      }
    }

    const directToken = cookiesStore.get('superAppToken')?.value;
    if (directToken) {
      return { superAppToken: directToken };
    }
  } catch (e) {
    console.error('Error reading legacy session or superAppToken cookie in getSession:', e);
    return null;
  }

  return null;
}

export async function deleteSession() {
  // Revoke session by refresh token in DB and clear cookies
  const cookiesStore = await cookies();
  const refresh = cookiesStore.get('refreshToken')?.value;
  const access = cookiesStore.get('accessToken')?.value;
  if (refresh) {
    try {
      const { default: prisma } = await import('./prisma');
      const sessionRecord = await prisma.session.findUnique({ where: { refreshToken: refresh } });
      if (sessionRecord) {
        // mark revoked and clear stored jti so access tokens cannot be validated anymore
        await prisma.session.update({ where: { id: sessionRecord.id }, data: { revoked: true, jti: null } });
      }
    } catch (e) {
      console.error('Failed to revoke session by refresh token in deleteSession:', e);
    }
  } else if (access) {
    // try to decode access token to find session id and revoke it
    const payload = await decryptJwt(access);
      if (payload?.sessionId) {
      try {
        const { default: prisma } = await import('./prisma');
        // mark revoked and clear stored jti so this access token is no longer valid
        await prisma.session.update({ where: { id: payload.sessionId }, data: { revoked: true, jti: null } });
      } catch (e) {
        console.error('Failed to revoke session by access token in deleteSession:', e);
      }
    }
  }

  // clear cookies
  const expired = new Date(0);
  cookiesStore.set('accessToken', '', { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: expired });
  cookiesStore.set('refreshToken', '', { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: expired });
  cookiesStore.set('session', '', { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', expires: expired });
}
