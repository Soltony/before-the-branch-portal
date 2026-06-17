
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ChevronLeft, ChevronRight, FileJson, Search, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

interface AuditLog {
    id: string;
    actorId: string;
    actor?: { id: string; fullName: string; email: string } | null;
    action: string;
    entity: string | null;
    entityId: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt: string;
    details?: string | null;
}

// (details page moved to its own route)

const ITEMS_PER_PAGE = 20;

export default function AuditLogsPage() {
    useRequirePermission('audit-logs');
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    // Filter / search state
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [actionFilter, setActionFilter] = useState('');
    const [entityFilter, setEntityFilter] = useState('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [distinctActions, setDistinctActions] = useState<string[]>([]);
    const [distinctEntities, setDistinctEntities] = useState<string[]>([]);

    const router = useRouter();
    const { toast } = useToast();

    // Fetch distinct actions & entities for filter dropdowns
    useEffect(() => {
        const fetchMeta = async () => {
            try {
                const res = await fetch('/api/audit-logs?meta=1');
                if (res.ok) {
                    const data = await res.json();
                    setDistinctActions(data.actions || []);
                    setDistinctEntities(data.entities || []);
                }
            } catch { /* ignore */ }
        };
        fetchMeta();
    }, []);

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
            setPage(1);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Reset to page 1 when any filter changes
    const handleFilterChange = useCallback((setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
        setter(value);
        setPage(1);
    }, []);

    const clearFilters = () => {
        setSearchQuery('');
        setDebouncedSearch('');
        setActionFilter('');
        setEntityFilter('');
        setFilterDateFrom('');
        setFilterDateTo('');
        setPage(1);
    };

    const hasActiveFilters = debouncedSearch || actionFilter || entityFilter || filterDateFrom || filterDateTo;

    const exportLogs = async (exportFormat: 'csv' | 'json') => {
        if (!fromDate || !toDate) {
            toast({ title: 'Missing dates', description: 'Please select From and To dates.', variant: 'destructive' });
            return;
        }

        const url = `/api/audit-logs/export?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}&tz=${encodeURIComponent('Africa/Nairobi')}&format=${encodeURIComponent(exportFormat)}`;
        // Trigger browser download
        window.location.href = url;
    };

    useEffect(() => {
        const fetchLogs = async () => {
            setIsLoading(true);
            try {
                const params = new URLSearchParams({
                    page: String(page),
                    limit: String(ITEMS_PER_PAGE),
                });
                if (debouncedSearch) params.set('search', debouncedSearch);
                if (actionFilter) params.set('action', actionFilter);
                if (entityFilter) params.set('entity', entityFilter);
                if (filterDateFrom) params.set('dateFrom', filterDateFrom);
                if (filterDateTo) params.set('dateTo', filterDateTo);

                const response = await fetch(`/api/audit-logs?${params.toString()}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch audit logs.');
                }
                const data = await response.json();
                setLogs(data.logs);
                setTotalPages(data.totalPages);
            } catch (error: any) {
                toast({
                    title: 'Error',
                    description: error.message,
                    variant: 'destructive',
                });
            } finally {
                setIsLoading(false);
            }
        };

        fetchLogs();
    }, [page, debouncedSearch, actionFilter, entityFilter, filterDateFrom, filterDateTo, toast]);

    // change request payload fetching moved to the dedicated detail page
    
    const getActionBadgeClass = (action: string): string => {
        if (action.includes('SUCCESS') || action.includes('CREATE')) return 'bg-green-600 text-white';
        if (action.includes('FAILURE') || action.includes('DELETE')) return 'bg-red-600 text-white';
        if (action.includes('UPDATE')) return 'bg-blue-600 text-white';
        if (action.includes('LOGIN')) return 'bg-yellow-500 text-black';
        return 'bg-gray-500 text-white';
    };


    return (
        <>
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Audit Logs</h2>
                        <p className="text-muted-foreground">
                            A chronological record of system activities.
                        </p>
                    </div>
                    <div className="flex items-end gap-2">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">From</span>
                            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">To</span>
                            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => void exportLogs('csv')}
                            disabled={!fromDate || !toDate}
                        >
                            Export CSV
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => void exportLogs('json')}
                            disabled={!fromDate || !toDate}
                        >
                            Export JSON
                        </Button>
                    </div>
                </div>

                {/* ── Filter & Search Bar ── */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex flex-col gap-4 md:flex-row md:items-end">
                            {/* Search */}
                            <div className="flex-1 min-w-[200px]">
                                <label className="text-xs text-muted-foreground mb-1 block">Search</label>
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search by actor, action, entity, IP..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-9"
                                    />
                                </div>
                            </div>

                            {/* Action filter */}
                            <div className="w-full md:w-[200px]">
                                <label className="text-xs text-muted-foreground mb-1 block">Action</label>
                                <Select value={actionFilter} onValueChange={(v) => handleFilterChange(setActionFilter, v)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="All actions" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {distinctActions.map((a) => (
                                            <SelectItem key={a} value={a}>{a}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Entity filter */}
                            <div className="w-full md:w-[200px]">
                                <label className="text-xs text-muted-foreground mb-1 block">Entity</label>
                                <Select value={entityFilter} onValueChange={(v) => handleFilterChange(setEntityFilter, v)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="All entities" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {distinctEntities.map((e) => (
                                            <SelectItem key={e} value={e}>{e}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Date range filter */}
                            <div className="w-full md:w-[160px]">
                                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                                <Input
                                    type="date"
                                    value={filterDateFrom}
                                    onChange={(e) => handleFilterChange(setFilterDateFrom, e.target.value)}
                                />
                            </div>
                            <div className="w-full md:w-[160px]">
                                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                                <Input
                                    type="date"
                                    value={filterDateTo}
                                    onChange={(e) => handleFilterChange(setFilterDateTo, e.target.value)}
                                />
                            </div>

                            {/* Clear filters */}
                            {hasActiveFilters && (
                                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-10 gap-1">
                                    <X className="h-4 w-4" />
                                    Clear
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Activity History</CardTitle>
                        <CardDescription>
                            This log contains all significant actions performed by users and the system.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Actor</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead>Entity</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>IP Address</TableHead>
                                    <TableHead>Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto"/>
                                        </TableCell>
                                    </TableRow>
                                ) : logs.length > 0 ? (
                                    logs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium">{log.actor?.fullName || 'Unknown user'}</span>
                                                    <span className="text-xs text-muted-foreground font-mono break-all">{log.actor?.email || log.actorId}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    className={getActionBadgeClass(log.action)}
                                                >
                                                    {log.action}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {log.entity ? (
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{log.entity}</span>
                                                        <span className="text-xs text-muted-foreground font-mono">{log.entityId}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>{format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}</TableCell>
                                            <TableCell className="font-mono">{log.ipAddress || 'N/A'}</TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => router.push(`/admin/audit-logs/${log.id}`)}
                                                    className="h-8 w-8"
                                                >
                                                    <FileJson className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            No audit logs found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                    <CardFooter>
                        <div className="flex items-center justify-end w-full space-x-2">
                             <span className="text-sm text-muted-foreground">
                                Page {page} of {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                            >
                                Next
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </CardFooter>
                </Card>
            </div>
            {/* navigation to full detail page */}
        </>
    );
}
