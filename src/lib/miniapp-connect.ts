import { createLegacySession, createSession } from '@/lib/session';

function snippet(text: string, maxLen = 300) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen) + '…';
}

export class MiniAppConnectError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type ConnectOptions = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function connectMiniAppSession(
  superAppToken: string,
  _options: ConnectOptions = {}
) {
  const TOKEN_VALIDATION_API_URL = process.env.TOKEN_VALIDATION_API_URL;

  if (!TOKEN_VALIDATION_API_URL) {
    throw new MiniAppConnectError(
      500,
      'The token validation URL is not configured on the server.'
    );
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  if (!superAppToken || !superAppToken.startsWith('Bearer ')) {
    throw new MiniAppConnectError(400, 'Super App Token is missing or malformed.');
  }

  const authHeader = superAppToken;
  const token = authHeader.substring(7);

  let externalResponse: Response;
  try {
    externalResponse = await fetch(TOKEN_VALIDATION_API_URL, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error('[auth/connect] token validation request failed', {
      requestId,
      message,
      TOKEN_VALIDATION_API_URL,
      tokenLength: token?.length,
    });

    throw new MiniAppConnectError(502, `Token validation request failed: ${message}`);
  }

  if (!externalResponse.ok) {
    const contentType = externalResponse.headers.get('content-type') || '';
    const wwwAuthenticate = externalResponse.headers.get('www-authenticate') || '';
    const rawBody = await externalResponse.text().catch(() => '');

    console.log('[auth/connect] token validation response', {
      requestId,
      upstreamStatus: externalResponse.status,
      upstreamContentType: contentType,
      upstreamWwwAuthenticate: wwwAuthenticate || undefined,
      upstreamBodySnippet: rawBody ? snippet(rawBody, 1200) : undefined,
      TOKEN_VALIDATION_API_URL,
    });

    let errorMessage = `Token validation failed (status ${externalResponse.status}).`;
    try {
      const maybeJson = JSON.parse(rawBody || '{}');
      if (maybeJson?.message && typeof maybeJson.message === 'string') {
        errorMessage = maybeJson.message;
      } else if (rawBody) {
        errorMessage = `${errorMessage} Upstream response: ${snippet(rawBody)}`;
      }
    } catch {
      if (rawBody) {
        errorMessage = `${errorMessage} Upstream response: ${snippet(rawBody)}`;
      } else if (contentType) {
        errorMessage = `${errorMessage} Upstream content-type: ${contentType}`;
      }
    }

    throw new MiniAppConnectError(externalResponse.status, errorMessage, {
      upstreamStatus: externalResponse.status,
      upstreamContentType: contentType,
      upstreamWwwAuthenticate: wwwAuthenticate || undefined,
      upstreamBodySnippet: rawBody ? snippet(rawBody, 1200) : undefined,
    });
  }

  const responseData = await externalResponse.json();
  const phone = responseData.phone;

  console.log('[auth/connect] token validated', {
    requestId,
    phonePresent: Boolean(phone),
    TOKEN_VALIDATION_API_URL,
  });

  if (!phone) {
    throw new MiniAppConnectError(400, 'Phone number not found in validation response.');
  }

  const { default: prisma } = await import('@/lib/prisma');
  const user = await prisma.user.findUnique({ where: { phoneNumber: phone } });

  if (!user) {
    await createLegacySession(phone, token);
    return { borrowerId: phone, userId: null, legacy: true };
  }

  await createSession(user.id, token);
  return { borrowerId: phone, userId: user.id, legacy: false };
}