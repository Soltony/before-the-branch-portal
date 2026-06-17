
'use client';

import React, { useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveAs } from 'file-saver';

export default function DataExportPage() {
    useRequirePermission('reports');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const handleDownload = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/borrowers/export');
            if (!response.ok) {
                throw new Error('Failed to download file.');
            }
            const blob = await response.blob();
            saveAs(blob, 'borrower_data.xlsx');
            
            toast({
                title: 'Download Started',
                description: 'Your file is being downloaded.',
            });
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Could not download the file.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <h2 className="text-3xl font-bold tracking-tight">Data Export</h2>
            <Card>
                <CardHeader>
                    <CardTitle>Export Borrower Data</CardTitle>
                    <CardDescription>
                        Click the button below to download the sample borrower data as an Excel file.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        This will generate an Excel (`.xlsx`) file containing the predefined list of borrower profiles.
                    </p>
                </CardContent>
                <CardFooter>
                    <Button onClick={handleDownload} disabled={isLoading}>
                        {isLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Download className="mr-2 h-4 w-4" />
                        )}
                        Download Excel File
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
