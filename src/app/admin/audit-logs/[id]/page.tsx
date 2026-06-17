import Link from 'next/link';
import prisma from '@/lib/prisma';
import { requireServerPermission } from '@/lib/require-permission';
import { getUserFromSession } from '@/lib/user';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function safeParseJson(text: string | null | undefined): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function omitFileContentForDisplay(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(omitFileContentForDisplay);

  const out: any = {};
  for (const k of Object.keys(value)) {
    if (k === 'fileContent') {
      out[k] = '[omitted: fileContent]';
      continue;
    }
    out[k] = omitFileContentForDisplay(value[k]);
  }
  return out;
}

export default async function AuditLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireServerPermission('audit-logs', 'read');

  const { id } = await params;

  const user = await getUserFromSession();
  const isPrivileged = user?.role === 'Super Admin' || user?.role === 'Auditor';

  const log = await prisma.auditLog.findUnique({ where: { id } });
  if (!log) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Audit Log Detail</h1>
          <Button asChild variant="ghost">
            <Link href="/admin/audit-logs">Back</Link>
          </Button>
        </div>
        <Card>
          <CardContent>
            <div className="py-8 text-center">Not found.</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const actor = await prisma.user.findUnique({
    where: { id: log.actorId },
    select: { id: true, fullName: true, email: true },
  });

  const sanitizedLog = isPrivileged
    ? log
    : {
        id: log.id,
        actorId: log.actorId,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        createdAt: log.createdAt,
        ipAddress: null,
        details: null,
        userAgent: null,
      };

  const detailsObj = safeParseJson(isPrivileged ? log.details : null);
  const changeId = detailsObj?.changeRequestId || detailsObj?.changeId;

  const change =
    typeof changeId === 'string' && changeId.trim() && isPrivileged
      ? await prisma.pendingChange.findUnique({
          where: { id: changeId },
          include: {
            createdBy: { select: { id: true, fullName: true, email: true } },
            approvedBy: { select: { id: true, fullName: true, email: true } },
          },
        })
      : null;

  const changePayloadObj = safeParseJson(change?.payload);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Audit Log Detail</h1>
        <Button asChild className="bg-yellow-500 text-black hover:bg-yellow-600">
          <Link href="/admin/audit-logs">Back</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Log #{sanitizedLog.id}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="text-muted-foreground">Date</div>
              <div className="col-span-2 font-mono">{format(new Date(sanitizedLog.createdAt), 'yyyy-MM-dd HH:mm:ss')}</div>

              <div className="text-muted-foreground">Actor</div>
              <div className="col-span-2">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{actor?.fullName || 'Unknown user'}</span>
                  <span className="text-xs text-muted-foreground font-mono break-all">{actor?.email || sanitizedLog.actorId}</span>
                </div>
              </div>

              <div className="text-muted-foreground">Action</div>
              <div className="col-span-2">{sanitizedLog.action}</div>

              <div className="text-muted-foreground">Entity</div>
              <div className="col-span-2">{sanitizedLog.entity || '—'}</div>

              <div className="text-muted-foreground">Entity ID</div>
              <div className="col-span-2 font-mono break-all">{sanitizedLog.entityId || '—'}</div>

              <div className="text-muted-foreground">IP Address</div>
              <div className="col-span-2 font-mono break-all">{(sanitizedLog as any).ipAddress || 'N/A'}</div>

              <div className="text-muted-foreground">User Agent</div>
              <div className="col-span-2 font-mono break-all">{(sanitizedLog as any).userAgent || 'N/A'}</div>
            </div>

            <div>
              <div className="text-sm font-medium">Details</div>
              <pre className="mt-2 w-full overflow-auto rounded-md bg-muted p-4 text-sm">
                <code>{prettyJson(omitFileContentForDisplay(detailsObj))}</code>
              </pre>
            </div>

            {change && (
              <>
                <div className="text-sm font-medium">Change Request</div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-muted-foreground">Status</div>
                  <div className="col-span-2">{change.status}</div>

                  <div className="text-muted-foreground">Type</div>
                  <div className="col-span-2">{change.changeType}</div>

                  <div className="text-muted-foreground">Requested By</div>
                  <div className="col-span-2">{change.createdBy ? `${change.createdBy.fullName} (${change.createdBy.email})` : change.createdById}</div>

                  <div className="text-muted-foreground">Approved By</div>
                  <div className="col-span-2">{change.approvedBy ? `${change.approvedBy.fullName} (${change.approvedBy.email})` : (change.approvedById || '—')}</div>

                  <div className="text-muted-foreground">Approved At</div>
                  <div className="col-span-2 font-mono">{change.approvedAt ? format(new Date(change.approvedAt), 'yyyy-MM-dd HH:mm:ss') : '—'}</div>

                  <div className="text-muted-foreground">Rejection Reason</div>
                  <div className="col-span-2">{change.rejectionReason || '—'}</div>
                </div>

                <div>
                  <div className="text-sm font-medium">Change Payload</div>
                  <pre className="mt-2 w-full overflow-auto rounded-md bg-muted p-4 text-sm">
                    <code>{prettyJson(omitFileContentForDisplay(changePayloadObj))}</code>
                  </pre>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
