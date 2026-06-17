import { NextRequest, NextResponse } from 'next/server';
import { createLegacySession } from '@/lib/session';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const borrowerId = searchParams.get('borrowerId');

    if (!token || !borrowerId) {
        return NextResponse.json({ error: 'Missing token or borrowerId.' }, { status: 400 });
    }

    const normalizedToken = token.trim().toLowerCase().startsWith('bearer ') ? token.trim().slice(7).trim() : token.trim();

    // ✅ Create a redirect response
    const redirectUrl = new URL(`/loan?borrowerId=${borrowerId}`, req.url);
    const response = NextResponse.redirect(redirectUrl);

    // ✅ Set secure, HTTP-only cookie
    response.cookies.set('superAppToken', normalizedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 30, // 30 minutes
    });

    // Also set a signed legacy session cookie so server-side can bind
    // borrowerId (phone) <-> token and prevent IDOR.
    await createLegacySession(String(borrowerId), normalizedToken);

    return response;
}
