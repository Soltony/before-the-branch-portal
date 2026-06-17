
import { deleteSession, getSession } from '@/lib/session';
import { NextResponse } from 'next/server';
import { createAuditLog } from '@/lib/audit-log';

export async function POST() {
  const session = await getSession();
  if (session?.userId) {
    await createAuditLog({ actorId: session.userId, action: 'USER_LOGOUT_SUCCESS' });
   
  }
  
  // Ensure session is revoked and cookies cleared before responding
  await deleteSession();
  return NextResponse.json({ success: true });
}
