-- Targeted schema change for the NIB insurance payment flow.
-- Creates only the InsuranceAccount and LershaInsurancePayment tables
-- (plus indexes and foreign keys). Pre-existing schema drift on other
-- tables is intentionally NOT included here.
BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[InsuranceAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [insuranceName] NVARCHAR(1000) NOT NULL,
    [insuranceId] NVARCHAR(1000) NOT NULL,
    [accountNumber] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [InsuranceAccount_status_df] DEFAULT 'ACTIVE',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InsuranceAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [InsuranceAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [InsuranceAccount_insuranceName_key] UNIQUE NONCLUSTERED ([insuranceName])
);

-- CreateTable
CREATE TABLE [dbo].[LershaInsurancePayment] (
    [id] NVARCHAR(1000) NOT NULL,
    [farmerId] NVARCHAR(1000) NOT NULL,
    [loanPurposeId] NVARCHAR(1000),
    [insuranceName] NVARCHAR(1000),
    [insuranceAccountId] NVARCHAR(1000),
    [insuranceId] NVARCHAR(1000),
    [creditAccount] NVARCHAR(1000),
    [insuranceAmount] FLOAT(53) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [LershaInsurancePayment_status_df] DEFAULT 'REQUESTED',
    [loanId] NVARCHAR(1000),
    [remainingBalance] FLOAT(53),
    [transactionId] NVARCHAR(1000),
    [transactionAmount] FLOAT(53),
    [rejectionReason] NVARCHAR(max),
    [approvedByUserId] NVARCHAR(1000),
    [requestPayload] NVARCHAR(max),
    [responsePayload] NVARCHAR(max),
    [lershaConfirmationSentAt] DATETIME2,
    [lershaConfirmationResponse] NVARCHAR(max),
    [requestedAt] DATETIME2 NOT NULL CONSTRAINT [LershaInsurancePayment_requestedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [confirmedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LershaInsurancePayment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LershaInsurancePayment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InsuranceAccount_status_idx] ON [dbo].[InsuranceAccount]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LershaInsurancePayment_farmerId_idx] ON [dbo].[LershaInsurancePayment]([farmerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LershaInsurancePayment_status_idx] ON [dbo].[LershaInsurancePayment]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LershaInsurancePayment_loanPurposeId_idx] ON [dbo].[LershaInsurancePayment]([loanPurposeId]);

-- AddForeignKey
ALTER TABLE [dbo].[LershaInsurancePayment] ADD CONSTRAINT [LershaInsurancePayment_farmerId_fkey] FOREIGN KEY ([farmerId]) REFERENCES [dbo].[LershaFarmer]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LershaInsurancePayment] ADD CONSTRAINT [LershaInsurancePayment_insuranceAccountId_fkey] FOREIGN KEY ([insuranceAccountId]) REFERENCES [dbo].[InsuranceAccount]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
