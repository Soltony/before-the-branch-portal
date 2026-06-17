'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export function DisbursementControlClient({
  initialEnabled,
  canUpdate,
}: {
  initialEnabled: boolean;
  canUpdate: boolean;
}) {
  const { toast } = useToast();
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [saving, setSaving] = React.useState(false);

  const onToggle = async (next: boolean) => {
    if (!canUpdate) {
      return;
    }

    setEnabled(next);
    setSaving(true);

    try {
      const res = await fetch('/api/settings/disbursement-control', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEnabled(!next);
        toast({
          title: 'Update failed',
          description: data?.error ? String(data.error) : 'Failed to update disbursement control.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: next ? 'Disbursements enabled' : 'Disbursements disabled',
        description: next
          ? 'All disbursement endpoints are now active.'
          : 'All disbursement endpoints are now blocked.',
      });
    } catch (e: any) {
      setEnabled(!next);
      toast({
        title: 'Network error',
        description: String(e?.message ?? e),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Disbursement Control</CardTitle>
          <CardDescription>
            Toggle to stop all disbursements (external + internal) immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-1">
              <Label htmlFor="disbursements-enabled">Disbursements Enabled</Label>
              <div className="text-sm text-muted-foreground">
                {enabled ? 'Enabled' : 'Disabled'}{saving ? ' (saving...)' : ''}
              </div>
              {!canUpdate ? (
                <div className="text-sm text-muted-foreground">
                  You have read-only access to this control.
                </div>
              ) : null}
            </div>
            <Switch
              id="disbursements-enabled"
              checked={enabled}
              onCheckedChange={onToggle}
              disabled={saving || !canUpdate}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
