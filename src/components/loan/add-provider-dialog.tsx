
'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Landmark, Briefcase, type LucideIcon, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LoanProvider } from '@/lib/types';
import { IconDisplay } from '@/components/icons';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';

interface AddProviderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (provider: Partial<Omit<LoanProvider, 'products' | 'dataProvisioningConfigs' | 'id' | 'initialBalance'>> & { id?: string }) => void;
  provider: LoanProvider | null;
  primaryColor?: string;
}

const icons: { name: string; component: LucideIcon }[] = [
  { name: 'Building2', component: Building2 },
  { name: 'Landmark', component: Landmark },
  { name: 'Briefcase', component: Briefcase },
];

export function AddProviderDialog({ isOpen, onClose, onSave, provider, primaryColor = '#fdb913' }: AddProviderDialogProps) {
    const [formData, setFormData] = useState({
        name: '',
        icon: icons[0].name,
        colorHex: '#2563eb',
        displayOrder: 0,
      accountNumber: '' as string | null,
      collectionAccount: '' as string | null,
        startingCapital: 0,
        nplThresholdDays: 60,
    });

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (provider) {
        setFormData({
            name: provider.name || '',
            icon: provider.icon || icons[0].name,
            colorHex: provider.colorHex || '#2563eb',
            displayOrder: provider.displayOrder || 0,
            accountNumber: provider.accountNumber || null,
      collectionAccount: (provider as any).collectionAccount || null,
            startingCapital: provider.startingCapital || 0,
            nplThresholdDays: provider.nplThresholdDays || 60,
        });
    } else {
        setFormData({
            name: '',
            icon: icons[0].name,
            colorHex: '#2563eb',
            displayOrder: 0,
            accountNumber: null,
      collectionAccount: null,
            startingCapital: 0,
            nplThresholdDays: 60,
        });
    }
  }, [provider, isOpen]);

  const handleCustomIconUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && (file.type === 'image/svg+xml' || file.type === 'image/png' || file.type === 'image/jpeg')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setFormData(prev => ({...prev, icon: result}));
      };
      reader.readAsDataURL(file);
    } else {
      alert('Please select an SVG, PNG, or JPG file.');
    }
  };

  const handleSelectIcon = (name: string) => {
    setFormData(prev => ({...prev, icon: name}));
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [id]: type === 'number' ? (value === '' ? '' : Number(value)) : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name.trim() === '') return;

    const dataToSave: Partial<Omit<LoanProvider, 'products' | 'dataProvisioningConfigs' | 'id' | 'initialBalance'>> & { id?: string } = {
      id: provider?.id,
      ...formData,
      startingCapital: Number(formData.startingCapital),
      nplThresholdDays: Number(formData.nplThresholdDays)
    };
    
    onSave(dataToSave as any);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{provider ? 'Edit Provider' : 'Add New Loan Provider'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-6 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Name
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g., Acme Financial"
              required
              className="col-span-3"
              style={{'--ring': primaryColor} as React.CSSProperties}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="accountNumber" className="text-right">
              Account No.
            </Label>
            <Input
              id="accountNumber"
              value={formData.accountNumber || ''}
              onChange={handleChange}
              placeholder="e.g., 1000123456789"
              className="col-span-3"
              style={{'--ring': primaryColor} as React.CSSProperties}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="collectionAccount" className="text-right">
              Collection Account
            </Label>
            <Input
              id="collectionAccount"
              value={formData.collectionAccount || ''}
              onChange={handleChange}
              placeholder="e.g., 2000123456789"
              className="col-span-3"
              style={{'--ring': primaryColor} as React.CSSProperties}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="startingCapital" className="text-right">
              Initial Capital
            </Label>
            <Input
              id="startingCapital"
              type="number"
              value={formData.startingCapital}
              onChange={handleChange}
              placeholder="e.g., 100000"
              className="col-span-3"
              style={{'--ring': primaryColor} as React.CSSProperties}
              disabled={!!provider} // Disable editing for existing providers
            />
          </div>
           <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="displayOrder" className="text-right">
              Display Order
            </Label>
            <Input
              id="displayOrder"
              type="number"
              value={formData.displayOrder}
              onChange={handleChange}
              required
              className="col-span-3"
              style={{'--ring': primaryColor} as React.CSSProperties}
            />
          </div>
           <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="nplThresholdDays" className="text-right">
              NPL Threshold (Days)
            </Label>
            <Input
              id="nplThresholdDays"
              type="number"
              value={formData.nplThresholdDays}
              onChange={handleChange}
              required
              className="col-span-3"
              style={{'--ring': primaryColor} as React.CSSProperties}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Icon</Label>
            <div className="col-span-3 flex space-x-2">
              {icons.map(({ name, component: Icon }) => (
                <Button
                  key={name}
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => handleSelectIcon(name)}
                  className={cn(
                    'h-12 w-12',
                    formData.icon === name && 'ring-2'
                  )}
                  style={{'--ring': primaryColor} as React.CSSProperties}
                >
                  <Icon className="h-6 w-6" />
                </Button>
              ))}
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                        'h-12 w-12',
                        formData.icon.startsWith('data:image/') && 'ring-2'
                    )}
                    style={{'--ring': primaryColor} as React.CSSProperties}
                >
                   {formData.icon.startsWith('data:image/') ? (
                      <img src={formData.icon} alt="Custom Icon" className="h-6 w-6" />
                    ) : (
                      <Upload className="h-6 w-6" />
                    )}
                </Button>
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/svg+xml,image/png,image/jpeg"
                    onChange={handleCustomIconUpload}
                />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Color</Label>
            <div className="col-span-3 flex items-center gap-2">
                <Input
                    id="colorHex"
                    type="color"
                    value={formData.colorHex}
                    onChange={handleChange}
                    className="p-1 h-10 w-14"
                />
                <span className="text-sm font-mono bg-muted px-2 py-1 rounded-md">{formData.colorHex}</span>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" style={{ backgroundColor: primaryColor }} className="text-white">{provider ? 'Submit for Approval' : 'Add Provider'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
