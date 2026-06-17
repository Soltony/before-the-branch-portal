"use client";

import { useState, useEffect } from "react";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { useAuth } from "@/hooks/use-auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { postPendingChange } from "@/lib/fetch-utils";
import { Loader2, Save, PlusCircle, Trash2 } from "lucide-react";
import type { Tax as TaxConfig } from "@prisma/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { produce } from "immer";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

const TAX_COMPONENTS = [
  { id: "serviceFee", label: "Service Fee" },
  { id: "interest", label: "Daily Fee (Interest)" },
];

function TaxCard({
  tax,
  onSave,
  onDelete,
  canCreate,
  canUpdate,
  canDelete,
}: {
  tax: TaxConfig;
  onSave: (tax: TaxConfig, originalTax?: TaxConfig) => Promise<void>;
  onDelete: (tax: TaxConfig) => Promise<void>;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [config, setConfig] = useState(tax);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const isNew = config.id.startsWith("new-");
  const canEdit =
    config.status !== "PENDING_APPROVAL" && (isNew ? canCreate : canUpdate);

  useEffect(() => {
    setConfig(tax);
  }, [tax]);

  const handleComponentChange = (componentId: string, checked: boolean) => {
    const currentAppliedTo = JSON.parse(config.appliedTo);
    const newAppliedTo = checked
      ? [...currentAppliedTo, componentId]
      : currentAppliedTo.filter((c: string) => c !== componentId);

    setConfig((prev) => ({ ...prev, appliedTo: JSON.stringify(newAppliedTo) }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const numericRate = Number(config.rate);
      if (isNaN(numericRate) || numericRate < 0) {
        toast({
          title: "Invalid Rate",
          description: "Tax rate must be a positive number.",
          variant: "destructive",
        });
        return;
      }
      const sanitizedAppliedTo = (() => {
        try {
          const appliedTo = JSON.parse(config.appliedTo || "[]");
          const filtered = Array.isArray(appliedTo)
            ? appliedTo.filter((c: unknown) => c !== "penalty")
            : [];
          return JSON.stringify(filtered);
        } catch {
          return "[]";
        }
      })();
      await onSave(
        { ...config, rate: numericRate, appliedTo: sanitizedAppliedTo },
        tax,
      );
      if (!config.id.startsWith("new-")) {
        setConfig((prev) =>
          produce(prev, (draft) => {
            draft.status = "PENDING_APPROVAL";
          }),
        );
      }
    } catch (error) {
      // onSave should handle the toast for errors
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(config);
      setConfig((prev) =>
        produce(prev, (draft) => {
          draft.status = "PENDING_APPROVAL";
        }),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>{config.name}</CardTitle>
          {config.status === "PENDING_APPROVAL" && (
            <Badge variant="outline">Pending Approval</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        <div className="space-y-2">
          <Label htmlFor={`tax-name-${config.id}`}>Tax Name</Label>
          <Input
            id={`tax-name-${config.id}`}
            type="text"
            value={config.name || ""}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="e.g., VAT"
            className="max-w-xs"
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`tax-rate-${config.id}`}>Tax Rate (%)</Label>
          <Input
            id={`tax-rate-${config.id}`}
            type="number"
            value={config.rate}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                rate: parseFloat(e.target.value) || 0,
              }))
            }
            placeholder="e.g., 15"
            className="max-w-xs"
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-4">
          <Label>Apply Tax On</Label>
          <div className="space-y-2 rounded-md border p-4">
            {TAX_COMPONENTS.map((component) => (
              <div key={component.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`tax-on-${config.id}-${component.id}`}
                  checked={JSON.parse(config.appliedTo).includes(component.id)}
                  onCheckedChange={(checked) =>
                    handleComponentChange(component.id, !!checked)
                  }
                  disabled={!canEdit}
                />
                <Label
                  htmlFor={`tax-on-${config.id}-${component.id}`}
                  className="font-normal"
                >
                  {component.label}
                </Label>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="space-y-0.5">
              <Label htmlFor={`tax-inclusive-${config.id}`}>
                Inclusive Tax (Deduct from Principal)
              </Label>
              <p className="text-xs text-muted-foreground">
                When enabled, the tax is deducted upfront from the loan amount
                before disbursement.
              </p>
            </div>
            <Switch
              id={`tax-inclusive-${config.id}`}
              checked={!!(config as any).isInclusive}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, isInclusive: checked }))
              }
              disabled={!canEdit}
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button
          variant="destructive"
          onClick={() => setIsDeleting(true)}
          disabled={
            isSaving ||
            isDeleting ||
            config.status === "PENDING_APPROVAL" ||
            !canDelete ||
            isNew
          }
        >
          {isDeleting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Delete
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving || isDeleting || !canEdit}
        >
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {config.status === "PENDING_APPROVAL"
            ? "Pending Approval"
            : "Submit for Approval"}
        </Button>
      </CardFooter>
      <AlertDialog open={isDeleting} onOpenChange={setIsDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will submit a request to delete the "{config.name}" tax
              configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
              disabled={!canDelete || isNew}
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Submit for Deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function TaxSettingsPage() {
  useRequirePermission("tax");
  const { currentUser } = useAuth();
  const [taxes, setTaxes] = useState<TaxConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // Align with backend mapping: Tax actions can be authorized via either the `tax` or `settings` module.
  const canCreate = !!(
    currentUser?.permissions?.tax?.create ||
    currentUser?.permissions?.settings?.create
  );
  const canUpdate = !!(
    currentUser?.permissions?.tax?.update ||
    currentUser?.permissions?.settings?.update
  );
  const canDelete = !!(
    currentUser?.permissions?.tax?.delete ||
    currentUser?.permissions?.settings?.delete
  );

  const fetchTaxConfigs = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/tax");
      if (response.ok) {
        const configs: TaxConfig[] = await response.json();
        setTaxes(configs);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not load tax configurations.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTaxConfigs();
  }, []);

  const handleAddNewTax = () => {
    if (!canCreate) return;
    const newTax: TaxConfig = {
      id: `new-${Date.now()}`,
      name: "New Tax",
      rate: 0,
      appliedTo: "[]",
      isInclusive: false,
      status: "Active",
    };
    setTaxes((prev) => [...prev, newTax]);
  };

  const handleSave = async (taxToSave: TaxConfig, originalTax?: TaxConfig) => {
    const isNew = taxToSave.id.startsWith("new-");
    if (isNew && !canCreate) {
      toast({
        title: "Not authorized",
        description: "Not authorized to perform this action.",
        variant: "destructive",
      });
      return;
    }
    if (!isNew && !canUpdate) {
      toast({
        title: "Not authorized",
        description: "Not authorized to perform this action.",
        variant: "destructive",
      });
      return;
    }
    const changeType = isNew ? "CREATE" : "UPDATE";
    const entityId = isNew ? undefined : taxToSave.id;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...taxDataForCreation } = taxToSave;

    const payload = {
      original: isNew ? null : originalTax,
      updated: isNew ? null : taxToSave,
      created: isNew ? taxDataForCreation : null,
    };

    try {
      await postPendingChange(
        {
          entityType: "Tax",
          entityId,
          changeType,
          payload: JSON.stringify(payload),
        },
        "Failed to submit changes for approval.",
      );

      toast({
        title: "Submitted for Approval",
        description: `Changes for "${taxToSave.name}" have been submitted for review.`,
      });

      if (isNew) {
        await fetchTaxConfigs();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleDelete = async (taxToDelete: TaxConfig) => {
    if (!canDelete) {
      toast({
        title: "Not authorized",
        description: "Not authorized to perform this action.",
        variant: "destructive",
      });
      return;
    }
    if (taxToDelete.id.startsWith("new-")) {
      setTaxes((prev) => prev.filter((t) => t.id !== taxToDelete.id));
      return;
    }

    try {
      await postPendingChange(
        {
          entityType: "Tax",
          entityId: taxToDelete.id,
          changeType: "DELETE",
          payload: JSON.stringify({ original: taxToDelete }),
        },
        "Could not submit deletion for approval.",
      );

      toast({
        title: "Deletion Submitted",
        description: "Tax configuration deletion is pending approval.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  };

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Tax Configuration
          </h2>
          <p className="text-muted-foreground">
            Define universal tax rates and apply them to specific loan
            components.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={handleAddNewTax}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add New Tax
          </Button>
        ) : null}
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : taxes.length > 0 ? (
          taxes.map((tax) => (
            <TaxCard
              key={tax.id}
              tax={tax}
              onSave={handleSave}
              onDelete={handleDelete}
              canCreate={canCreate}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          ))
        ) : (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No tax configurations found.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
