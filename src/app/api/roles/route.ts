

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { z } from 'zod';
import { createAuditLog } from '@/lib/audit-log';
import { getUserFromSession } from '@/lib/user';
import { revokeAllUserSessions } from '@/lib/session';

const permissionsSchema = z.record(z.string(), z.object({
  create: z.boolean(),
  read: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
}));

const roleSchema = z.object({
  name: z.string().min(1, 'Role name is required'),
  permissions: permissionsSchema,
});


export async function GET() {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['access-control']?.read) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

  try {
    const roles = await prisma.role.findMany({
        orderBy: {
            name: 'asc'
        }
    });
    
    // Prisma stores permissions as a JSON string, so we need to parse it.
    const formattedRoles = roles.map(role => ({
        ...role,
        permissions: JSON.parse(role.permissions),
    }));

    return NextResponse.json(formattedRoles);
  } catch (error) {
    console.error('Error fetching roles:', error);
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

    try {
        const body = await req.json();
        const { name, permissions } = roleSchema.parse(body);
        
        // Vertical Escalation Prevention: Non-super admins cannot create roles with more permissions than they have.
        if (user.role !== 'Super Admin') {
            for (const module in permissions) {
                for (const action in permissions[module]) {
                    if (permissions[module][action as keyof typeof permissions[module]] && !user.permissions[module]?.[action as keyof typeof permissions[module]]) {
                        return NextResponse.json({ error: `You cannot grant permission for an action you do not have: ${module}.${action}`}, { status: 403 });
                    }
                }
            }
        }

        const logDetails = { roleName: name };
        await createAuditLog({ actorId: user.id, action: 'ROLE_CREATE_INITIATED', entity: 'ROLE', details: logDetails, ipAddress, userAgent });

        const newRole = await prisma.role.create({
            data: {
                name,
                permissions: JSON.stringify(permissions),
            },
        });
        
        const successLogDetails = { roleId: newRole.id, roleName: newRole.name };
        await createAuditLog({ actorId: user.id, action: 'ROLE_CREATE_SUCCESS', entity: 'ROLE', entityId: newRole.id, details: successLogDetails, ipAddress, userAgent });

        return NextResponse.json({ ...newRole, permissions }, { status: 201 });
    } catch (error) {
        const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
        const failureLogDetails = { error: errorMessage };
        await createAuditLog({ actorId: user.id, action: 'ROLE_CREATE_FAILED', entity: 'ROLE', details: failureLogDetails, ipAddress, userAgent });
        console.error(JSON.stringify({ ...failureLogDetails, action: 'ROLE_CREATE_FAILED', actorId: user.id }));
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
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
        const { id, name, permissions } = roleSchema.extend({ id: z.string() }).parse(body);

        // Vertical Escalation Prevention: Non-super admins cannot grant more permissions than they have
        if (user.role !== 'Super Admin') {
            for (const module in permissions) {
                for (const action in permissions[module]) {
                    if (permissions[module][action as keyof typeof permissions[module]] && !user.permissions[module]?.[action as keyof typeof permissions[module]]) {
                        return NextResponse.json({ error: `You cannot grant permission for an action you do not have: ${module}.${action}`}, { status: 403 });
                    }
                }
            }
        }
        
        // Prevent editing the Super Admin role by anyone other than a Super Admin
        const roleToEdit = await prisma.role.findUnique({ where: { id } });
        if (roleToEdit?.name === 'Super Admin' && user.role !== 'Super Admin') {
            return NextResponse.json({ error: 'Only Super Admins can modify the Super Admin role.' }, { status: 403 });
        }


        const logDetails = { roleId: id, roleName: name };
        await createAuditLog({ actorId: user.id, action: 'ROLE_UPDATE_INITIATED', entity: 'ROLE', entityId: id, details: logDetails, ipAddress, userAgent });

                const updatedRole = await prisma.role.update({
            where: { id },
            data: {
                name,
                permissions: JSON.stringify(permissions),
            },
        });

                // Privilege update control: if a role's permissions change, invalidate sessions
                // for all users assigned to that role so new permissions take effect immediately.
                try {
                    const users = await prisma.user.findMany({ where: { roleId: id }, select: { id: true } });
                    await Promise.all(users.map((u) => revokeAllUserSessions(u.id)));
                } catch (e) {
                    console.error('Failed to revoke sessions after role permission update:', e);
                }
        
        const successLogDetails = { roleId: updatedRole.id, roleName: updatedRole.name };
        await createAuditLog({ actorId: user.id, action: 'ROLE_UPDATE_SUCCESS', entity: 'ROLE', entityId: updatedRole.id, details: successLogDetails, ipAddress, userAgent });


        return NextResponse.json({ ...updatedRole, permissions });
    } catch (error) {
        const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
        const failureLogDetails = { error: errorMessage };
        await createAuditLog({ actorId: user.id, action: 'ROLE_UPDATE_FAILED', entity: 'ROLE', details: failureLogDetails, ipAddress, userAgent });
        console.error(JSON.stringify({ ...failureLogDetails, action: 'ROLE_UPDATE_FAILED', actorId: user.id }));
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['access-control']?.delete) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';
    let roleId = '';
    try {
        const { id } = await req.json();
        roleId = id;
        if (!id) {
            return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
        }
        
        // Prevent deleting core roles
        const roleToDelete = await prisma.role.findUnique({ where: { id }});
        if (['Super Admin', 'Admin', 'Loan Provider'].includes(roleToDelete?.name || '')) {
            return NextResponse.json({ error: `Cannot delete the core role: "${roleToDelete?.name}".`}, { status: 400 });
        }


        const logDetails = { roleId: id };
        await createAuditLog({ actorId: user.id, action: 'ROLE_DELETE_INITIATED', entity: 'ROLE', entityId: id, details: logDetails, ipAddress, userAgent });
        
        // Check if any user is assigned to this role
        const usersWithRole = await prisma.user.count({ where: { roleId: id } });
        if (usersWithRole > 0) {
            throw new Error('Cannot delete role. It is currently assigned to one or more users.');
        }

        await prisma.role.delete({
            where: { id },
        });

        const successLogDetails = { deletedRoleId: id, deletedRoleName: roleToDelete?.name };
        await createAuditLog({ actorId: user.id, action: 'ROLE_DELETE_SUCCESS', entity: 'ROLE', entityId: id, details: successLogDetails, ipAddress, userAgent });

        return NextResponse.json({ message: 'Role deleted successfully' });

    } catch (error) {
        const errorMessage = (error as Error).message;
        const failureLogDetails = { roleId: roleId, error: errorMessage };
        await createAuditLog({ actorId: user.id, action: 'ROLE_DELETE_FAILED', entity: 'ROLE', entityId: roleId, details: failureLogDetails, ipAddress, userAgent });
        console.error(JSON.stringify({ ...failureLogDetails, action: 'ROLE_DELETE_FAILED', actorId: user.id }));
        return NextResponse.json({ error: errorMessage || 'Internal Server Error' }, { status: 500 });
    }
}
