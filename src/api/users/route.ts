
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { createAuditLog } from '@/lib/audit-log';
import { phoneNumberSchema } from '@/lib/validators';
import { revokeAllUserSessions } from '@/lib/session';

const userSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  phoneNumber: phoneNumberSchema,
  password: z.string().min(6, 'Password must be at least 6 characters long').optional(),
  role: z.string(), // Role name, will be connected by ID
  providerId: z.string().nullable().optional(),
  status: z.enum(['Active', 'Inactive']),
});

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      include: {
        role: true,
        loanProvider: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const formattedUsers = users.map(user => ({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role.name,
      providerName: user.loanProvider?.name || 'N/A',
      providerId: user.loanProvider?.id,
      status: user.status,
    }));

    return NextResponse.json(formattedUsers);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const ipAddress = req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';
  try {

    const body = await req.json();
    const { password, role: roleName, providerId, ...userData } = userSchema.parse(body);

    const logDetails = { userEmail: userData.email, assignedRole: roleName };
    await createAuditLog({ actorId: session.userId, action: 'USER_CREATE_INITIATED', entity: 'USER', details: logDetails, ipAddress, userAgent });

    if (!password) {
      throw new Error('Password is required for new users.');
    }

    const role = await prisma.role.findUnique({ where: { name: roleName }});
    if (!role) {
      throw new Error('Invalid role selected.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const dataToCreate: any = {
        ...userData,
        password: hashedPassword,
        roleId: role.id,
    };
    
    if (providerId) {
        dataToCreate.loanProviderId = providerId;
    }

    const newUser = await prisma.user.create({
      data: dataToCreate,
    });
    
    const successLogDetails = { createdUserId: newUser.id, createdUserEmail: newUser.email, assignedRole: roleName };
    await createAuditLog({ actorId: session.userId, action: 'USER_CREATE_SUCCESS', entity: 'USER', entityId: newUser.id, details: successLogDetails, ipAddress, userAgent });

    // Never return password hashes (or other auth secrets) in API responses.
    const createdUser = await prisma.user.findUnique({
      where: { id: newUser.id },
      include: { role: true, loanProvider: true },
    });

    if (!createdUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: createdUser.id,
        fullName: createdUser.fullName,
        email: createdUser.email,
        phoneNumber: createdUser.phoneNumber,
        role: createdUser.role.name,
        providerName: createdUser.loanProvider?.name || 'N/A',
        providerId: createdUser.loanProvider?.id,
        status: createdUser.status,
        passwordChangeRequired: createdUser.passwordChangeRequired,
      },
      { status: 201 }
    );
  } catch (error) {
     const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
     const failureLogDetails = { error: errorMessage };
     await createAuditLog({ actorId: session.userId, action: 'USER_CREATE_FAILED', entity: 'USER', details: failureLogDetails, ipAddress, userAgent });
     console.error(JSON.stringify({ ...failureLogDetails, action: 'USER_CREATE_FAILED', actorId: session.userId }));
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: errorMessage || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const ipAddress = req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';
  try {

    const body = await req.json();
    const { id, role: roleName, providerId, ...userData } = body;

    if (!id) {
        throw new Error('User ID is required for an update.');
    }

    const existingUser = await prisma.user.findUnique({ where: { id }, select: { roleId: true, status: true } });
    if (!existingUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const logDetails = { updatedUserId: id, updatedFields: Object.keys(userData) };
    await createAuditLog({ actorId: session.userId, action: 'USER_UPDATE_INITIATED', entity: 'USER', entityId: id, details: logDetails, ipAddress, userAgent });

    let dataToUpdate: any = { ...userData };

    let roleChanged = false;
    const statusChanged = typeof userData?.status === 'string' && userData.status !== existingUser.status;

    if (roleName) {
        const role = await prisma.role.findUnique({ where: { name: roleName }});
        if (!role) {
            throw new Error('Invalid role selected.');
        }
        dataToUpdate.roleId = role.id;
      roleChanged = role.id !== existingUser.roleId;
    }
    
    // Handle providerId relationship
    if (providerId === null) {
        dataToUpdate.loanProviderId = null;
    } else if (providerId) {
        dataToUpdate.loanProviderId = providerId;
    }


    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
    });

    if (roleChanged || statusChanged) {
      try {
        await revokeAllUserSessions(id);
      } catch (e) {
        console.error('Failed to revoke user sessions after privilege change:', e);
      }
    }
    
    const successLogDetails = { updatedUserId: id, updatedFields: Object.keys(userData) };
    await createAuditLog({ actorId: session.userId, action: 'USER_UPDATE_SUCCESS', entity: 'USER', entityId: id, details: successLogDetails, ipAddress, userAgent });

    // Never return password hashes (or other auth secrets) in API responses.
    const updatedUserFull = await prisma.user.findUnique({
      where: { id: updatedUser.id },
      include: { role: true, loanProvider: true },
    });

    if (!updatedUserFull) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    return NextResponse.json({
      id: updatedUserFull.id,
      fullName: updatedUserFull.fullName,
      email: updatedUserFull.email,
      phoneNumber: updatedUserFull.phoneNumber,
      role: updatedUserFull.role.name,
      providerName: updatedUserFull.loanProvider?.name || 'N/A',
      providerId: updatedUserFull.loanProvider?.id,
      status: updatedUserFull.status,
      passwordChangeRequired: updatedUserFull.passwordChangeRequired,
    });
  } catch (error) {
    const errorMessage = (error as Error).message;
    const failureLogDetails = { error: errorMessage };
    await createAuditLog({ actorId: session.userId, action: 'USER_UPDATE_FAILED', entity: 'USER', details: failureLogDetails, ipAddress, userAgent });
    console.error(JSON.stringify({ ...failureLogDetails, action: 'USER_UPDATE_FAILED', actorId: session.userId }));
    return NextResponse.json({ error: errorMessage || 'Internal Server Error' }, { status: 500 });
  }
}
