BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[NplCbsUploadBatch] (
    [id] NVARCHAR(1000) NOT NULL,
    [triggeredByUserId] NVARCHAR(1000),
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [NplCbsUploadBatch_source_df] DEFAULT 'MANUAL',
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [NplCbsUploadBatch_status_df] DEFAULT 'PENDING',
    [accountsSentCount] INT NOT NULL CONSTRAINT [NplCbsUploadBatch_accountsSentCount_df] DEFAULT 0,
    [totalReceived] INT,
    [insertedCount] INT,
    [alreadyExistsCount] INT,
    [httpStatus] INT,
    [errorMessage] NVARCHAR(MAX),
    [accountNumbers] NVARCHAR(MAX) NOT NULL,
    [requestPayload] NVARCHAR(MAX),
    [responsePayload] NVARCHAR(MAX),
    [startedAt] DATETIME2 NOT NULL CONSTRAINT [NplCbsUploadBatch_startedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [finishedAt] DATETIME2,
    CONSTRAINT [NplCbsUploadBatch_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NplCbsUploadBatch_status_idx] ON [dbo].[NplCbsUploadBatch]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NplCbsUploadBatch_startedAt_idx] ON [dbo].[NplCbsUploadBatch]([startedAt]);

-- CreateTable
CREATE TABLE [dbo].[NplCreditNotification] (
    [id] NVARCHAR(1000) NOT NULL,
    [externalReference] NVARCHAR(1000),
    [correlationId] NVARCHAR(1000) NOT NULL,
    [accountNumber] NVARCHAR(1000) NOT NULL,
    [creditedAmount] FLOAT(53) NOT NULL,
    [providerId] NVARCHAR(1000),
    [rawPayload] NVARCHAR(MAX) NOT NULL,
    [borrowerId] NVARCHAR(1000),
    [loanId] NVARCHAR(1000),
    [paymentId] NVARCHAR(1000),
    [processStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [NplCreditNotification_processStatus_df] DEFAULT 'PENDING',
    [resultMessage] NVARCHAR(MAX),
    [repayHttpStatus] INT,
    [repayTransactionId] NVARCHAR(1000),
    [repayDebitAmount] FLOAT(53),
    [repayDebitAccount] NVARCHAR(1000),
    [repayCreditAccount] NVARCHAR(1000),
    [repayResponse] NVARCHAR(MAX),
    [attempts] INT NOT NULL CONSTRAINT [NplCreditNotification_attempts_df] DEFAULT 0,
    [lastAttemptAt] DATETIME2,
    [receivedAt] DATETIME2 NOT NULL CONSTRAINT [NplCreditNotification_receivedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NplCreditNotification_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [NplCreditNotification_externalReference_key] UNIQUE NONCLUSTERED ([externalReference]),
    CONSTRAINT [NplCreditNotification_correlationId_key] UNIQUE NONCLUSTERED ([correlationId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NplCreditNotification_accountNumber_idx] ON [dbo].[NplCreditNotification]([accountNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NplCreditNotification_processStatus_idx] ON [dbo].[NplCreditNotification]([processStatus]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NplCreditNotification_receivedAt_idx] ON [dbo].[NplCreditNotification]([receivedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NplCreditNotification_loanId_idx] ON [dbo].[NplCreditNotification]([loanId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
