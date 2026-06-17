'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { PendingChangeWithDetails } from './page';
import type { User } from '@/lib/types';
import ExcelJS from 'exceljs';

export default function ApprovalsDetailClient({ change, currentUser }: { change: PendingChangeWithDetails; currentUser: User }) {
  const { toast } = useToast();
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const parsedPayload = useMemo(() => {
    try {
      return JSON.parse(change.payload);
    } catch {
      return null;
    }
  }, [change.payload]);

  const whatRequestIs = useMemo(() => {
    if (!parsedPayload) return `${change.changeType} ${change.entityType}`;
    const who = change.createdBy?.fullName || 'Someone';
    if (change.changeType === 'CREATE') return `${who} requested to create ${change.entityType} "${change.entityName}"`;
    if (change.changeType === 'UPDATE') return `${who} requested to update ${change.entityType} "${change.entityName}"`;
    if (change.changeType === 'DELETE') return `${who} requested to remove ${change.entityType} "${change.entityName}"`;
    return `${change.changeType} ${change.entityType}`;
  }, [parsedPayload, change]);

  const impact = useMemo(() => {
    if (change.changeType === 'DELETE') return 'This will remove the item and any associated data.';
    if (change.changeType === 'CREATE') return 'This will add a new item which may affect related workflows.';
    return 'This will update existing configuration and may change behavior for affected users.';
  }, [change.changeType]);

  const changesList = useMemo(() => {
    const out: { field: string; before?: any; after?: any }[] = [];
    if (!parsedPayload) return out;
    const original = parsedPayload.original || {};
    const updated = parsedPayload.updated || {};
    const created = parsedPayload.created || {};

    if (change.changeType === 'CREATE') {
      Object.keys(created).forEach(k => out.push({ field: k, after: created[k] }));
    } else if (change.changeType === 'DELETE') {
      Object.keys(original).forEach(k => out.push({ field: k, before: original[k] }));
    } else {
      const keys = new Set([...Object.keys(original || {}), ...Object.keys(updated || {})]);
      keys.forEach(k => {
        const before = original[k];
        const after = updated[k];
        if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ field: k, before, after });
      });
    }
    return out;
  }, [parsedPayload, change.changeType]);

  const loanCycleSources = useMemo(() => {
    if (!parsedPayload) return { before: null as any, after: null as any };
    const before = change.changeType === 'DELETE'
      ? parsedPayload.original
      : change.changeType === 'CREATE'
        ? null
        : (parsedPayload.original ?? null);
    const after = change.changeType === 'DELETE'
      ? null
      : (change.changeType === 'CREATE'
          ? (parsedPayload.created ?? null)
          : (parsedPayload.updated ?? parsedPayload.created ?? null));
    return { before, after };
  }, [parsedPayload, change.changeType]);


  const renderLoanCycleRangesMini = (ranges: Array<{ label: string; min: number | null; max: number | null }> | null | undefined) => {
    if (!ranges || ranges.length === 0) return '—';
    return (
      <div className="space-y-1">
        {ranges.map((r, idx) => (
          <div key={idx} className="text-sm">
            <span className="font-medium">{r.label}</span>
            <span className="text-muted-foreground">{r.min !== null && r.max !== null ? ` (${r.min}-${r.max})` : ''}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderLoanCycleGradesMini = (
    ranges: Array<{ label: string; min: number | null; max: number | null }> | null | undefined,
    grades: Array<{ label: string; minScore: number | null; percentages: Array<number | null> }> | null | undefined,
  ) => {
    if (!grades || grades.length === 0) return '—';
    const cols = Array.isArray(ranges) ? ranges : [];
    const hasAnyPercent = grades.some(g => Array.isArray(g.percentages) && g.percentages.some(p => p !== null && p !== undefined));

    // If we don't have columns or percentages, fall back to a simple list.
    if (cols.length === 0 || !hasAnyPercent) {
      return (
        <div className="space-y-1">
          {grades.map((g, idx) => (
            <div key={idx} className="text-sm">
              <span className="font-medium">{g.label}</span>
              {g.minScore !== null ? <span className="text-muted-foreground"> (min score {g.minScore})</span> : null}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="border rounded-md overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grade</TableHead>
              <TableHead>Min Score</TableHead>
              {cols.map(c => (
                <TableHead key={c.label}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grades.map((g, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-medium">{g.label}</TableCell>
                <TableCell>{g.minScore ?? '—'}</TableCell>
                {cols.map((c, ci) => (
                  <TableCell key={`${idx}-${c.label}`}>{g.percentages?.[ci] ?? '—'}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const isScoringEngineRule = (it: any) => {
    if (!it || typeof it !== 'object') return false;
    return (
      'condition' in it &&
      'value' in it &&
      'score' in it &&
      'field' in it
    );
  };

  const isScoringParameter = (it: any) => {
    if (!it || typeof it !== 'object') return false;
    return typeof it.name === 'string' && typeof it.weight === 'number' && Array.isArray(it.rules);
  };

  const isImageDataUrl = (s: string) => /^data:image\//i.test(s.trim());
  const isLikelyImageUrl = (s: string) => /^https?:\/\//i.test(s.trim()) && /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(s.trim());
  const isHexColor = (s: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/i.test(s.trim());

  const tryParseJsonString = (s: string) => {
    const t = s.trim();
    if (!t) return null;
    // Avoid parsing huge strings; also avoid base64-ish content.
    if (t.length > 20000) return null;
    if (!(t.startsWith('{') || t.startsWith('['))) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };

  const tryParseJsonAny = (value: any) => {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') return value;
    const t = value.trim();
    if (!t) return value;
    // allow normal json
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return JSON.parse(t);
      } catch {
        return value;
      }
    }
    // allow double-encoded json string
    if (t.startsWith('"') && t.endsWith('"')) {
      try {
        const inner = JSON.parse(t);
        return inner;
      } catch {
        return value;
      }
    }
    return value;
  };

  const parseRangeLabel = (label: string): { min: number; max: number } | null => {
    const t = String(label || '').trim();
    const m = t.match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
    if (!m) return null;
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
  };

  const normalizeLoanCycleRanges = (raw: any): Array<{ label: string; min: number | null; max: number | null }> => {
    const v = tryParseJsonAny(raw);
    const arr = Array.isArray(v) ? v : [];
    return arr
      .map((r: any) => {
        if (r === null || r === undefined) return null;
        if (typeof r === 'string') {
          const parsed = parseRangeLabel(r);
          if (!parsed) return null;
          return { label: r, min: parsed.min, max: parsed.max };
        }
        if (typeof r !== 'object') return null;
        const label = String(r?.label ?? '').trim();
        const minRaw = r?.min ?? r?.from ?? r?.start;
        const maxRaw = r?.max ?? r?.to ?? r?.end;
        const min = Number(minRaw);
        const max = Number(maxRaw);

        // If min/max are missing, try to parse from label like "1-2"
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          const parsed = parseRangeLabel(label);
          if (!label || !parsed) return null;
          return { label, min: parsed.min, max: parsed.max };
        }

        if (!label) return null;
        return { label, min, max };
      })
      .filter(Boolean) as any;
  };

  const normalizeLoanCycleGrades = (raw: any): Array<{ label: string; minScore: number | null; percentages: Array<number | null> }> => {
    const v = tryParseJsonAny(raw);
    const arr = Array.isArray(v) ? v : [];
    return arr
      .map((g: any) => {
        if (g === null || g === undefined) return null;
        if (typeof g === 'string') return { label: g, minScore: null, percentages: [] };
        if (typeof g !== 'object') return null;

        const label = String(g?.label ?? '').trim();
        if (!label) return null;

        const minScoreNum = Number(g?.minScore);
        const minScore = Number.isFinite(minScoreNum) ? minScoreNum : null;

        const percentages = Array.isArray(g?.percentages)
          ? g.percentages.map((p: any) => {
              const n = Number(p);
              return Number.isFinite(n) ? n : null;
            })
          : [];

        return { label, minScore, percentages };
      })
      .filter(Boolean) as any;
  };

  const loanCycleChangesList = useMemo(() => {
    if (change.entityType !== 'LoanCycleConfig') return null;
    const before = loanCycleSources.before;
    const after = loanCycleSources.after;

    const allowed = ['enabled', 'metric', 'cycleRanges', 'grades'] as const;
    const rows: { field: string; before?: any; after?: any }[] = [];

    const beforeRanges = normalizeLoanCycleRanges(before?.cycleRanges);
    const afterRanges = normalizeLoanCycleRanges(after?.cycleRanges);
    const beforeGrades = normalizeLoanCycleGrades(before?.grades);
    const afterGrades = normalizeLoanCycleGrades(after?.grades);

    const normalized: Record<string, { before: any; after: any }> = {
      enabled: { before: before?.enabled, after: after?.enabled },
      metric: { before: before?.metric, after: after?.metric },
      cycleRanges: { before: beforeRanges, after: afterRanges },
      grades: { before: beforeGrades, after: afterGrades },
    };

    for (const field of allowed) {
      const b = normalized[field].before;
      const a = normalized[field].after;
      if (JSON.stringify(b) !== JSON.stringify(a)) rows.push({ field, before: b, after: a });
    }

    return rows;
  }, [change.entityType, loanCycleSources]);

  const metricLabel = (metric: any) => {
    const m = String(metric ?? '').toUpperCase();
    const map: Record<string, string> = {
      PAID_EARLY: 'Paid Early',
      PAID_LATE: 'Paid Late',
      TOTAL_COUNT: 'Total Loans Count',
      PAID_ON_TIME: 'Paid On Time',
    };
    return map[m] ?? String(metric ?? '');
  };

  const renderLoanCycleConfig = (source: any) => {
    if (!source || typeof source !== 'object') return null;
    const enabled = source.enabled;
    const metric = source.metric;

    const cycleRanges = normalizeLoanCycleRanges(source.cycleRanges);
    const grades = normalizeLoanCycleGrades(source.grades);
    const legacyCycles = tryParseJsonAny(source.cycles);

    const hasMain = metric || typeof enabled === 'boolean' || cycleRanges.length || grades.length || (Array.isArray(legacyCycles) && legacyCycles.length);
    if (!hasMain) return null;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Loan Cycle Configuration</CardTitle>
          <CardDescription>Progression metric, cycle ranges, and grade percentages</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Progression Metric</div>
              <div className="font-medium">{metricLabel(metric) || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Enabled</div>
              <div className="font-medium">{typeof enabled === 'boolean' ? (enabled ? 'Yes' : 'No') : '—'}</div>
            </div>
          </div>

          {cycleRanges.length > 0 && (
            <div className="space-y-2">
              <div className="font-medium">Cycle Ranges</div>
              <div className="border rounded-md overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Min</TableHead>
                      <TableHead>Max</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cycleRanges.map((r, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell>{r.min ?? '—'}</TableCell>
                        <TableCell>{r.max ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {grades.length > 0 && cycleRanges.length > 0 && (
            <div className="space-y-2">
              <div className="font-medium">Grades &amp; Percentages</div>
              <div className="border rounded-md overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grade</TableHead>
                      <TableHead>Min Score</TableHead>
                      {cycleRanges.map((r) => (
                        <TableHead key={r.label}>{r.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grades.map((g, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{g.label}</TableCell>
                        <TableCell>{g.minScore ?? '—'}</TableCell>
                        {cycleRanges.map((r, ri) => (
                          <TableCell key={`${idx}-${r.label}`}>{g.percentages?.[ri] ?? '—'}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {Array.isArray(legacyCycles) && legacyCycles.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Legacy Cycles</div>
              <div className="text-sm">{legacyCycles.map((c: any) => String(c)).join(', ')}</div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const formatCurrency = (n: number | string | undefined | null) => {
    const num = typeof n === 'string' ? parseFloat(n) : (n as number | undefined | null);
    if (num === null || num === undefined || Number.isNaN(Number(num))) return String(n ?? '');
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(num)) + ' ETB';
  };

  const normalizeSalaryAdvanceMappings = (value: any): Array<{ accountNumber: string; salary: number | string }> | null => {
    if (value === null || value === undefined) return null;

    const normalizeRow = (row: any) => {
      if (!row || typeof row !== 'object') return null;
      const accountNumber = String(row.accountNumber ?? row.account ?? row.acc ?? row.account_no ?? row.accountNumberString ?? '').trim();
      const salary = row.salary ?? row.amount ?? row.monthlySalary ?? row.monthly_salary;
      if (!accountNumber) return null;
      return { accountNumber, salary: salary ?? '' };
    };

    // If it's a JSON string, parse it first.
    // NOTE: salary mappings can be very large and sometimes double-encoded
    // (e.g. "[{...}]"), so we parse more aggressively here than the generic helper.
    if (typeof value === 'string') {
      const t = value.trim();
      if (!t) return null;

      // Fast filter: avoid parsing unrelated huge strings.
      const looksLikeMappings = t.includes('accountNumber') || t.includes('salary');

      // Normal JSON array/object
      if ((t.startsWith('[') || t.startsWith('{')) && looksLikeMappings) {
        try {
          return normalizeSalaryAdvanceMappings(JSON.parse(t));
        } catch {
          // fall through
        }
      }

      // Double-encoded JSON string: "[...]"
      if (t.startsWith('"') && t.endsWith('"') && looksLikeMappings) {
        try {
          const inner = JSON.parse(t);
          return normalizeSalaryAdvanceMappings(inner);
        } catch {
          // fall through
        }
      }

      return null;
    }

    // Some payloads may wrap it.
    const unwrapped = (value && typeof value === 'object' && Array.isArray((value as any).mappings))
      ? (value as any).mappings
      : value;

    if (!Array.isArray(unwrapped)) return null;
    const rows = unwrapped.map(normalizeRow).filter(Boolean) as Array<{ accountNumber: string; salary: number | string }>;
    return rows.length ? rows : null;
  };

  type SalaryPreviewRow = { accountNumber: string; salary: number | string; removed?: boolean };

  const [salaryPreviewOpen, setSalaryPreviewOpen] = useState(false);
  const [salaryPreviewRows, setSalaryPreviewRows] = useState<Array<SalaryPreviewRow> | null>(null);
  const [salaryPreviewTitle, setSalaryPreviewTitle] = useState<string>('Salary Mappings');
  const [salaryPageSize] = useState<number>(20);
  const [salaryCurrentPage, setSalaryCurrentPage] = useState<number>(1);
  const [salaryPreviewBeforeMap, setSalaryPreviewBeforeMap] = useState<Map<string, string | number> | null>(null);
  const [salaryFilter, setSalaryFilter] = useState<'all' | 'new' | 'updated' | 'unchanged' | 'removed'>('all');

  const salaryPreviewCounts = useMemo(() => {
    if (!salaryPreviewRows || !salaryPreviewBeforeMap) return null;
    let newCount = 0, updatedCount = 0, unchangedCount = 0, removedCount = 0;
    for (const row of salaryPreviewRows) {
      if (row.removed) {
        removedCount++;
        continue;
      }
      const inBefore = salaryPreviewBeforeMap.has(row.accountNumber);
      if (!inBefore) { newCount++; }
      else if (String(salaryPreviewBeforeMap.get(row.accountNumber)) !== String(row.salary)) { updatedCount++; }
      else { unchangedCount++; }
    }
    return { newCount, updatedCount, unchangedCount, removedCount };
  }, [salaryPreviewRows, salaryPreviewBeforeMap]);

  const salaryPreviewFilteredRows = useMemo(() => {
    if (!salaryPreviewRows) return null;
    if (!salaryPreviewBeforeMap || salaryFilter === 'all') return salaryPreviewRows;
    return salaryPreviewRows.filter(row => {
      if (salaryFilter === 'removed') return !!row.removed;
      if (row.removed) return false;
      const inBefore = salaryPreviewBeforeMap.has(row.accountNumber);
      const salaryChanged = inBefore && String(salaryPreviewBeforeMap.get(row.accountNumber)) !== String(row.salary);
      if (salaryFilter === 'new') return !inBefore;
      if (salaryFilter === 'updated') return inBefore && salaryChanged;
      if (salaryFilter === 'unchanged') return inBefore && !salaryChanged;
      return true;
    });
  }, [salaryPreviewRows, salaryPreviewBeforeMap, salaryFilter]);

  const getSalaryRowStatus = (row: SalaryPreviewRow): 'new' | 'updated' | 'unchanged' | 'removed' => {
    if (!salaryPreviewBeforeMap) return 'unchanged';
    if (row.removed) return 'removed';
    if (!salaryPreviewBeforeMap.has(row.accountNumber)) return 'new';
    if (String(salaryPreviewBeforeMap.get(row.accountNumber)) !== String(row.salary)) return 'updated';
    return 'unchanged';
  };

  const openSalaryPreview = (raw: any, title: string, beforeRaw?: any) => {
    const rows = normalizeSalaryAdvanceMappings(raw);
    if (!rows) {
      toast({ title: 'No preview available', description: 'Salary mappings were not found or could not be parsed.', variant: 'destructive' });
      return;
    }
    // Build a lookup map from the "before" data for comparison
    let beforeMap: Map<string, string | number> | null = null;
    if (beforeRaw !== undefined) {
      const beforeRows = normalizeSalaryAdvanceMappings(beforeRaw);
      if (beforeRows) {
        beforeMap = new Map(beforeRows.map(r => [r.accountNumber, r.salary]));
      }
    }
    let previewRows: SalaryPreviewRow[] = rows;
    if (beforeMap) {
      const afterAccounts = new Set(rows.map(r => r.accountNumber));
      const removedRows: SalaryPreviewRow[] = [];
      for (const [accountNumber] of beforeMap.entries()) {
        if (!afterAccounts.has(accountNumber)) {
          removedRows.push({ accountNumber, salary: '', removed: true });
        }
      }
      previewRows = [...rows, ...removedRows];
    }

    setSalaryPreviewBeforeMap(beforeMap);
    setSalaryFilter('all');
    setSalaryPreviewRows(previewRows);
    setSalaryPreviewTitle(title);
    setSalaryCurrentPage(1);
    setSalaryPreviewOpen(true);
  };

  const renderSalaryMappingsCompact = (raw: any, title: string, beforeRaw?: any) => {
    const rows = normalizeSalaryAdvanceMappings(raw);
    if (!rows) return renderValue(raw);

    // Compute summary if we have before data for comparison
    const summaryParts: { label: string; variant: 'new' | 'updated' | 'removed' }[] = [];
    if (beforeRaw !== undefined) {
      const beforeRows = normalizeSalaryAdvanceMappings(beforeRaw);
      if (beforeRows) {
        const beforeMap = new Map(beforeRows.map(r => [r.accountNumber, r.salary]));
        const afterAccounts = new Set(rows.map(r => r.accountNumber));
        let newCount = 0;
        let updatedCount = 0;
        let removedCount = 0;
        for (const row of rows) {
          if (!beforeMap.has(row.accountNumber)) {
            newCount++;
          } else if (String(beforeMap.get(row.accountNumber)) !== String(row.salary)) {
            updatedCount++;
          }
        }
        for (const accountNumber of beforeMap.keys()) {
          if (!afterAccounts.has(accountNumber)) {
            removedCount++;
          }
        }
        if (newCount > 0) summaryParts.push({ label: `${newCount} new`, variant: 'new' });
        if (updatedCount > 0) summaryParts.push({ label: `${updatedCount} updated`, variant: 'updated' });
        if (removedCount > 0) summaryParts.push({ label: `${removedCount} removed`, variant: 'removed' });
      }
    }

    return (
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground">{rows.length} mapping{rows.length === 1 ? '' : 's'}</div>
        {summaryParts.map((part, i) => (
          <Badge
            key={i}
            className={part.variant === 'new'
              ? 'bg-green-100 text-green-800 hover:bg-green-100 border-green-200'
              : part.variant === 'updated'
                ? 'bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200'
                : 'bg-red-100 text-red-800 hover:bg-red-100 border-red-200'
            }
          >
            {part.label}
          </Badge>
        ))}
        <Button variant="link" className="p-0 h-auto" onClick={() => openSalaryPreview(raw, title, beforeRaw)}>Preview</Button>
      </div>
    );
  };

  const renderValue = (v: any) => {
    if (v === undefined || v === null) return '—';
    if (typeof v === 'string') {
      const s = v.trim();
      if (isImageDataUrl(s) || isLikelyImageUrl(s)) {
        return (
          <div className="flex items-center gap-3">
            <img
              src={s}
              alt="icon"
              className="h-12 w-12 rounded border bg-white object-contain"
            />
          </div>
        );
      }
      if (isHexColor(s)) {
        return (
          <div className="flex items-center gap-3">
            <div className="h-6 w-10 rounded border" style={{ backgroundColor: s }} />
            <div className="text-sm">{s}</div>
          </div>
        );
      }

      // Many config fields (e.g., penaltyRules, serviceFee, dailyFee, eligibilityFilter)
      // are stored as JSON strings in the DB. If it looks like JSON, render it.
      const parsed = tryParseJsonString(s);
      if (parsed !== null) return renderValue(parsed);

      return String(v);
    }
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return '0 items';

      // Scoring Engine rules: show readable conditions + score
      if (v.every(isScoringEngineRule)) {
        return renderRules(v);
      }

      // Known array shapes: LoanAmountTier[] and PenaltyRules[]
      const isLoanAmountTier = (it: any) => it && typeof it === 'object' && (('fromScore' in it) || ('from' in it) || ('min' in it)) && (('loanAmount' in it) || ('amount' in it) || ('value' in it));
      const isPenaltyRule = (it: any) => {
        if (!it || typeof it !== 'object') return false;
        // Avoid false positives for objects like DataColumn (which have a generic 'type' field).
        // Require at least one of the clear penalty-related fields (fromDay/toDay/value/frequency)
        // and an identifier to qualify.
        const hasAnyPenaltyField = ('fromDay' in it) || ('toDay' in it) || ('value' in it) || ('frequency' in it) || ('penaltyType' in it);
        const hasIdentifier = ('id' in it) || ('ruleId' in it);
        return hasAnyPenaltyField && hasIdentifier;
      };

      const formatPenaltyRuleLocal = (rule: any) => {
        if (!rule) return '—';
        const raw = rule.value;
        const fromDay = rule.fromDay === '' || rule.fromDay === null || rule.fromDay === undefined ? 1 : Number(rule.fromDay);
        const toDay = rule.toDay === '' || rule.toDay === null || rule.toDay === undefined ? Infinity : Number(rule.toDay);
        const freq = String(rule.frequency || '').toLowerCase();

        let valueString = '';
        if (rule.type === 'fixed') {
          valueString = formatCurrency(raw);
        } else if (rule.type === 'percentageOfPrincipal') {
          valueString = `${Number.isFinite(Number(raw)) ? Number(raw) : String(raw)}% of principal`;
        } else if (rule.type === 'percentageOfCompound') {
          valueString = `${Number.isFinite(Number(raw)) ? Number(raw) : String(raw)}% of outstanding balance`;
        } else {
          valueString = String(raw);
        }

        const when = toDay === Infinity ? `from day ${fromDay} onwards after due date` : `from day ${fromDay} to day ${toDay} after due date`;
        const freqText = freq === 'one-time' ? ' (one-time)' : (freq === 'daily' ? ' (daily)' : (freq ? ` (${freq})` : ''));
        return `${valueString} ${when}${freqText}`;
      };

      if (v.every(isLoanAmountTier)) {
        return (
          <div className="space-y-2 text-sm">
            {v.map((t: any, i: number) => {
              const from = t.fromScore ?? t.from ?? t.min ?? '';
              const to = t.toScore ?? t.to ?? t.max ?? '';
              const amt = t.loanAmount ?? t.amount ?? t.value ?? '';
              const range = from !== '' && to !== '' ? `${from}–${to}` : (from !== '' ? `from ${from}` : `Tier ${i+1}`);
              return (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-4">
                    <div className="text-xs text-muted-foreground w-36">{range}</div>
                    <div className="text-sm font-medium">{formatCurrency(amt)}</div>
                  </div>
                  {t.description && <div className="text-xs text-muted-foreground ml-40">{String(t.description)}</div>}
                </div>
              );
            })}
          </div>
        );
      }

      if (v.every(isPenaltyRule)) {
        return (
          <div className="space-y-2 text-sm">
            {v.map((p: any, i: number) => (
              <div key={i} className="border rounded p-2">
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground w-36">{p.id || p.ruleId || `rule-${i+1}`}</div>
                  <div className="text-sm">{formatPenaltyRuleLocal(p)}</div>
                </div>
              </div>
            ))}
          </div>
        );
      }

      const allPrimitives = v.every(x => ['string', 'number', 'boolean'].includes(typeof x));
      if (allPrimitives) return <div className="text-sm">{v.join(', ')}</div>;
      // array of objects: try to extract sensible label keys
      const nameKeys = ['name', 'columnName', 'field', 'label', 'title', 'key'];
      const typeKeys = ['type', 'dataType', 'columnType', 'kind'];
        const mapped = v.map((item: any) => {
        if (item === null || item === undefined) return { _label: '—', _type: undefined, _isId: false };
        if (typeof item !== 'object') return { _label: String(item), _type: undefined, _isId: false };
        let label: string | undefined;
        for (const k of nameKeys) {
          if (item[k]) { label = String(item[k]); break; }
        }
        let typ: string | undefined;
        for (const k of typeKeys) {
          if (item[k]) { typ = String(item[k]); break; }
        }
        // detect identifier column via common flags or via top-level payload hints
        const isIdFlag = Boolean(item.isId || item.primary || item.isPrimary || item.key === true || item.primaryKey === true || item.identifier === true || item.isIdentifier === true || item.is_identifier === true || item.pk === true || item.primary_key === true);
        let isId = isIdFlag;
        // also consider typical column name 'id'
        if (!isId) {
          const possibleNames = [item.name, item.columnName, item.field, item.key].map(x => String(x || ''));
          if (possibleNames.includes('id')) isId = true;
        }
        // check for explicit identifier name in surrounding payload
        if (!isId && parsedPayload) {
          const idNameKeys = ['idColumn','idField','identifier','identifierColumn','identifierField','primaryKeyField','keyField','idName'];
          for (const k of idNameKeys) {
            const candidate = parsedPayload[k];
            if (!candidate) continue;
            const cand = String(candidate);
            if ([item.name, item.columnName, item.field, item.key].some(x => String(x || '') === cand)) { isId = true; break; }
          }
        }
        if (!label) {
          const vals = Object.values(item).slice(0, 3).map(x => String(x));
          label = vals.join(' | ');
        }
        return { _label: label, _type: typ, _isId: isId };
      });

      const allMappedHaveLabel = mapped.every(m => m && m._label);
      if (allMappedHaveLabel) {
        return (
          <ul className="list-disc ml-5 text-sm space-y-1">
            {mapped.map((m: any, i: number) => (
              <li key={i}>
                <span>{m._label}</span>
                {m._type && <span className="text-xs text-muted-foreground"> ({m._type})</span>}
                {m._isId && <span className="ml-2 text-xs text-muted-foreground">ID</span>}
              </li>
            ))}
          </ul>
        );
      }
      return <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre>;
    }
    if (typeof v === 'object') {
      // Scoring Engine parameter object: show name/weight and expand rules
      if (isScoringParameter(v)) {
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{String((v as any).name)}</div>
              <div className="text-xs text-muted-foreground">Weight (max points): {String((v as any).weight)}</div>
            </div>
            <div className="text-sm">{(v as any).rules?.length ? renderRules((v as any).rules) : <span className="text-muted-foreground">No rules defined.</span>}</div>
          </div>
        );
      }

      const keys = Object.keys(v).filter(k => k !== 'fileContent' && k !== 'file');
      if (keys.length === 0) return '—';
      return (
        <div className="space-y-1">
          {keys.slice(0, 8).map(k => (
            <div key={k} className="flex items-start gap-4">
              <div className="text-xs text-muted-foreground w-36">{k}</div>
              <div className="text-sm break-words">{k === 'rules' ? renderRules((v as any)[k]) : renderValue((v as any)[k])}</div>
            </div>
          ))}
          {keys.length > 8 && <div className="text-xs text-muted-foreground">and {keys.length - 8} more…</div>}
        </div>
      );
    }
    return String(v);
  };

  const renderParameters = (v: any) => {
    if (!v) return '—';
    // object of key -> value
    if (!Array.isArray(v) && typeof v === 'object') {
      const keys = Object.keys(v);
      return (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k} className="flex items-start gap-4">
              <div className="text-xs text-muted-foreground w-36">{k}</div>
              <div className="text-sm break-words">{renderValue(v[k])}</div>
            </div>
          ))}
        </div>
      );
    }
    // array of { name, value }
    if (Array.isArray(v)) {
      return (
        <div className="space-y-2">
          {v.map((it: any, i: number) => (
            <div key={i} className="flex items-start gap-4">
              <div className="text-xs text-muted-foreground w-36">{it.name ?? it.key ?? `param${i+1}`}</div>
              <div className="text-sm break-words">{renderValue(it.value ?? it.default ?? it)}</div>
            </div>
          ))}
        </div>
      );
    }
    return renderValue(v);
  };

  function renderRules(v: any) {
    if (!v) return '—';
    const items = Array.isArray(v) ? v : [v];

    // scoring engine Rule[] shape (field/condition/value/score)
    const isScoringEngineRule = (it: any) => {
      if (!it || typeof it !== 'object') return false;
      return (
        'condition' in it &&
        'value' in it &&
        'score' in it &&
        'field' in it
      );
    };

    const formatScoringRuleLine = (r: any) => {
      const rawCond = String(r.condition ?? '').trim();
      const labelMap: Record<string, string> = {
        '>': 'Greater than',
        '<': 'Less than',
        '>=': 'Greater than or equal to',
        '<=': 'Less than or equal to',
        '==': 'Equal to',
        '!=': 'Not equal to',
        between: 'Between',
      };
      const condLabel = labelMap[rawCond] ?? rawCond;

      const rawValue = r.value ?? '';
      let valueText = String(rawValue);
      if (rawCond === 'between') {
        // stored as "min-max" in the scoring engine
        const [min, max] = String(rawValue).split('-').map(s => s.trim());
        if (min && max) valueText = `${min}–${max}`;
      }

      const left = `${condLabel}${valueText ? ` ${valueText}` : ''}`;
      const right = `=> ${String(r.score ?? '')}`;
      return { left, right };
    };

    if (items.length > 0 && items.every(isScoringEngineRule)) {
      const distinctFields = new Set(items.map((r: any) => String(r.field ?? '')).filter(Boolean));
      return (
        <div className="space-y-2">
          {items.map((r: any, idx: number) => {
            const key = String(r.id || `${idx}`);
            const { left, right } = formatScoringRuleLine(r);
            return (
              <div key={key} className="flex items-center gap-3">
                {distinctFields.size > 1 && (
                  <div className="text-xs text-muted-foreground w-36 truncate">{String(r.field ?? '')}</div>
                )}
                <div className="text-sm">{left}</div>
                <div className="ml-auto text-sm text-muted-foreground">{right}</div>
              </div>
            );
          })}
        </div>
      );
    }

    // build an index of rule-like objects in the payload (objects that have condition/operator/value or weight)
    const buildRuleIndex = (root: any) => {
      const idx = new Map<string, any>();
      const seen = new Set<any>();
      const queue: any[] = [root];
      while (queue.length) {
        const cur = queue.shift();
        if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
        seen.add(cur);
        try {
          // candidate object
          const hasRuleLike = ['condition','expression','operator','value','weight','points','parameter','columns'].some(k => k in cur);
          if (hasRuleLike && (cur.id || cur.ruleId || cur.name)) {
            const key = String(cur.id || cur.ruleId || cur.name);
            idx.set(key, cur);
          }
        } catch {}
        for (const k of Object.keys(cur)) {
          const v2 = cur[k];
          if (v2 && typeof v2 === 'object') queue.push(v2);
        }
      }
      return idx;
    };

    const index = parsedPayload ? buildRuleIndex(parsedPayload) : new Map();

    const resolveItem = (r: any) => {
      if (!r) return null;
      if (typeof r === 'object') return r;
      if (typeof r === 'string') {
        if (index.has(r)) return index.get(r);
        // fallback: try to find by scanning payload for matching id
        const find = (root: any, id: string): any | null => {
          const seen = new Set<any>();
          const q: any[] = [root];
          while (q.length) {
            const cur = q.shift();
            if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
            seen.add(cur);
            if (String(cur.id || cur.ruleId || cur.name) === id) return cur;
            for (const k of Object.keys(cur)) { const v2 = cur[k]; if (v2 && typeof v2 === 'object') q.push(v2); }
          }
          return null;
        };
        if (parsedPayload) {
          const f = find(parsedPayload, r);
          if (f) return f;
        }
        return { name: r };
      }
      return { name: String(r) };
    };

    const resolved = items.map(resolveItem).filter(Boolean);

    // dedupe by name/id
    const seenNames = new Set<string>();
    const unique = resolved.filter((it: any) => {
      const n = String(it.name || it.ruleName || it.id || it.ruleId || '');
      if (!n) return true;
      if (seenNames.has(n)) return false;
      seenNames.add(n);
      return true;
    });

    return (
      <div className="space-y-3">
        {unique.map((r: any, i: number) => {
          const key = String(r.id || r.ruleId || r.name || i);
          const cond = r.condition ?? r.expression ?? r.rule ?? r.criteria ?? r.when;
          const isExpanded = expandedRuleIds.includes(key);
          return (
            <div key={i} className="border rounded p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="font-medium">{r.name || r.ruleName || r.id || r.ruleId || `Rule ${i+1}`}</div>
                <div className="text-xs text-muted-foreground">{r.active === false ? 'inactive' : ''}</div>
              </div>
              {r.description && <div className="text-sm text-muted-foreground mt-1">{r.description}</div>}
              {r.parameter && <div className="text-xs text-muted-foreground mt-2">Parameter: {String(r.parameter)}</div>}
              {r.weight !== undefined && <div className="text-xs text-muted-foreground mt-1">Weight (max points): {String(r.weight)}</div>}
              {cond && (
                <div className="mt-2">
                  {String(cond).length > 160 && !isExpanded ? (
                    <div className="flex items-start gap-2">
                      <pre className="text-xs whitespace-pre-wrap bg-muted/10 p-2 rounded max-h-20 overflow-hidden">{String(cond).slice(0, 160)}…</pre>
                      <Button variant="ghost" size="sm" onClick={() => setExpandedRuleIds(ids => ids.includes(key) ? ids.filter(x => x !== key) : [...ids, key])}>Show</Button>
                    </div>
                  ) : (
                    <pre className="text-xs mt-2 whitespace-pre-wrap bg-muted/10 p-2 rounded">{String(cond)}</pre>
                  )}
                </div>
              )}
              {r.conditions && Array.isArray(r.conditions) && (
                <div className="mt-2 space-y-1">
                  {r.conditions.map((c: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="text-xs text-muted-foreground w-36">{c.operator ?? c.op ?? c.type ?? 'Condition'}</div>
                      <div className="text-sm">{String(c.value ?? c.min ?? c.from ?? '')}{c.to ? ` - ${c.to}` : ''}</div>
                      <div className="ml-auto text-xs text-muted-foreground">{c.points ?? c.score ?? ''}</div>
                    </div>
                  ))}
                </div>
              )}
              {r.columns && Array.isArray(r.columns) && (
                <div className="mt-2">
                  <div className="text-xs text-muted-foreground mb-1">Columns</div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set(r.columns.map((c: any) => String(c)))).map((c: any, idx: number) => <Badge key={idx}>{String(c)}</Badge>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderObjectCard = (obj: any, idx: number) => {
    if (!obj || typeof obj !== 'object') return <div>{renderValue(obj)}</div>;

    // Scoring engine parameter card (used in ScoringRules approvals)
    if (
      typeof obj.name === 'string' &&
      typeof obj.weight === 'number' &&
      Array.isArray(obj.rules)
    ) {
      const title = obj.name || `Parameter ${idx + 1}`;
      return (
        <div key={idx} className="border rounded-md p-4 bg-white">
          <div className="flex items-center justify-between">
            <div className="font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">Weight (max points): {String(obj.weight)}</div>
          </div>
          <div className="mt-3">
            {obj.rules?.length ? (
              <div className="space-y-2">{renderRules(obj.rules)}</div>
            ) : (
              <div className="text-sm text-muted-foreground">No rules defined.</div>
            )}
          </div>
        </div>
      );
    }

    // show id in muted small text, but prefer readable name as header
    const title = obj.name || obj.title || obj.label || `Item ${idx + 1}`;
    const idVal = obj.id || obj.key || obj._id || obj.identifier;
    return (
      <div key={idx} className="border rounded-md p-4 bg-white">
        <div className="flex items-center justify-between">
          <div className="font-medium">{title}</div>
          {idVal && <div className="text-xs text-muted-foreground">ID: {String(idVal)}</div>}
        </div>
        <div className="mt-3 space-y-2">
          {Object.entries(obj).map(([k, v]) => {
            if (k === 'id' || k === 'name' || k === 'title' || k === 'label') return null;
            if (k === 'rules') return (
              <div key={k} className="flex items-start gap-4">
                <div className="text-xs text-muted-foreground w-36 capitalize">{k}</div>
                <div className="text-sm break-words">{renderRules(v)}</div>
              </div>
            );
            return (
              <div key={k} className="flex items-start gap-4">
                <div className="text-xs text-muted-foreground w-36 capitalize">{k}</div>
                <div className="text-sm break-words">{renderValue(v)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const findFileInPayload = () => {
    if (!parsedPayload) return null;
    const candidate = parsedPayload.created || parsedPayload.updated || parsedPayload.original || {};
    const search = (obj: any): any | null => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.fileContent && typeof obj.fileContent === 'string') {
        return { fileContent: obj.fileContent, fileName: obj.fileName || obj.name || 'file' };
      }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'object') {
          const found = search(v);
          if (found) return found;
        }
      }
      return null;
    };
    return search(candidate);
  };

  const file = useMemo(() => findFileInPayload(), [parsedPayload]);

  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [expandedRuleIds, setExpandedRuleIds] = useState<string[]>([]);

  const openPreview = async () => {
    if (!file || !file.fileContent) {
      setPreviewError('No file available');
      setPreviewOpen(true);
      return;
    }
    setPreviewRows(null);
    setPreviewHeaders(null);
    setPreviewError(null);
    setParsing(true);
    try {
      const name = (file.fileName || '').toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const binaryString = atob(file.fileContent);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes.buffer as any);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) throw new Error('No worksheet');
        const columnCount = worksheet.columnCount || 0;
        const headers: string[] = [];
        const headerRow = worksheet.getRow(1);
        for (let i = 1; i <= columnCount; i++) {
          const cell = headerRow.getCell(i);
          const text = (cell.text ?? cell.value) as any;
          headers.push(text?.toString?.() || `Column${i}`);
        }
        const rows: any[] = [];
        for (let r = 2; r <= worksheet.rowCount; r++) {
          const row = worksheet.getRow(r);
          const obj: any = {};
          let empty = true;
          for (let c = 1; c <= columnCount; c++) {
            const val = row.getCell(c).value;
            if (val !== null && val !== undefined && String(val).trim() !== '') empty = false;
            obj[headers[c - 1]] = val;
          }
          if (!empty) rows.push(obj);
        }
        setPreviewHeaders(headers);
        setPreviewRows(rows);
      } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
        const csvText = atob(file.fileContent);
        const lines = csvText.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) throw new Error('Empty file');
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = lines.slice(1).map(l => {
          const parts = l.split(',');
          const obj: any = {};
          headers.forEach((h, i) => obj[h] = parts[i] ?? '');
          return obj;
        });
        setPreviewHeaders(headers);
        setPreviewRows(rows);
      } else {
        setPreviewError('Preview not supported for this file type');
      }
    } catch (err: any) {
      setPreviewError(String(err?.message || err));
    } finally {
      setParsing(false);
      setCurrentPage(1);
      setPreviewOpen(true);
    }
  };

  const fileUrl = useMemo(() => {
    if (!file) return null;
    try {
      // assume base64 content
      const isImage = file.fileName && /\.(png|jpe?g|gif|webp|svg)$/i.test(file.fileName);
      if (isImage) return `data:image/*;base64,${file.fileContent}`;
      return null;
    } catch {
      return null;
    }
  }, [file]);

  const handleProcess = async (approved: boolean) => {
    setProcessing(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeId: change.id, approved, rejectionReason: approved ? undefined : rejectionReason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed');
      }
      toast({ title: 'Success', description: `Change ${approved ? 'approved' : 'rejected'}.` });
      router.push('/admin/approvals');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to process change', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => router.push('/admin/approvals')}>← Back</Button>
          <h1 className="text-2xl font-bold">{whatRequestIs}</h1>
        </div>
        <div className="text-sm text-muted-foreground">Requested {format(new Date(change.createdAt), 'PPpp')}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {change.entityType === 'ScoringRules' && parsedPayload && (
            <Card>
              <CardHeader>
                <CardTitle>Scoring Rules Context</CardTitle>
                <CardDescription>Provider and selected products for this scoring configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-start gap-4">
                  <div className="text-xs text-muted-foreground w-36">Provider</div>
                  <div className="text-sm font-medium">{parsedPayload.provider?.name || change.providerName || parsedPayload.provider?.id || change.entityId || '—'}</div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="text-xs text-muted-foreground w-36">Applied Products</div>
                  <div className="text-sm">
                    {Array.isArray(parsedPayload.appliedProducts) && parsedPayload.appliedProducts.length > 0
                      ? parsedPayload.appliedProducts.map((p: any) => p?.name || p?.id).filter(Boolean).join(', ')
                      : Array.isArray(parsedPayload.appliedProductIds) && parsedPayload.appliedProductIds.length > 0
                        ? parsedPayload.appliedProductIds.join(', ')
                        : '—'}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>{change.entityType} • {change.changeType}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-medium">What this request is</p>
              <p className="text-sm text-muted-foreground mb-3">{whatRequestIs}</p>
              <p className="font-medium">Impact</p>
              <p className="text-sm text-muted-foreground">{impact}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Changes</CardTitle>
              <CardDescription>Field / Before / After</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const list = change.entityType === 'LoanCycleConfig' && Array.isArray(loanCycleChangesList)
                  ? loanCycleChangesList
                  : changesList;

                return list.length === 0;
              })() ? (
                <p className="text-sm text-muted-foreground">No detectable field-level changes.</p>
              ) : (
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>Before</TableHead>
                        <TableHead>After</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const list = change.entityType === 'LoanCycleConfig' && Array.isArray(loanCycleChangesList)
                          ? loanCycleChangesList
                          : changesList;
                        return list;
                      })()
                        .filter(c => c.field !== 'fileContent')
                        .map((c, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{c.field}</TableCell>
                          <TableCell>
                            {change.entityType === 'LoanCycleConfig' && c.field === 'metric'
                              ? metricLabel(c.before)
                              : change.entityType === 'LoanCycleConfig' && c.field === 'enabled'
                                ? (typeof c.before === 'boolean' ? (c.before ? 'Yes' : 'No') : '—')
                                : change.entityType === 'LoanCycleConfig' && c.field === 'cycleRanges'
                                  ? renderLoanCycleRangesMini(c.before)
                                  : change.entityType === 'LoanCycleConfig' && c.field === 'grades'
                                    ? renderLoanCycleGradesMini(normalizeLoanCycleRanges(loanCycleSources.before?.cycleRanges), c.before)
                                    : change.entityType === 'TermsAndConditions' && c.field === 'content'
                                      ? <span className="text-sm text-muted-foreground">See the Terms &amp; Conditions section below.</span>
                                      : c.field === 'salaryAdvanceMappings'
                                        ? renderSalaryMappingsCompact(c.before, 'Salary Mappings (Before)')
                                        : c.field === 'columns'
                                          ? (Array.isArray(c.before) ? `${c.before.length} column${c.before.length === 1 ? '' : 's'}` : (c.before === undefined ? '—' : renderValue(c.before)))
                                          : renderValue(c.before)}
                          </TableCell>
                          <TableCell>
                            {change.entityType === 'LoanCycleConfig' && c.field === 'metric'
                              ? metricLabel(c.after)
                              : change.entityType === 'LoanCycleConfig' && c.field === 'enabled'
                                ? (typeof c.after === 'boolean' ? (c.after ? 'Yes' : 'No') : '—')
                                : change.entityType === 'LoanCycleConfig' && c.field === 'cycleRanges'
                                  ? renderLoanCycleRangesMini(c.after)
                                  : change.entityType === 'LoanCycleConfig' && c.field === 'grades'
                                    ? renderLoanCycleGradesMini(normalizeLoanCycleRanges(loanCycleSources.after?.cycleRanges), c.after)
                                    : change.entityType === 'TermsAndConditions' && c.field === 'content'
                                      ? <span className="text-sm text-muted-foreground">See the Terms &amp; Conditions section below.</span>
                                      : c.field === 'salaryAdvanceMappings'
                                        ? renderSalaryMappingsCompact(c.after, 'Salary Mappings (After)', c.before)
                                        : c.field === 'columns'
                                          ? (Array.isArray(c.after) ? `${c.after.length} column${c.after.length === 1 ? '' : 's'}` : (c.after === undefined ? '—' : renderValue(c.after)))
                                          : renderValue(c.after)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Plain-language details card: summarizes created/updated/original payload in readable sections */}
          {parsedPayload && change.entityType !== 'TermsAndConditions' && change.entityType !== 'LoanCycleConfig' && (
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>Plain-language summary of the attached data</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const source = change.changeType === 'CREATE' ? parsedPayload.created : change.changeType === 'DELETE' ? parsedPayload.original : parsedPayload.updated || parsedPayload.created;
                  if (!source || Object.keys(source).length === 0) return <div className="text-sm text-muted-foreground">No additional details.</div>;
                  const entries = Object.entries(source).filter(([k]) => k !== 'fileContent');
                  // if the source is an array of objects, render each item as a clear card
                  if (Array.isArray(source)) {
                    return (
                      <div className="space-y-3">
                        {source.map((it: any, i: number) => (
                          <div key={i}>{renderObjectCard(it, i)}</div>
                        ))}
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {entries.map(([k, v]) => (
                        <div key={k} className="flex items-start gap-4">
                          <div className="text-xs text-muted-foreground w-36 capitalize">{k}</div>
                          <div className="text-sm break-words">
                            {(() => {
                              const lowerKey = k.toLowerCase();
                              const isPenaltyRulesKey = lowerKey === 'penaltyrules' || lowerKey.endsWith('penaltyrules');
                              const isParametersKey = lowerKey.includes('param') || lowerKey.includes('parameters');
                              const isScoringRulesKey = (lowerKey === 'rules' || lowerKey.includes('scoring')) && (lowerKey.includes('rule') || lowerKey.includes('conditions'));
                              const isSalaryMappingsKey = lowerKey === 'salaryadvancemappings' || lowerKey.endsWith('salaryadvancemappings');

                              if (lowerKey === 'columns') {
                                const cols = Array.isArray(v) ? v : tryParseJsonAny(v) || [];
                                if (!Array.isArray(cols) || cols.length === 0) return '—';
                                return (
                                  <div className="space-y-2">
                                    {cols.map((col: any, i: number) => (
                                      <div key={i} className="flex items-center gap-3">
                                        <div className="text-xs text-muted-foreground w-36">{String(col.name ?? col.id ?? `column${i+1}`)}</div>
                                        <div className="text-sm">
                                          {col.type ? String(col.type) : '—'}{col.isIdentifier ? ' • Identifier' : ''}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              if (isPenaltyRulesKey) return renderValue(v);
                              if (isSalaryMappingsKey) return renderSalaryMappingsCompact(v, 'Salary Mappings');
                              if (isParametersKey) return renderParameters(v);
                              if (isScoringRulesKey) return renderRules(v);
                              return renderValue(v);
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {parsedPayload && change.entityType === 'LoanCycleConfig' && (
            (() => {
              const source = change.changeType === 'CREATE'
                ? parsedPayload.created
                : change.changeType === 'DELETE'
                  ? parsedPayload.original
                  : parsedPayload.updated || parsedPayload.created;

              return renderLoanCycleConfig(source);
            })()
          )}

          <Dialog open={salaryPreviewOpen} onOpenChange={(open) => setSalaryPreviewOpen(open)}>
            <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>{salaryPreviewTitle}</DialogTitle>
                <DialogDescription>
                  {salaryPreviewFilteredRows
                    ? `Showing ${salaryPreviewFilteredRows.length} of ${salaryPreviewRows?.length ?? 0} mappings.`
                    : 'Displaying salary mappings.'}
                  {salaryPreviewCounts && (
                    <span className="ml-1">
                      ({salaryPreviewCounts.newCount} new, {salaryPreviewCounts.updatedCount} updated, {salaryPreviewCounts.removedCount} removed, {salaryPreviewCounts.unchangedCount} unchanged)
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              {/* Filter buttons — only shown when we have comparison data */}
              {salaryPreviewCounts && (
                <div className="flex items-center gap-2 flex-wrap px-1">
                  <Button variant={salaryFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => { setSalaryFilter('all'); setSalaryCurrentPage(1); }}>
                    All ({salaryPreviewRows?.length ?? 0})
                  </Button>
                  <Button variant={salaryFilter === 'new' ? 'default' : 'outline'} size="sm"
                    className={salaryFilter === 'new' ? 'bg-green-600 hover:bg-green-700' : ''}
                    onClick={() => { setSalaryFilter('new'); setSalaryCurrentPage(1); }}>
                    New ({salaryPreviewCounts.newCount})
                  </Button>
                  <Button variant={salaryFilter === 'updated' ? 'default' : 'outline'} size="sm"
                    className={salaryFilter === 'updated' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                    onClick={() => { setSalaryFilter('updated'); setSalaryCurrentPage(1); }}>
                    Updated ({salaryPreviewCounts.updatedCount})
                  </Button>
                  <Button variant={salaryFilter === 'removed' ? 'default' : 'outline'} size="sm"
                    className={salaryFilter === 'removed' ? 'bg-red-600 hover:bg-red-700' : ''}
                    onClick={() => { setSalaryFilter('removed'); setSalaryCurrentPage(1); }}>
                    Removed ({salaryPreviewCounts.removedCount})
                  </Button>
                  <Button variant={salaryFilter === 'unchanged' ? 'default' : 'outline'} size="sm"
                    onClick={() => { setSalaryFilter('unchanged'); setSalaryCurrentPage(1); }}>
                    Unchanged ({salaryPreviewCounts.unchangedCount})
                  </Button>
                </div>
              )}

              <div className="flex-grow overflow-auto border rounded-md">
                {salaryPreviewFilteredRows && salaryPreviewFilteredRows.length > 0 ? (
                  <div className="p-4">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead>Account Number</TableHead>
                          <TableHead>Salary</TableHead>
                          {salaryPreviewBeforeMap && <TableHead>Previous Salary</TableHead>}
                          {salaryPreviewBeforeMap && <TableHead>Status</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salaryPreviewFilteredRows.slice((salaryCurrentPage - 1) * salaryPageSize, salaryCurrentPage * salaryPageSize).map((row, idx) => {
                          const status = getSalaryRowStatus(row);
                          const rowBg = status === 'new'
                            ? 'bg-green-50'
                            : status === 'updated'
                              ? 'bg-amber-50'
                              : status === 'removed'
                                ? 'bg-red-50'
                              : '';
                          return (
                            <TableRow key={idx} className={rowBg}>
                              <TableCell className="font-medium">{row.accountNumber}</TableCell>
                              <TableCell>{status === 'removed' ? '—' : String(row.salary ?? '')}</TableCell>
                              {salaryPreviewBeforeMap && (
                                <TableCell className="text-muted-foreground">
                                  {salaryPreviewBeforeMap.has(row.accountNumber)
                                    ? String(salaryPreviewBeforeMap.get(row.accountNumber) ?? '')
                                    : '—'}
                                </TableCell>
                              )}
                              {salaryPreviewBeforeMap && (
                                <TableCell>
                                  {status === 'new' && <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">New</Badge>}
                                  {status === 'updated' && <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Updated</Badge>}
                                  {status === 'removed' && <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">Removed</Badge>}
                                  {status === 'unchanged' && <span className="text-xs text-muted-foreground">Unchanged</span>}
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">No mappings to preview.</div>
                )}
              </div>
              {salaryPreviewFilteredRows && salaryPreviewFilteredRows.length > 0 && (
                <div className="px-4 py-3 border-t">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Page {salaryCurrentPage} of {Math.max(1, Math.ceil(salaryPreviewFilteredRows.length / salaryPageSize))}</div>
                    <div className="flex items-center space-x-2">
                      <Button variant="outline" size="sm" onClick={() => setSalaryCurrentPage(p => Math.max(1, p - 1))} disabled={salaryCurrentPage === 1}>Previous</Button>
                      <Button variant="outline" size="sm" onClick={() => setSalaryCurrentPage(p => Math.min(Math.ceil(salaryPreviewFilteredRows.length / salaryPageSize), p + 1))} disabled={salaryCurrentPage >= Math.ceil(salaryPreviewFilteredRows.length / salaryPageSize)}>Next</Button>
                    </div>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setSalaryPreviewOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {change.entityType === 'TermsAndConditions' && parsedPayload && (
            <Card>
              <CardHeader>
                <CardTitle>Terms &amp; Conditions</CardTitle>
                <CardDescription>Current vs Proposed</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Current</p>
                    <div className="border rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap bg-muted/40">{parsedPayload.original?.content || 'No current terms.'}</div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Proposed</p>
                    <div className="border rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap bg-muted/20">{parsedPayload.updated?.content || parsedPayload.created?.content || 'No proposed terms.'}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {file && (
            <Card>
              <CardHeader>
                <CardTitle>File Preview</CardTitle>
                <CardDescription>{file.fileName}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
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
                      <TableRow>
                        <TableCell className="font-medium flex items-center gap-2">{/** click file name to preview */}
                          <Button variant="link" onClick={openPreview} className="p-0">📄 {file.fileName}</Button>
                        </TableCell>
                        <TableCell>{previewRows ? previewRows.length : '—'}</TableCell>
                        <TableCell>{change.createdBy?.fullName || 'Unknown'}</TableCell>
                        <TableCell>{format(new Date(change.createdAt), 'yyyy-MM-dd HH:mm')}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                {fileUrl ? (
                  <img src={fileUrl} alt={file.fileName} className="max-h-96 object-contain" />
                ) : (
                  <div className="space-y-2">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Click the file name to preview the uploaded data.</p>
                      <Button onClick={() => {
                        try {
                          const bstr = atob(file.fileContent);
                          let n = bstr.length;
                          const u8arr = new Uint8Array(n);
                          while (n--) u8arr[n] = bstr.charCodeAt(n);
                          const blob = new Blob([u8arr]);
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = file.fileName || 'file';
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          toast({ title: 'Error', description: 'Unable to download file', variant: 'destructive' });
                        }
                      }}>Download</Button>
                    </div>
                  </div>
                )}
                <Dialog open={previewOpen} onOpenChange={(open) => setPreviewOpen(open)}>
                  <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                    <DialogHeader className="relative">
                      <div className="flex items-start w-full">
                        <div>
                          <DialogTitle>Viewing Upload: {file.fileName}</DialogTitle>
                          <DialogDescription>
                            {previewRows
                              ? `Displaying ${Math.min(previewRows.slice((currentPage - 1) * pageSize, currentPage * pageSize).length, previewRows.length)} of ${previewRows.length} rows from the uploaded file.`
                              : 'Displaying rows from the uploaded file.'}
                          </DialogDescription>
                        </div>
                      </div>
                    </DialogHeader>
                    <div className="flex-grow overflow-auto border rounded-md">
                      {parsing ? (
                        <div className="p-4">Parsing file preview...</div>
                      ) : previewError ? (
                        <div className="p-4 text-sm text-muted-foreground">Preview failed: {previewError}</div>
                      ) : previewRows && previewRows.length > 0 && previewHeaders ? (
                        <div className="p-4 space-y-3">
                          <div className="overflow-auto border rounded-md">
                            <Table>
                              <TableHeader className="sticky top-0 bg-background">
                                <TableRow>
                                  {previewHeaders.map(h => <TableHead key={h}>{h}</TableHead>)}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {previewRows.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((row, idx) => (
                                  <TableRow key={idx}>
                                    {previewHeaders.map(h => <TableCell key={`${idx}-${h}`}>{String((row as any)[h] ?? '')}</TableCell>)}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {/* pagination moved to footer */}
                        </div>
                      ) : (
                        <div className="p-4">No preview available.</div>
                      )}
                    </div>
                    {previewRows && previewRows.length > 0 && previewHeaders && (
                      <div className="px-4 py-3 border-t">
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-muted-foreground">Page {currentPage} of {Math.max(1, Math.ceil(previewRows.length / pageSize))}</div>
                          <div className="flex items-center space-x-2">
                            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</Button>
                            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(Math.ceil(previewRows.length / pageSize), p + 1))} disabled={currentPage >= Math.ceil(previewRows.length / pageSize)}>Next</Button>
                          </div>
                        </div>
                      </div>
                    )}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Decision</CardTitle>
              <CardDescription>Approve or reject this request</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Rejection Reason (optional)</label>
                  <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} placeholder="Explain why this request should be rejected" />
                </div>

                <div className="flex space-x-2">
                  <Button variant="outline" onClick={() => router.push('/admin/approvals')}>Cancel</Button>
                  <Button onClick={() => handleProcess(true)} disabled={processing} className="text-black">{processing ? 'Processing...' : 'Approve'}</Button>
                  <Button variant="destructive" onClick={() => handleProcess(false)} disabled={processing || !rejectionReason.trim()}>{processing ? 'Processing...' : 'Reject'}</Button>
                </div>

                <div className="text-xs text-muted-foreground">Decision will be recorded and submitter will be notified.</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Meta</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">Requested by</div>
              <div className="font-medium mb-2">{change.createdBy?.fullName || 'Unknown'}</div>
              <div className="text-sm text-muted-foreground">Entity</div>
              <div className="font-medium mb-2">{change.entityType} {change.providerName ? `• ${change.providerName}` : ''}</div>
              <div className="text-sm text-muted-foreground">Type</div>
              <div className="font-medium"><Badge>{change.changeType}</Badge></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
