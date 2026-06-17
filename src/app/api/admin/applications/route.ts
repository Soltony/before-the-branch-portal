

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { z } from 'zod';
import { createAuditLog } from '@/lib/audit-log';
import { getUserFromSession } from '@/lib/user';
import { loanCreationSchema } from '@/lib/schemas';
import { addDays } from 'date-fns';
import { areDisbursementsEnabled } from '@/lib/disbursement-control';

// This is an internal helper function and should not be exported from the route file.
// It is moved here because it's only used by this route.
async function handleSmeLoan(data: z.infer<typeof loanCreationSchema>) {
    return await prisma.$transaction(async (tx) => {
        // Update application status to APPROVED first
        await tx.loanApplication.update({
            where: { id: data.loanApplicationId },
            data: { status: 'APPROVED' },
        });

        const [product, taxConfigs] = await Promise.all([
            tx.loanProduct.findUnique({
                where: { id: data.productId },
                include: {
                    provider: {
                        include: {
                            ledgerAccounts: true
                        }
                    }
                }
            }),
            tx.tax.findMany()
        ]);

        if (!product) {
            throw new Error('Loan product not found.');
        }
        
        if (product.provider.initialBalance < data.loanAmount) {
            throw new Error(`Insufficient provider funds. Available: ${product.provider.initialBalance}, Requested: ${data.loanAmount}`);
        }

        const provider = product.provider;
        
        // Use a temporary loan object for calculation purposes.
        const tempLoanForCalc = {
            id: 'temp',
            loanAmount: data.loanAmount,
            disbursedDate: new Date(data.disbursedDate),
            dueDate: new Date(data.dueDate),
            serviceFee: 0,
            repaymentStatus: 'Unpaid' as 'Unpaid' | 'Paid',
            payments: [],
            productName: product.name,
            providerName: product.provider.name,
            repaidAmount: 0,
            penaltyAmount: 0,
            product: product as any,
        };
        // This import is needed for calculation
        const { calculateTotalRepayable } = require('@/lib/loan-calculator');
        const { serviceFee: calculatedServiceFee, tax: calculatedTax } = calculateTotalRepayable(
            tempLoanForCalc,
            product,
            taxConfigs,
            new Date(data.disbursedDate)
        );

        const principalReceivableAccount = provider.ledgerAccounts.find((acc: any) => acc.category === 'Principal' && acc.type === 'Receivable');
        const serviceFeeReceivableAccount = provider.ledgerAccounts.find((acc: any) => acc.category === 'ServiceFee' && acc.type === 'Receivable');
        const taxReceivableAccount = provider.ledgerAccounts.find((acc: any) => acc.category === 'Tax' && acc.type === 'Receivable');
        if (!principalReceivableAccount) throw new Error('Principal Receivable ledger account not found.');
        if (calculatedServiceFee > 0 && !serviceFeeReceivableAccount) throw new Error('Service Fee Receivable ledger account not found.');
        if (calculatedTax > 0 && !taxReceivableAccount) throw new Error('Tax Receivable ledger account not found.');


        const createdLoan = await tx.loan.create({
            data: {
                borrowerId: data.borrowerId,
                productId: data.productId,
                loanApplicationId: data.loanApplicationId!,
                loanAmount: data.loanAmount,
                disbursedDate: data.disbursedDate,
                dueDate: data.dueDate,
                serviceFee: calculatedServiceFee,
                penaltyAmount: 0,
                repaymentStatus: 'Unpaid',
                repaidAmount: 0,
            }
        });

        // Finally, update the application to DISBURSED
        await tx.loanApplication.update({
            where: { id: data.loanApplicationId },
            data: { status: 'DISBURSED' },
        });
        
        const journalEntry = await tx.journalEntry.create({
            data: {
                providerId: provider.id,
                loanId: createdLoan.id,
                date: new Date(data.disbursedDate),
                description: `Loan disbursement for ${product.name} to borrower ${data.borrowerId}`,
            }
        });
        
        await tx.ledgerEntry.createMany({
            data: [{
                journalEntryId: journalEntry.id,
                ledgerAccountId: principalReceivableAccount.id,
                type: 'Debit',
                amount: data.loanAmount
            }]
        });
        
        if (calculatedServiceFee > 0 && serviceFeeReceivableAccount) {
            await tx.ledgerEntry.createMany({
                data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceivableAccount.id, type: 'Debit', amount: calculatedServiceFee },
                ]
            });
            await tx.ledgerAccount.update({ where: { id: serviceFeeReceivableAccount.id }, data: { balance: { increment: calculatedServiceFee } } });
        }

        if (calculatedTax > 0.000001 && taxReceivableAccount) {
            await tx.ledgerEntry.createMany({
                data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: taxReceivableAccount.id, type: 'Debit', amount: calculatedTax }
                ]
            });
            await tx.ledgerAccount.update({ where: { id: taxReceivableAccount.id }, data: { balance: { increment: calculatedTax } } });
        }

        await tx.ledgerAccount.update({ where: { id: principalReceivableAccount.id }, data: { balance: { increment: data.loanAmount } } });
        await tx.loanProvider.update({ where: { id: provider.id }, data: { initialBalance: { decrement: data.loanAmount } } });
        
        return createdLoan;
    });
}


// GET all applications pending review
export async function GET(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['applications']?.read) {
        return NextResponse.json({ error: 'Not authenticated or insufficient permissions' }, { status: 401 });
    }

    try {
        const whereClause: any = {
            status: 'PENDING_REVIEW'
        };

        // Horizontal access control: Non-super-admins can only see applications for their own provider
        if (user.role !== 'Super Admin' && user.loanProviderId) {
            whereClause.product = {
                providerId: user.loanProviderId
            };
        }

        const applications = await prisma.loanApplication.findMany({
            where: whereClause,
            include: {
                product: {
                    include: {
                        provider: true,
                    }
                },
                borrower: {
                   include: {
                        provisionedData: {
                            orderBy: {
                                createdAt: 'desc'
                            },
                            take: 1
                        }
                    }
                },
                uploadedDocuments: {
                    include: {
                        requiredDocument: true,
                    }
                },
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        // Add borrower name to application
        const applicationsWithBorrowerName = applications.map(app => {
            let borrowerName = `B-${app.borrowerId.slice(0, 8)}`;
            if (app.borrower.provisionedData.length > 0) {
                 try {
                    const data = JSON.parse(app.borrower.provisionedData[0].data as string);
                    const nameKey = Object.keys(data).find(k => k.toLowerCase() === 'fullname' || k.toLowerCase() === 'full name' || k.toLowerCase() === 'customername');
                    if (nameKey) {
                        borrowerName = data[nameKey];
                    }
                } catch(e) { /* ignore */}
            }
            return {
                ...app,
                borrowerName
            }
        });
        

        return NextResponse.json(applicationsWithBorrowerName);

    } catch (error) {
        console.error('Error fetching applications for review:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

const updateStatusSchema = z.object({
  applicationId: z.string(),
  status: z.enum(['APPROVED', 'NEEDS_REVISION']),
  rejectionReason: z.string().optional(),
});

// PUT to update an application's status
export async function PUT(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['applications']?.update) {
        return NextResponse.json({ error: 'Not authenticated or insufficient permissions' }, { status: 401 });
    }
    
    try {
        const body = await req.json();
        const { applicationId, status, rejectionReason } = updateStatusSchema.parse(body);
        
        const application = await prisma.loanApplication.findUnique({
            where: { id: applicationId },
            include: { product: true }
        });

        if (!application) {
            return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
        }
        
        // Horizontal access control: check if the user is allowed to modify this application
        if (user.role !== 'Super Admin' && user.loanProviderId !== application.product.providerId) {
            return NextResponse.json({ error: 'You do not have permission to modify this application.' }, { status: 403 });
        }

        if (application.status !== 'PENDING_REVIEW') {
             return NextResponse.json({ error: `Application is not pending review. Current status: ${application.status}` }, { status: 409 });
        }

        if (status === 'APPROVED') {

            const enabled = await areDisbursementsEnabled();
            if (!enabled) {
                return NextResponse.json({ error: 'Disbursements are currently disabled.' }, { status: 503 });
            }
            
            const disbursementDate = new Date();
            const loanData = {
                borrowerId: application.borrowerId,
                productId: application.productId,
                loanApplicationId: application.id,
                loanAmount: application.loanAmount!,
                disbursedDate: disbursementDate.toISOString(),
                dueDate: addDays(disbursedDate, application.product.duration || 30).toISOString(),
            };

            const newLoan = await handleSmeLoan(loanData);
            
            await createAuditLog({
                actorId: user.id,
                action: 'LOAN_APPLICATION_APPROVED',
                entity: 'LOAN_APPLICATION',
                entityId: applicationId,
                details: { borrowerId: application.borrowerId, loanId: newLoan.id }
            });
            
            return NextResponse.json(newLoan);

        } else if (status === 'NEEDS_REVISION') {
            if (!rejectionReason) {
                return NextResponse.json({ error: 'A reason is required to request revisions.' }, { status: 400 });
            }
            const updatedApplication = await prisma.loanApplication.update({
                where: { id: applicationId },
                data: { 
                    status: 'NEEDS_REVISION',
                    rejectionReason: rejectionReason,
                }
            });

            await createAuditLog({
                actorId: user.id,
                action: 'LOAN_APPLICATION_REVISION_REQUESTED',
                entity: 'LOAN_APPLICATION',
                entityId: applicationId,
                details: { borrowerId: updatedApplication.borrowerId, reason: rejectionReason }
            });

            return NextResponse.json(updatedApplication);
        }

        return NextResponse.json({ error: 'Invalid status provided.' }, { status: 400 });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error('Error updating application status:', error);
        const errorMessage = (error as Error).message || 'Internal Server Error';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
