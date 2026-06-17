import { NextResponse } from 'next/server';
import { BRANCHES } from '@/lib/branches';
import { getUserFromSession } from '@/lib/user';

export async function GET() {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['access-control']?.read) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  return NextResponse.json(BRANCHES);
}
