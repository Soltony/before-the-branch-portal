

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ExcelJS from 'exceljs';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PlusCircle, Trash2, Loader2, Edit, ChevronDown, Settings2, Save, FilePlus2, Upload, FileClock, Pencil, Link as LinkIcon, ChevronRight, ChevronLeft, Search, X } from 'lucide-react';
import type { LoanProvider, LoanProduct, FeeRule, PenaltyRule, DataProvisioningConfig, LoanAmountTier, TermsAndConditions, DataColumn, DataProvisioningUpload, Tax, LoanCycleConfig } from '@/lib/types';
import { AddProviderDialog } from '@/components/loan/add-provider-dialog';
import { AddProductDialog } from '@/components/loan/add-product-dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog as UIDialog,
  DialogContent as UIDialogContent,
  DialogHeader as UIDialogHeader,
  DialogTitle as UIDialogTitle,
  DialogFooter as UIDialogFooter,
  DialogClose as UIDialogClose,
  DialogDescription as UIDialogDescription,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { postPendingChange } from '@/lib/fetch-utils';
import { produce } from 'immer';
import { IconDisplay } from '@/components/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '../ui/textarea';
import { CONTRACT_LANGUAGES, type TermsLanguageField } from '@/lib/lersha/contract-languages';
import { Skeleton } from '../ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { format } from 'date-fns';
import { Checkbox } from '../ui/checkbox';
import Link from 'next/link';
import { usePermissions } from '@/hooks/use-permissions';


// Helper to safely parse JSON fields that might be strings
const safeParseJson = (data: any, field: string, defaultValue: any) => {
    if (data && typeof data[field] === 'string') {
        try {
            return JSON.parse(data[field]);
        } catch (e) {
            return defaultValue;
        }
    }
    return data?.[field] ?? defaultValue;
};

// Sanitize product object for inclusion in pending change payloads
// Removes large/secret fields (notably eligibility upload fileContent) while
// keeping useful metadata (id, fileName, status) so diffs remain meaningful.
const sanitizeProductForPayload = (p: any) => {
    if (!p) return p;
    // shallow copy
    const copy: any = { ...p };
    if (copy.eligibilityUpload) {
        const eu = copy.eligibilityUpload;
        copy.eligibilityUpload = {
            id: eu.id,
            fileName: eu.fileName,
            status: eu.status,
            uploadedAt: eu.uploadedAt,
            uploadedBy: eu.uploadedBy,
        } as any;
    }
    // Clear any embedded large data that should not be part of product change diffs
    if (copy.eligibilityUpload && (copy.eligibilityUpload as any).fileContent) {
        delete (copy.eligibilityUpload as any).fileContent;
    }
    return copy;
};

const sanitizeProviderForPayload = (prov: any) => {
    if (!prov) return prov;
    const c = { ...prov };
    if (Array.isArray(c.products)) {
        c.products = c.products.map((pp: any) => sanitizeProductForPayload(pp));
    }
    // avoid including any nested uploads with large content
    return c;
};

const ProductSettingsForm = ({ provider, product, providerColor, onSave, onDelete, onUpdate, allDataConfigs }: {
    provider: LoanProvider;
    product: LoanProduct;
    providerColor?: string;
    onSave: (product: LoanProduct) => void;
    onDelete: () => void;
    onUpdate: (updatedProduct: Partial<LoanProduct>) => void;
    allDataConfigs: DataProvisioningConfig[];
}) => {
    const { currentUser } = useAuth();
    const { entityActions } = usePermissions();
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    // Keep a snapshot of the original product when the settings collapsible is opened
    // so we can send correct "original" values for approval payloads even though
    // edits are applied optimistically to the parent provider state via onUpdate.
    const originalSnapshotRef = React.useRef<LoanProduct | null>(null);
    const snapshotProductIdRef = React.useRef<string | null>(null);
    const { toast } = useToast();
    
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    // Upload mode: 'replace' replaces all mappings, 'append' merges with existing
    const [salaryUploadMode, setSalaryUploadMode] = useState<'replace' | 'append'>('append');
    // Salary mappings management dialog state
    const [isMappingsDialogOpen, setIsMappingsDialogOpen] = useState(false);
    const [mappingsSearchQuery, setMappingsSearchQuery] = useState('');
    const [editingMappingIndex, setEditingMappingIndex] = useState<number | null>(null);
    const [editingAccountNumber, setEditingAccountNumber] = useState('');
    const [editingSalary, setEditingSalary] = useState('');
    const [mappingsPage, setMappingsPage] = useState(1);
    const MAPPINGS_PAGE_SIZE = 10;

    const productActions = entityActions('LoanProduct');
    const eligibilityActions = entityActions('EligibilityList');
    const canEditProduct = !!(productActions.create || productActions.update);
    const canDeleteProduct = !!productActions.delete;
    const canCreateEligibilityList = !!eligibilityActions.create;

    const formData = useMemo(() => {
        return {
            ...product,
            serviceFee: safeParseJson(product, 'serviceFee', { type: 'percentage', value: 0 }),
            dailyFee: safeParseJson(product, 'dailyFee', { type: 'percentage', value: 0, calculationBase: 'principal' }),
            penaltyRules: safeParseJson(product, 'penaltyRules', []),
            eligibilityFilter: product.eligibilityFilter,
            installments: product.installments ?? '',
            repaymentIntervalDays: product.repaymentIntervalDays ?? undefined,
        };
    }, [product]);
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        onUpdate({ [name]: value === '' ? null : value });
    };

    // Capture original snapshot when the editor opens so we can later
    // use the original values when submitting a change request for approval.
    useEffect(() => {
        if (!isOpen) {
            originalSnapshotRef.current = null;
            snapshotProductIdRef.current = null;
            return;
        }

        // Capture snapshot once per open session (or when switching products)
        if (!snapshotProductIdRef.current || snapshotProductIdRef.current !== product.id) {
            originalSnapshotRef.current = { ...product } as LoanProduct;
            snapshotProductIdRef.current = product.id;
        }
    }, [isOpen, product]);

    const handleSwitchChange = (name: keyof LoanProduct, checked: boolean) => {
        if (!canEditProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Settings.', variant: 'destructive' });
            return;
        }
        if (name === 'status') {
            handleStatusChange(checked);
        } else {
            onUpdate({ [name]: checked });
        }
    }

    const handleFileSalaryUpload = async (file?: File | null) => {
        if (!file) return;
        
        // Client-side validation: reject unsupported file types and oversized files early
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
        const allowedTypes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];
        const allowedExtensions = ['csv', 'xlsx', 'xls'];
        
        const name = file.name || '';
        const ext = name.split('.').pop()?.toLowerCase();
        
        // Validate file extension
        if (!ext || !allowedExtensions.includes(ext)) {
            toast({ 
                title: 'Invalid file type', 
                description: 'Only .csv, .xlsx, and .xls files are allowed.', 
                variant: 'destructive' 
            });
            return;
        }
        
        // Validate file type (MIME type) - allow if either MIME type matches or extension is valid
        // Some systems may not report correct MIME types for CSV files
        if (file.type && !allowedTypes.includes(file.type) && !file.type.includes('sheet') && !file.type.includes('csv')) {
            toast({ 
                title: 'Invalid file type', 
                description: 'Only .csv, .xlsx, and .xls files are allowed.', 
                variant: 'destructive' 
            });
            return;
        }
        
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            toast({ 
                title: 'File too large', 
                description: 'Maximum file size is 10MB.', 
                variant: 'destructive' 
            });
            return;
        }
        
        try {
            let mappings: Array<any> = [];
            if (ext === 'xlsx' || ext === 'xls' || (file.type && file.type.includes('sheet'))) {
                // parse with ExcelJS
                const buffer = await file.arrayBuffer();
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);
                const sheet = workbook.worksheets[0];
                if (sheet) {
                    const headerRow = sheet.getRow(1).values as any[];
                    const rawHeaders = (headerRow || []).slice(1).map((h: any) => String(h || '').trim());
                    const canonicalHeaders = rawHeaders.map(h => {
                        const norm = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (norm.includes('account') || norm.includes('acct')) return 'accountNumber';
                        if (norm.includes('salary') || norm.includes('amount') || norm.includes('pay')) return 'salary';
                        return norm || h;
                    });
                    for (let i = 2; i <= sheet.rowCount; i++) {
                        const row = sheet.getRow(i).values as any[];
                        if (!row || row.length <= 1) continue;
                        const data: any = {};
                        canonicalHeaders.forEach((h: string, idx: number) => {
                          data[h] = row[idx + 1] ?? '';
                        });
                        mappings.push({
                            accountNumber: String(data.accountNumber || '').trim(),
                            salary: Number(data.salary || 0)
                        });
                    }
                }
            } else {
                const text = await file.text();
                const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
                if (lines.length) {
                    const raw = lines[0].split(',').map(h => h.trim());
                    const headers = raw.map(h => {
                        const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (norm.includes('account') || norm.includes('acct')) return 'accountNumber';
                        if (norm.includes('salary') || norm.includes('amount') || norm.includes('pay')) return 'salary';
                        return h;
                    });
                    const rows = lines.slice(1).map(line => {
                        const cols = line.split(',');
                        const obj: any = {};
                        headers.forEach((h, i) => obj[h] = cols[i] ? cols[i].trim() : '');
                        return obj;
                    });
                    mappings = rows.map((r: any) => ({
                        accountNumber: String(r.accountNumber || '').trim(),
                        salary: Number(r.salary || 0)
                    })).filter((r: any) => r.accountNumber);
                }
            }

            mappings = mappings.filter((m: any) => m.accountNumber);
            
            if (mappings.length === 0) {
                toast({ 
                    title: 'No valid data found', 
                    description: 'The file must contain at least one row with an account number.', 
                    variant: 'destructive' 
                });
                return;
            }

            // Handle append mode - merge with existing mappings
            let finalMappings = mappings;
            if (salaryUploadMode === 'append' && formData.salaryAdvanceMappings) {
                try {
                    const existingMappings = JSON.parse(formData.salaryAdvanceMappings as string) as Array<{ accountNumber: string; salary: number }>;
                    // Create a map of existing entries for efficient lookup
                    const existingMap = new Map(existingMappings.map(m => [String(m.accountNumber), m]));
                    
                    // Add or update with new mappings
                    let addedCount = 0;
                    let updatedCount = 0;
                    for (const newMapping of mappings) {
                        const accountKey = String(newMapping.accountNumber);
                        if (existingMap.has(accountKey)) {
                            // Update existing entry
                            existingMap.set(accountKey, newMapping);
                            updatedCount++;
                        } else {
                            // Add new entry
                            existingMap.set(accountKey, newMapping);
                            addedCount++;
                        }
                    }
                    
                    finalMappings = Array.from(existingMap.values());
                    
                    onUpdate({ salaryAdvanceMappings: JSON.stringify(finalMappings) });
                    toast({ 
                        title: 'Mappings updated', 
                        description: `Added ${addedCount} new mapping${addedCount !== 1 ? 's' : ''}, updated ${updatedCount} existing mapping${updatedCount !== 1 ? 's' : ''}. Total: ${finalMappings.length} mappings.` 
                    });
                    return;
                } catch (e) {
                    console.error('Failed to parse existing mappings for append', e);
                    // Fall back to replace mode if parsing fails
                }
            }
            
            onUpdate({ salaryAdvanceMappings: JSON.stringify(finalMappings) });
            toast({ 
                title: 'File uploaded', 
                description: `Successfully ${salaryUploadMode === 'replace' ? 'replaced with' : 'loaded'} ${finalMappings.length} salary mapping${finalMappings.length !== 1 ? 's' : ''}.` 
            });
        } catch (err: any) {
            console.error('Failed to parse salary mapping file', err);
            toast({ 
                title: 'Failed to parse file', 
                description: err?.message || 'Could not read the salary mapping file. Please check the file format.', 
                variant: 'destructive' 
            });
        }
    }

    // Parse salary mappings for display and management
    const parsedMappings = useMemo(() => {
        if (!formData.salaryAdvanceMappings) return [];
        try {
            return JSON.parse(formData.salaryAdvanceMappings as string) as Array<{ accountNumber: string; salary: number }>;
        } catch {
            return [];
        }
    }, [formData.salaryAdvanceMappings]);

    // Filter and paginate mappings (preserve original indices so edit/delete work after searching)
    const filteredMappingEntries = useMemo(() => {
        const query = mappingsSearchQuery.trim().toLowerCase();
        return parsedMappings
            .map((m, originalIndex) => ({ mapping: m, originalIndex }))
            .filter(({ mapping }) => {
                if (!query) return true;
                return (
                    String(mapping.accountNumber).toLowerCase().includes(query) ||
                    String(mapping.salary).includes(query)
                );
            });
    }, [parsedMappings, mappingsSearchQuery]);

    const paginatedMappingEntries = useMemo(() => {
        const start = (mappingsPage - 1) * MAPPINGS_PAGE_SIZE;
        return filteredMappingEntries.slice(start, start + MAPPINGS_PAGE_SIZE);
    }, [filteredMappingEntries, mappingsPage]);

    const totalMappingsPages = Math.ceil(filteredMappingEntries.length / MAPPINGS_PAGE_SIZE);

    // Handle editing a mapping
    const handleStartEditMapping = (originalIndex: number) => {
        const mapping = parsedMappings[originalIndex];
        if (mapping) {
            setEditingMappingIndex(originalIndex);
            setEditingAccountNumber(String(mapping.accountNumber));
            setEditingSalary(String(mapping.salary));
        }
    };

    const handleCancelEditMapping = () => {
        setEditingMappingIndex(null);
        setEditingAccountNumber('');
        setEditingSalary('');
    };

    const handleSaveEditMapping = () => {
        if (editingMappingIndex === null) return;
        if (!editingAccountNumber.trim()) {
            toast({ title: 'Invalid account number', description: 'Account number cannot be empty.', variant: 'destructive' });
            return;
        }
        
        const newMappings = [...parsedMappings];
        const oldAccountNumber = newMappings[editingMappingIndex].accountNumber;
        
        // Check if new account number already exists (if changed)
        if (editingAccountNumber !== oldAccountNumber) {
            const exists = newMappings.some((m, i) => i !== editingMappingIndex && String(m.accountNumber) === editingAccountNumber);
            if (exists) {
                toast({ title: 'Duplicate account', description: 'This account number already exists in the list.', variant: 'destructive' });
                return;
            }
        }
        
        newMappings[editingMappingIndex] = {
            accountNumber: editingAccountNumber.trim(),
            salary: Number(editingSalary) || 0
        };
        
        onUpdate({ salaryAdvanceMappings: JSON.stringify(newMappings) });
        toast({ title: 'Mapping updated', description: `Account ${editingAccountNumber} has been updated.` });
        handleCancelEditMapping();
    };

    // Handle deleting a mapping
    const handleDeleteMapping = (originalIndex: number) => {
        const mapping = parsedMappings[originalIndex];
        if (!mapping) return;
        
        const newMappings = parsedMappings.filter((_, i) => i !== originalIndex);
        onUpdate({ salaryAdvanceMappings: JSON.stringify(newMappings) });
        toast({ title: 'Mapping removed', description: `Account ${mapping.accountNumber} has been removed from the list.` });

        if (editingMappingIndex === originalIndex) {
            handleCancelEditMapping();
        }
        
        // Adjust page if needed
        if (paginatedMappingEntries.length === 1 && mappingsPage > 1) {
            setMappingsPage(mappingsPage - 1);
        }
    };

    // Handle adding a new mapping manually
    const [isAddingMapping, setIsAddingMapping] = useState(false);
    const [newMappingAccount, setNewMappingAccount] = useState('');
    const [newMappingSalary, setNewMappingSalary] = useState('');

    const handleAddMapping = () => {
        if (!newMappingAccount.trim()) {
            toast({ title: 'Invalid account number', description: 'Account number cannot be empty.', variant: 'destructive' });
            return;
        }
        
        const exists = parsedMappings.some(m => String(m.accountNumber) === newMappingAccount.trim());
        if (exists) {
            toast({ title: 'Duplicate account', description: 'This account number already exists in the list.', variant: 'destructive' });
            return;
        }
        
        const newMappings = [...parsedMappings, {
            accountNumber: newMappingAccount.trim(),
            salary: Number(newMappingSalary) || 0
        }];
        
        onUpdate({ salaryAdvanceMappings: JSON.stringify(newMappings) });
        toast({ title: 'Mapping added', description: `Account ${newMappingAccount} has been added.` });
        setNewMappingAccount('');
        setNewMappingSalary('');
        setIsAddingMapping(false);
        // Go to last page to show new entry
        setMappingsPage(Math.ceil(newMappings.length / MAPPINGS_PAGE_SIZE));
    };

    const handleStatusChange = async (checked: boolean) => {
        if (!canEditProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Settings.', variant: 'destructive' });
            return;
        }
        const newStatus = checked ? 'Active' : 'Disabled';
        // Optimistically update the UI
        onUpdate({ status: newStatus }); 
        
        try {
            const response = await fetch('/api/settings/products', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: product.id, status: newStatus })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update status.');
            }
            
            toast({
                title: 'Status Updated',
                description: `${product.name} has been set to ${newStatus}.`
            });
            // The onUpdate call above already updated the state, so no need to do it again on success.

        } catch (error: any) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
            // Revert UI on failure
            onUpdate({ status: product.status });
        }
    };
    
    const handleFilterFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !product.dataProvisioningConfigId) return;

        if (!canCreateEligibilityList) {
            toast({ title: 'Not authorized', description: 'You only have read access for Eligibility.', variant: 'destructive' });
            if (event.target) event.target.value = '';
            return;
        }

        // Client-side validation: reject unsupported file types and oversized files early
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
        const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        const allowedExtensions = ['xlsx'];
        
        const fileName = file.name || '';
        const ext = fileName.split('.').pop()?.toLowerCase();
        
        // Validate file extension
        if (!ext || !allowedExtensions.includes(ext)) {
            toast({ 
                title: 'Invalid file type', 
                description: 'Only .xlsx files are allowed.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }
        
        // Validate file type (MIME type)
        if (file.type && !allowedTypes.includes(file.type) && !file.type.includes('sheet')) {
            toast({ 
                title: 'Invalid file type', 
                description: 'Only .xlsx files are allowed.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }
        
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            toast({ 
                title: 'File too large', 
                description: 'Maximum file size is 10MB.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }

        setIsUploading(true);
        try {
            const fileReader = new FileReader();
            fileReader.readAsDataURL(file);
            fileReader.onload = async (e) => {
                const fileContentBase64 = (e.target?.result as string)?.split(',')[1];
                if (!fileContentBase64) {
                    throw new Error("Could not read file content.");
                }

                const tempUpload: DataProvisioningUpload = {
                    id: `temp-${Date.now()}`,
                    configId: product.dataProvisioningConfigId!,
                    fileName: file.name,
                    rowCount: 0, // Placeholder
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: 'you (unsaved)',
                    status: 'PENDING_APPROVAL',
                    // Store content for submission
                    fileContent: fileContentBase64,
                } as any;

                onUpdate({ eligibilityUpload: tempUpload });
            };

        } catch (error: any) {
            toast({ title: "Error reading file", description: error.message, variant: 'destructive'});
        } finally {
            setIsUploading(false);
            if (event.target) event.target.value = '';
        }
    };
    
    const handleEligibilitySubmitForApproval = async () => {
        if (!canCreateEligibilityList) {
            toast({ title: 'Not authorized', description: 'You only have read access for Eligibility.', variant: 'destructive' });
            return;
        }
        if (!product.eligibilityUpload || !(product.eligibilityUpload as any).fileContent) {
            toast({ title: "No file to submit", description: "Please upload a file first.", variant: "destructive"});
            return;
        }

        setIsSaving(true);
        try {
            const { eligibilityUpload } = product;
            const payload = {
                created: {
                    configId: eligibilityUpload.configId,
                    fileName: eligibilityUpload.fileName,
                    fileContent: (eligibilityUpload as any).fileContent,
                    productId: product.id,
                }
            };
                await postPendingChange({
                    entityType: 'EligibilityList',
                    entityId: product.id,
                    changeType: 'CREATE', // Using CREATE since it creates a new upload and filter
                    payload: JSON.stringify(payload),
                }, 'Failed to submit eligibility list for approval.');
            toast({ title: "Submitted for Approval", description: `The new eligibility list for "${product.name}" is pending review.` });

            // Replace the temporary upload with a "pending" state placeholder
            onUpdate({ eligibilityUpload: { ...product.eligibilityUpload, id: 'pending-approval', status: 'PENDING_APPROVAL' } as any });

        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };


    const submitForApproval = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!canEditProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            const parsedDuration = parseInt(String(formData.duration)) || 30;
            const parsedInstallments = formData.isSalaryAdvance
                ? (formData.installments === '' || formData.installments === null || formData.installments === undefined
                    ? null
                    : Number(formData.installments))
                : null;

            if (formData.isSalaryAdvance) {
                if (!parsedInstallments || !Number.isFinite(parsedInstallments) || parsedInstallments <= 0) {
                    throw new Error('For salary-advance products, Installments is required and must be greater than 0.');
                }
                if (parsedDuration <= 0) {
                    throw new Error('For salary-advance products, Loan Duration (days) must be greater than 0.');
                }
                if (parsedInstallments > parsedDuration) {
                    throw new Error('Installments cannot be greater than duration (days).');
                }
            }

            const computedIntervalDays = (formData.isSalaryAdvance && parsedInstallments)
                ? Math.floor(parsedDuration / parsedInstallments)
                : null;

             const productToSave = {
                ...formData,
                minLoan: formData.isSalaryAdvance ? undefined : (parseFloat(String(formData.minLoan)) || 0),
                maxLoan: formData.isSalaryAdvance ? undefined : (parseFloat(String(formData.maxLoan)) || 0),
                duration: parsedDuration,
                advancePercent: formData.isSalaryAdvance ? (formData.advancePercent ? Number(formData.advancePercent) : null) : undefined,
                salaryAdvanceMappings: formData.isSalaryAdvance ? formData.salaryAdvanceMappings : undefined,
                installments: formData.isSalaryAdvance ? parsedInstallments : undefined,
                repaymentIntervalDays: formData.isSalaryAdvance ? (computedIntervalDays || undefined) : undefined,
                // For installment-based products, apply penalties per installment.
                penaltyPerInstallment: formData.isSalaryAdvance ? true : undefined,
                // Exclude status and eligibility from the main product approval payload
                status: undefined, 
                dataProvisioningEnabled: undefined,
                dataProvisioningConfigId: undefined,
                eligibilityUpload: undefined,
                eligibilityUploadId: undefined,
                eligibilityFilter: undefined,
            };

            // Use the snapshot of the product captured when the editor was opened
            // (falls back to provider state if snapshot is missing)
            const originalProduct = originalSnapshotRef.current ?? provider.products.find(p => p.id === product.id);
            // Build a small original object that only contains keys that are being updated
            const keysToSend = Object.keys(productToSave).filter(k => (productToSave as any)[k] !== undefined);
            const pick = (obj: any, keys: string[]) => keys.reduce((acc: any, k: string) => { if (obj && (k in obj)) acc[k] = (obj as any)[k]; return acc; }, {});
            const originalSubset = pick(originalProduct, keysToSend);

            const payload = {
                original: sanitizeProductForPayload(originalSubset),
                updated: sanitizeProductForPayload(productToSave)
            };

                await postPendingChange({
                    entityType: 'LoanProduct',
                    entityId: product.id,
                    changeType: 'UPDATE',
                    payload: JSON.stringify(payload)
                }, 'Failed to submit product changes for approval.');

            onUpdate({ status: 'Disabled', _optimisticPending: true } as any);

            toast({
                title: 'Submitted for Approval',
                description: `Changes to ${product.name} have been submitted successfully.`,
            });
        } catch (error: any) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    }

    return (
       <>
       <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
            <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full space-x-4 px-4 py-2 border rounded-lg bg-background hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold">{product.name}</h4>
                        {(((product as any)._optimisticPending) || product.status === 'PENDING_APPROVAL') && <Badge variant="outline">Pending Approval</Badge>}
                        {!(((product as any)._optimisticPending) || product.status === 'PENDING_APPROVAL') && <Badge variant={product.status === 'Active' ? 'default' : 'destructive'} className={cn(product.status === 'Active' && 'bg-green-600')}>{product.status}</Badge>}
                    </div>
                    <ChevronDown className="h-4 w-4 transition-transform duration-200 data-[state=open]:rotate-180" />
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                 <form onSubmit={submitForApproval} className="p-4 border rounded-lg bg-background space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex items-center space-x-2">
                            <Switch 
                                id={`status-${product.id}`}
                                checked={formData.status === 'Active'} 
                                onCheckedChange={(checked) => handleSwitchChange('status', checked)}
                                disabled={!canEditProduct}
                                className="data-[state=checked]:bg-[--provider-color]"
                                style={{'--provider-color': providerColor} as React.CSSProperties}
                            />
                            <Label htmlFor={`status-${product.id}`}>Status ({formData.status})</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch
                                id={`allowConcurrentLoans-${product.id}`}
                                checked={!!formData.allowConcurrentLoans}
                                onCheckedChange={(checked) => handleSwitchChange('allowConcurrentLoans', Boolean(checked))}
                                disabled={!canEditProduct}
                                className="data-[state=checked]:bg-[--provider-color]"
                                style={{'--provider-color': providerColor} as React.CSSProperties}
                            />
                            <Label htmlFor={`allowConcurrentLoans-${product.id}`}>Combinable with Other Loans</Label>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`minLoan-${product.id}`}>Min Loan Amount</Label>
                            <Input
                                id={`minLoan-${product.id}`}
                                name="minLoan"
                                type="number"
                                value={formData.minLoan ?? ''}
                                onChange={handleChange}
                                placeholder="e.g., 500"
                                disabled={!canEditProduct || !!formData.isSalaryAdvance}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`maxLoan-${product.id}`}>Max Loan Amount</Label>
                            <Input
                                id={`maxLoan-${product.id}`}
                                name="maxLoan"
                                type="number"
                                value={formData.maxLoan ?? ''}
                                onChange={handleChange}
                                placeholder="e.g., 2500"
                                disabled={!canEditProduct || !!formData.isSalaryAdvance}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`duration-${product.id}`}>Loan Duration (days)</Label>
                            <Input
                                id={`duration-${product.id}`}
                                name="duration"
                                type="number"
                                value={formData.duration ?? ''}
                                onChange={handleChange}
                                placeholder="e.g., 30"
                                disabled={!canEditProduct}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="">Salary Advance</Label>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id={`isSalaryAdvance-${product.id}`}
                                    checked={!!formData.isSalaryAdvance}
                                    onCheckedChange={(checked) => handleSwitchChange('isSalaryAdvance', Boolean(checked))}
                                    disabled={!canEditProduct}
                                    className="data-[state=checked]:bg-[--provider-color]"
                                    style={{'--provider-color': providerColor} as React.CSSProperties}
                                />
                                <span className="text-sm">Enable salary advance for this product</span>
                            </div>
                        </div>
                        {formData.isSalaryAdvance && (
                          <>
                            <div className="space-y-2">
                                <Label htmlFor={`advancePercent-${product.id}`}>Advance Percent</Label>
                                <Input
                                    id={`advancePercent-${product.id}`}
                                    name="advancePercent"
                                    type="number"
                                    value={formData.advancePercent ?? ''}
                                    onChange={handleChange}
                                    placeholder="e.g., 50"
                                    disabled={!canEditProduct}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor={`installments-${product.id}`}>Installments</Label>
                                <Input
                                    id={`installments-${product.id}`}
                                    name="installments"
                                    type="number"
                                    value={formData.installments ?? ''}
                                    onChange={handleChange}
                                    placeholder="e.g., 12"
                                    disabled={!canEditProduct}
                                />
                            </div>
                            {formData.installments && Number(formData.installments) > 0 && (
                              <div className="space-y-2">
                                <Label>Repayment Interval</Label>
                                <div className="text-sm text-muted-foreground">Every {Math.floor((Number(formData.duration) || 0) / Number(formData.installments)) || 0} days</div>
                              </div>
                            )}
                            <div className="space-y-4">
                                <Label>Salary Mapping Upload</Label>
                                <div className="space-y-3">
                                    {/* Upload Mode Selector */}
                                    <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-md">
                                        <span className="text-sm font-medium">Upload Mode:</span>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input 
                                                type="radio" 
                                                name={`uploadMode-${product.id}`}
                                                checked={salaryUploadMode === 'append'} 
                                                onChange={() => setSalaryUploadMode('append')}
                                                disabled={!canEditProduct}
                                                className="h-4 w-4"
                                            />
                                            <span className="text-sm">Add to existing list</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input 
                                                type="radio" 
                                                name={`uploadMode-${product.id}`}
                                                checked={salaryUploadMode === 'replace'} 
                                                onChange={() => setSalaryUploadMode('replace')}
                                                disabled={!canEditProduct}
                                                className="h-4 w-4"
                                            />
                                            <span className="text-sm">Replace entire list</span>
                                        </label>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {salaryUploadMode === 'append' 
                                            ? '• New entries will be added, existing account numbers will be updated with new salary values'
                                            : '• Warning: This will remove all existing mappings and replace with the new file'}
                                    </div>
                                    <div>
                                        <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleFileSalaryUpload(e.target.files ? e.target.files[0] : undefined)} disabled={!canEditProduct} />
                                        <div className="text-sm text-muted-foreground mt-1">CSV columns: accountNumber,salary</div>
                                    </div>
                                </div>
                                {formData.salaryAdvanceMappings && (
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm text-muted-foreground">Current mappings: {parsedMappings.length} rows</div>
                                        <Button 
                                            type="button" 
                                            variant="outline" 
                                            size="sm"
                                            onClick={() => {
                                                setMappingsPage(1);
                                                setMappingsSearchQuery('');
                                                setIsMappingsDialogOpen(true);
                                            }}
                                        >
                                            <Settings2 className="h-4 w-4 mr-2" />
                                            Manage Mappings
                                        </Button>
                                    </div>
                                )}
                            </div>

                            {/* Salary Mappings Management Dialog */}
                            <UIDialog open={isMappingsDialogOpen} onOpenChange={(open) => {
                                setIsMappingsDialogOpen(open);
                                if (!open) {
                                    handleCancelEditMapping();
                                    setIsAddingMapping(false);
                                }
                            }}>
                                <UIDialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                                    <UIDialogHeader>
                                        <UIDialogTitle>Manage Salary Mappings</UIDialogTitle>
                                        <UIDialogDescription>
                                            View, edit, or remove salary mappings. Total: {parsedMappings.length} entries.
                                        </UIDialogDescription>
                                    </UIDialogHeader>
                                    
                                    {/* Search and Add */}
                                    <div className="flex items-center gap-2 py-2">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input 
                                                placeholder="Search by account number or salary..." 
                                                value={mappingsSearchQuery}
                                                onChange={(e) => {
                                                    setMappingsSearchQuery(e.target.value);
                                                    setMappingsPage(1);
                                                }}
                                                className="pl-9"
                                            />
                                            {mappingsSearchQuery && (
                                                <Button 
                                                    variant="ghost" 
                                                    size="icon" 
                                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                                                    onClick={() => setMappingsSearchQuery('')}
                                                >
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            )}
                                        </div>
                                        {canEditProduct && !isAddingMapping && (
                                            <Button variant="outline" size="sm" onClick={() => setIsAddingMapping(true)}>
                                                <PlusCircle className="h-4 w-4 mr-2" />
                                                Add Entry
                                            </Button>
                                        )}
                                    </div>

                                    {/* Add New Entry Form */}
                                    {isAddingMapping && (
                                        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
                                            <Input 
                                                placeholder="Account Number" 
                                                value={newMappingAccount}
                                                onChange={(e) => setNewMappingAccount(e.target.value)}
                                                className="flex-1"
                                            />
                                            <Input 
                                                type="number"
                                                placeholder="Salary" 
                                                value={newMappingSalary}
                                                onChange={(e) => setNewMappingSalary(e.target.value)}
                                                className="w-32"
                                            />
                                            <Button size="sm" onClick={handleAddMapping}>
                                                <Save className="h-4 w-4 mr-1" />
                                                Add
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => {
                                                setIsAddingMapping(false);
                                                setNewMappingAccount('');
                                                setNewMappingSalary('');
                                            }}>
                                                Cancel
                                            </Button>
                                        </div>
                                    )}

                                    {/* Mappings Table */}
                                    <div className="flex-1 overflow-auto border rounded-md">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-16">#</TableHead>
                                                    <TableHead>Account Number</TableHead>
                                                    <TableHead className="w-32">Salary</TableHead>
                                                    {canEditProduct && <TableHead className="w-24 text-right">Actions</TableHead>}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {paginatedMappingEntries.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={canEditProduct ? 4 : 3} className="text-center text-muted-foreground py-8">
                                                            {mappingsSearchQuery ? 'No matching entries found.' : 'No salary mappings yet.'}
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    paginatedMappingEntries.map(({ mapping, originalIndex }, index) => {
                                                        const rowNumber = (mappingsPage - 1) * MAPPINGS_PAGE_SIZE + index + 1;
                                                        const isEditing = editingMappingIndex === originalIndex;
                                                        
                                                        return (
                                                            <TableRow key={originalIndex}>
                                                                <TableCell className="text-muted-foreground">{rowNumber}</TableCell>
                                                                <TableCell>
                                                                    {isEditing ? (
                                                                        <Input 
                                                                            value={editingAccountNumber}
                                                                            onChange={(e) => setEditingAccountNumber(e.target.value)}
                                                                            className="h-8"
                                                                        />
                                                                    ) : (
                                                                        <span className="font-mono">{mapping.accountNumber}</span>
                                                                    )}
                                                                </TableCell>
                                                                <TableCell>
                                                                    {isEditing ? (
                                                                        <Input 
                                                                            type="number"
                                                                            value={editingSalary}
                                                                            onChange={(e) => setEditingSalary(e.target.value)}
                                                                            className="h-8 w-28"
                                                                        />
                                                                    ) : (
                                                                        <span>{mapping.salary.toLocaleString()}</span>
                                                                    )}
                                                                </TableCell>
                                                                {canEditProduct && (
                                                                    <TableCell className="text-right">
                                                                        {isEditing ? (
                                                                            <div className="flex items-center justify-end gap-1">
                                                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSaveEditMapping}>
                                                                                    <Save className="h-3.5 w-3.5 text-green-600" />
                                                                                </Button>
                                                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelEditMapping}>
                                                                                    <X className="h-3.5 w-3.5" />
                                                                                </Button>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="flex items-center justify-end gap-1">
                                                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleStartEditMapping(originalIndex)}>
                                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                                </Button>
                                                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteMapping(originalIndex)}>
                                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                                </Button>
                                                                            </div>
                                                                        )}
                                                                    </TableCell>
                                                                )}
                                                            </TableRow>
                                                        );
                                                    })
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {/* Pagination */}
                                    {totalMappingsPages > 1 && (
                                        <div className="flex items-center justify-between pt-2">
                                            <div className="text-sm text-muted-foreground">
                                                Showing {((mappingsPage - 1) * MAPPINGS_PAGE_SIZE) + 1} - {Math.min(mappingsPage * MAPPINGS_PAGE_SIZE, filteredMappingEntries.length)} of {filteredMappingEntries.length}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    disabled={mappingsPage === 1}
                                                    onClick={() => setMappingsPage(p => Math.max(1, p - 1))}
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </Button>
                                                <span className="text-sm">Page {mappingsPage} of {totalMappingsPages}</span>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    disabled={mappingsPage >= totalMappingsPages}
                                                    onClick={() => setMappingsPage(p => Math.min(totalMappingsPages, p + 1))}
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    <UIDialogFooter>
                                        <UIDialogClose asChild>
                                            <Button variant="outline">Close</Button>
                                        </UIDialogClose>
                                    </UIDialogFooter>
                                </UIDialogContent>
                            </UIDialog>
                          </>
                        )}
                    </div>

                    <div className="flex items-center space-x-2 justify-end">
                        {canDeleteProduct && (
                            <Button variant="destructive" type="button" onClick={onDelete} disabled={isSaving}>
                                <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </Button>
                        )}
                        <Button
                            type="submit"
                            style={{ backgroundColor: providerColor }}
                            className="text-white"
                            disabled={!canEditProduct || isSaving || (((product as any)._optimisticPending) || product.status === 'PENDING_APPROVAL')}
                        >
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {(((product as any)._optimisticPending) || product.status === 'PENDING_APPROVAL') ? 'Pending Approval' : 'Submit for Approval'}
                        </Button>
                    </div>
                </form>
            </CollapsibleContent>
        </Collapsible>
       </>
    )
}

function ProvidersTab({ providers, onProvidersChange }: { 
    providers: LoanProvider[],
    onProvidersChange: (updater: React.SetStateAction<LoanProvider[]>) => void;
}) {
    const { currentUser } = useAuth();
    const { entityActions } = usePermissions();
    const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
    const [editingProvider, setEditingProvider] = useState<LoanProvider | null>(null);
    const [isAddProductDialogOpen, setIsAddProductDialogOpen] = useState(false);
    const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<{ type: 'provider' | 'product'; providerId: string; productId?: string } | null>(null);
    const [dataConfigs, setDataConfigs] = useState<DataProvisioningConfig[]>(providers.flatMap(p => p.dataProvisioningConfigs || []));

    const { toast } = useToast();

    const providerActions = entityActions('LoanProvider');
    const productActions = entityActions('LoanProduct');
    const canCreateProvider = !!providerActions.create;
    const canUpdateProvider = !!providerActions.update;
    const canDeleteProvider = !!providerActions.delete;
    const canCreateProduct = !!productActions.create;
    const canDeleteProduct = !!productActions.delete;
    
    useEffect(() => {
        setDataConfigs(providers.flatMap(p => p.dataProvisioningConfigs || []));
    }, [providers]);
    
    const themeColor = useMemo(() => {
        if (currentUser?.role === 'Super Admin' || currentUser?.role === 'Admin') {
            return providers.find(p => p.name === 'NIb Bank')?.colorHex || '#fdb913';
        }
        return providers.find(p => p.name === currentUser?.providerName)?.colorHex || '#fdb913';
    }, [currentUser, providers]);
    
    const handleOpenProviderDialog = (provider: LoanProvider | null = null) => {
        setEditingProvider(provider);
        setIsProviderDialogOpen(true);
    };

    const handleSaveProvider = async (providerData: Partial<Omit<LoanProvider, 'products' | 'dataProvisioningConfigs' | 'id' | 'initialBalance'>> & { id?: string }) => {
        const isEditing = !!providerData.id;
        if (isEditing && !canUpdateProvider) {
            toast({ title: 'Not authorized', description: 'You only have read access for Providers.', variant: 'destructive' });
            return;
        }
        if (!isEditing && !canCreateProvider) {
            toast({ title: 'Not authorized', description: 'You only have read access for Providers.', variant: 'destructive' });
            return;
        }
        try {
            const changeType = isEditing ? 'UPDATE' : 'CREATE';
            const entityId = isEditing ? providerData.id : undefined;

            let originalProvider = null;
            if (isEditing && entityId) {
                originalProvider = providers.find(p => p.id === entityId) || null;
            }

            const payload = {
                original: originalProvider,
                updated: { ...originalProvider, ...providerData },
                created: !isEditing ? providerData : undefined,
            };

            await postPendingChange({
                entityType: 'LoanProvider',
                entityId,
                changeType,
                payload: JSON.stringify(payload)
            }, 'Failed to submit provider changes');

            onProvidersChange(produce(draft => {
                if (isEditing && entityId) {
                    const index = draft.findIndex(p => p.id === entityId);
                    if (index !== -1) draft[index].status = 'PENDING_APPROVAL';
                }
            }));

            toast({ title: 'Submitted for Approval', description: `Changes for ${providerData.name} have been submitted for review.` });
        } catch (error: any) {
             toast({ title: "Error", description: error.message, variant: 'destructive' });
        }
    };
    
    const handleOpenAddProductDialog = (providerId: string) => {
        setSelectedProviderId(providerId);
        setIsAddProductDialogOpen(true);
    };

    const handleAddProduct = async (newProductData: Omit<LoanProduct, 'id' | 'status' | 'serviceFee' | 'dailyFee' | 'penaltyRules' | 'providerId' > & { icon?: string }) => {
        if (!selectedProviderId) return;

        if (!canCreateProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
            return;
        }

        try {
            await postPendingChange({
                entityType: 'LoanProduct',
                changeType: 'CREATE',
                payload: JSON.stringify({ created: { ...newProductData, providerId: selectedProviderId } })
            }, 'Failed to submit new product for approval');
            // Note: The product is not added to the local state, as it will only appear after approval.
            toast({ title: "Submitted for Approval", description: `${newProductData.name} has been submitted for review.` });
        } catch (error: any) {
             toast({ title: "Error", description: error.message, variant: 'destructive' });
        }
    };

    const handleUpdateProduct = (providerId: string, updatedProduct: LoanProduct) => {
        onProvidersChange(produce(draft => {
            const provider = draft.find(p => p.id === providerId);
            if (provider) {
                const productIndex = provider.products.findIndex(p => p.id === updatedProduct.id);
                if (productIndex !== -1) {
                     provider.products[productIndex] = { ...provider.products[productIndex], ...updatedProduct };
                }
            }
        }));
    }

    
    const confirmDelete = () => {
        if (!deletingId) return;

        if (deletingId.type === 'provider') {
            handleDeleteProvider(deletingId.providerId);
        } else if (deletingId.type === 'product' && deletingId.productId) {
            handleDeleteProduct(deletingId.providerId, deletingId.productId);
        }
        setDeletingId(null);
    }
    
    const handleDeleteProvider = async (providerId: string) => {
        try {
             if (!canDeleteProvider) {
                 toast({ title: 'Not authorized', description: 'You only have read access for Providers.', variant: 'destructive' });
                 return;
             }
             const providerToDelete = providers.find(p => p.id === providerId);
             if (!providerToDelete) throw new Error('Provider not found');

             await postPendingChange({
                entityType: 'LoanProvider',
                entityId: providerId,
                changeType: 'DELETE',
                payload: JSON.stringify({ original: sanitizeProviderForPayload(providerToDelete) })
            }, 'Could not submit deletion for approval.');
            
            onProvidersChange(produce(draft => {
                const index = draft.findIndex(p => p.id === providerId);
                if (index !== -1) draft[index].status = 'PENDING_APPROVAL';
            }));

            toast({ title: "Deletion Submitted", description: 'Provider deletion is pending approval.' });
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: 'destructive' });
        }
    }
    
    const handleDeleteProduct = async (providerId: string, productId: string) => {
        try {
            if (!canDeleteProduct) {
                toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
                return;
            }
            const provider = providers.find(p => p.id === providerId);
            const productToDelete = provider?.products.find(p => p.id === productId);
            if (!productToDelete) throw new Error("Product not found");

             await postPendingChange({ 
                    entityType: 'LoanProduct',
                    entityId: productId,
                    changeType: 'DELETE',
                    payload: JSON.stringify({ original: sanitizeProductForPayload(productToDelete) })
                 }, 'Could not submit product deletion for approval.');
            
             onProvidersChange(produce(draft => {
                const provider = draft.find(p => p.id === providerId);
                if (provider) {
                    const product = provider.products.find(p => p.id === productId);
                    if (product) { product.status = 'Disabled'; (product as any)._optimisticPending = true; }
                }
            }));
            toast({ title: "Deletion Submitted", description: "Product deletion is pending approval." });
        } catch (error: any) {
             toast({ title: "Error", description: error.message, variant: 'destructive' });
        }
    }
    
    if (providers.length === 0) {
        return (
            <>
                <div className="flex items-center justify-between space-y-2 mb-4">
                    <div></div>
                    {canCreateProvider && (
                        <Button onClick={() => handleOpenProviderDialog(null)} style={{ backgroundColor: themeColor }} className="text-white">
                            <PlusCircle className="mr-2 h-4 w-4" /> Add Provider
                        </Button>
                    )}
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Providers &amp; Products</CardTitle>
                        <CardDescription>
                            {canCreateProvider 
                                ? 'No providers available yet. Click "Add Provider" to create one.'
                                : 'No providers available. Please contact a Super Admin.'}
                        </CardDescription>
                    </CardHeader>
                </Card>
                <AddProviderDialog
                    isOpen={isProviderDialogOpen}
                    onClose={() => setIsProviderDialogOpen(false)}
                    onSave={handleSaveProvider}
                    provider={editingProvider}
                    primaryColor={themeColor}
                />
            </>
        );
    }

    return (
    <>
      <div className="flex items-center justify-between space-y-2 mb-4">
        <div></div>
                {canCreateProvider && (
          <Button onClick={() => handleOpenProviderDialog(null)} style={{ backgroundColor: themeColor }} className="text-white">
            <PlusCircle className="mr-2 h-4 w-4" /> Add Provider
          </Button>
        )}
      </div>
      <Accordion type="multiple" className="w-full space-y-4">
        {providers.map((provider) => (
          <AccordionItem value={provider.id} key={provider.id} className="border rounded-lg bg-card">
            <div className="flex items-center w-full p-4">
              <AccordionTrigger className="flex-1 p-0 hover:no-underline text-left" hideChevron>
                <div className="flex items-center gap-4">
                  <IconDisplay iconName={provider.icon} className="h-6 w-6" />
                  <div>
                    <div className="text-lg font-semibold">{provider.name}</div>
                    <div className="text-sm text-muted-foreground flex items-center">
                        {(provider.products || []).length} products
                        {provider.status === 'PENDING_APPROVAL' && <Badge variant="outline" className="ml-2">Pending Approval</Badge>}
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <div className="flex items-center gap-2 ml-auto pl-4">
                                {(canUpdateProvider || canDeleteProvider) && (
                  <>
                                        {canUpdateProvider && (
                                                <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="hover:bg-muted h-8 w-8"
                                                        onClick={(e) => { e.stopPropagation(); handleOpenProviderDialog(provider); }}
                                                >
                                                        <Edit className="h-4 w-4" />
                                                </Button>
                                        )}
                                        {canDeleteProvider && (
                                                <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="hover:bg-destructive hover:text-destructive-foreground h-8 w-8"
                                                        onClick={(e) => { e.stopPropagation(); setDeletingId({ type: 'provider', providerId: provider.id }); }}
                                                >
                                                        <Trash2 className="h-4 w-4" />
                                                </Button>
                                        )}
                  </>
                )}
                <AccordionTrigger className="p-2">
                  <span className="sr-only">Toggle</span>
                </AccordionTrigger>
              </div>
            </div>
            <AccordionContent className="p-4 border-t">
              <div className="space-y-6">
                {(provider.products || []).map(product => (
                  <ProductSettingsForm 
                    key={product.id}
                    provider={provider}
                    product={{...product, icon: product.icon || 'PersonStanding'}} 
                    providerColor={provider.colorHex} 
                    onSave={(savedProduct) => handleUpdateProduct(provider.id, savedProduct)}
                    onDelete={() => setDeletingId({ type: 'product', providerId: provider.id, productId: product.id })}
                    onUpdate={(updatedFields) => handleUpdateProduct(provider.id, { id: product.id, ...updatedFields })}
                    allDataConfigs={dataConfigs.filter(c => c.providerId === provider.id)}
                  />
                ))}
                {canCreateProduct && (
                    <Button 
                    variant="outline" 
                    className="w-full hover:text-white"
                    onClick={() => handleOpenAddProductDialog(provider.id)}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = provider.colorHex || themeColor; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                    >
                    <PlusCircle className="mr-2 h-4 w-4" /> Add New Product
                    </Button>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <AddProviderDialog
        isOpen={isProviderDialogOpen}
        onClose={() => setIsProviderDialogOpen(false)}
        onSave={handleSaveProvider}
        provider={editingProvider}
        primaryColor={themeColor}
      />
      <AddProductDialog
        isOpen={isAddProductDialogOpen}
        onClose={() => setIsAddProductDialogOpen(false)}
        onAddProduct={handleAddProduct}
      />
      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will submit a request to delete the selected item. This cannot be undone once approved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">Submit for Deletion</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
    );
}

type DailyFeeRule = FeeRule & { calculationBase?: 'principal' | 'compound' };

const FeeInput = ({ label, fee, onChange, isEnabled }: { label: string; fee: FeeRule; onChange: (fee: FeeRule) => void; isEnabled: boolean; }) => {
    return (
        <div className="flex items-center gap-2">
            <Label className={cn("w-28", !isEnabled && "text-muted-foreground/50")}>{label}</Label>
            <Select value={fee.type} onValueChange={(type: 'fixed' | 'percentage') => onChange({ ...fee, type })} disabled={!isEnabled}>
                <SelectTrigger className="w-32" disabled={!isEnabled}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
            </Select>
            <div className="relative flex-1">
                <Input
                    type="number"
                    value={fee.value ?? ''}
                    onChange={(e) => onChange({ ...fee, value: e.target.value === '' ? '' : Number(e.target.value) })}
                    placeholder="Enter value"
                    className={cn(fee.type === 'percentage' ? "pr-8" : "")}
                    disabled={!isEnabled}
                />
                {fee.type === 'percentage' && <span className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground", !isEnabled && "text-muted-foreground/50")}>%</span>}
            </div>
        </div>
    );
};

const DailyFeeInput = ({ label, fee, onChange, isEnabled }: { label: string; fee: DailyFeeRule; onChange: (fee: DailyFeeRule) => void; isEnabled: boolean; }) => {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Label className={cn("w-28", !isEnabled && "text-muted-foreground/50")}>{label}</Label>
                <Select value={fee.type} onValueChange={(type: 'fixed' | 'percentage') => onChange({ ...fee, type, calculationBase: type === 'fixed' ? undefined : fee.calculationBase || 'principal' })} disabled={!isEnabled}>
                    <SelectTrigger className="w-32" disabled={!isEnabled}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                    </SelectContent>
                </Select>
                <div className="relative flex-1">
                    <Input
                        type="number"
                        value={fee.value ?? ''}
                        onChange={(e) => onChange({ ...fee, value: e.target.value === '' ? '' : Number(e.target.value) })}
                        placeholder="Enter value"
                        className={cn(fee.type === 'percentage' ? "pr-8" : "")}
                        disabled={!isEnabled}
                    />
                    {fee.type === 'percentage' && <span className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground", !isEnabled && "text-muted-foreground/50")}>%</span>}
                </div>
            </div>
            {isEnabled && fee.type === 'percentage' && (
                <div className="flex items-center gap-2 pl-[124px]">
                    <Label className="w-32 text-sm text-muted-foreground">Calculation Base</Label>
                    <Select value={fee.calculationBase || 'principal'} onValueChange={(base: 'principal' | 'compound') => onChange({ ...fee, calculationBase: base })}>
                        <SelectTrigger className="flex-1">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="principal">Principal</SelectItem>
                            <SelectItem value="compound">Compound (Principal + Accrued)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}
        </div>
    );
};

const PenaltyRuleRow = ({ rule, onChange, onRemove, color, isEnabled }: { rule: PenaltyRule, onChange: (rule: PenaltyRule) => void, onRemove: () => void, color?: string, isEnabled: boolean }) => {
    return (
        <div className="flex items-center gap-2">
            <Input 
                type="number" 
                value={rule.fromDay ?? ''}
                onChange={(e) => onChange({...rule, fromDay: e.target.value === '' ? '' : parseInt(e.target.value)})}
                placeholder="From"
                className="w-20"
                disabled={!isEnabled}
            />
            <Input 
                type="number" 
                value={rule.toDay === Infinity ? '' : (rule.toDay ?? '')}
                onChange={(e) => onChange({...rule, toDay: e.target.value === '' ? null : parseInt(e.target.value)})}
                placeholder="To"
                className="w-20"
                disabled={!isEnabled}
            />
            <Select value={rule.type} onValueChange={(type: 'fixed' | 'percentageOfPrincipal' | 'percentageOfCompound') => onChange({ ...rule, type })} disabled={!isEnabled}>
                <SelectTrigger className="w-48" disabled={!isEnabled}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                    <SelectItem value="percentageOfPrincipal">Percentage of Principal</SelectItem>
                    <SelectItem value="percentageOfCompound">Percentage of Compound</SelectItem>
                </SelectContent>
            </Select>
             <Select value={rule.frequency || 'daily'} onValueChange={(freq: 'daily' | 'one-time') => onChange({ ...rule, frequency: freq })} disabled={!isEnabled}>
                <SelectTrigger className="w-36" disabled={!isEnabled}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="one-time">One Time</SelectItem>
                </SelectContent>
            </Select>
             <div className="relative flex-1">
                <Input
                    type="number"
                    value={rule.value ?? ''}
                    onChange={(e) => onChange({ ...rule, value: e.target.value === '' ? '' : Number(e.target.value) })}
                    placeholder="Value"
                    className={cn(rule.type !== 'fixed' ? "pr-8" : "")}
                    disabled={!isEnabled}
                />
                 {rule.type !== 'fixed' && <span className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground", !isEnabled && "text-muted-foreground/50")}>%</span>}
            </div>
             <Button variant="ghost" size="icon" onClick={onRemove} className="text-destructive" disabled={!isEnabled}><Trash2 className="h-4 w-4" /></Button>
        </div>
    );
};

function LoanTiersForm({ product, onUpdate, color }: {
    product: LoanProduct;
    onUpdate: (updatedProduct: Partial<LoanProduct>) => void;
    color?: string;
}) {
    const { entityActions } = usePermissions();
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const tiers = product.loanAmountTiers || [];

    const productActions = entityActions('LoanProduct');
    const canEditProduct = !!(productActions.create || productActions.update);

    const handleTierChange = (index: number, field: keyof Omit<LoanAmountTier, 'id' | 'productId'>, value: string) => {
        if (!canEditProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
            return;
        }
        const newTiers = produce(tiers, draft => {
            const newTier = { ...draft[index], [field]: value === '' ? '' : value };
            draft[index] = newTier;

            if (field === 'toScore' && index < draft.length - 1) {
                const nextTier = { ...draft[index + 1] };
                nextTier.fromScore = (Number(value) || 0) + 1;
                draft[index + 1] = nextTier;
            }
        });
        onUpdate({ loanAmountTiers: newTiers });
    };

    const handleAddTier = () => {
        if (!canEditProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
            return;
        }
        const lastTier = tiers[tiers.length - 1];
        const newFromScore = lastTier ? (Number(lastTier.toScore) || 0) + 1 : 0;
        
        const newTier: LoanAmountTier = {
            id: `tier-${Date.now()}`,
            productId: product.id,
            fromScore: newFromScore,
            toScore: newFromScore + 9,
            loanAmount: 0
        };

        onUpdate({ loanAmountTiers: [...tiers, newTier]});
    };

    const handleRemoveTier = (index: number) => {
        if (!canEditProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
            return;
        }
        const newTiers = tiers.filter((_, i) => i !== index);
        onUpdate({ loanAmountTiers: newTiers });
    };
    
    const handleSaveTiers = async () => {
        setIsLoading(true);
        try {
            const tiersToSend = tiers.map((tier, i) => {
                const fromScore = Number(tier.fromScore);
                const toScore = Number(tier.toScore);
                const loanAmount = Number(tier.loanAmount);

                if (isNaN(fromScore) || isNaN(toScore) || isNaN(loanAmount)) {
                    toast({ title: 'Invalid Tier', description: `In tier #${i + 1}, all fields must be valid numbers.`, variant: 'destructive'});
                    throw new Error("Invalid tier data");
                }
                if (loanAmount <= 0) {
                    toast({ title: 'Invalid Loan Amount', description: `In tier #${i + 1}, the loan amount must be positive.`, variant: 'destructive'});
                    throw new Error("Invalid loan amount");
                }
                 if (product.maxLoan != null && loanAmount > product.maxLoan) {
                    toast({ title: 'Invalid Loan Amount', description: `In tier #${i + 1}, the loan amount cannot exceed the product's maximum of ${product.maxLoan}.`, variant: 'destructive'});
                    throw new Error("Invalid loan amount");
                }
                if (fromScore > toScore) {
                    toast({ title: 'Invalid Tier', description: `In tier #${i + 1}, the "From Score" cannot be greater than the "To Score".`, variant: 'destructive'});
                    throw new Error("Invalid tier data");
                }
                if (i > 0) {
                    const prevToScore = Number(tiers[i-1].toScore);
                    if (fromScore <= prevToScore) {
                        toast({ title: 'Overlapping Tiers', description: `Tier #${i + 1} overlaps with the previous tier. "From Score" must be greater than the previous "To Score".`, variant: 'destructive'});
                        throw new Error("Overlapping Tiers");
                    }
                }
                return {
                    ...tier,
                    fromScore,
                    toScore,
                    loanAmount,
                    id: String(tier.id).startsWith('tier-') ? undefined : tier.id
                }
            });

            // This update is now part of the parent's save logic.
            onUpdate({ loanAmountTiers: tiersToSend });
            toast({ title: 'Tiers Updated', description: 'Tiers have been staged for approval. Submit the product changes to finalize.' });
            
        } catch (error: any) {
            // Validation errors are already toasted.
            if (!["Invalid tier data", "Invalid loan amount", "Overlapping Tiers"].includes(error.message)) {
                toast({ title: 'Error Updating Tiers', description: error.message, variant: 'destructive' });
            }
        } finally {
            setIsLoading(false);
        }
    };


    return (
         <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
            <Card>
                <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Loan Amount Tiers</CardTitle>
                                <CardDescription>Define loan amounts based on credit scores for this product.</CardDescription>
                            </div>
                            <ChevronDown className="h-4 w-4 transition-transform duration-200 data-[state=open]:rotate-180" />
                        </div>
                    </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <CardContent className="space-y-4 pt-0">
                         {tiers.map((tier, index) => (
                            <div key={tier.id} className="flex items-center gap-4 p-2 rounded-md bg-muted/50">
                                <Label className="w-20">From Score</Label>
                                <Input
                                    type="number"
                                    value={tier.fromScore ?? ''}
                                    onChange={(e) => handleTierChange(index, 'fromScore', e.target.value)}
                                    className="w-28"
                                    disabled={index > 0 || !canEditProduct} // Only first "from" is editable
                                />
                                <Label className="w-16">To Score</Label>
                                 <Input
                                    type="number"
                                    value={tier.toScore ?? ''}
                                    onChange={(e) => handleTierChange(index, 'toScore', e.target.value)}
                                    className="w-28"
                                                disabled={!canEditProduct}
                                />
                                <Label className="w-24">Loan Amount</Label>
                                 <Input
                                    type="number"
                                    value={tier.loanAmount ?? ''}
                                    onChange={(e) => handleTierChange(index, 'loanAmount', e.target.value)}
                                    className="flex-1"
                                    disabled={!canEditProduct}
                                />
                                <Button variant="ghost" size="icon" onClick={() => handleRemoveTier(index)} className="text-destructive" disabled={!canEditProduct}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                         <Button variant="outline" onClick={handleAddTier} className="w-full" disabled={!canEditProduct}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Add Tier
                        </Button>
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
}

function ProductConfiguration({ product, providerColor, onProductUpdate, taxConfig }: { 
    product: LoanProduct; 
    providerColor?: string;
    onProductUpdate: (updatedProduct: LoanProduct) => void;
    taxConfig: Tax;
}) {
    const { entityActions } = usePermissions();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const productActions = entityActions('LoanProduct');
    const canEditProduct = !!(productActions.create || productActions.update);
    
    const taxAppliedTo = useMemo(() => safeParseJson({appliedTo: taxConfig.appliedTo}, 'appliedTo', []), [taxConfig.appliedTo]);

    const parsedProduct = useMemo(() => {
        const serviceFee = safeParseJson(product, 'serviceFee', { type: 'percentage', value: 0 });
        const dailyFee = safeParseJson(product, 'dailyFee', { type: 'percentage', value: 0, calculationBase: 'principal' });
        const penaltyRules = safeParseJson(product, 'penaltyRules', []).map((r: any) => ({ ...r, frequency: r.frequency || 'daily' }));
        const penaltyPerInstallment = (product as any).penaltyPerInstallment ?? false;
        return {
            ...product,
            serviceFee,
            dailyFee,
            penaltyRules,
            penaltyPerInstallment,
        };
    }, [product]);
    
    const [config, setConfig] = useState(parsedProduct);

    useEffect(() => {
        setConfig(parsedProduct);
    }, [parsedProduct]);

    const handleUpdate = (update: Partial<LoanProduct>) => {
        if (!canEditProduct) return;
        setConfig(prev => ({...prev, ...update}));
    };

    const handleAddPenaltyRule = () => {
        if (!canEditProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
            return;
        }
        const newRule: PenaltyRule = {
            id: `penalty-${Date.now()}`,
            fromDay: 1,
            toDay: null,
            type: 'fixed',
            value: 0,
            frequency: 'daily'
        };
        setConfig(prev => ({...prev, penaltyRules: [...prev.penaltyRules, newRule]}));
    };

    const handleRemovePenaltyRule = (ruleId: string) => {
        if (!canEditProduct) return;
        setConfig(prev => ({...prev, penaltyRules: prev.penaltyRules.filter(r => r.id !== ruleId)}));
    };
    
    const handleUpdatePenaltyRule = (ruleId: string, updatedRule: PenaltyRule) => {
         if (!canEditProduct) return;
         setConfig(prev => ({
            ...prev,
            penaltyRules: prev.penaltyRules.map(r => r.id === ruleId ? updatedRule : r)
        }));
    };

    const handleSave = async () => {
        if (!canEditProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            // Validate loan amount tiers before submitting, in case the user
            // edited tiers but didn't click the dedicated "Update Tiers" button.
            const tiersToValidate = (config.loanAmountTiers || []) as any[];
            for (let i = 0; i < tiersToValidate.length; i++) {
                const tier = tiersToValidate[i];
                const fromScore = Number(tier.fromScore);
                const toScore = Number(tier.toScore);
                const loanAmount = Number(tier.loanAmount);

                if (isNaN(fromScore) || isNaN(toScore) || isNaN(loanAmount)) {
                    toast({ title: 'Invalid Tier', description: `In tier #${i + 1}, all fields must be valid numbers.`, variant: 'destructive'});
                    throw new Error('Invalid tier data');
                }
                if (loanAmount <= 0) {
                    toast({ title: 'Invalid Loan Amount', description: `In tier #${i + 1}, the loan amount must be positive.`, variant: 'destructive'});
                    throw new Error('Invalid loan amount');
                }
                if (config.maxLoan != null && !isNaN(Number(config.maxLoan)) && loanAmount > Number(config.maxLoan)) {
                    toast({ title: 'Invalid Loan Amount', description: `In tier #${i + 1}, the loan amount cannot exceed the product's maximum of ${config.maxLoan}.`, variant: 'destructive'});
                    throw new Error('Invalid loan amount');
                }
                if (fromScore > toScore) {
                    toast({ title: 'Invalid Tier', description: `In tier #${i + 1}, the "From Score" cannot be greater than the "To Score".`, variant: 'destructive'});
                    throw new Error('Invalid tier data');
                }
                if (i > 0) {
                    const prevToScore = Number(tiersToValidate[i-1].toScore);
                    if (fromScore <= prevToScore) {
                        toast({ title: 'Overlapping Tiers', description: `Tier #${i + 1} overlaps with the previous tier. "From Score" must be greater than the previous "To Score".`, variant: 'destructive'});
                        throw new Error('Overlapping Tiers');
                    }
                }
            }

            // Only include original fields for keys that are present in the updated config
            const updateKeys = Object.keys(config).filter(k => (config as any)[k] !== undefined);
            const pick = (obj: any, keys: string[]) => keys.reduce((acc: any, k: string) => { if (obj && (k in obj)) acc[k] = (obj as any)[k]; return acc; }, {});
            const originalSubset = pick(product, updateKeys);

            const payload = {
                original: sanitizeProductForPayload(originalSubset), // The original product state before edits (sanitized)
                updated: sanitizeProductForPayload(config),   // The new state from the form (sanitized)
            };
            await postPendingChange({
                entityType: 'LoanProduct',
                entityId: product.id,
                changeType: 'UPDATE',
                payload: JSON.stringify(payload)
            }, 'Failed to submit changes for approval.');

            // Update the parent state to reflect pending status
            onProductUpdate({ ...config, status: 'Disabled', _optimisticPending: true } as any);
            
            toast({
                title: 'Submitted for Approval',
                description: `Changes for ${config.name} have been submitted successfully.`,
            });
        } catch (error: any) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
            <CollapsibleTrigger asChild>
                 <button className="flex items-center justify-between w-full space-x-4 px-4 py-2 border rounded-lg bg-background hover:bg-muted/50 transition-colors">
                    <h4 className="text-sm font-semibold">{product.name}</h4>
                    {(config as any)._optimisticPending || config.status === 'PENDING_APPROVAL' ? (
                        <Badge variant="outline">Pending Approval</Badge>
                    ) : (
                        <ChevronDown className="h-4 w-4 transition-transform duration-200 data-[state=open]:rotate-180" />
                    )}
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                 <Card className="border-t-0 rounded-t-none">
                    <CardContent className="space-y-4 pt-6">
                        <div className="flex items-center justify-between border-b pb-4">
                            <div className="flex items-center gap-2">
                                <Label htmlFor={`serviceFeeEnabled-${config.id}`} className="font-medium">Service Fee</Label>
                                {taxAppliedTo.includes('serviceFee') && <Badge variant="outline" className="text-xs">Taxable ({taxConfig.rate}%)</Badge>}
                            </div>
                            <Switch
                                id={`serviceFeeEnabled-${config.id}`}
                                checked={config.serviceFeeEnabled}
                                onCheckedChange={(checked) => handleUpdate({ serviceFeeEnabled: checked })}
                                disabled={!canEditProduct}
                                className="data-[state=checked]:bg-[--provider-color]"
                                style={{'--provider-color': providerColor} as React.CSSProperties}
                            />
                        </div>
                    <FeeInput 
                            label="Fee Details"
                            fee={config.serviceFee}
                            onChange={(fee) => handleUpdate({ serviceFee: fee })}
                            isEnabled={!!config.serviceFeeEnabled && canEditProduct}
                        />
                        
                        <div className="flex items-center justify-between border-b pb-4 pt-4">
                             <div className="flex items-center gap-2">
                                <Label htmlFor={`dailyFeeEnabled-${config.id}`} className="font-medium">Daily Fee</Label>
                                {taxAppliedTo.includes('interest') && <Badge variant="outline" className="text-xs">Taxable ({taxConfig.rate}%)</Badge>}
                            </div>
                            <Switch
                                id={`dailyFeeEnabled-${config.id}`}
                                checked={config.dailyFeeEnabled}
                                onCheckedChange={(checked) => handleUpdate({ dailyFeeEnabled: checked })}
                                disabled={!canEditProduct}
                                className="data-[state=checked]:bg-[--provider-color]"
                                style={{'--provider-color': providerColor} as React.CSSProperties}
                            />
                        </div>
                        <DailyFeeInput 
                            label="Fee Details"
                            fee={config.dailyFee}
                            onChange={(fee) => handleUpdate({ dailyFee: fee })}
                            isEnabled={!!config.dailyFeeEnabled && canEditProduct}
                        />
                        
                        <div className="flex items-center justify-between border-b pb-4 pt-4">
                             <div className="flex items-center gap-2">
                                <Label htmlFor={`penaltyRulesEnabled-${config.id}`} className="font-medium">Penalty Rules</Label>
                            </div>
                            <Switch
                                id={`penaltyRulesEnabled-${config.id}`}
                                checked={config.penaltyRulesEnabled}
                                onCheckedChange={(checked) => handleUpdate({ penaltyRulesEnabled: checked })}
                                disabled={!canEditProduct}
                                className="data-[state=checked]:bg-[--provider-color]"
                                style={{'--provider-color': providerColor} as React.CSSProperties}
                            />
                        </div>
                            {config.isSalaryAdvance && (
                                <div className="flex items-center justify-between mt-3">
                                    <div className="flex items-center gap-2">
                                        <Label htmlFor={`penaltyPerInstallment-${config.id}`} className="font-medium">Apply Penalty Per Installment</Label>
                                        <div className="text-sm text-muted-foreground">(Each installment uses its own due date)</div>
                                    </div>
                                    <Switch
                                        id={`penaltyPerInstallment-${config.id}`}
                                        checked={!!config.penaltyPerInstallment}
                                        onCheckedChange={(checked) => handleUpdate({ penaltyPerInstallment: checked })}
                                        disabled={!canEditProduct}
                                        className="data-[state=checked]:bg-[--provider-color]"
                                        style={{'--provider-color': providerColor} as React.CSSProperties}
                                    />
                                </div>
                            )}
                        <div>
                            <div className="space-y-2 p-4 border rounded-md bg-muted/50">
                                {config.penaltyRules.map((rule) => (
                                    <PenaltyRuleRow
                                        key={rule.id}
                                        rule={rule}
                                        onChange={(updatedRule) => handleUpdatePenaltyRule(rule.id, updatedRule)}
                                        onRemove={() => handleRemovePenaltyRule(rule.id)}
                                        color={providerColor}
                                        isEnabled={!!config.penaltyRulesEnabled && canEditProduct}
                                    />
                                ))}
                                <Button variant="outline" size="sm" onClick={handleAddPenaltyRule} disabled={!config.penaltyRulesEnabled || !canEditProduct}>
                                    <PlusCircle className="h-4 w-4 mr-2" /> Add Penalty Rule
                                </Button>
                            </div>
                        </div>
                        
                        <div className="pt-4">
                            <LoanTiersForm
                                product={config}
                                onUpdate={(updatedProductData) => handleUpdate(updatedProductData)}
                                color={providerColor}
                            />
                        </div>

                </CardContent>
                <CardFooter>
                        <Button 
                            onClick={handleSave} 
                            size="sm"
                            style={{ backgroundColor: providerColor }}
                            className="text-white ml-auto"
                            disabled={!canEditProduct || isSaving || ((config as any)._optimisticPending || config.status === 'PENDING_APPROVAL')}
                        >
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                            {(config as any)._optimisticPending || config.status === 'PENDING_APPROVAL' ? 'Pending Approval' : 'Submit for Approval'}
                        </Button>
                </CardFooter>
            </Card>
            </CollapsibleContent>
        </Collapsible>
    );
}

function ConfigurationTab({ providers, onProductUpdate, taxConfig }: { 
    providers: LoanProvider[],
    onProductUpdate: (providerId: string, updatedProduct: LoanProduct) => void;
    taxConfig: Tax;
}) {
    if (providers.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Product Fee Configuration</CardTitle>
                    <CardDescription>
                        No providers available to configure.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }
    
    return (
        <>
        <Accordion type="multiple" className="w-full space-y-4">
            {providers.map((provider) => (
                <AccordionItem value={provider.id} key={provider.id} className="border rounded-lg bg-card">
                    <AccordionTrigger className="flex w-full items-center justify-between p-4 hover:no-underline">
                        <div className="flex items-center gap-4">
                            <IconDisplay iconName={provider.icon} className="h-6 w-6" />
                            <div>
                                <div className="text-lg font-semibold">{provider.name}</div>
                                <p className="text-sm text-muted-foreground">{(provider.products || []).length} products to configure</p>
                            </div>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 border-t space-y-6">
                       {(provider.products || []).map(product => (
                            <ProductConfiguration
                                key={product.id}
                                product={product}
                                providerColor={provider.colorHex}
                                onProductUpdate={(updatedProduct) => onProductUpdate(provider.id, updatedProduct)}
                                taxConfig={taxConfig}
                            />
                       ))}
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
        </>
    );
}

const TAX_COMPONENTS = [
    { id: 'serviceFee', label: 'Service Fee' },
    { id: 'interest', label: 'Daily Fee (Interest)' },
];

function TaxTab({ initialTaxConfig }: { initialTaxConfig: Tax }) {
    const [taxConfig, setTaxConfig] = useState(initialTaxConfig);

    useEffect(() => {
        setTaxConfig(initialTaxConfig);
    }, [initialTaxConfig]);
    
    const appliedTo = useMemo(() => safeParseJson({appliedTo: taxConfig.appliedTo}, 'appliedTo', []), [taxConfig.appliedTo]);

    return (
        <Card>
            <CardHeader className='flex-row items-start justify-between'>
                <div>
                    <CardTitle>Global Tax Configuration</CardTitle>
                    <CardDescription>This is a read-only view of the current system-wide tax settings.</CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                    <Link href="/admin/tax">
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit Configuration
                    </Link>
                </Button>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Label>Tax Rate (%)</Label>
                    <Input 
                        value={`${taxConfig.rate}%`}
                        readOnly
                        className="max-w-xs bg-muted"
                    />
                </div>
                <div className="space-y-4">
                    <Label>Tax is Applied On</Label>
                    <div className="space-y-2 rounded-md border p-4 bg-muted">
                        {TAX_COMPONENTS.map(component => (
                            <div key={component.id} className="flex items-center space-x-2">
                                <Checkbox
                                    id={`tax-on-${component.id}-readonly`}
                                    checked={appliedTo.includes(component.id)}
                                    disabled
                                />
                                <Label htmlFor={`tax-on-${component.id}-readonly`} className="font-normal">{component.label}</Label>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

function EligibilityTab({ providers, onProvidersChange }: { 
    providers: LoanProvider[],
    onProvidersChange: (updater: React.SetStateAction<LoanProvider[]>) => void;
}) {
    const { entityActions } = usePermissions();
    const { toast } = useToast();
    const [isSaving, setIsSaving] = useState(false);
    const [viewingUpload, setViewingUpload] = useState<DataProvisioningUpload | null>(null);

    const productActions = entityActions('LoanProduct');
    const eligibilityActions = entityActions('EligibilityList');
    const canUpdateProduct = !!(productActions.create || productActions.update);
    const canCreateEligibilityList = !!eligibilityActions.create;
    const canDeleteEligibilityList = !!eligibilityActions.delete;

    const handleUpdateProduct = async (providerId: string, updatedProduct: Partial<LoanProduct>) => {
        if (!canUpdateProduct) {
            toast({ title: 'Not authorized', description: 'You only have read access for Products.', variant: 'destructive' });
            return;
        }
        // Optimistically update UI
        const previousState = JSON.parse(JSON.stringify(providers));
        onProvidersChange(produce(draft => {
            const provider = draft.find(p => p.id === providerId);
            if (provider) {
                const productIndex = provider.products.findIndex(p => p.id === updatedProduct.id);
                if (productIndex !== -1) {
                    provider.products[productIndex] = { ...provider.products[productIndex], ...updatedProduct };
                }
            }
        }));

        // Previously we auto-submitted changes to eligibility configuration (enable/link data source).
        // New behaviour:
        // - Selecting a data source or enabling eligibility does NOT auto-submit — admin can finish
        //   the workflow (upload list, review) and then click "Submit for Approval".
        // - Disabling eligibility (turning `dataProvisioningEnabled` from true -> false) *does*
        //   require approval, so create a pending-change when the user disables it.

        const originalProduct = previousState.find((p: LoanProvider) => p.id === providerId)?.products.find((p: LoanProduct) => p.id === updatedProduct.id);

        // If we don't have the original product context, just return (no auto-persist).
        if (!originalProduct) return;

        const isDisablingEligibility = typeof (updatedProduct as any).dataProvisioningEnabled !== 'undefined'
            && originalProduct.dataProvisioningEnabled === true
            && (updatedProduct as any).dataProvisioningEnabled === false;

        if (!isDisablingEligibility) {
            // No automatic persistence for other eligibility edits — user must explicitly submit.
            return;
        }

        // Create a pending change for disabling eligibility
        setIsSaving(true);
        try {
            const body: any = { id: updatedProduct.id, dataProvisioningEnabled: false };
            const payload = { original: originalProduct, updated: { ...originalProduct, ...body } };

            await postPendingChange({
                entityType: 'LoanProduct',
                entityId: updatedProduct.id,
                changeType: 'UPDATE',
                payload: JSON.stringify(payload)
            }, 'Failed to submit changes for approval');

            toast({ title: 'Submitted for Approval', description: 'Disabling eligibility has been submitted for review.' });

            // Mark product as pending in the UI
            onProvidersChange(produce(draft => {
                const provider = draft.find(p => p.id === providerId);
                if (provider) {
                    const product = provider.products.find(p => p.id === updatedProduct.id);
                    if (product) { (product as any).status = 'Disabled'; (product as any)._optimisticPending = true; }
                }
            }));

        } catch (error: any) {
            // Revert optimistic change
            onProvidersChange(previousState as any);
            toast({ title: 'Error', description: error.message || 'Failed to update product', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleFilterFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, product: LoanProduct) => {
        const file = event.target.files?.[0];
        if (!file || !product.dataProvisioningConfigId) return;

        if (!canCreateEligibilityList) {
            toast({ title: 'Not authorized', description: 'You only have read access for Eligibility.', variant: 'destructive' });
            if (event.target) event.target.value = '';
            return;
        }

        // Client-side validation: reject unsupported file types and oversized files early
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
        const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        const allowedExtensions = ['xlsx'];
        
        const fileName = file.name || '';
        const ext = fileName.split('.').pop()?.toLowerCase();
        
        // Validate file extension
        if (!ext || !allowedExtensions.includes(ext)) {
            toast({ 
                title: 'Invalid file type', 
                description: 'Only .xlsx files are allowed.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }
        
        // Validate file type (MIME type)
        if (file.type && !allowedTypes.includes(file.type) && !file.type.includes('sheet')) {
            toast({ 
                title: 'Invalid file type', 
                description: 'Only .xlsx files are allowed.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }
        
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            toast({ 
                title: 'File too large', 
                description: 'Maximum file size is 10MB.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }

        setIsSaving(true);
        try {
            const fileReader = new FileReader();
            fileReader.readAsDataURL(file);
            fileReader.onload = async (e) => {
                const fileContentBase64 = (e.target?.result as string)?.split(',')[1];
                if (!fileContentBase64) {
                    throw new Error("Could not read file content.");
                }
                 const tempUpload: DataProvisioningUpload = {
                    id: `temp-${Date.now()}`,
                    configId: product.dataProvisioningConfigId!,
                    fileName: file.name,
                    rowCount: 0, 
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: 'you (unsaved)',
                    status: 'PENDING_APPROVAL',
                    fileContent: fileContentBase64,
                } as any;
                handleUpdateProduct(product.providerId, { id: product.id, eligibilityUpload: tempUpload });
            };
        } catch (error: any) {
            toast({ title: "Error reading file", description: error.message, variant: 'destructive'});
        } finally {
            setIsSaving(false);
            if (event.target) event.target.value = '';
        }
    };
    
    const handleEligibilitySubmitForApproval = async (product: LoanProduct) => {
        if (!canCreateEligibilityList) {
            toast({ title: 'Not authorized', description: 'You only have read access for Eligibility.', variant: 'destructive' });
            return;
        }
        if (!product.eligibilityUpload || !(product.eligibilityUpload as any).fileContent) {
            toast({ title: "No file to submit", description: "Please upload a file first.", variant: "destructive"});
            return;
        }

        setIsSaving(true);
        try {
            const { eligibilityUpload } = product;
            const payload = {
                created: {
                    configId: eligibilityUpload.configId,
                    fileName: eligibilityUpload.fileName,
                    fileContent: (eligibilityUpload as any).fileContent,
                    productId: product.id,
                }
            };
             await postPendingChange({
                entityType: 'EligibilityList',
                entityId: product.id,
                changeType: 'CREATE',
                payload: JSON.stringify(payload),
            }, 'Failed to submit eligibility list for approval.');
            toast({ title: "Submitted for Approval", description: `The new eligibility list for "${product.name}" is pending review.` });
            
            const finalUploadState = { ...product.eligibilityUpload, id: 'pending-approval', status: 'PENDING_APPROVAL', fileContent: undefined };
            handleUpdateProduct(product.providerId, { id: product.id, eligibilityUpload: finalUploadState as any });

        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleDeleteFilter = async (product: LoanProduct) => {
        if (!product.eligibilityUploadId) return;

        if (!canDeleteEligibilityList) {
            toast({ title: 'Not authorized', description: 'You only have read access for Eligibility.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            const response = await fetch(`/api/settings/products/eligibility-filter?productId=${product.id}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete filter.');
            }
            handleUpdateProduct(product.providerId, { id: product.id, eligibilityFilter: null, eligibilityUploadId: null, eligibilityUpload: undefined });
            toast({ title: "Filter Deleted", description: "Eligibility list has been removed." });
        } catch (error: any) {
             toast({ title: "Error", description: error.message, variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            <Accordion type="multiple" className="w-full space-y-4">
                {providers.map((provider) => (
                    <AccordionItem value={provider.id} key={provider.id} className="border rounded-lg bg-card">
                        <AccordionTrigger className="flex w-full items-center justify-between p-4 hover:no-underline">
                            <div className="flex items-center gap-4">
                                <IconDisplay iconName={provider.icon} className="h-6 w-6" />
                                <div>
                                    <div className="text-lg font-semibold">{provider.name}</div>
                                    <p className="text-sm text-muted-foreground">Managing {(provider.products || []).length} products</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="p-4 border-t space-y-6">
                            {(provider.products || []).map(product => (
                                <Card key={product.id}>
                                    <CardHeader>
                                        <CardTitle className="text-base">{product.name}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="flex items-center space-x-2">
                                            <Switch
                                                id={`dataProvisioningEnabled-${product.id}`}
                                                checked={!!product.dataProvisioningEnabled}
                                                onCheckedChange={(checked) => handleUpdateProduct(provider.id, { id: product.id, dataProvisioningEnabled: checked })}
                                                className="data-[state=checked]:bg-[--provider-color]"
                                                style={{ '--provider-color': provider.colorHex } as React.CSSProperties}
                                                disabled={!canUpdateProduct || ((product as any)._optimisticPending || product.status === 'PENDING_APPROVAL')}
                                            />
                                            <Label htmlFor={`dataProvisioningEnabled-${product.id}`}>Enable Eligibility Allow-List</Label>
                                        </div>

                                        {product.dataProvisioningEnabled && (
                                            <div className="pl-8 space-y-4">
                                                <div className="space-y-2">
                                                    <Label>Link Data Source</Label>
                                                    <Select
                                                        value={product.dataProvisioningConfigId || ''}
                                                        onValueChange={(value) => handleUpdateProduct(provider.id, { id: product.id, dataProvisioningConfigId: value })}
                                                        disabled={!canUpdateProduct || ((product as any)._optimisticPending || product.status === 'PENDING_APPROVAL')}
                                                    >
                                                        <SelectTrigger className="w-full">
                                                            <SelectValue placeholder="Select a data source..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {(provider.dataProvisioningConfigs || []).map(config => (
                                                                <SelectItem key={config.id} value={config.id}>{config.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Upload List</Label>
                                                    <div className="flex items-center gap-4">
                                                        <Button asChild variant="outline" size="sm">
                                                            <label
                                                                htmlFor={`filter-upload-${product.id}`}
                                                                className={cn(
                                                                    "cursor-pointer",
                                                                    (!product.dataProvisioningConfigId || !canCreateEligibilityList) && 'cursor-not-allowed opacity-50',
                                                                )}
                                                            >
                                                                <Upload className="h-4 w-4 mr-2" />
                                                                {isSaving ? "Uploading..." : "Upload Excel File"}
                                                                <input
                                                                    id={`filter-upload-${product.id}`}
                                                                    type="file"
                                                                    accept=".xlsx, .xls"
                                                                    onChange={(e) => handleFilterFileUpload(e, product)}
                                                                    className="hidden"
                                                                    disabled={isSaving || !product.dataProvisioningConfigId || !canCreateEligibilityList}
                                                                />
                                                            </label>
                                                        </Button>
                                                        <p className="text-xs text-muted-foreground">The headers must match the linked data source.</p>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Uploaded List</Label>
                                                    {product.eligibilityUpload ? (
                                                        <div className="border rounded-lg p-3">
                                                            <div className="flex justify-between items-start">
                                                                <div>
                                                                    <p className="font-medium">{product.eligibilityUpload.fileName}</p>
                                                                    <p className="text-sm text-muted-foreground">
                                                                        {product.eligibilityUpload.status === 'PENDING_APPROVAL' ? 'Pending Approval' : `By ${product.eligibilityUpload.uploadedBy} on ${format(new Date(product.eligibilityUpload.uploadedAt), "MMM d, yyyy 'at' h:mm a")}`}
                                                                    </p>
                                                                </div>
                                                                <div className="flex gap-2 items-center">
                                                                    <Button variant="outline" size="sm" onClick={() => setViewingUpload(product.eligibilityUpload ?? null)}>View</Button>
                                                                    {canDeleteEligibilityList && (
                                                                        <Button variant="destructive" size="sm" onClick={() => handleDeleteFilter(product)}>
                                                                            Delete List
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {(product.eligibilityUpload as any).fileContent && (
                                                                <div className="mt-2 text-right">
                                                                     <Button size="sm" onClick={() => handleEligibilitySubmitForApproval(product)} disabled={!canCreateEligibilityList || isSaving}>
                                                                        Submit Eligibility for Approval
                                                                     </Button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <p className="text-sm text-muted-foreground">No eligibility list has been uploaded for this product.</p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
             {viewingUpload && (
                 <UploadDataViewerDialog
                    upload={viewingUpload}
                    onClose={() => setViewingUpload(null)}
                />
            )}
        </>
    );
}

function LoanCycleTab({ providers, onProviderUpdate }: {
    providers: LoanProvider[],
    onProviderUpdate: (providerId: string, productId: string, update: Partial<LoanProduct>) => void;
}) {
    if (providers.length === 0) {
        return <Card><CardHeader><CardTitle>Loan Cycle Configuration</CardTitle><CardDescription>No providers available.</CardDescription></CardHeader></Card>;
    }
    return (
        <Accordion type="multiple" className="w-full space-y-4">
            {providers.map((provider) => (
                 <AccordionItem value={provider.id} key={provider.id} className="border rounded-lg bg-card">
                     <AccordionTrigger className="flex w-full items-center justify-between p-4 hover:no-underline">
                        <div className="flex items-center gap-4">
                            <IconDisplay iconName={provider.icon} className="h-6 w-6" />
                            <div>
                                <div className="text-lg font-semibold">{provider.name}</div>
                                <p className="text-sm text-muted-foreground">Configuring {(provider.products || []).length} products</p>
                            </div>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 border-t space-y-6">
                        {(provider.products || []).map(product => (
                             <LoanCycleForm 
                                key={product.id}
                                product={product} 
                                onUpdate={(update) => onProviderUpdate(provider.id, product.id, update)}
                                providerColor={provider.colorHex}
                            />
                        ))}
                    </AccordionContent>
                 </AccordionItem>
            ))}
        </Accordion>
    )
}

function LoanCycleForm({ product, onUpdate, providerColor }: {
    product: LoanProduct,
    onUpdate: (update: Partial<LoanProduct>) => void,
    providerColor?: string;
}) {
    const { toast } = useToast();
    const { entityActions } = usePermissions();
    const loanCycleActions = entityActions('LoanCycleConfig');
    const [loanCycleConfig, setLoanCycleConfig] = useState<LoanCycleConfig | null>(null);
    const [editingMetric, setEditingMetric] = useState<LoanCycleConfig['metric'] | null>(null);
    const [editingEnabled, setEditingEnabled] = useState<boolean>(true);
    const [editingCycleRanges, setEditingCycleRanges] = useState<Array<{ label: string; min: number | ''; max: number | '' }>>([]);
    const [editingGrades, setEditingGrades] = useState<Array<{ label: string; minScore: number | ''; percentages: number[] }>>([]);
    const [newCycleLabel, setNewCycleLabel] = useState<string>('');
    const [isSavingLoanCycle, setIsSavingLoanCycle] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const canEditLoanCycle = loanCycleConfig ? loanCycleActions.update : loanCycleActions.create;
    const loanCycleReadOnly = !canEditLoanCycle;

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                const res = await fetch(`/api/settings/products/loan-cycle?productId=${product.id}`);
                if (!res.ok) return;
                const data = await res.json();
                if (!mounted) return;
                if (!data) {
                    setLoanCycleConfig(null);
                    setEditingMetric(null);
                    setEditingCycleRanges([]);
                    setEditingGrades([]);
                    return;
                }
                const rangesParsed = typeof data.cycleRanges === 'string' ? JSON.parse(data.cycleRanges) : data.cycleRanges;
                const gradesParsed = typeof data.grades === 'string' ? JSON.parse(data.grades) : data.grades;
                setLoanCycleConfig({ ...data, cycleRanges: rangesParsed, grades: gradesParsed });
                setEditingMetric(data.metric);
                setEditingEnabled(typeof data.enabled === 'boolean' ? data.enabled : true);
                setEditingCycleRanges(Array.isArray(rangesParsed) ? rangesParsed.map((r: any) => ({ label: r.label ?? `${r.min}-${r.max}`, min: r.min ?? '', max: r.max ?? '' })) : []);
                setEditingGrades(Array.isArray(gradesParsed) ? gradesParsed.map((g: any) => ({ label: g.label ?? '', minScore: g.minScore ?? '', percentages: Array.isArray(g.percentages) ? g.percentages : [] })) : []);
            } catch (err) {
                // ignore errors for now
            }
        }
        load();
        return () => { mounted = false; };
    }, [product.id]);

    const addCycleRange = () => {
        const label = newCycleLabel.trim() || `r${editingCycleRanges.length + 1}`;
        setEditingCycleRanges(prev => [...prev, { label, min: '', max: '' }]);
        setNewCycleLabel('');
        setEditingGrades(prev => prev.map(g => ({ ...g, percentages: [...g.percentages, 0] })));
    };

    const removeCycleRange = (idx: number) => {
        setEditingCycleRanges(prev => prev.filter((_, i) => i !== idx));
        setEditingGrades(prev => prev.map(g => ({ ...g, percentages: g.percentages.filter((_, i) => i !== idx) })));
    };

    const updateCycleRangeField = (idx: number, field: 'label' | 'min' | 'max', value: string) => {
        setEditingCycleRanges(prev => prev.map((r, i) => i === idx ? { ...r, [field]: field === 'label' ? value : (value === '' ? '' : Number(value)) } : r));
    };

    const updateGradeField = (idx: number, field: 'label' | 'minScore', value: string) => {
        setEditingGrades(prev => prev.map((g, i) => i === idx ? { ...g, [field]: field === 'label' ? value : (value === '' ? '' : Number(value)) } : g));
    };

    const updateGradePercentage = (gradeIdx: number, colIdx: number, value: string) => {
        setEditingGrades(prev => prev.map((g, i) => {
            if (i !== gradeIdx) return g;
            const newPercentages = g.percentages.slice();
            newPercentages[colIdx] = Number(value || 0);
            return { ...g, percentages: newPercentages };
        }));
    };

    const addGrade = () => {
        const cols = editingCycleRanges.length || 1;
        setEditingGrades(prev => [...prev, { label: `Grade ${prev.length + 1}`, minScore: '', percentages: Array.from({ length: cols }, () => 0) }]);
    };

    const removeGrade = (idx: number) => {
        setEditingGrades(prev => prev.filter((_, i) => i !== idx));
    };
    
    const handleSaveLoanCycle = async () => {
        if (loanCycleReadOnly) {
            toast({ title: 'Not authorized', description: 'You are not authorized to update loan-cycle configuration.', variant: 'destructive' });
            return;
        }
        if (!product.id || !editingMetric) {
            toast({ title: 'Error', description: 'Product and metric are required', variant: 'destructive' });
            return;
        }
        setIsSavingLoanCycle(true);
        try {
            const updated = { productId: product.id, metric: editingMetric, enabled: editingEnabled, cycleRanges: editingCycleRanges.map(r => ({ label: r.label, min: Number(r.min), max: Number(r.max) })), grades: editingGrades.map(g => ({ label: g.label, minScore: Number(g.minScore), percentages: g.percentages.map(p => Number(p)) })) };

            const changeType = loanCycleConfig ? 'UPDATE' : 'CREATE';
            const payload = loanCycleConfig ? { original: loanCycleConfig, updated } : { created: updated };

            await postPendingChange({ entityType: 'LoanCycleConfig', entityId: product.id, changeType, payload: JSON.stringify(payload) }, 'Failed to submit loan-cycle config for approval');

            // Mark locally as pending (so UI reflects that change was submitted)
            toast({ title: 'Submitted', description: 'Loan cycle configuration has been submitted for approval.' });
            // Optionally mark product as pending approval similar to other product updates
            onUpdate({ loanCycleConfigId: loanCycleConfig?.id || null });
        } catch (err: any) {
            toast({ title: 'Error', description: err.message || String(err), variant: 'destructive' });
        } finally {
            setIsSavingLoanCycle(false);
        }
    }


    return (
         <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
                 <button className="flex items-center justify-between w-full space-x-4 px-4 py-2 border rounded-lg bg-background hover:bg-muted/50 transition-colors">
                    <h4 className="text-sm font-semibold">{product.name}</h4>
                     <Badge variant={loanCycleConfig ? 'default' : 'secondary'}>{loanCycleConfig ? 'Configured' : 'Not configured'}</Badge>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="p-4 border rounded-lg bg-background mt-2">
                <div className="flex items-center justify-end">
                    <div className="flex items-center gap-2">
                        <Label>Enabled</Label>
                        <Switch checked={editingEnabled} onCheckedChange={(c) => setEditingEnabled(Boolean(c))} disabled={loanCycleReadOnly} />
                    </div>
                </div>

                 <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-2">
                        <Label>Progression Metric</Label>
                        <Select onValueChange={(v) => setEditingMetric(v as LoanCycleConfig['metric'])} value={editingMetric || undefined}>
                            <SelectTrigger disabled={loanCycleReadOnly}>
                                <SelectValue placeholder="Select metric" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="TOTAL_COUNT">Total Loans Count</SelectItem>
                                <SelectItem value="PAID_ON_TIME">On-time Repayments</SelectItem>
                                <SelectItem value="PAID_EARLY">Early Repayments</SelectItem>
                                <SelectItem value="PAID_LATE">Late Repayments</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="mt-4">
                    <Label>Cycle Ranges</Label>
                    <div className="space-y-2 mt-2">
                        {editingCycleRanges.length === 0 && <div className="text-xs text-muted-foreground">No cycle ranges defined.</div>}
                        {editingCycleRanges.map((r, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                                <Input placeholder="Label" value={r.label} onChange={(e) => updateCycleRangeField(idx, 'label', e.target.value)} className="w-32" disabled={loanCycleReadOnly} />
                                <Input placeholder="min" type="number" value={String(r.min)} onChange={(e) => updateCycleRangeField(idx, 'min', e.target.value)} className="w-20" disabled={loanCycleReadOnly} />
                                <div className="text-sm">-</div>
                                <Input placeholder="max" type="number" value={String(r.max)} onChange={(e) => updateCycleRangeField(idx, 'max', e.target.value)} className="w-20" disabled={loanCycleReadOnly} />
                                <Button variant="ghost" size="sm" onClick={() => removeCycleRange(idx)} disabled={loanCycleReadOnly}><Trash2 className="h-3 w-3"/></Button>
                            </div>
                        ))}
                        <div className="flex items-center gap-2 mt-1">
                            <Input placeholder="New range label" value={newCycleLabel} onChange={(e) => setNewCycleLabel(e.target.value)} className="w-32" disabled={loanCycleReadOnly} />
                            <Button type="button" onClick={addCycleRange} size="sm" disabled={loanCycleReadOnly}><PlusCircle className="h-4 w-4"/></Button>
                        </div>
                    </div>

                    <div className="mt-4">
                        <Label className="mb-2">Grades & Percentages</Label>
                        <div className="overflow-auto border rounded">
                            <table className="min-w-full bg-background text-sm">
                                <thead>
                                    <tr className="text-left">
                                        <th className="px-2 py-2">Grade</th>
                                        <th className="px-2 py-2">Min Score</th>
                                        {editingCycleRanges.map((r, idx) => (
                                            <th key={idx} className="px-2 py-2">{r.label || `${r.min}-${r.max}`}</th>
                                        ))}
                                        <th className="px-2 py-2">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {editingGrades.map((g, gIdx) => (
                                        <tr key={gIdx} className="border-t">
                                            <td className="px-2 py-2"><Input value={g.label} onChange={(e) => updateGradeField(gIdx, 'label', e.target.value)} className="w-28 h-8" disabled={loanCycleReadOnly} /></td>
                                            <td className="px-2 py-2"><Input type="number" value={String(g.minScore)} onChange={(e) => updateGradeField(gIdx, 'minScore', e.target.value)} className="w-24 h-8" disabled={loanCycleReadOnly} /></td>
                                            {editingCycleRanges.map((r, cIdx) => (
                                                <td key={cIdx} className="px-2 py-2"><Input type="number" value={String(g.percentages[cIdx] ?? 0)} onChange={(e) => updateGradePercentage(gIdx, cIdx, e.target.value)} className="w-20 h-8" disabled={loanCycleReadOnly} /></td>
                                            ))}
                                            <td className="px-2 py-2"><Button variant="ghost" size="sm" onClick={() => removeGrade(gIdx)} disabled={loanCycleReadOnly}><Trash2 className="h-4 w-4"/></Button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                            <Button type="button" onClick={addGrade} size="sm" disabled={loanCycleReadOnly}><PlusCircle className="h-4 w-4"/> Add Grade</Button>
                        </div>
                    </div>
                </div>

                <div className="mt-4 flex justify-end space-x-2">
                    <Button variant="outline" type="button" onClick={() => {
                        setEditingMetric(loanCycleConfig?.metric ?? null);
                        setEditingEnabled(typeof loanCycleConfig?.enabled === 'boolean' ? loanCycleConfig?.enabled : true);
                        setEditingCycleRanges(Array.isArray(loanCycleConfig?.cycleRanges) ? loanCycleConfig!.cycleRanges.map((r: any) => ({ label: r.label ?? `${r.min}-${r.max}`, min: r.min ?? '', max: r.max ?? '' })) : []);
                        setEditingGrades(Array.isArray(loanCycleConfig?.grades) ? loanCycleConfig!.grades.map((g: any) => ({ label: g.label ?? '', minScore: g.minScore ?? '', percentages: Array.isArray(g.percentages) ? g.percentages : [] })) : []);
                    }}>Reset</Button>
                    <Button type="button" onClick={handleSaveLoanCycle} disabled={isSavingLoanCycle || !editingMetric || loanCycleReadOnly} style={{ backgroundColor: providerColor }} className="text-white">{isSavingLoanCycle ? 'Saving...' : 'Save Loan Cycle'}</Button>
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}


export function SettingsClient({ initialProviders, initialTaxConfig }: { initialProviders: LoanProvider[], initialTaxConfig: Tax }) {
    const [providers, setProviders] = useState(initialProviders);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const onProductUpdate = useCallback((providerId: string, productId: string, updatedProduct: Partial<LoanProduct>) => {
        setProviders(produce(draft => {
            const provider = draft.find(p => p.id === providerId);
            if (provider) {
                const productIndex = provider.products.findIndex(p => p.id === productId);
                if (productIndex !== -1) {
                    const existingProduct = provider.products[productIndex];
                    provider.products[productIndex] = { ...existingProduct, ...updatedProduct };
                }
            }
        }));
    }, []);

    const handleProvidersChange = useCallback((updater: React.SetStateAction<LoanProvider[]>) => {
        setProviders(updater);
    }, []);
    
    const handleProviderUpdate = useCallback((update: Partial<LoanProvider>) => {
        setProviders(produce(draft => {
            const provider = draft.find(p => p.id === update.id);
            if (provider) {
                Object.assign(provider, update);
            }
        }));
    }, []);

        return (
                <div className="flex-1 space-y-4 p-8 pt-6">
                        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
                        {/* Render Tabs only after client mount to avoid Radix/React hydration id mismatches */}
                        {mounted ? (
                            <Tabs defaultValue="providers" className="space-y-4">
                                <TabsList>
                                    <TabsTrigger value="providers">Providers & Products</TabsTrigger>
                                    <TabsTrigger value="configuration">Fee & Tier Configuration</TabsTrigger>
                                    <TabsTrigger value="loanCycles">Loan Cycle</TabsTrigger>
                                    <TabsTrigger value="eligibility">Eligibility</TabsTrigger>
                                    <TabsTrigger value="agreement">Borrower Agreement</TabsTrigger>
                                    <TabsTrigger value="tax">Tax</TabsTrigger>
                                    <TabsTrigger value="priceChange">Price Change</TabsTrigger>
                                </TabsList>
                                <TabsContent value="providers">
                                    <ProvidersTab providers={providers} onProvidersChange={handleProvidersChange} />
                                </TabsContent>
                                <TabsContent value="configuration">
                                    <ConfigurationTab providers={providers} onProductUpdate={(providerId, product) => onProductUpdate(providerId, product.id, product)} taxConfig={initialTaxConfig} />
                                </TabsContent>
                                <TabsContent value="loanCycles">
                                    <LoanCycleTab providers={providers} onProviderUpdate={onProductUpdate} />
                                </TabsContent>
                                <TabsContent value="eligibility">
                                    <EligibilityTab providers={providers} onProvidersChange={handleProvidersChange} />
                                </TabsContent>
                                <TabsContent value="agreement">
                                    <Accordion type="multiple" className="w-full space-y-4">
                                        {providers.map((provider) => (
                                            <AccordionItem value={provider.id} key={provider.id} className="border rounded-lg bg-card">
                                                <AccordionTrigger className="flex w-full items-center justify-between p-4 hover:no-underline">
                                                    <div className="flex items-center gap-4">
                                                        <IconDisplay iconName={provider.icon} className="h-6 w-6" />
                                                        <div className="text-lg font-semibold">{provider.name}</div>
                                                    </div>
                                                </AccordionTrigger>
                                                <AccordionContent className="p-4 border-t">
                                                    <AgreementTab provider={provider} onProviderUpdate={handleProviderUpdate} />
                                                </AccordionContent>
                                            </AccordionItem>
                                        ))}
                                    </Accordion>
                                </TabsContent>
                                <TabsContent value="tax">
                                    <TaxTab initialTaxConfig={initialTaxConfig} />
                                </TabsContent>
                                <TabsContent value="priceChange">
                                    <PriceChangeTab />
                                </TabsContent>
                            </Tabs>
                        ) : (
                            <div className="space-y-4">
                                {/* Server-rendered fallback: simple headings to match layout */}
                                <div className="inline-flex items-center gap-4">
                                    <div className="font-medium">Providers & Products</div>
                                    <div className="font-medium">Fee & Tier Configuration</div>
                                </div>
                            </div>
                        )}
        </div>
    );
}

type TermsLanguageState = Record<TermsLanguageField, string>;

const emptyTermsLanguageState = (): TermsLanguageState =>
    CONTRACT_LANGUAGES.reduce((acc, lang) => {
        acc[lang.field] = '';
        return acc;
    }, {} as TermsLanguageState);

function AgreementTab({ provider, onProviderUpdate }: { provider: LoanProvider, onProviderUpdate: (update: Partial<LoanProvider>) => void }) {
    const { toast } = useToast();
    const { entityActions } = usePermissions();
    const termsActions = entityActions('TermsAndConditions');
    const canEditTerms = termsActions.create || termsActions.update;
    const [contents, setContents] = useState<TermsLanguageState>(emptyTermsLanguageState);
    const [version, setVersion] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchTerms = async () => {
            setIsLoading(true);
            try {
                const response = await fetch(`/api/settings/terms?providerId=${provider.id}`);
                if (response.ok) {
                    const data: TermsAndConditions | null = await response.json();
                    const next = emptyTermsLanguageState();
                    if (data) {
                        CONTRACT_LANGUAGES.forEach(lang => {
                            next[lang.field] = (data[lang.field] as string | null | undefined) ?? '';
                        });
                        setVersion(data.version ?? 0);
                    }
                    setContents(next);
                }
            } catch (error) {
                 toast({ title: "Error", description: "Failed to load terms and conditions.", variant: "destructive"});
            } finally {
                setIsLoading(false);
            }
        };
        fetchTerms();
    }, [provider.id, toast]);

    const handleSave = async () => {
        if (!canEditTerms) {
            toast({ title: 'Not authorized', description: 'You are not authorized to update terms and conditions.', variant: 'destructive' });
            return;
        }
        const filled = CONTRACT_LANGUAGES.filter(lang => contents[lang.field].trim().length > 0);
        if (filled.length === 0) {
            toast({ title: "Error", description: "Enter the terms in at least one language before submitting.", variant: "destructive" });
            return;
        }
        setIsLoading(true);
        try {
            const originalTerms = provider.termsAndConditions?.find(t => t.isActive);
            // Keep the legacy `content` column populated (first non-empty language) so
            // single-language consumers (borrower mini-app, GET endpoint) keep working.
            const defaultContent = contents[filled[0].field].trim();
            const updated: Record<string, string> = {
                providerId: provider.id,
                content: defaultContent,
            };
            CONTRACT_LANGUAGES.forEach(lang => {
                updated[lang.field] = contents[lang.field];
            });

            const payload = {
                original: originalTerms,
                updated,
            };

            await postPendingChange({
                entityType: 'TermsAndConditions',
                entityId: originalTerms?.id || provider.id, // Use provider ID for new terms
                changeType: 'UPDATE', // Always an update/new version
                payload: JSON.stringify(payload)
            }, 'Failed to submit new terms for approval.');

            toast({ title: "Submitted for Approval", description: `A new version of the terms has been submitted for review.` });

        } catch (error: any) {
             toast({ title: "Error", description: error.message, variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return <div className="space-y-4">
            <Skeleton className="h-8 w-1/4" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-10 w-32" />
        </div>
    }

    return (
        <div className="space-y-4">
            <div>
                <Label>Loan Contract — Terms and Conditions</Label>
                <p className="text-sm text-muted-foreground">
                    Configure the contract content for each language. The farmer's chosen
                    language is presented during the loan contract step.
                </p>
            </div>
            <Tabs defaultValue={CONTRACT_LANGUAGES[0].code} className="space-y-4">
                <TabsList>
                    {CONTRACT_LANGUAGES.map(lang => (
                        <TabsTrigger key={lang.code} value={lang.code}>
                            {lang.label}
                            {contents[lang.field].trim() ? ' ●' : ''}
                        </TabsTrigger>
                    ))}
                </TabsList>
                {CONTRACT_LANGUAGES.map(lang => (
                    <TabsContent key={lang.code} value={lang.code}>
                        <Label htmlFor={`terms-${lang.field}-${provider.id}`}>{lang.label} content</Label>
                        <Textarea
                            id={`terms-${lang.field}-${provider.id}`}
                            value={contents[lang.field]}
                            onChange={(e) => setContents(prev => ({ ...prev, [lang.field]: e.target.value }))}
                            placeholder={`Enter the ${lang.label} terms and conditions here.`}
                            rows={15}
                            disabled={!canEditTerms}
                        />
                    </TabsContent>
                ))}
            </Tabs>
            <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">
                    Current Version: {version}
                </p>
                <Button onClick={handleSave} disabled={isLoading || !canEditTerms}>
                    {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : <Save className="h-4 w-4 mr-2" />}
                    Submit New Version for Approval
                </Button>
            </div>
        </div>
    );
}

// --------------------------------------------------
// PRICE CHANGE CONTROL TAB
// --------------------------------------------------
function PriceChangeTab() {
    const { toast } = useToast();
    const { canModule } = usePermissions();
    const canRead = canModule('settings', 'read');
    const canUpdate = canModule('settings', 'update');

    const [thresholdPercent, setThresholdPercent] = useState<string>('');
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setIsLoading(true);
            try {
                const res = await fetch('/api/settings/price-change-control');
                if (!res.ok) throw new Error('Failed to load the price change threshold.');
                const data = await res.json();
                if (!cancelled) {
                    setThresholdPercent(String(data.thresholdPercent ?? ''));
                    setUpdatedAt(data.updatedAt ?? null);
                }
            } catch (error: any) {
                if (!cancelled) toast({ title: 'Error', description: error.message, variant: 'destructive' });
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        if (canRead) load();
        else setIsLoading(false);
        return () => { cancelled = true; };
    }, [canRead, toast]);

    const handleSave = async () => {
        const value = Number(thresholdPercent);
        if (!Number.isFinite(value) || value <= 0 || value > 100) {
            toast({ title: 'Invalid value', description: 'Enter a tolerance between 0 (exclusive) and 100 percent.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            const res = await fetch('/api/settings/price-change-control', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thresholdPercent: value }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error((Array.isArray(data?.error) ? data.error[0]?.message : data?.error) || 'Failed to save.');
            setThresholdPercent(String(data.thresholdPercent));
            setUpdatedAt(data.updatedAt ?? null);
            toast({ title: 'Saved', description: `Price change tolerance set to ±${data.thresholdPercent}%.` });
        } catch (error: any) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Price Change Control</CardTitle>
                <CardDescription>
                    Maximum tolerance for a Lersha product price change. A change is rejected
                    when it moves a product&apos;s unit price by more than this percentage away
                    from its <span className="font-medium">original registered price</span>.
                    Products are also locked once their loan has been disbursed.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading ? (
                    <div className="space-y-3">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-10 w-64" />
                    </div>
                ) : (
                    <>
                        <div className="max-w-xs">
                            <Label htmlFor="priceChangeThreshold">Tolerance (%)</Label>
                            <div className="relative mt-1">
                                <Input
                                    id="priceChangeThreshold"
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.1"
                                    value={thresholdPercent}
                                    onChange={(e) => setThresholdPercent(e.target.value)}
                                    disabled={!canUpdate || isSaving}
                                    className="pr-8"
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                e.g. 10 allows up to ±10% from the original price.
                            </p>
                        </div>
                        {updatedAt && (
                            <p className="text-xs text-muted-foreground">
                                Last updated: {new Date(updatedAt).toLocaleString()}
                            </p>
                        )}
                    </>
                )}
            </CardContent>
            <CardFooter>
                <Button onClick={handleSave} disabled={isLoading || isSaving || !canUpdate}>
                    {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save Threshold
                </Button>
            </CardFooter>
        </Card>
    );
}

// --------------------------------------------------
// DATA PROVISIONING MANAGER (NEW COMPONENT)
// --------------------------------------------------
function DataProvisioningManager({ providerId, config, onConfigChange, allProviderProducts }: {
    providerId: string;
    config: DataProvisioningConfig | undefined;
    onConfigChange: (newConfig: DataProvisioningConfig) => void;
    allProviderProducts: LoanProduct[];
}) {
    const { toast } = useToast();
    const { entityActions } = usePermissions();
    const dataConfigActions = entityActions('DataProvisioningConfig');
    const uploadActions = entityActions('DataProvisioningUpload');
    const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [viewingUpload, setViewingUpload] = useState<DataProvisioningUpload | null>(null);

    const handleSaveConfig = async (newConfigData: Omit<DataProvisioningConfig, 'providerId' | 'id' | 'uploads'> & { id?: string }) => {
        const isEditing = !!newConfigData.id;
        if (isEditing ? !dataConfigActions.update : !dataConfigActions.create) {
            toast({ title: 'Not authorized', description: 'You are not authorized to modify data provisioning settings.', variant: 'destructive' });
            return;
        }
        const method = isEditing ? 'PUT' : 'POST';
        const endpoint = '/api/settings/data-provisioning';
        const body = { ...newConfigData, providerId: providerId };

        try {
            const response = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
             if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save config.');
            }
            const savedConfig = await response.json();
            
            onConfigChange(savedConfig);
            toast({ title: "Success", description: `Data type "${savedConfig.name}" saved successfully.` });
        } catch(error: any) {
            toast({ title: "Error", description: error.message, variant: 'destructive' });
        }
    };
    
    const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!config) return;
        if (!uploadActions.create) {
            toast({ title: 'Not authorized', description: 'You are not authorized to upload data provisioning files.', variant: 'destructive' });
            if (event.target) event.target.value = '';
            return;
        }

        const file = event.target.files?.[0];
        if (!file) return;

        // Client-side validation: reject unsupported file types and oversized files early
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
        const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        const allowedExtensions = ['xlsx'];
        
        const fileName = file.name || '';
        const ext = fileName.split('.').pop()?.toLowerCase();
        
        // Validate file extension
        if (!ext || !allowedExtensions.includes(ext)) {
            toast({ 
                title: 'Invalid file type', 
                description: 'Only .xlsx files are allowed.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }
        
        // Validate file type (MIME type)
        if (file.type && !allowedTypes.includes(file.type) && !file.type.includes('sheet')) {
            toast({ 
                title: 'Invalid file type', 
                description: 'Only .xlsx files are allowed.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }
        
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            toast({ 
                title: 'File too large', 
                description: 'Maximum file size is 10MB.', 
                variant: 'destructive' 
            });
            if (event.target) event.target.value = '';
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('configId', config.id);

            const response = await fetch('/api/settings/data-provisioning-uploads', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to upload file.');
            }
            
            const newUpload = await response.json();
            
            const updatedConfig = produce(config, draft => {
                if (!draft.uploads) draft.uploads = [];
                draft.uploads.unshift(newUpload);
            });
            onConfigChange(updatedConfig);

            toast({
                title: 'Upload Successful',
                description: `File "${file.name}" uploaded and recorded successfully.`,
            });

        } catch (error: any) {
             toast({
                title: 'Upload Failed',
                description: error.message,
                variant: 'destructive',
            });
        } finally {
            setIsUploading(false);
            if (event.target) event.target.value = '';
        }
    };

    if (!config) {
        if (!dataConfigActions.create) {
            return null;
        }
        return (
            <>
                <Button onClick={() => setIsConfigDialogOpen(true)}>
                    <FilePlus2 className="h-4 w-4 mr-2" /> Create Data Source
                </Button>
                <DataProvisioningDialog
                    isOpen={isConfigDialogOpen}
                    onClose={() => setIsConfigDialogOpen(false)}
                    onSave={handleSaveConfig}
                    config={null}
                    readOnly={!dataConfigActions.create}
                />
            </>
        )
    }

    const generalUploads = useMemo(() => {
        const eligibilityUploadIds = new Set(allProviderProducts.map(p => p.eligibilityUploadId).filter(Boolean));
        return (config.uploads || []).filter(upload => !eligibilityUploadIds.has(upload.id));
    }, [config.uploads, allProviderProducts]);


    return (
        <>
            <Card className="bg-muted/50">
                <CardHeader className="flex flex-row justify-between items-center">
                     <div>
                        <CardTitle className="text-lg">{config.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                        {dataConfigActions.update && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsConfigDialogOpen(true)}><Edit className="h-4 w-4" /></Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                   <h4 className="font-medium mb-2">Columns</h4>
                   <ul className="list-disc pl-5 text-sm text-muted-foreground mb-4">
                        {(config.columns || []).map(col => <li key={col.id}>{col.name} <span className="text-xs opacity-70">({col.type})</span> {col.isIdentifier && <Badge variant="outline" className="ml-2">ID</Badge>}</li>)}
                   </ul>
                   <Separator />
                   <div className="mt-4">
                       <div className="flex justify-between items-center mb-2">
                            <h4 className="font-medium">Upload History</h4>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isUploading || !uploadActions.create}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : <Upload className="h-4 w-4 mr-2"/>}
                                Upload File
                            </Button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept=".xlsx, .xls"
                                onChange={handleExcelUpload}
                            />
                       </div>
                       <div className="border rounded-md">
                           <Table>
                               <TableHeader>
                                   <TableRow>
                                       <TableHead>File Name</TableHead>
                                       <TableHead>Rows</TableHead>
                                       <TableHead>Uploaded By</TableHead>
                                       <TableHead>Date</TableHead>
                                   </TableRow>
                               </TableHeader>
                               <TableBody>
                                   {generalUploads.length > 0 ? (
                                       generalUploads.map(upload => (
                                            <TableRow key={upload.id} onClick={() => setViewingUpload(upload)} className="cursor-pointer hover:bg-muted">
                                                <TableCell className="font-medium flex items-center gap-2"><FileClock className="h-4 w-4 text-muted-foreground"/>{upload.fileName}</TableCell>
                                                <TableCell>{upload.rowCount}</TableCell>
                                                <TableCell>{upload.uploadedBy}</TableCell>
                                                <TableCell>{format(new Date(upload.uploadedAt), "yyyy-MM-dd HH:mm")}</TableCell>
                                            </TableRow>
                                       ))
                                   ) : (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center text-muted-foreground h-24">No files uploaded yet.</TableCell>
                                        </TableRow>
                                   )}
                               </TableBody>
                           </Table>
                       </div>
                   </div>
                </CardContent>
            </Card>

             <DataProvisioningDialog
                isOpen={isConfigDialogOpen}
                onClose={() => setIsConfigDialogOpen(false)}
                onSave={handleSaveConfig}
                config={config}
                     readOnly={!dataConfigActions.update}
            />
            <UploadDataViewerDialog
                upload={viewingUpload}
                onClose={() => setViewingUpload(null)}
            />
        </>
    );
}

// --------------------------------------------------
// DATA PROVISIONING DIALOG (NEW COMPONENT)
// --------------------------------------------------
type EditableDataColumn = DataColumn & { optionsString?: string };

function DataProvisioningDialog({ isOpen, onClose, onSave, config, readOnly }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (config: Omit<DataProvisioningConfig, 'providerId' | 'id' | 'uploads'> & { id?: string }) => void;
    config: DataProvisioningConfig | null;
    readOnly?: boolean;
}) {
    const { toast } = useToast();
    const [name, setName] = useState('');
    const [columns, setColumns] = useState<EditableDataColumn[]>([]);

    useEffect(() => {
        if (isOpen) {
            if (config) {
                setName(config.name);
                setColumns(config.columns.map(c => ({...c, optionsString: (c.options || []).join(', ') })) || []);
            } else {
                setName('');
                setColumns([]);
            }
        }
    }, [config, isOpen]);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (readOnly) {
            toast({ title: 'Not authorized', description: 'You are not authorized to modify this configuration.', variant: 'destructive' });
            if (event.target) event.target.value = '';
            return;
        }
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            try {
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(arrayBuffer);
                const worksheet = workbook.worksheets[0];
                const headers: string[] = [];
                const headerRow = worksheet.getRow(1);
                headerRow.eachCell((cell) => {
                    const text = (cell.text ?? cell.value) as any;
                    headers.push(text?.toString?.() || '');
                });

                setColumns(headers.map((header, index) => ({
                    id: `col-${Date.now()}-${index}`,
                    name: header,
                    type: 'string', // default type
                    isIdentifier: index === 0, // default first column as identifier
                    options: [],
                    optionsString: '',
                })));
            } catch (err) {
                console.error('Failed to parse Excel file', err);
                toast({ title: 'Error', description: 'Could not parse the uploaded file.', variant: 'destructive' });
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleColumnChange = (index: number, field: keyof EditableDataColumn, value: string | boolean) => {
        if (readOnly) return;
        setColumns(produce(draft => {
            if (field === 'isIdentifier' && typeof value === 'boolean') {
                // Ensure only one column can be the identifier
                draft.forEach((col, i) => {
                    col.isIdentifier = i === index ? value : false;
                });
            } else {
                 (draft[index] as any)[field] = value;
            }
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (readOnly) {
            toast({ title: 'Not authorized', description: 'You are not authorized to save this configuration.', variant: 'destructive' });
            return;
        }
        if (!columns.some(c => c.isIdentifier)) {
            toast({ title: 'Error', description: 'Please mark one column as the customer identifier.', variant: 'destructive' });
            return;
        }

        // Process the final columns array before saving
        const finalColumns = columns.map(col => {
            const { optionsString, ...rest } = col;
            const finalOptions = optionsString ? optionsString.split(',').map(s => s.trim()).filter(Boolean) : [];
            return { ...rest, options: finalOptions };
        });

        onSave({ id: config?.id, name, columns: finalColumns });
        onClose();
    };

    return (
         <UIDialog open={isOpen} onOpenChange={onClose}>
            <UIDialogContent className="sm:max-w-2xl">
                <UIDialogHeader>
                    <UIDialogTitle>{config ? 'Edit' : 'Create'} Data Type</UIDialogTitle>
                     <UIDialogDescription>Define a new data schema by uploading a sample file.</UIDialogDescription>
                </UIDialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div>
                        <Label htmlFor="data-type-name">Data Type Name</Label>
                        <Input id="data-type-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Credit Bureau Data" required disabled={!!readOnly} />
                    </div>

                    <div>
                        <Label htmlFor="file-upload">Upload Sample File (.xlsx, .xls)</Label>
                        <Input id="file-upload" type="file" accept=".xlsx, .xls" onChange={handleFileUpload} disabled={!!readOnly} />
                         <p className="text-xs text-muted-foreground mt-1">Upload a file to automatically detect columns.</p>
                    </div>

                    {columns.length > 0 && (
                        <div>
                            <Label>Configure Columns</Label>
                            <div className="space-y-4 mt-2 border p-4 rounded-md max-h-[50vh] overflow-y-auto">
                                {columns.map((col, index) => (
                                    <div key={col.id} className="space-y-2 p-2 rounded-md bg-muted/50">
                                        <div className="grid grid-cols-12 items-center gap-2">
                                            <Input
                                                className="col-span-5"
                                                value={col.name}
                                                onChange={e => handleColumnChange(index, 'name', e.target.value)}
                                                required
                                                disabled={!!readOnly}
                                            />
                                            <Select value={col.type} onValueChange={(value: 'string' | 'number' | 'date') => handleColumnChange(index, 'type', value)}>
                                                <SelectTrigger className="col-span-3" disabled={!!readOnly}>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="string">Text</SelectItem>
                                                    <SelectItem value="number">Number</SelectItem>
                                                    <SelectItem value="date">Date</SelectItem>
                                                </SelectContent>
                                            </Select>
                                             <div className="col-span-4 flex items-center justify-end space-x-2">
                                                <Checkbox
                                                    id={`is-identifier-${col.id}`}
                                                    checked={col.isIdentifier}
                                                    onCheckedChange={(checked) => handleColumnChange(index, 'isIdentifier', !!checked)}
                                                    disabled={!!readOnly}
                                                />
                                                <Label htmlFor={`is-identifier-${col.id}`} className="text-sm text-muted-foreground whitespace-nowrap">Is Identifier?</Label>
                                            </div>
                                        </div>
                                         {col.type === 'string' && (
                                            <div className="space-y-1">
                                                <Label htmlFor={`options-${col.id}`} className="text-xs text-muted-foreground">Dropdown Options (optional)</Label>
                                                <Textarea
                                                    id={`options-${col.id}`}
                                                    placeholder="e.g., Male, Female, Other"
                                                    className="text-xs"
                                                    value={col.optionsString || ''}
                                                    onChange={e => handleColumnChange(index, 'optionsString', e.target.value)}
                                                    disabled={!!readOnly}
                                                />
                                                <p className="text-xs text-muted-foreground">Comma-separated values for dropdown select.</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    <UIDialogFooter>
                        <UIDialogClose asChild><Button type="button" variant="outline">Cancel</Button></UIDialogClose>
                        <Button type="submit" disabled={!!readOnly}>Save</Button>
                    </UIDialogFooter>
                </form>
            </UIDialogContent>
        </UIDialog>
    )
}

function UploadDataViewerDialog({ upload, onClose }: {
    upload: DataProvisioningUpload | null;
    onClose: () => void;
}) {
    const [data, setData] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalRows, setTotalRows] = useState(0);
    const rowsPerPage = 100;
    const [tempPreview, setTempPreview] = useState<any[] | null>(null);
    const [tempHeaders, setTempHeaders] = useState<string[]>([]);
    const [tempLoading, setTempLoading] = useState(false);

    useEffect(() => {
        if (upload && !upload.id.startsWith('temp-')) {
            const fetchData = async () => {
                setIsLoading(true);
                try {
                    const response = await fetch(`/api/settings/data-provisioning-uploads/view?uploadId=${upload.id}&page=${page}&limit=${rowsPerPage}`);
                    if (!response.ok) {
                        throw new Error('Failed to fetch uploaded data');
                    }
                    const result = await response.json();
                    setData(result.data);
                    setTotalPages(result.totalPages);
                    setTotalRows(result.totalRows);
                } catch (error) {
                    console.error(error);
                } finally {
                    setIsLoading(false);
                }
            };
            fetchData();
        }
    }, [upload, page]);

    if (!upload) return null;
    
    // Special handling for temporary filter preview (async parse)
    useEffect(() => {
        let cancelled = false;
        const parseTemp = async () => {
            if (!upload || !upload.id.startsWith('temp-')) return;
            const fileContent = (upload as any).fileContent;
            if (!fileContent) return;
            setTempLoading(true);
            try {
                const base64ToArrayBuffer = (base64: string) => {
                    const binaryString = atob(base64);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    return bytes.buffer;
                };

                const arrayBuffer = base64ToArrayBuffer(fileContent);
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(arrayBuffer as any);
                const worksheet = workbook.worksheets[0];
                const columnCount = worksheet.columnCount || 0;
                const headers: string[] = [];
                const headerRow = worksheet.getRow(1);
                for (let i = 1; i <= columnCount; i++) {
                    const cell = headerRow.getCell(i);
                    const text = (cell.text ?? cell.value) as any;
                    headers.push(text?.toString?.() || '');
                }

                const rows: any[] = [];
                for (let r = 2; r <= worksheet.rowCount; r++) {
                    const row = worksheet.getRow(r);
                    const obj: any = {};
                    let empty = true;
                    for (let c = 1; c <= columnCount; c++) {
                        const cell = row.getCell(c);
                        const val = cell.value;
                        if (val !== null && val !== undefined && String(val).trim() !== '') empty = false;
                        obj[headers[c - 1] || `Column${c}`] = val;
                    }
                    if (!empty) rows.push(obj);
                }

                if (!cancelled) {
                    setTempHeaders(headers);
                    setTempPreview(rows);
                }
            } catch (err) {
                console.error('Error parsing preview file:', err);
                setTempPreview(null);
            } finally {
                setTempLoading(false);
            }
        };

        parseTemp();
        return () => { cancelled = true; };
    }, [upload]);


    // If this is a temporary upload preview, show parsed tempPreview
    if (upload.id.startsWith('temp-')) {
        if (tempLoading) {
            return (
                <UIDialog open={!!upload} onOpenChange={onClose}>
                    <UIDialogContent className="max-w-4xl h-[90vh] flex items-center justify-center">
                        <div>Loading preview...</div>
                    </UIDialogContent>
                </UIDialog>
            );
        }

        const headersPreview = tempHeaders || [];
        const rowsPreview = tempPreview || [];

        return (
            <UIDialog open={!!upload} onOpenChange={onClose}>
                <UIDialogContent className="max-w-4xl h-[90vh] flex flex-col">
                    <UIDialogHeader>
                        <UIDialogTitle>Viewing Upload: {upload.fileName}</UIDialogTitle>
                        <UIDialogDescription>
                            This is a preview of the file you uploaded.
                        </UIDialogDescription>
                    </UIDialogHeader>
                    <div className="flex-grow overflow-auto border rounded-md">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background">
                                <TableRow>
                                    {headersPreview.map(header => <TableHead key={header}>{header}</TableHead>)}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rowsPreview.map((row: any, rowIndex) => (
                                    <TableRow key={rowIndex}>
                                        {headersPreview.map((header) => (
                                            <TableCell key={`${rowIndex}-${header}`}>{row[header]}</TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <UIDialogFooter className="pt-4">
                        <UIDialogClose asChild><Button type="button">Close</Button></UIDialogClose>
                    </UIDialogFooter>
                </UIDialogContent>
            </UIDialog>
        );
    }

    const headers = data.length > 0 ? Object.keys(data[0]) : [];

    return (
        <UIDialog open={!!upload} onOpenChange={onClose}>
            <UIDialogContent className="max-w-4xl h-[90vh] flex flex-col">
                <UIDialogHeader>
                    <UIDialogTitle>Viewing Upload: {upload.fileName}</UIDialogTitle>
                    <UIDialogDescription>
                        Displaying {data.length} of {totalRows} rows from the uploaded file.
                    </UIDialogDescription>
                </UIDialogHeader>
                <div className="flex-grow overflow-auto border rounded-md">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 bg-background">
                                <TableRow>
                                    {headers.map(header => <TableHead key={header} className="capitalize">{header.replace(/([A-Z])/g, ' $1')}</TableHead>)}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.map((row, rowIndex) => (
                                    <TableRow key={rowIndex}>
                                        {headers.map(header => <TableCell key={`${rowIndex}-${header}`}>{row[header]}</TableCell>)}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
                <UIDialogFooter className="justify-between items-center pt-4">
                    <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
                            <ChevronLeft className="h-4 w-4 mr-2" /> Previous
                        </Button>
                        <Button variant="outline" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>
                            Next <ChevronRight className="h-4 w-4 ml-2" />
                        </Button>
                    </div>
                </UIDialogFooter>
            </UIDialogContent>
        </UIDialog>
    );
}
    

    













