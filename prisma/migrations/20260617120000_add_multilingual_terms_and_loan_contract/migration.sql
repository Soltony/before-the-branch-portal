BEGIN TRY

BEGIN TRAN;

-- AlterTable: add per-language contract content to TermsAndConditions
ALTER TABLE [dbo].[TermsAndConditions] ADD [contentAm] NVARCHAR(max),
[contentOm] NVARCHAR(max),
[contentTi] NVARCHAR(max),
[contentSo] NVARCHAR(max),
[contentSid] NVARCHAR(max);

-- CreateTable: LoanContract
CREATE TABLE [dbo].[LoanContract] (
    [id] NVARCHAR(1000) NOT NULL,
    [farmerId] NVARCHAR(1000) NOT NULL,
    [languageCode] NVARCHAR(1000) NOT NULL,
    [contractCode] NVARCHAR(1000) NOT NULL,
    [termsId] NVARCHAR(1000),
    [contractContent] NVARCHAR(max),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [LoanContract_status_df] DEFAULT 'PENDING',
    [signedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LoanContract_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LoanContract_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LoanContract_contractCode_key] UNIQUE NONCLUSTERED ([contractCode])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LoanContract_farmerId_idx] ON [dbo].[LoanContract]([farmerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LoanContract_status_idx] ON [dbo].[LoanContract]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LoanContract_contractCode_idx] ON [dbo].[LoanContract]([contractCode]);

-- AddForeignKey
ALTER TABLE [dbo].[LoanContract] ADD CONSTRAINT [LoanContract_farmerId_fkey] FOREIGN KEY ([farmerId]) REFERENCES [dbo].[LershaFarmer]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[LoanContract] ADD CONSTRAINT [LoanContract_termsId_fkey] FOREIGN KEY ([termsId]) REFERENCES [dbo].[TermsAndConditions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
