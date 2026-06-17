
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { z } from 'zod';
import { createAuditLog } from '@/lib/audit-log';
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
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';

    try {
        const body = await req.json();
        const { name, permissions } = roleSchema.parse(body);
        
        const logDetails = { roleName: name };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_CREATE_INITIATED', entity: 'ROLE', details: logDetails, ipAddress, userAgent });

        const newRole = await prisma.role.create({
            data: {
                name,
                permissions: JSON.stringify(permissions),
            },
        });
        
        const successLogDetails = { roleId: newRole.id, roleName: newRole.name };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_CREATE_SUCCESS', entity: 'ROLE', entityId: newRole.id, details: successLogDetails, ipAddress, userAgent });

        return NextResponse.json({ ...newRole, permissions }, { status: 201 });
    } catch (error) {
        const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
        const failureLogDetails = { error: errorMessage };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_CREATE_FAILED', entity: 'ROLE', details: failureLogDetails, ipAddress, userAgent });
        console.error(JSON.stringify({ ...failureLogDetails, action: 'ROLE_CREATE_FAILED', actorId: session.userId }));
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';
    try {
        const body = await req.json();
        const { id, name, permissions } = roleSchema.extend({ id: z.string() }).parse(body);

        const logDetails = { roleId: id, roleName: name };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_UPDATE_INITIATED', entity: 'ROLE', entityId: id, details: logDetails, ipAddress, userAgent });

        const updatedRole = await prisma.role.update({
            where: { id },
            data: {
                name,
                permissions: JSON.stringify(permissions),
            },
        });

                // Privilege update control: invalidate sessions for users of this role.
                try {
                    const users = await prisma.user.findMany({ where: { roleId: id }, select: { id: true } });
                    await Promise.all(users.map((u) => revokeAllUserSessions(u.id)));
                } catch (e) {
                    console.error('Failed to revoke sessions after role permission update:', e);
                }
        
        const successLogDetails = { roleId: updatedRole.id, roleName: updatedRole.name };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_UPDATE_SUCCESS', entity: 'ROLE', entityId: updatedRole.id, details: successLogDetails, ipAddress, userAgent });


        return NextResponse.json({ ...updatedRole, permissions });
    } catch (error) {
        const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
        const failureLogDetails = { error: errorMessage };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_UPDATE_FAILED', entity: 'ROLE', details: failureLogDetails, ipAddress, userAgent });
        console.error(JSON.stringify({ ...failureLogDetails, action: 'ROLE_UPDATE_FAILED', actorId: session.userId }));
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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

        const logDetails = { roleId: id };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_DELETE_INITIATED', entity: 'ROLE', entityId: id, details: logDetails, ipAddress, userAgent });
        
        // Check if any user is assigned to this role
        const usersWithRole = await prisma.user.count({ where: { roleId: id } });
        if (usersWithRole > 0) {
            throw new Error('Cannot delete role. It is currently assigned to one or more users.');
        }
        
        const roleToDelete = await prisma.role.findUnique({ where: { id }});

        await prisma.role.delete({
            where: { id },
        });

        const successLogDetails = { deletedRoleId: id, deletedRoleName: roleToDelete?.name };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_DELETE_SUCCESS', entity: 'ROLE', entityId: id, details: successLogDetails, ipAddress, userAgent });

        return NextResponse.json({ message: 'Role deleted successfully' });

    } catch (error) {
        const errorMessage = (error as Error).message;
        const failureLogDetails = { roleId: roleId, error: errorMessage };
        await createAuditLog({ actorId: session.userId, action: 'ROLE_DELETE_FAILED', entity: 'ROLE', entityId: roleId, details: failureLogDetails, ipAddress, userAgent });
        console.error(JSON.stringify({ ...failureLogDetails, action: 'ROLE_DELETE_FAILED', actorId: session.userId }));
        return NextResponse.json({ error: errorMessage || 'Internal Server Error' }, { status: 500 });
    }
}
