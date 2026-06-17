
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSession, deleteSession, revokeAllUserSessions } from '@/lib/session';
import { createAuditLog } from '@/lib/audit-log';
import { z, ZodError } from 'zod';
import { passwordSchema } from '@/lib/validators'; // Use the strong password validation (includes breach check)

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { currentPassword, newPassword } = body;
        
        // Validate the new password against security policies (includes breach check)
        const passwordValidation = await passwordSchema.safeParseAsync(newPassword);
        if (!passwordValidation.success) {
            const errorMessages = passwordValidation.error.errors.map(e => e.message).join(', ');
            return NextResponse.json({ error: `Invalid new password: ${errorMessages}` }, { status: 400 });
        }


        const user = await prisma.user.findUnique({ where: { id: session.userId } });

        if (!user) {
            return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }

        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

        if (!isCurrentPasswordValid) {
            await createAuditLog({
                actorId: user.id,
                action: 'PASSWORD_CHANGE_FAILED',
                details: { reason: 'Incorrect current password' },
            });
            return NextResponse.json({ error: 'The current password you entered is incorrect.' }, { status: 400 });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedNewPassword,
                passwordChangeRequired: false,
            },
        });

        await createAuditLog({
            actorId: user.id,
            action: 'PASSWORD_CHANGE_SUCCESS',
        });

        // Invalidate all existing sessions after a password change.
        // This prevents stolen/leaked tokens from remaining usable.
        await revokeAllUserSessions(user.id);

        // Clear cookies for the current browser as well.
        await deleteSession();
    
        return NextResponse.json({ message: 'Password changed successfully.' }, { status: 200 });

    } catch (error) {
        if (error instanceof ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error('Error changing password:', error);
        return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
    }
}
