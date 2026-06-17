

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { z, ZodError } from 'zod';
import { loginSchema, passwordSchema, phoneNumberSchema } from '@/lib/validators';
import { validationErrorResponse, handleApiError } from '@/lib/error-utils';
import { isBlocked, recordFailedAttempt, resetAttempts, getRemainingAttempts, getBackoffSeconds, getLockRemainingMs } from '@/lib/rate-limiter';
import { createAuditLog } from '@/lib/audit-log';
import { getUserFromSession } from '@/lib/user';
import { revokeAllUserSessions } from '@/lib/session';
import { branchIdToCode, getBranchLabel } from '@/lib/branches';

const userSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  phoneNumber: phoneNumberSchema,
  // password is validated with the stronger shared login schema below
  password: z.string().optional(),
  role: z.string(), // Role name, will be connected by ID
  providerId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  branchCode: z.number().int().positive().nullable().optional(),
  status: z.enum(['Active', 'Inactive']),
});

function resolveBranchCode(
  roleName: string,
  branchId?: string | null,
  branchCode?: number | null
): number | null {
  if (roleName !== 'Branch') return null;
  if (branchCode != null) return branchCode;
  if (branchId) return branchIdToCode(branchId);
  return null;
}

export async function GET() {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['access-control']?.read) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

  try {
    // Horizontal access control: non-super-admins can only see users of their own provider or unassigned users
    const whereClause: any = {};
    if (user.role !== 'Super Admin' && user.loanProviderId) {
        whereClause.OR = [
            { loanProviderId: user.loanProviderId },
            { loanProviderId: null }
        ];
    }


    const users = await prisma.user.findMany({
      where: whereClause,
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
      branchCode: user.branchCode,
      branchName: user.branchCode != null ? getBranchLabel(user.branchCode) : undefined,
      status: user.status,
    }));

    return NextResponse.json(formattedUsers);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['access-control']?.create) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';
    const ipAddressKey = req.ip || req.headers.get('x-forwarded-for') || 'unknown-ip';
    const rateKey = `createUser:${user.id}:${ipAddressKey}`;

    // Quick rate-limit check to avoid heavy processing when the caller is blocked
    if (isBlocked(rateKey)) {
      const lockMs = getLockRemainingMs(rateKey);
      const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
      return NextResponse.json({ error: 'Too many attempts. Try again later.', retryAfter: retryAfterSeconds }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });
    }
  try {

    const body = await req.json();
    const { password, role: roleName, providerId, branchId, branchCode: branchCodeInput, ...userData } = userSchema.parse(body);
    const branchCode = resolveBranchCode(roleName, branchId, branchCodeInput);
    if (roleName === 'Branch' && branchCode == null) {
      return NextResponse.json({ error: 'Branch selection is required for Branch role users.' }, { status: 400 });
    }
    // Validate password with the stronger shared password rules (includes breach check)
    try {
      // Use the exported `passwordSchema` which includes the async HaveIBeenPwned check.
      // Wrap into an object so we can pass the same shape as before.
      const pwWrapper = z.object({ password: passwordSchema });
      await pwWrapper.parseAsync({ password });
    } catch (err) {
      if (err instanceof ZodError) {
        // record failed attempt and apply the same lockout/backoff behavior as login
        recordFailedAttempt(rateKey);
        if (isBlocked(rateKey)) {
          const lockMs = getLockRemainingMs(rateKey);
          const retryAfterSeconds = Math.ceil(lockMs / 1000) || 1;
          return NextResponse.json({ error: 'Too many attempts. Try again later.', retryAfter: retryAfterSeconds }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });
        }
        const backoff = getBackoffSeconds(rateKey);
        if (backoff > 0) await new Promise((res) => setTimeout(res, backoff * 1000));
        const remaining = getRemainingAttempts(rateKey);
        // Return sanitized validation issues
        return NextResponse.json({ error: 'Invalid password.', retriesLeft: remaining, delaySeconds: backoff, issues: err.errors }, { status: 400 });
      }
      // Unexpected error: log & return generic message
      return handleApiError(err, { operation: 'POST /api/users' });
    }

    const logDetails = { userEmail: userData.email, assignedRole: roleName };
    await createAuditLog({ actorId: user.id, action: 'USER_CREATE_INITIATED', entity: 'USER', details: logDetails, ipAddress, userAgent });

    if (!password) {
      throw new Error('Password is required for new users.');
    }

    const role = await prisma.role.findUnique({ where: { name: roleName }});
    if (!role) {
      throw new Error('Invalid role selected.');
    }

    // Vertical Escalation Prevention
    if (user.role !== 'Super Admin' && (role.name === 'Super Admin' || role.name === 'Admin')) {
        return NextResponse.json({ error: 'You cannot create a user with a higher-privileged role.' }, { status: 403 });
    }
    // Horizontal Escalation Prevention
    if (user.role !== 'Super Admin' && providerId && providerId !== user.loanProviderId) {
        return NextResponse.json({ error: 'You can only create users for your own provider.' }, { status: 403 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const dataToCreate: any = {
        ...userData,
        password: hashedPassword,
        passwordChangeRequired: true, // Force password change on first login
        roleId: role.id,
        branchCode,
    };
    
    // Only assign providerId if the creator is allowed to and the role requires it
    if (user.role === 'Super Admin' || (user.loanProviderId && providerId === user.loanProviderId)) {
       if (providerId) {
            dataToCreate.loanProviderId = providerId;
        }
    }


    const newUser = await prisma.user.create({
      data: dataToCreate,
    });
    
    // Successful creation: clear recorded failed attempts for this creator+ip
    try { resetAttempts(rateKey); } catch (e) { /* noop */ }

    const successLogDetails = { createdUserId: newUser.id, createdUserEmail: newUser.email, assignedRole: roleName };
    await createAuditLog({ actorId: user.id, action: 'USER_CREATE_SUCCESS', entity: 'USER', entityId: newUser.id, details: successLogDetails, ipAddress, userAgent });


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
        branchCode: createdUser.branchCode,
        branchName: createdUser.branchCode != null ? getBranchLabel(createdUser.branchCode) : undefined,
        status: createdUser.status,
        passwordChangeRequired: createdUser.passwordChangeRequired,
      },
      { status: 201 }
    );
  } catch (error) {
    const errorMessage = (error instanceof ZodError) ? error.errors : (error as Error).message;
     const failureLogDetails = { error: errorMessage };
     await createAuditLog({ actorId: user.id, action: 'USER_CREATE_FAILED', entity: 'USER', details: failureLogDetails, ipAddress, userAgent });
     console.error(JSON.stringify({ ...failureLogDetails, action: 'USER_CREATE_FAILED', actorId: user.id }));
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid request', issues: error.errors }, { status: 400 });
    }
    return handleApiError(error, { operation: 'POST /api/users' });
  }
}

export async function PUT(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['access-control']?.update) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';
  try {

    const body = await req.json();
    const { id, role: roleName, providerId, branchId, branchCode: branchCodeInput, password, ...userData } = body;

    if (!id) {
        throw new Error('User ID is required for an update.');
    }

    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: { roleId: true, status: true },
    });
    if (!existingUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    
    // Horizontal access control: non-super-admins can only edit users in their own provider or unassigned users
    if (user.role !== 'Super Admin' && user.loanProviderId) {
        const userToEdit = await prisma.user.findUnique({ where: { id }});
        if (userToEdit && userToEdit.loanProviderId && userToEdit.loanProviderId !== user.loanProviderId) {
            return NextResponse.json({ error: 'You do not have permission to edit this user.' }, { status: 403 });
        }
    }


    const logDetails = { updatedUserId: id, updatedFields: Object.keys(userData) };
    await createAuditLog({ actorId: user.id, action: 'USER_UPDATE_INITIATED', entity: 'USER', entityId: id, details: logDetails, ipAddress, userAgent });

    let dataToUpdate: any = { ...userData };

    const passwordWasReset = !!password;
    let roleChanged = false;
    const statusChanged = typeof userData?.status === 'string' && userData.status !== existingUser.status;

    if (roleName) {
        const role = await prisma.role.findUnique({ where: { name: roleName }});
        if (!role) {
            throw new Error('Invalid role selected.');
        }
        
        // Vertical Escalation Prevention
        if (user.role !== 'Super Admin' && (role.name === 'Super Admin' || role.name === 'Admin')) {
            return NextResponse.json({ error: 'You cannot assign a higher-privileged role.' }, { status: 403 });
        }

    dataToUpdate.roleId = role.id;
    roleChanged = role.id !== existingUser.roleId;

    if (role.name === 'Branch') {
      const resolvedBranchCode = resolveBranchCode(role.name, branchId, branchCodeInput);
      if (resolvedBranchCode == null) {
        return NextResponse.json({ error: 'Branch selection is required for Branch role users.' }, { status: 400 });
      }
      dataToUpdate.branchCode = resolvedBranchCode;
    } else {
      dataToUpdate.branchCode = null;
    }
    }
    
    if (password) {
      try {
        const pwWrapper = z.object({ password: passwordSchema });
        await pwWrapper.parseAsync({ password });
      } catch (err) {
        if (err instanceof ZodError) {
          return NextResponse.json({ error: 'Invalid password', issues: err.errors }, { status: 400 });
        }
        throw err;
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      dataToUpdate.password = hashedPassword;
      dataToUpdate.passwordChangeRequired = true; // Force user to change password on next login
    }

    // Handle providerId relationship
    if (user.role === 'Super Admin') {
        if (providerId === null) {
            dataToUpdate.loanProviderId = null;
        } else if (providerId) {
            dataToUpdate.loanProviderId = providerId;
        }
    } else if (user.loanProviderId) {
        // Non-super-admins can only assign users to their own provider
        if (providerId && providerId !== user.loanProviderId) {
             return NextResponse.json({ error: 'You can only assign users to your own provider.' }, { status: 403 });
        }
        dataToUpdate.loanProviderId = providerId;
    }


    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
    });

    // Privilege/session lifecycle control:
    // - role changes => revoke sessions (permissions may change)
    // - account deactivation => revoke sessions
    // - password reset / forced password change => revoke sessions
    if (roleChanged || statusChanged || passwordWasReset || dataToUpdate.passwordChangeRequired === true) {
      try {
        await revokeAllUserSessions(id);
      } catch (e) {
        console.error('Failed to revoke user sessions after privilege change:', e);
      }
    }
    
    const successLogDetails = { updatedUserId: id, updatedFields: Object.keys(dataToUpdate) };
    await createAuditLog({ actorId: user.id, action: 'USER_UPDATE_SUCCESS', entity: 'USER', entityId: id, details: successLogDetails, ipAddress, userAgent });

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
      branchCode: updatedUserFull.branchCode,
      branchName: updatedUserFull.branchCode != null ? getBranchLabel(updatedUserFull.branchCode) : undefined,
      status: updatedUserFull.status,
      passwordChangeRequired: updatedUserFull.passwordChangeRequired,
    });
  } catch (error) {
    const errorMessage = (error as Error).message;
    const failureLogDetails = { error: errorMessage };
    await createAuditLog({ actorId: user.id, action: 'USER_UPDATE_FAILED', entity: 'USER', details: failureLogDetails, ipAddress, userAgent });
    console.error(JSON.stringify({ ...failureLogDetails, action: 'USER_UPDATE_FAILED', actorId: user.id }));
    return handleApiError(error, { operation: 'PUT /api/users', info: { userId: body?.id } });
  }
}
