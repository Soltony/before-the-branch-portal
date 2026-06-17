'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import {
    ArrowLeft,
    Calendar,
    Users,
    CheckCircle,
    XCircle,
    Clock,
    Loader2,
    RefreshCw,
    FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import type { SmsCampaign, SmsLog, SmsCampaignTargetCriteria, SmsStatus, SmsCampaignStatus } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

interface CampaignDetailClientProps {
    campaign: SmsCampaign & {
        smsLogs: SmsLog[];
    };
}

export function CampaignDetailClient({ campaign: initialCampaign }: CampaignDetailClientProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [campaign, setCampaign] = useState(initialCampaign);
    const [refreshing, setRefreshing] = useState(false);

    const refreshCampaign = async () => {
        setRefreshing(true);
        try {
            const res = await fetch(`/api/sms/campaigns/${campaign.id}`);
            if (!res.ok) throw new Error('Failed to refresh');
            const data = await res.json();
            setCampaign(data);
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to refresh campaign data', variant: 'destructive' });
        } finally {
            setRefreshing(false);
        }
    };

    const handleResendFailed = async (logId: string) => {
        try {
            const res = await fetch(`/api/sms/logs/${logId}/resend`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to resend');
            toast({ title: 'Success', description: 'SMS resent successfully' });
            refreshCampaign();
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to resend SMS', variant: 'destructive' });
        }
    };

    const renderStatusBadge = (status: SmsStatus | SmsCampaignStatus) => {
        const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
            PENDING: { variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
            SENT: { variant: 'default', icon: <CheckCircle className="h-3 w-3" /> },
            DELIVERED: { variant: 'default', icon: <CheckCircle className="h-3 w-3" /> },
            FAILED: { variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
            DRAFT: { variant: 'outline', icon: <FileText className="h-3 w-3" /> },
            SCHEDULED: { variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
            PROCESSING: { variant: 'default', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
            COMPLETED: { variant: 'default', icon: <CheckCircle className="h-3 w-3" /> },
            CANCELLED: { variant: 'secondary', icon: <XCircle className="h-3 w-3" /> },
        };

        const config = variants[status] || { variant: 'outline', icon: null };

        return (
            <Badge variant={config.variant} className="gap-1">
                {config.icon}
                {status}
            </Badge>
        );
    };

    const progressPercent = campaign.totalRecipients > 0
        ? Math.round(((campaign.sentCount + campaign.failedCount) / campaign.totalRecipients) * 100)
        : 0;

    const criteria = campaign.targetCriteria as SmsCampaignTargetCriteria;

    return (
        <div className="container mx-auto py-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => router.push('/admin/sms-management')}>
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold">{campaign.name}</h1>
                        <p className="text-muted-foreground">Campaign Details</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {renderStatusBadge(campaign.status)}
                    <Button variant="outline" size="sm" onClick={refreshCampaign} disabled={refreshing}>
                        {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total Recipients</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold flex items-center gap-2">
                            <Users className="h-5 w-5 text-muted-foreground" />
                            {campaign.totalRecipients}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Sent</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600 flex items-center gap-2">
                            <CheckCircle className="h-5 w-5" />
                            {campaign.sentCount}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Delivered</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-600 flex items-center gap-2">
                            <CheckCircle className="h-5 w-5" />
                            {campaign.deliveredCount}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Failed</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600 flex items-center gap-2">
                            <XCircle className="h-5 w-5" />
                            {campaign.failedCount}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Progress */}
            {campaign.status === 'PROCESSING' && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Progress</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Progress value={progressPercent} className="h-3" />
                        <p className="text-sm text-muted-foreground mt-2">
                            {campaign.sentCount + campaign.failedCount} of {campaign.totalRecipients} processed ({progressPercent}%)
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Campaign Details */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Campaign Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-muted-foreground">Template</p>
                                <p className="font-medium">{campaign.template?.name || 'Custom Message'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Schedule Type</p>
                                <p className="font-medium">{campaign.scheduleType}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Created At</p>
                                <p className="font-medium">{format(new Date(campaign.createdAt), 'MMM dd, yyyy HH:mm')}</p>
                            </div>
                            {campaign.scheduledAt && (
                                <div>
                                    <p className="text-sm text-muted-foreground">Scheduled For</p>
                                    <p className="font-medium">{format(new Date(campaign.scheduledAt), 'MMM dd, yyyy HH:mm')}</p>
                                </div>
                            )}
                            {campaign.startedAt && (
                                <div>
                                    <p className="text-sm text-muted-foreground">Started At</p>
                                    <p className="font-medium">{format(new Date(campaign.startedAt), 'MMM dd, yyyy HH:mm')}</p>
                                </div>
                            )}
                            {campaign.completedAt && (
                                <div>
                                    <p className="text-sm text-muted-foreground">Completed At</p>
                                    <p className="font-medium">{format(new Date(campaign.completedAt), 'MMM dd, yyyy HH:mm')}</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Target Criteria</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {criteria.providerIds?.length && (
                            <div>
                                <span className="text-sm text-muted-foreground">Providers: </span>
                                <span className="font-medium">{criteria.providerIds.join(', ')}</span>
                            </div>
                        )}
                        {criteria.productIds?.length && (
                            <div>
                                <span className="text-sm text-muted-foreground">Products: </span>
                                <span className="font-medium">{criteria.productIds.join(', ')}</span>
                            </div>
                        )}
                        {(criteria.overdueFrom !== undefined || criteria.overdueTo !== undefined) && (
                            <div>
                                <span className="text-sm text-muted-foreground">Days Overdue: </span>
                                <span className="font-medium">
                                    {criteria.overdueFrom ?? '0'} - {criteria.overdueTo ?? '∞'}
                                </span>
                            </div>
                        )}
                        {(criteria.loanAgeFrom !== undefined || criteria.loanAgeTo !== undefined) && (
                            <div>
                                <span className="text-sm text-muted-foreground">Loan Age (days): </span>
                                <span className="font-medium">
                                    {criteria.loanAgeFrom ?? '0'} - {criteria.loanAgeTo ?? '∞'}
                                </span>
                            </div>
                        )}
                        {criteria.repaymentStatus && (
                            <div>
                                <span className="text-sm text-muted-foreground">Repayment Status: </span>
                                <span className="font-medium">{criteria.repaymentStatus}</span>
                            </div>
                        )}
                        {Object.keys(criteria).length === 0 && (
                            <p className="text-muted-foreground">All loans (no filters applied)</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Message Content */}
            {campaign.customMessage && (
                <Card>
                    <CardHeader>
                        <CardTitle>Message Content</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <pre className="whitespace-pre-wrap bg-muted p-4 rounded-md text-sm">
                            {campaign.customMessage}
                        </pre>
                    </CardContent>
                </Card>
            )}

            {/* SMS Logs */}
            <Card>
                <CardHeader>
                    <CardTitle>SMS Log (Last 100)</CardTitle>
                    <CardDescription>Individual message delivery status</CardDescription>
                </CardHeader>
                <CardContent>
                    {campaign.smsLogs?.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">No SMS logs yet</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Recipient</TableHead>
                                    <TableHead>Message Preview</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Sent At</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {campaign.smsLogs?.map((log) => (
                                    <TableRow key={log.id}>
                                        <TableCell>
                                            <p className="font-medium">{log.recipientPhone}</p>
                                            {log.recipientName && (
                                                <p className="text-sm text-muted-foreground">{log.recipientName}</p>
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-[300px]">
                                            <p className="truncate">{log.messageContent}</p>
                                            {log.errorMessage && (
                                                <p className="text-sm text-red-500 truncate">{log.errorMessage}</p>
                                            )}
                                        </TableCell>
                                        <TableCell>{renderStatusBadge(log.status)}</TableCell>
                                        <TableCell>
                                            {log.sentAt ? format(new Date(log.sentAt), 'HH:mm:ss') : '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {log.status === 'FAILED' && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleResendFailed(log.id)}
                                                >
                                                    <RefreshCw className="h-4 w-4 mr-1" />
                                                    Resend
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
