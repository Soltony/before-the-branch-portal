import { requireServerPermission } from '@/lib/require-permission';
import { getUserFromSession } from '@/lib/user';
import { DisbursementControlClient } from './client';
import { getDisbursementControl } from '@/lib/disbursement-control';

export default async function DisbursementControlPage() {
  await requireServerPermission('disbursement-control');

  const user = await getUserFromSession();
  if (!user) return <div>Not authenticated</div>;

  const control = await getDisbursementControl();

  return (
    <DisbursementControlClient
      initialEnabled={control.enabled}
      canUpdate={!!user.permissions?.['disbursement-control']?.update}
    />
  );
}
