import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MiniAppConnectError, connectMiniAppSession } from '@/lib/miniapp-connect';

const miniAppConnectTokenCookie = 'miniappConnectToken';

function redirectWithError(request: Request, message: string) {
  const url = new URL('/loan/connect', request.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const superAppToken = cookieStore.get(miniAppConnectTokenCookie)?.value;

  if (!superAppToken) {
    const response = redirectWithError(
      request,
      'Secure session token is missing. Please reopen the mini app from the super app.'
    );
    response.cookies.set(miniAppConnectTokenCookie, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/loan/connect',
      expires: new Date(0),
    });
    return response;
  }

  try {
    const { borrowerId } = await connectMiniAppSession(superAppToken);
    const destination = new URL(`/loan?borrowerId=${encodeURIComponent(borrowerId)}`, request.url);
    const response = NextResponse.redirect(destination, { status: 303 });

    response.cookies.set(miniAppConnectTokenCookie, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/loan/connect',
      expires: new Date(0),
    });

    return response;
  } catch (error) {
    const message = error instanceof MiniAppConnectError
      ? error.message
      : `An internal error occurred: ${(error as Error)?.message || 'Unknown error'}`;

    return redirectWithError(request, message);
  }
}