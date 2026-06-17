
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, Download, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateNplStatus } from '@/actions/npl';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

interface NplEntry {
    borrowerId: string;
    borrowerName: string;
    accountNumber: string;
    providerName: string;
    daysOverdue: number;
    principalOutstanding: number;
    interestOutstanding: number;
    serviceFeeOutstanding: number;
    penaltyOutstanding: number;
    totalOutstanding: number;
}

interface Provider {
    id: string;
    name: string;
}

const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined || isNaN(amount)) return "0.00";
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
};

type SortDir = 'asc' | 'desc';

export default function NplManagementPage() {
    useRequirePermission('npl');
    const { canModule } = usePermissions();
    const canRunNplUpdate = canModule('npl', 'update');
    
    const [entries, setEntries] = useState<NplEntry[]>([]);
    const [providers, setProviders] = useState<Provider[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const { toast } = useToast();

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [providerFilter, setProviderFilter] = useState('all');
    const [daysOverdueMin, setDaysOverdueMin] = useState('');
    const [daysOverdueMax, setDaysOverdueMax] = useState('');

    // Table State
    const [sortBy, setSortBy] = useState<keyof NplEntry>('daysOverdue');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);

    const fetchBorrowers = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/npl-borrowers');
            if (!response.ok) throw new Error('Failed to fetch NPL borrowers');
            const data = await response.json();
            setEntries(data);

            // Extract unique providers for filter
            const responseProviders = await fetch('/api/providers');
            if (responseProviders.ok) {
                const providersData = await responseProviders.json();
                setProviders(providersData);
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Could not load NPL data.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchBorrowers();
    }, []);

    const handleRunNplUpdate = async () => {
        if (!canRunNplUpdate) {
            toast({ title: 'Not authorized', description: 'You are not authorized to run NPL updates.', variant: 'destructive' });
            return;
        }
        setIsUpdating(true);
        try {
            const result = await updateNplStatus();
            if (result.success) {
                toast({
                    title: 'NPL Status Updated',
                    description: `${result.updatedCount} borrower(s) have been updated.`,
                });
                await fetchBorrowers(); // Refresh the list
            } else {
                throw new Error(result.message);
            }
        } catch (error: any) {
            toast({
                title: 'Error Running NPL Update',
                description: error.message,
                variant: 'destructive',
            });
        } finally {
            setIsUpdating(false);
        }
    };

    const filteredEntries = useMemo(() => {
        return entries.filter(entry => {
            const matchesSearch = 
                entry.borrowerId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                entry.borrowerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                entry.accountNumber.toLowerCase().includes(searchQuery.toLowerCase());
            
            const matchesProvider = providerFilter === 'all' || entry.providerName === providerFilter;
            
            const min = daysOverdueMin === '' ? -Infinity : parseInt(daysOverdueMin);
            const max = daysOverdueMax === '' ? Infinity : parseInt(daysOverdueMax);
            const matchesDays = entry.daysOverdue >= min && entry.daysOverdue <= max;

            return matchesSearch && matchesProvider && matchesDays;
        });
    }, [entries, searchQuery, providerFilter, daysOverdueMin, daysOverdueMax]);

    const sortedEntries = useMemo(() => {
        const sorted = [...filteredEntries];
        sorted.sort((a, b) => {
            const aVal = a[sortBy];
            const bVal = b[sortBy];
            
            if (aVal === bVal) return 0;
            if (aVal == null) return sortDir === 'asc' ? -1 : 1;
            if (bVal == null) return sortDir === 'asc' ? 1 : -1;

            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
            }
            
            return sortDir === 'asc' 
                ? String(aVal).localeCompare(String(bVal))
                : String(bVal).localeCompare(String(aVal));
        });
        return sorted;
    }, [filteredEntries, sortBy, sortDir]);

    const paginatedEntries = useMemo(() => {
        const start = (page - 1) * pageSize;
        return sortedEntries.slice(start, start + pageSize);
    }, [sortedEntries, page, pageSize]);

    const totalPages = Math.ceil(sortedEntries.length / pageSize);

    const toggleSort = (field: keyof NplEntry) => {
        if (sortBy === field) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortDir('asc');
        }
    };

    const renderSortIcon = (field: keyof NplEntry) => {
        if (sortBy !== field) return <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />;
        return sortDir === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />;
    };

    const handleExcelExport = async () => {
        setIsExporting(true);
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('NPL Report');

            worksheet.columns = [
                { header: 'Borrower ID', key: 'borrowerId', width: 20 },
                { header: 'Customer Name', key: 'borrowerName', width: 25 },
                { header: 'Account Number', key: 'accountNumber', width: 20 },
                { header: 'Loan Provider', key: 'providerName', width: 20 },
                { header: 'Days Overdue', key: 'daysOverdue', width: 15 },
                { header: 'Principal Outstanding', key: 'principalOutstanding', width: 20 },
                { header: 'Interest Outstanding', key: 'interestOutstanding', width: 20 },
                { header: 'Service Fee Outstanding', key: 'serviceFeeOutstanding', width: 20 },
                { header: 'Penalty Outstanding', key: 'penaltyOutstanding', width: 20 },
                { header: 'Total Outstanding', key: 'totalOutstanding', width: 20 },
            ];

            // Use the currently displayed (filtered and sorted) data
            sortedEntries.forEach(entry => {
                worksheet.addRow({
                    ...entry,
                    // Ensure numbers are numbers for Excel
                    principalOutstanding: Number(entry.principalOutstanding.toFixed(2)),
                    interestOutstanding: Number(entry.interestOutstanding.toFixed(2)),
                    serviceFeeOutstanding: Number(entry.serviceFeeOutstanding.toFixed(2)),
                    penaltyOutstanding: Number(entry.penaltyOutstanding.toFixed(2)),
                    totalOutstanding: Number(entry.totalOutstanding.toFixed(2)),
                });
            });

            // Auto-adjust column widths (simple version)
            worksheet.columns.forEach(column => {
                let maxLength = 0;
                column.eachCell!({ includeEmpty: true }, cell => {
                    const columnLength = cell.value ? cell.value.toString().length : 10;
                    if (columnLength > maxLength) {
                        maxLength = columnLength;
                    }
                });
                column.width = maxLength < 10 ? 10 : maxLength + 2;
            });

            const buffer = await workbook.xlsx.writeBuffer();
            const fileName = `NPL_Report_${format(new Date(), 'yyyyMMdd')}.xlsx`;
            saveAs(new Blob([buffer]), fileName);

            toast({
                title: 'Export Successful',
                description: 'NPL report has been exported to Excel.',
            });
        } catch (error) {
            console.error('Export failed:', error);
            toast({
                title: 'Export Failed',
                description: 'Could not export NPL data to Excel.',
                variant: 'destructive',
            });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">NPL</h2>
                    <p className="text-muted-foreground">
                        View and manage borrowers with Non-Performing Loans.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={handleExcelExport}
                        disabled={isExporting || sortedEntries.length === 0}
                    >
                        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        {isExporting ? 'Exporting...' : 'Export to Excel'}
                    </Button>
                    {canRunNplUpdate && (
                        <Button onClick={handleRunNplUpdate} disabled={isUpdating}>
                            {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Run NPL Status Update
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[300px]">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search by ID, name or account..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <Select value={providerFilter} onValueChange={setProviderFilter}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="All Providers" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Providers</SelectItem>
                            {providers.map(p => (
                                <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                        <Input
                            placeholder="Min Days Overdue"
                            type="number"
                            value={daysOverdueMin}
                            onChange={(e) => setDaysOverdueMin(e.target.value)}
                            className="w-[150px]"
                        />
                        <span>-</span>
                        <Input
                            placeholder="Max Days Overdue"
                            type="number"
                            value={daysOverdueMax}
                            onChange={(e) => setDaysOverdueMax(e.target.value)}
                            className="w-[150px]"
                        />
                    </div>
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>NPL Borrowers</CardTitle>
                        <CardDescription>This list contains all borrowers who have been flagged due to overdue loans based on their provider's NPL threshold.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead onClick={() => toggleSort('borrowerId')} className="cursor-pointer whitespace-nowrap">
                                            <div className="flex items-center">Borrower ID {renderSortIcon('borrowerId')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('borrowerName')} className="cursor-pointer whitespace-nowrap">
                                            <div className="flex items-center">Customer Name {renderSortIcon('borrowerName')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('accountNumber')} className="cursor-pointer whitespace-nowrap">
                                            <div className="flex items-center">Account Number {renderSortIcon('accountNumber')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('providerName')} className="cursor-pointer whitespace-nowrap">
                                            <div className="flex items-center">Loan Provider {renderSortIcon('providerName')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('daysOverdue')} className="cursor-pointer whitespace-nowrap text-right">
                                            <div className="flex items-center justify-end">Days Overdue {renderSortIcon('daysOverdue')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('principalOutstanding')} className="cursor-pointer whitespace-nowrap text-right">
                                            <div className="flex items-center justify-end">Principal Outstanding {renderSortIcon('principalOutstanding')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('interestOutstanding')} className="cursor-pointer whitespace-nowrap text-right">
                                            <div className="flex items-center justify-end">Interest Outstanding {renderSortIcon('interestOutstanding')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('serviceFeeOutstanding')} className="cursor-pointer whitespace-nowrap text-right">
                                            <div className="flex items-center justify-end">Service Fee Outstanding {renderSortIcon('serviceFeeOutstanding')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('penaltyOutstanding')} className="cursor-pointer whitespace-nowrap text-right">
                                            <div className="flex items-center justify-end">Penalty Outstanding {renderSortIcon('penaltyOutstanding')}</div>
                                        </TableHead>
                                        <TableHead onClick={() => toggleSort('totalOutstanding')} className="cursor-pointer whitespace-nowrap text-right font-bold">
                                            <div className="flex items-center justify-end">Total Outstanding {renderSortIcon('totalOutstanding')}</div>
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={10} className="h-24 text-center">
                                                <Loader2 className="h-6 w-6 animate-spin mx-auto"/>
                                            </TableCell>
                                        </TableRow>
                                    ) : paginatedEntries.length > 0 ? (
                                        paginatedEntries.map((entry, idx) => (
                                            <TableRow key={`${entry.borrowerId}-${entry.providerName}-${idx}`}>
                                                <TableCell className="font-mono text-xs">{entry.borrowerId}</TableCell>
                                                <TableCell className="font-medium">{entry.borrowerName}</TableCell>
                                                <TableCell className="font-mono">{entry.accountNumber}</TableCell>
                                                <TableCell>{entry.providerName}</TableCell>
                                                <TableCell className="text-right font-mono">{entry.daysOverdue}</TableCell>
                                                <TableCell className="text-right font-mono">{formatCurrency(entry.principalOutstanding)}</TableCell>
                                                <TableCell className="text-right font-mono">{formatCurrency(entry.interestOutstanding)}</TableCell>
                                                <TableCell className="text-right font-mono">{formatCurrency(entry.serviceFeeOutstanding)}</TableCell>
                                                <TableCell className="text-right font-mono">{formatCurrency(entry.penaltyOutstanding)}</TableCell>
                                                <TableCell className="text-right font-mono font-bold">{formatCurrency(entry.totalOutstanding)}</TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={10} className="h-24 text-center">
                                                No NPL data found matching your filters.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination Controls */}
                        <div className="flex items-center justify-between px-4 py-4 border-t">
                            <div className="text-sm text-muted-foreground">
                                Showing {Math.min(sortedEntries.length, (page - 1) * pageSize + 1)} to {Math.min(sortedEntries.length, page * pageSize)} of {sortedEntries.length} entries
                            </div>
                            <div className="flex items-center space-x-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(1)}
                                    disabled={page === 1}
                                >
                                    <ChevronsLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(prev => Math.max(1, prev - 1))}
                                    disabled={page === 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <div className="text-sm font-medium">
                                    Page {page} of {totalPages}
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={page === totalPages}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(totalPages)}
                                    disabled={page === totalPages}
                                >
                                    <ChevronsRight className="h-4 w-4" />
                                </Button>
                                <Select
                                    value={pageSize.toString()}
                                    onValueChange={(val) => {
                                        setPageSize(parseInt(val));
                                        setPage(1);
                                    }}
                                >
                                    <SelectTrigger className="h-8 w-[70px]">
                                        <SelectValue placeholder={pageSize.toString()} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[10, 20, 50, 100].map(size => (
                                            <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
