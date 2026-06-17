"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Role, Permissions } from "@/lib/types";
import { produce } from "immer";
import { allMenuItems } from "@/lib/menu-items";

interface AddRoleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (role: Omit<Role, "id">) => void;
  role: Role | null;
  primaryColor?: string;
}

const PERMISSION_MODULES: (keyof Permissions)[] = allMenuItems
  .map(
    (item) => item.label.toLowerCase().replace(/\s+/g, "-") as keyof Permissions
  )
  .concat(["providers", "products"]);
const PERMISSION_ACTIONS: (keyof Permissions[keyof Permissions])[] = [
  "create",
  "read",
  "update",
  "delete",
];

const initialPermissions = PERMISSION_MODULES.reduce((acc, module) => {
  acc[module] = { create: false, read: false, update: false, delete: false };
  return acc;
}, {} as Permissions);

export function AddRoleDialog({
  isOpen,
  onClose,
  onSave,
  role,
  primaryColor = "#fdb913",
}: AddRoleDialogProps) {
  const [roleName, setRoleName] = useState("");
  const [permissions, setPermissions] =
    useState<Permissions>(initialPermissions);

  useEffect(() => {
    if (role) {
      setRoleName(role.name);
      // Deep merge existing permissions with the full structure to handle new modules
      const mergedPermissions = produce(initialPermissions, (draft) => {
        for (const module in role.permissions) {
          if (draft[module as keyof Permissions]) {
            Object.assign(
              draft[module as keyof Permissions],
              role.permissions[module as keyof Permissions]
            );
          }
        }
      });
      setPermissions(mergedPermissions);
    } else {
      setRoleName("");
      setPermissions(initialPermissions);
    }
  }, [role, isOpen]);

  const handlePermissionChange = (
    module: keyof Permissions,
    action: keyof Permissions[keyof Permissions]
  ) => {
    setPermissions(
      produce((draft) => {
        draft[module][action] = !draft[module][action];
      })
    );
  };

  const handleSelectAll = (module: keyof Permissions) => {
    const allChecked = PERMISSION_ACTIONS.every(
      (action) => permissions[module]?.[action]
    );
    setPermissions(
      produce((draft) => {
        PERMISSION_ACTIONS.forEach((action) => {
          if (!draft[module]) {
            draft[module] = {
              create: false,
              read: false,
              update: false,
              delete: false,
            };
          }
          draft[module][action] = !allChecked;
        });
      })
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name: roleName, permissions });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{role ? "Edit Role" : "Add New Role"}</DialogTitle>
          <DialogDescription>
            {role
              ? "Update the details of the existing role."
              : "Define a new role and its permissions."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="roleName" className="text-right">
              Role Name
            </Label>
            <Input
              id="roleName"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              className="col-span-3"
              required
            />
          </div>

          <div>
            <Label>Permissions</Label>
            <Card className="mt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead className="text-center">Create</TableHead>
                    <TableHead className="text-center">Read</TableHead>
                    <TableHead className="text-center">Update</TableHead>
                    <TableHead className="text-center">Delete</TableHead>
                    <TableHead className="text-center">Select All</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PERMISSION_MODULES.map((module) => (
                    <TableRow key={module}>
                      <TableCell className="font-medium capitalize">
                        {module.replace("-", " ")}
                      </TableCell>
                      {PERMISSION_ACTIONS.map((action) => (
                        <TableCell key={action} className="text-center">
                          <Checkbox
                            checked={permissions[module]?.[action] || false}
                            onCheckedChange={() =>
                              handlePermissionChange(module, action)
                            }
                          />
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        <Checkbox
                          checked={PERMISSION_ACTIONS.every(
                            (action) => permissions[module]?.[action]
                          )}
                          onCheckedChange={() => handleSelectAll(module)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              style={{ backgroundColor: primaryColor }}
              className="text-white"
            >
              {role ? "Save Changes" : "Add Role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
