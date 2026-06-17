
'use client';

import React, { useState, useEffect } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, MoreHorizontal, FileText, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { LoanApplication, UploadedDocument } from '@/lib/types';
import { format } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePermissions } from '@/hooks/use-permissions';

const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ETB';
};

const DocumentViewerDialog = ({ application, isOpen, onClose }: { application: LoanApplication | null; isOpen: boolean; onClose: () => void }) => {
    if (!application) return null;
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Documents for {application.borrowerName}</DialogTitle>
                    <DialogDescription>Application ID: {application.id}</DialogDescription>
                </DialogHeader>
                <div className="mt-4 max-h-[60vh] overflow-y-auto space-y-3 p-1">
                    {application.uploadedDocuments.map((doc: UploadedDocument) => (
                         <a
                            key={doc.id}
                            href={doc.fileContent}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-3 border rounded-md hover:bg-muted transition-colors"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <FileText className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">{doc.requiredDocument?.name}</p>
                                        <p className="text-sm text-muted-foreground">{doc.fileName}</p>
                                    </div>
                                </div>
                                <Badge variant="secondary">{doc.fileType}</Badge>
                            </div>
                        </a>
                    ))}
                    {application.uploadedDocuments.length === 0 && (
                        <p className="text-center text-muted-foreground py-8">No documents were uploaded for this application.</p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

const RejectionDialog = ({ isOpen, onClose, onConfirm, isUpdating, readOnly }: { isOpen: boolean; onClose: () => void; onConfirm: (reason: string) => void; isUpdating: boolean; readOnly?: boolean; }) => {
    const [reason, setReason] = useState('');

    const handleConfirm = () => {
        if (readOnly) return;
        if (reason.trim()) {
            onConfirm(reason);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Request Revision</DialogTitle>
                    <DialogDescription>Please provide a reason for requesting revisions. This will be shown to the borrower.</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Label htmlFor="rejectionReason" className="sr-only">Reason for Revision</Label>
                    <Textarea
                        id="rejectionReason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="e.g., 'The uploaded ID is blurry. Please upload a clearer copy.'..."
                        disabled={!!readOnly}
                    />
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleConfirm} disabled={!!readOnly || !reason.trim() || isUpdating} variant="destructive">
                        {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Request Revision
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


export default function ApplicationsPage() {
    useRequirePermission('approvals');
    const [applications, setApplications] = useState<LoanApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    const { toast } = useToast();
    const { canModule } = usePermissions();
    const canUpdateApplications = canModule('applications', 'update');
    
    type ActionType = 'approve' | 'reject' | 'view';
    const [actionState, setActionState] = useState<{ type: ActionType; application: LoanApplication | null }>({ type: 'view', application: null });

    const fetchApplications = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/admin/applications');
            if (!response.ok) {
                throw new Error('Failed to fetch applications.');
            }
            const data = await response.json();
            setApplications(data);
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

    useEffect(() => {
        fetchApplications();
    }, []);
    
    const handleStatusUpdate = async (revisionReason?: string) => {
        if (!actionState.application) return;
        if (!canUpdateApplications) {
            toast({ title: 'Not authorized', description: 'You are not authorized to update applications.', variant: 'destructive' });
            return;
        }

        setIsUpdating(true);
        const { id, borrowerName } = actionState.application;
        const newStatus = actionState.type === 'approve' ? 'APPROVED' : 'NEEDS_REVISION';
        const successMessage = `Application for ${borrowerName} has been ${newStatus.toLowerCase() === 'approved' ? 'approved and disbursed' : 'sent back for revision'}.`;
        
        const body = {
            applicationId: id,
            status: newStatus,
            ...(revisionReason && { rejectionReason: revisionReason })
        };

        try {
            const response = await fetch('/api/admin/applications', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update status.');
            }
            
            toast({
                title: 'Success',
                description: successMessage,
            });
            
            // Refresh list
            fetchApplications();
        } catch (error: any) {
             toast({
                title: 'Error',
                description: error.message,
                variant: 'destructive',
            });
        } finally {
            setIsUpdating(false);
            setActionState({ type: 'view', application: null }); // Close all dialogs
        }
    };

    return (
        <>
            <div className="flex-1 space-y-4 p-8 pt-6">
                <h2 className="text-3xl font-bold tracking-tight">Loan Applications</h2>
                <p className="text-muted-foreground">
                    Review and process SME loan applications pending approval.
                </p>

                <Card>
                    <CardHeader>
                        <CardTitle>Pending Review</CardTitle>
                        <CardDescription>The following applications have all documents uploaded and are ready for a decision.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date Submitted</TableHead>
                                    <TableHead>Borrower</TableHead>
                                    <TableHead>Product</TableHead>
                                    <TableHead>Provider</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-24 text-center">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto"/>
                                        </TableCell>
                                    </TableRow>
                                ) : applications.length > 0 ? (
                                    applications.map((app) => (
                                        <TableRow key={app.id}>
                                            <TableCell>{format(new Date(app.updatedAt), 'yyyy-MM-dd')}</TableCell>
                                            <TableCell>{app.borrowerName}</TableCell>
                                            <TableCell>{app.product.name}</TableCell>
                                            <TableCell>{app.product.provider.name}</TableCell>
                                            <TableCell className="text-right font-mono">{formatCurrency(app.loanAmount)}</TableCell>
                                            <TableCell>
                                                <Badge variant="secondary">{app.status.replace('_', ' ')}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" className="h-8 w-8 p-0">
                                                            <span className="sr-only">Open menu</span>
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem onClick={() => setActionState({ type: 'view', application: app })}>
                                                            <FileText className="mr-2 h-4 w-4"/>
                                                            View Documents
                                                        </DropdownMenuItem>
                                                        {canUpdateApplications && (
                                                            <>
                                                                <DropdownMenuItem onClick={() => setActionState({ type: 'approve', application: app })}>
                                                                    <CheckCircle className="mr-2 h-4 w-4 text-green-600"/>
                                                                    Approve
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem className="text-red-600" onClick={() => setActionState({ type: 'reject', application: app })}>
                                                                    <XCircle className="mr-2 h-4 w-4"/>
                                                                    Request Revision
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-24 text-center">
                                            No applications are currently pending review.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
            
            <DocumentViewerDialog
                isOpen={actionState.type === 'view'}
                onClose={() => setActionState({ type: 'view', application: null })}
                application={actionState.application}
            />

            <AlertDialog open={actionState.type === 'approve'} onOpenChange={(open) => !open && setActionState({ type: 'view', application: null })}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You are about to approve and automatically disburse the loan for <span className="font-bold">{actionState.application?.borrowerName}</span>. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={() => handleStatusUpdate()} 
                            disabled={isUpdating || !canUpdateApplications}
                        >
                            {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                            Confirm Approval
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

             <RejectionDialog
                isOpen={actionState.type === 'reject'}
                onClose={() => setActionState({ type: 'view', application: null })}
                onConfirm={handleStatusUpdate}
                isUpdating={isUpdating}
                     readOnly={!canUpdateApplications}
            />
        </>
    );
}
