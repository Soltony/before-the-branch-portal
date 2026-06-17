
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { createSession } from '@/lib/session';
import { createAuditLog } from '@/lib/audit-log';
import { loginSchema } from '@/lib/validators';
import { isBlocked, recordFailedAttempt, resetAttempts, getRemainingAttempts, getBackoffSeconds, getLockRemainingMs } from '@/lib/rate-limiter';

export async function POST(req: NextRequest) {
  const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
  const userAgent = req.headers.get('user-agent') || 'N/A';
  const GENERIC_AUTH_ERROR = 'Invalid phone number or password.';

  try {
    const body = await req.json().catch(() => ({}));
    const phoneNumberRaw = typeof (body as any)?.phoneNumber === 'string' ? (body as any).phoneNumber.trim() : '';

    // Apply the same rate-limiter UX as the app-router login.
    const ipAddressKey = req.ip || req.headers.get('x-forwarded-for') || 'unknown-ip';
    const rateKey = `${phoneNumberRaw || 'unknown-phone'}:${ipAddressKey}`;

    if (isBlocked(rateKey)) {
      const lockMs = getLockRemainingMs(rateKey);
      const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
      const remaining = getRemainingAttempts(rateKey);
      const backoff = getBackoffSeconds(rateKey);
      return NextResponse.json(
        { error: 'Too many failed attempts. Try again later.', retryAfter: retryAfterSeconds, retriesLeft: remaining, delaySeconds: backoff },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    const parsed = await loginSchema.safeParseAsync(body);
    if (!parsed.success) {
      recordFailedAttempt(rateKey);
      if (isBlocked(rateKey)) {
        const lockMs = getLockRemainingMs(rateKey);
        const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
        const remaining = getRemainingAttempts(rateKey);
        const backoff = getBackoffSeconds(rateKey);
        return NextResponse.json(
          { error: 'Too many failed attempts. Try again later.', retryAfter: retryAfterSeconds, retriesLeft: remaining, delaySeconds: backoff },
          { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
        );
      }
      const backoff = getBackoffSeconds(rateKey);
      if (backoff > 0) await new Promise((res) => setTimeout(res, backoff * 1000));
      const remaining = getRemainingAttempts(rateKey);
      return NextResponse.json({ error: GENERIC_AUTH_ERROR, retriesLeft: remaining, delaySeconds: backoff }, { status: 401 });
    }

    const { phoneNumber, password } = parsed.data;
    const validatedRateKey = `${phoneNumber}:${ipAddressKey}`;

    const user = await prisma.user.findFirst({
      where: { phoneNumber },
      include: { role: true },
    });

    if (!user) {
      const logDetails = {
          reason: 'User not found',
          attemptedPhoneNumber: phoneNumber,
      };
      await createAuditLog({
        actorId: 'anonymous',
        action: 'USER_LOGIN_FAILURE',
        ipAddress,
        userAgent,
        details: logDetails,
      });
      recordFailedAttempt(validatedRateKey);
      if (isBlocked(validatedRateKey)) {
        const lockMs = getLockRemainingMs(validatedRateKey);
        const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
        const remaining = getRemainingAttempts(validatedRateKey);
        const backoff = getBackoffSeconds(validatedRateKey);
        return NextResponse.json(
          { error: 'Too many failed attempts. Try again later.', retryAfter: retryAfterSeconds, retriesLeft: remaining, delaySeconds: backoff },
          { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
        );
      }
      const backoff = getBackoffSeconds(validatedRateKey);
      if (backoff > 0) await new Promise((res) => setTimeout(res, backoff * 1000));
      const remaining = getRemainingAttempts(validatedRateKey);
      return NextResponse.json({ error: GENERIC_AUTH_ERROR, retriesLeft: remaining, delaySeconds: backoff }, { status: 401 });
    }

    if (user.status === 'Inactive') {
        const logDetails = {
            reason: 'User account is inactive',
            userId: user.id,
            attemptedPhoneNumber: phoneNumber,
        };
        await createAuditLog({
            actorId: user.id,
            action: 'USER_LOGIN_FAILURE',
            ipAddress,
            userAgent,
            details: logDetails
        });
          // Do not disclose account state on login.
          recordFailedAttempt(validatedRateKey);
          const backoff = getBackoffSeconds(validatedRateKey);
          if (backoff > 0) await new Promise((res) => setTimeout(res, backoff * 1000));
          const remaining = getRemainingAttempts(validatedRateKey);
          return NextResponse.json({ error: GENERIC_AUTH_ERROR, retriesLeft: remaining, delaySeconds: backoff }, { status: 401 });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
       const logDetails = {
            reason: 'Invalid password',
            userId: user.id,
            attemptedPhoneNumber: phoneNumber,
       };
       await createAuditLog({
           actorId: user.id,
           action: 'USER_LOGIN_FAILURE',
           ipAddress,
           userAgent,
           details: logDetails
       });
      recordFailedAttempt(validatedRateKey);
      if (isBlocked(validatedRateKey)) {
        const lockMs = getLockRemainingMs(validatedRateKey);
        const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
        const remaining = getRemainingAttempts(validatedRateKey);
        const backoff = getBackoffSeconds(validatedRateKey);
        return NextResponse.json(
          { error: 'Too many failed attempts. Try again later.', retryAfter: retryAfterSeconds, retriesLeft: remaining, delaySeconds: backoff },
          { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
        );
      }
      const backoff = getBackoffSeconds(validatedRateKey);
      if (backoff > 0) await new Promise((res) => setTimeout(res, backoff * 1000));
      const remaining = getRemainingAttempts(validatedRateKey);
      return NextResponse.json({ error: GENERIC_AUTH_ERROR, retriesLeft: remaining, delaySeconds: backoff }, { status: 401 });
    }

    resetAttempts(validatedRateKey);

    // Create a session for the user
    await createSession(user.id);
    
    const logDetails = {
        role: user.role.name,
    };
    await createAuditLog({
        actorId: user.id,
        action: 'USER_LOGIN_SUCCESS',
        ipAddress,
        userAgent,
        details: logDetails
    });

    return NextResponse.json({ message: 'Login successful' }, { status: 200 });

  } catch (error) {
    console.error('Login Error:', error);
    return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
  }
}
