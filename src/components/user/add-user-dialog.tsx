
'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { User, UserRole, UserStatus, Role, LoanProvider } from '@/lib/types';
import { BRANCHES, branchCodeToId } from '@/lib/branches';

interface AddUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: Omit<User, 'id'> & { password?: string }) => void;
  user: User | null;
  roles: Role[];
  providers: LoanProvider[];
  primaryColor?: string;
}

export function AddUserDialog({ isOpen, onClose, onSave, user, roles, providers, primaryColor = '#fdb913' }: AddUserDialogProps) {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    password: '',
    role: 'Loan Provider' as UserRole,
    status: 'Active' as UserStatus,
    providerId: '' as string | null,
    branchId: '' as string | null,
  });
  const [branchSearch, setBranchSearch] = useState('');
  const [branchError, setBranchError] = useState<string | null>(null);

  const [pwChecks, setPwChecks] = useState({
    length: false,
    lower: false,
    upper: false,
    number: false,
    symbol: false,
    common: true, // true means it's common (we'll invert when displaying)
  });
  const [pwned, setPwned] = useState<boolean | null>(null);
  const [pwnedLoading, setPwnedLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const pwnedAbort = useRef<AbortController | null>(null);
  const [pwFocused, setPwFocused] = useState(false);

  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const COMMON = new Set(['123456','123456789','qwerty','password','1234567','12345678','12345','111111','123123','password1','1234567890','1234','welcome','letmein','admin','iloveyou']);

  const PHONE_REGEX = /^(09\d{8}|9\d{8})$/;
  const validatePhone = (raw: string) => {
    const value = (raw || '').trim();
    if (!value) return 'Phone number is required.';
    if (!PHONE_REGEX.test(value)) return 'Invalid phone number format. Use 0912345678 or 912345678.';
    return null;
  };

  useEffect(() => {
    const defaultRole = roles.find(r => r.name === 'Loan Provider') ? 'Loan Provider' : (roles[0]?.name || '');
    if (user) {
      setFormData({
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        password: '', // Password is not edited by default, but can be reset
        role: user.role,
        status: user.status,
        providerId: user.providerId || null,
        branchId: user.branchCode != null ? branchCodeToId(user.branchCode) : null,
      });
    } else {
      setFormData({
        fullName: '',
        email: '',
        phoneNumber: '',
        password: '',
        role: defaultRole as UserRole,
        status: 'Active' as UserStatus,
        providerId: providers.length > 0 ? providers[0].id : null,
        branchId: null,
      });
    }

    // reset field-level validation UI on open/change
    setPhoneTouched(false);
    setPhoneError(null);
    setBranchSearch('');
  }, [user, isOpen, providers, roles]);

  // Validate password client-side and run debounced pwned-password check
  useEffect(() => {
    const pw = formData.password || '';
    const checks = {
      length: pw.length >= 8,
      lower: /[a-z]/.test(pw),
      upper: /[A-Z]/.test(pw),
      number: /\d/.test(pw),
      symbol: /[^A-Za-z0-9]/.test(pw),
      common: COMMON.has(pw.toLowerCase()),
    };
    setPwChecks(checks as any);
    setPwned(null);
    setPwError(null);

    // Only run pwned check if password is non-empty and meets basic composition
    const shouldCheckPwned = pw.length > 0 && checks.length && checks.lower && checks.upper && checks.number && checks.symbol && !checks.common;

    if (!shouldCheckPwned) {
      if (pwnedAbort.current) {
        pwnedAbort.current.abort();
        pwnedAbort.current = null;
      }
      setPwned(null);
      setPwnedLoading(false);
      return;
    }

    setPwnedLoading(true);
    const ac = new AbortController();
    pwnedAbort.current = ac;
    const id = setTimeout(async () => {
      try {
        const res = await fetch('/api/utils/pwned-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw }),
          signal: ac.signal,
        });
        if (!res.ok) {
          setPwned(false);
        } else {
          const data = await res.json();
          setPwned(Boolean(data?.pwned));
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('pwned check failed', err);
        setPwError('Could not verify password breach status');
        setPwned(null);
      } finally {
        setPwnedLoading(false);
        pwnedAbort.current = null;
      }
    }, 600);

    return () => {
      clearTimeout(id);
      if (pwnedAbort.current) {
        pwnedAbort.current.abort();
        pwnedAbort.current = null;
      }
    };
  }, [formData.password]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    if (id === 'phoneNumber') {
      // Keep only digits; validation expects strict digit-only formats.
      const digitsOnly = value.replace(/\D+/g, '');
      setFormData((prev) => ({ ...prev, phoneNumber: digitsOnly }));
      if (phoneTouched) {
        setPhoneError(validatePhone(digitsOnly));
      }
      return;
    }
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (field: 'role' | 'status' | 'providerId' | 'branchId') => (value: string) => {
    const newRole = field === 'role' ? (value as UserRole) : formData.role;
    const isProviderSpecificRole = newRole === 'Loan Provider' || newRole === 'Loan Manager';
    
    setFormData(prev => {
        const updatedState = { ...prev, [field]: value };
        
        if (field === 'role') {
            if (!isProviderSpecificRole) {
                updatedState.providerId = null;
            } else if (!prev.providerId && providers.length > 0) {
                updatedState.providerId = providers[0].id;
            }
            if (newRole !== 'Branch') {
                updatedState.branchId = null;
            }
        }
        
        return updatedState;
    });
};


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submissionData: any = { ...formData };

    // Phone validation (inline)
    const pErr = validatePhone(submissionData.phoneNumber);
    if (pErr) {
      setPhoneTouched(true);
      setPhoneError(pErr);
      return;
    }

    // Inline validation: ensure client checks pass and pwned check is clear
    if (submissionData.password) {
      const pw = submissionData.password;
      if (!pwChecks.length || !pwChecks.lower || !pwChecks.upper || !pwChecks.number || !pwChecks.symbol) {
        setPwError('Password does not meet complexity requirements.');
        return;
      }
      if (pwChecks.common) {
        setPwError('Password is too common.');
        return;
      }
      if (pwned === true) {
        setPwError('This password has appeared in a data breach. Choose a different password.');
        return;
      }
      if (pwnedLoading) {
        setPwError('Password breach check is still running. Please wait.');
        return;
      }
    } else if (!user) { // Password is only required for brand new users
      setPwError('Password is required for new users.');
      return;
    } else {
      // If editing and password field is empty, don't send it to the server
      delete submissionData.password;
    }
    setPwError(null);
    
    // Ensure providerId is null if the role is not provider-specific
    if (submissionData.role !== 'Loan Provider' && submissionData.role !== 'Loan Manager') {
        submissionData.providerId = null;
    }

    if (submissionData.role === 'Branch') {
      if (!submissionData.branchId) {
        setBranchError('Please select a branch for Branch role users.');
        return;
      }
      submissionData.providerId = null;
    } else {
      delete submissionData.branchId;
    }
    setBranchError(null);

    onSave(submissionData);
    onClose();
  };
  
  const isProviderRole = formData.role === 'Loan Provider' || formData.role === 'Loan Manager';
  const isBranchRole = formData.role === 'Branch';

  const filteredBranches = useMemo(() => {
    const q = branchSearch.trim().toLowerCase();
    if (!q) return BRANCHES;
    return BRANCHES.filter(
      (b) =>
        b.id.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        String(b.code).includes(q)
    );
  }, [branchSearch]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? 'Edit User' : 'Add New User'}</DialogTitle>
          <DialogDescription>
            {user ? 'Update the details of the existing user.' : 'Register a new user for the platform.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="fullName" className="text-right">
              Full Name
            </Label>
            <Input id="fullName" value={formData.fullName} onChange={handleChange} className="col-span-3" required />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right">
              Email
            </Label>
            <Input id="email" type="email" value={formData.email} onChange={handleChange} className="col-span-3" required />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="phoneNumber" className="text-right">
              Phone
            </Label>
            <Input
              id="phoneNumber"
              value={formData.phoneNumber}
              onChange={handleChange}
              onBlur={() => {
                setPhoneTouched(true);
                setPhoneError(validatePhone(formData.phoneNumber));
              }}
              className="col-span-3"
              required
              placeholder="e.g., 0912345678"
              inputMode="numeric"
              aria-invalid={!!phoneError}
            />
          </div>
          {(phoneTouched && phoneError) && (
            <div className="grid grid-cols-4 items-center gap-4">
              <div />
              <div className="col-span-3 text-sm text-destructive">
                {phoneError}
              </div>
            </div>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="password" className="text-right">
                {user ? 'New Password' : 'Password'}
            </Label>
            <Input 
                id="password" 
                type="password" 
                value={formData.password} 
                onChange={handleChange} 
                onFocus={() => setPwFocused(true)}
                onBlur={() => setPwFocused(false)}
                className="col-span-3" 
                required={!user} // Only required for new users
                placeholder={user ? 'Optional: Enter to reset' : ''}
            />
          </div>
          {/* Inline password validation UI (show on focus or when there's content) */}
          {(pwFocused || (formData.password && formData.password.length > 0)) && (
            <div className="grid grid-cols-4 items-center gap-4">
              <div />
              <div className="col-span-3 mt-2 mb-2">
                <div className="rounded-md border p-3 bg-yellow-50">
                  <div className="mb-2 font-semibold">Password must contain:</div>
                  <ul className="space-y-1 text-sm">
                    <li>{pwChecks.length ? '✅' : '❌'} At least 8 characters long</li>
                    <li>{pwChecks.lower ? '✅' : '❌'} At least one lowercase letter</li>
                    <li>{pwChecks.upper ? '✅' : '❌'} At least one uppercase letter</li>
                    <li>{pwChecks.number ? '✅' : '❌'} At least one number</li>
                    <li>{pwChecks.symbol ? '✅' : '❌'} At least one special character (@$!%*?&)</li>
                    <li>{!pwChecks.common ? '✅' : '❌'} Not a commonly used password</li>
                  </ul>
                  <div className="mt-2 text-sm">
                    {pwnedLoading ? (
                      <span>Checking breach database…</span>
                    ) : pwned === true ? (
                      <span className="text-red-700">This password was found in a data breach.</span>
                    ) : pwned === false ? (
                      <span className="text-green-700">Not found in known breaches.</span>
                    ) : null}
                    {pwError ? <div className="text-red-700 mt-1">{pwError}</div> : null}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="role" className="text-right">
              Role
            </Label>
            <Select onValueChange={handleSelectChange('role')} value={formData.role}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map(role => (
                    <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isProviderRole && (
             <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="providerId" className="text-right">
                    Provider
                </Label>
                <Select onValueChange={handleSelectChange('providerId')} value={formData.providerId || ''}>
                    <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                    <SelectContent>
                        {providers.map(provider => (
                            <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
             </div>
          )}
          {isBranchRole && (
            <>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="branchSearch" className="text-right">
                  Search
                </Label>
                <Input
                  id="branchSearch"
                  value={branchSearch}
                  onChange={(e) => setBranchSearch(e.target.value)}
                  className="col-span-3"
                  placeholder="Search by branch code or name"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="branchId" className="text-right">
                  Branch
                </Label>
                <Select onValueChange={handleSelectChange('branchId')} value={formData.branchId || ''}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select a branch" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {filteredBranches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.id} - {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {branchError && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <div />
                  <div className="col-span-3 text-sm text-destructive">{branchError}</div>
                </div>
              )}
            </>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="status" className="text-right">
              Status
            </Label>
             <Select onValueChange={handleSelectChange('status')} value={formData.status}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select a status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={
              ( !user && !formData.password ) ||
              !!validatePhone(formData.phoneNumber) ||
              (formData.password && (!pwChecks.length || !pwChecks.lower || !pwChecks.upper || !pwChecks.number || !pwChecks.symbol || pwChecks.common || pwned === true || pwnedLoading))
            } style={{ backgroundColor: primaryColor }} className="text-white">
              {user ? 'Save Changes' : 'Add User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
