BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(1000) NOT NULL,
    [fullName] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [phoneNumber] NVARCHAR(1000) NOT NULL,
    [password] NVARCHAR(1000) NOT NULL,
    [passwordChangeRequired] BIT NOT NULL CONSTRAINT [User_passwordChangeRequired_df] DEFAULT 1,
    [status] NVARCHAR(1000) NOT NULL,
    [roleId] NVARCHAR(1000) NOT NULL,
    [loanProviderId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email]),
    CONSTRAINT [User_phoneNumber_key] UNIQUE NONCLUSTERED ([phoneNumber])
);

-- CreateTable
CREATE TABLE [dbo].[Role] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [permissions] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Role_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Role_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [refreshToken] NVARCHAR(1000) NOT NULL,
    [jti] NVARCHAR(1000),
    [revoked] BIT NOT NULL CONSTRAINT [Session_revoked_df] DEFAULT 0,
    [expiresAt] DATETIME2 NOT NULL,
    [lastActivity] DATETIME2 NOT NULL CONSTRAINT [Session_lastActivity_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Session_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Session_refreshToken_key] UNIQUE NONCLUSTERED ([refreshToken])
);

-- CreateTable
CREATE TABLE [dbo].[DisbursementControl] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [DisbursementControl_id_df] DEFAULT 'global',
    [enabled] BIT NOT NULL CONSTRAINT [DisbursementControl_enabled_df] DEFAULT 1,
    [updatedById] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DisbursementControl_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [DisbursementControl_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[LoanProvider] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [icon] TEXT NOT NULL,
    [colorHex] NVARCHAR(1000) NOT NULL,
    [displayOrder] INT NOT NULL,
    [accountNumber] NVARCHAR(1000),
    [collectionAccount] NVARCHAR(1000),
    [startingCapital] FLOAT(53) NOT NULL,
    [initialBalance] FLOAT(53) NOT NULL,
    [allowCrossProviderLoans] BIT NOT NULL CONSTRAINT [LoanProvider_allowCrossProviderLoans_df] DEFAULT 0,
    [nplThresholdDays] INT NOT NULL CONSTRAINT [LoanProvider_nplThresholdDays_df] DEFAULT 60,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [LoanProvider_status_df] DEFAULT 'ACTIVE',
    CONSTRAINT [LoanProvider_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LoanProvider_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[ProviderDistribution] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [externalProviderId] NVARCHAR(1000),
    [distributionDate] DATETIME2 NOT NULL,
    [interestAmount] FLOAT(53) NOT NULL CONSTRAINT [ProviderDistribution_interestAmount_df] DEFAULT 0,
    [serviceFeeAmount] FLOAT(53) NOT NULL CONSTRAINT [ProviderDistribution_serviceFeeAmount_df] DEFAULT 0,
    [penaltyAmount] FLOAT(53) NOT NULL CONSTRAINT [ProviderDistribution_penaltyAmount_df] DEFAULT 0,
    [taxAmount] FLOAT(53) NOT NULL CONSTRAINT [ProviderDistribution_taxAmount_df] DEFAULT 0,
    [totalDistributedAmount] FLOAT(53) NOT NULL CONSTRAINT [ProviderDistribution_totalDistributedAmount_df] DEFAULT 0,
    [distributionReference] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ProviderDistribution_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ProviderDistribution_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ProviderDistribution_providerId_distributionDate_key] UNIQUE NONCLUSTERED ([providerId],[distributionDate])
);

-- CreateTable
CREATE TABLE [dbo].[LoanProduct] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000) NOT NULL,
    [icon] TEXT NOT NULL,
    [minLoan] FLOAT(53),
    [maxLoan] FLOAT(53),
    [isSalaryAdvance] BIT NOT NULL CONSTRAINT [LoanProduct_isSalaryAdvance_df] DEFAULT 0,
    [advancePercent] INT,
    [salaryAdvanceMappings] NVARCHAR(max),
    [duration] INT NOT NULL,
    [installments] INT,
    [repaymentIntervalDays] INT,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [LoanProduct_status_df] DEFAULT 'Active',
    [allowConcurrentLoans] BIT NOT NULL CONSTRAINT [LoanProduct_allowConcurrentLoans_df] DEFAULT 0,
    [serviceFee] NVARCHAR(1000) NOT NULL,
    [serviceFeeEnabled] BIT,
    [dailyFee] NVARCHAR(1000) NOT NULL,
    [dailyFeeEnabled] BIT,
    [penaltyRules] NVARCHAR(1000) NOT NULL,
    [penaltyRulesEnabled] BIT,
    [penaltyPerInstallment] BIT CONSTRAINT [LoanProduct_penaltyPerInstallment_df] DEFAULT 0,
    [dataProvisioningEnabled] BIT,
    [dataProvisioningConfigId] NVARCHAR(1000),
    [eligibilityFilter] TEXT,
    [eligibilityUploadId] NVARCHAR(1000),
    CONSTRAINT [LoanProduct_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LoanProduct_name_providerId_key] UNIQUE NONCLUSTERED ([name],[providerId])
);

-- CreateTable
CREATE TABLE [dbo].[LoanCycleConfig] (
    [id] NVARCHAR(1000) NOT NULL,
    [productId] NVARCHAR(1000) NOT NULL,
    [metric] NVARCHAR(1000) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [LoanCycleConfig_enabled_df] DEFAULT 1,
    [cycleRanges] NVARCHAR(max),
    [grades] NVARCHAR(max),
    [cycles] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LoanCycleConfig_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LoanCycleConfig_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LoanCycleConfig_productId_key] UNIQUE NONCLUSTERED ([productId])
);

-- CreateTable
CREATE TABLE [dbo].[Loan] (
    [id] NVARCHAR(1000) NOT NULL,
    [borrowerId] NVARCHAR(1000) NOT NULL,
    [productId] NVARCHAR(1000) NOT NULL,
    [loanApplicationId] NVARCHAR(1000) NOT NULL,
    [loanAmount] FLOAT(53) NOT NULL,
    [serviceFee] FLOAT(53) NOT NULL,
    [penaltyAmount] FLOAT(53) NOT NULL,
    [disbursedDate] DATETIME2 NOT NULL,
    [dueDate] DATETIME2 NOT NULL,
    [repaymentStatus] NVARCHAR(1000) NOT NULL,
    [repaymentBehavior] NVARCHAR(1000),
    [repaidAmount] FLOAT(53),
    [interestAccruedAmount] FLOAT(53) NOT NULL CONSTRAINT [Loan_interestAccruedAmount_df] DEFAULT 0,
    [interestAccruedThroughDate] DATETIME2,
    [penaltyAccruedAmount] FLOAT(53) NOT NULL CONSTRAINT [Loan_penaltyAccruedAmount_df] DEFAULT 0,
    [penaltyAccruedThroughDate] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Loan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Loan_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Loan_loanApplicationId_key] UNIQUE NONCLUSTERED ([loanApplicationId])
);

-- CreateTable
CREATE TABLE [dbo].[Payment] (
    [id] NVARCHAR(1000) NOT NULL,
    [loanId] NVARCHAR(1000) NOT NULL,
    [installmentId] NVARCHAR(1000),
    [amount] FLOAT(53) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [outstandingBalanceBeforePayment] FLOAT(53),
    [journalEntryId] NVARCHAR(1000),
    CONSTRAINT [Payment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Payment_journalEntryId_key] UNIQUE NONCLUSTERED ([journalEntryId])
);

-- CreateTable
CREATE TABLE [dbo].[LoanInstallment] (
    [id] NVARCHAR(1000) NOT NULL,
    [loanId] NVARCHAR(1000) NOT NULL,
    [installmentNumber] INT NOT NULL,
    [dueDate] DATETIME2 NOT NULL,
    [amount] FLOAT(53) NOT NULL,
    [paidAmount] FLOAT(53) CONSTRAINT [LoanInstallment_paidAmount_df] DEFAULT 0,
    [paidAt] DATETIME2,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [LoanInstallment_status_df] DEFAULT 'PENDING',
    [penaltyAmount] FLOAT(53) NOT NULL CONSTRAINT [LoanInstallment_penaltyAmount_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [LoanInstallment_isActive_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LoanInstallment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LoanInstallment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Borrower] (
    [id] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Borrower_status_df] DEFAULT 'Active',
    CONSTRAINT [Borrower_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[LoanApplication] (
    [id] NVARCHAR(1000) NOT NULL,
    [borrowerId] NVARCHAR(1000) NOT NULL,
    [productId] NVARCHAR(1000) NOT NULL,
    [loanAmount] FLOAT(53),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [LoanApplication_status_df] DEFAULT 'PENDING_DOCUMENTS',
    [rejectionReason] TEXT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LoanApplication_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LoanApplication_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[RequiredDocument] (
    [id] NVARCHAR(1000) NOT NULL,
    [productId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    CONSTRAINT [RequiredDocument_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[UploadedDocument] (
    [id] NVARCHAR(1000) NOT NULL,
    [loanApplicationId] NVARCHAR(1000) NOT NULL,
    [requiredDocumentId] NVARCHAR(1000) NOT NULL,
    [fileName] NVARCHAR(1000) NOT NULL,
    [fileType] NVARCHAR(1000) NOT NULL,
    [fileContent] TEXT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [UploadedDocument_status_df] DEFAULT 'PENDING',
    [reviewedBy] NVARCHAR(1000),
    [reviewedAt] DATETIME2,
    CONSTRAINT [UploadedDocument_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UploadedDocument_loanApplicationId_requiredDocumentId_key] UNIQUE NONCLUSTERED ([loanApplicationId],[requiredDocumentId])
);

-- CreateTable
CREATE TABLE [dbo].[DataProvisioningConfig] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [columns] NVARCHAR(max) NOT NULL,
    CONSTRAINT [DataProvisioningConfig_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DataProvisioningUpload] (
    [id] NVARCHAR(1000) NOT NULL,
    [configId] NVARCHAR(1000) NOT NULL,
    [fileName] NVARCHAR(1000) NOT NULL,
    [rowCount] INT NOT NULL,
    [uploadedBy] NVARCHAR(1000) NOT NULL,
    [uploadedAt] DATETIME2 NOT NULL CONSTRAINT [DataProvisioningUpload_uploadedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DataProvisioningUpload_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ProvisionedData] (
    [id] NVARCHAR(1000) NOT NULL,
    [borrowerId] NVARCHAR(1000) NOT NULL,
    [configId] NVARCHAR(1000) NOT NULL,
    [uploadId] NVARCHAR(1000),
    [data] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ProvisionedData_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ProvisionedData_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ProvisionedData_borrowerId_configId_uploadId_key] UNIQUE NONCLUSTERED ([borrowerId],[configId],[uploadId])
);

-- CreateTable
CREATE TABLE [dbo].[ScoringParameter] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [weight] INT NOT NULL,
    CONSTRAINT [ScoringParameter_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Rule] (
    [id] NVARCHAR(1000) NOT NULL,
    [parameterId] NVARCHAR(1000) NOT NULL,
    [field] NVARCHAR(1000) NOT NULL,
    [condition] NVARCHAR(1000) NOT NULL,
    [value] NVARCHAR(1000) NOT NULL,
    [score] INT NOT NULL,
    CONSTRAINT [Rule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[LoanAmountTier] (
    [id] NVARCHAR(1000) NOT NULL,
    [productId] NVARCHAR(1000) NOT NULL,
    [fromScore] INT NOT NULL,
    [toScore] INT NOT NULL,
    [loanAmount] FLOAT(53) NOT NULL,
    CONSTRAINT [LoanAmountTier_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ScoringConfigurationHistory] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [parameters] NVARCHAR(max) NOT NULL,
    [savedAt] DATETIME2 NOT NULL CONSTRAINT [ScoringConfigurationHistory_savedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ScoringConfigurationHistory_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ScoringConfigurationProduct] (
    [id] NVARCHAR(1000) NOT NULL,
    [configId] NVARCHAR(1000) NOT NULL,
    [productId] NVARCHAR(1000) NOT NULL,
    [assignedAt] DATETIME2 NOT NULL CONSTRAINT [ScoringConfigurationProduct_assignedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [assignedBy] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [ScoringConfigurationProduct_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ScoringConfigurationProduct_configId_productId_key] UNIQUE NONCLUSTERED ([configId],[productId])
);

-- CreateTable
CREATE TABLE [dbo].[LedgerAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000) NOT NULL,
    [balance] FLOAT(53) NOT NULL CONSTRAINT [LedgerAccount_balance_df] DEFAULT 0,
    CONSTRAINT [LedgerAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LedgerAccount_providerId_name_key] UNIQUE NONCLUSTERED ([providerId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[JournalEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [loanId] NVARCHAR(1000),
    [date] DATETIME2 NOT NULL,
    [description] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [JournalEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[LedgerEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [journalEntryId] NVARCHAR(1000) NOT NULL,
    [ledgerAccountId] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [amount] FLOAT(53) NOT NULL,
    CONSTRAINT [LedgerEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TermsAndConditions] (
    [id] NVARCHAR(1000) NOT NULL,
    [providerId] NVARCHAR(1000) NOT NULL,
    [content] TEXT NOT NULL,
    [version] INT NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [TermsAndConditions_isActive_df] DEFAULT 0,
    [publishedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TermsAndConditions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TermsAndConditions_providerId_version_key] UNIQUE NONCLUSTERED ([providerId],[version])
);

-- CreateTable
CREATE TABLE [dbo].[BorrowerAgreement] (
    [id] NVARCHAR(1000) NOT NULL,
    [borrowerId] NVARCHAR(1000) NOT NULL,
    [termsId] NVARCHAR(1000) NOT NULL,
    [acceptedAt] DATETIME2 NOT NULL CONSTRAINT [BorrowerAgreement_acceptedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BorrowerAgreement_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BorrowerAgreement_borrowerId_termsId_key] UNIQUE NONCLUSTERED ([borrowerId],[termsId])
);

-- CreateTable
CREATE TABLE [dbo].[Tax] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000),
    [rate] FLOAT(53) NOT NULL CONSTRAINT [Tax_rate_df] DEFAULT 0,
    [appliedTo] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Tax_status_df] DEFAULT 'ACTIVE',
    CONSTRAINT [Tax_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [actorId] NVARCHAR(1000) NOT NULL,
    [action] NVARCHAR(1000) NOT NULL,
    [entity] NVARCHAR(1000),
    [entityId] NVARCHAR(1000),
    [details] TEXT,
    [ipAddress] NVARCHAR(1000),
    [userAgent] TEXT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PendingChange] (
    [id] NVARCHAR(1000) NOT NULL,
    [entityType] NVARCHAR(1000) NOT NULL,
    [entityId] NVARCHAR(1000),
    [changeType] NVARCHAR(1000) NOT NULL,
    [payload] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PendingChange_status_df] DEFAULT 'PENDING',
    [createdById] NVARCHAR(1000) NOT NULL,
    [approvedById] NVARCHAR(1000),
    [approvedAt] DATETIME2,
    [rejectionReason] TEXT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PendingChange_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PendingChange_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PendingPayment] (
    [id] NVARCHAR(1000) NOT NULL,
    [transactionId] NVARCHAR(1000) NOT NULL,
    [loanId] NVARCHAR(1000) NOT NULL,
    [borrowerId] NVARCHAR(1000) NOT NULL,
    [amount] FLOAT(53) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PendingPayment_status_df] DEFAULT 'PENDING',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PendingPayment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PendingPayment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PendingPayment_transactionId_key] UNIQUE NONCLUSTERED ([transactionId])
);

-- CreateTable
CREATE TABLE [dbo].[PaymentTransaction] (
    [id] NVARCHAR(1000) NOT NULL,
    [transactionId] NVARCHAR(1000) NOT NULL,
    [txnRef] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL,
    [payload] NVARCHAR(max) NOT NULL,
    [receivedAt] DATETIME2 NOT NULL CONSTRAINT [PaymentTransaction_receivedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PaymentTransaction_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PaymentTransaction_transactionId_key] UNIQUE NONCLUSTERED ([transactionId])
);

-- CreateTable
CREATE TABLE [dbo].[DisbursementTransaction] (
    [id] NVARCHAR(1000) NOT NULL,
    [transactionId] NVARCHAR(1000),
    [providerId] NVARCHAR(1000) NOT NULL,
    [originalProviderId] NVARCHAR(1000),
    [creditAccount] NVARCHAR(1000) NOT NULL,
    [amount] FLOAT(53),
    [requestPayload] NVARCHAR(max) NOT NULL,
    [responsePayload] NVARCHAR(max),
    [rawResponse] NVARCHAR(max),
    [statusCode] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DisbursementTransaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DisbursementTransaction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PhoneAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [phoneNumber] NVARCHAR(1000) NOT NULL,
    [accountNumber] NVARCHAR(1000) NOT NULL,
    [customerName] NVARCHAR(1000),
    [isActive] BIT NOT NULL CONSTRAINT [PhoneAccount_isActive_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PhoneAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PhoneAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PhoneAccount_phoneNumber_accountNumber_key] UNIQUE NONCLUSTERED ([phoneNumber],[accountNumber])
);

-- CreateTable
CREATE TABLE [dbo].[AccountStatement] (
    [id] NVARCHAR(1000) NOT NULL,
    [borrowerId] NVARCHAR(1000) NOT NULL,
    [accountNumber] NVARCHAR(1000) NOT NULL,
    [customerName] NVARCHAR(1000),
    [currency] NVARCHAR(1000),
    [openingBalance] NVARCHAR(1000),
    [closingBalance] NVARCHAR(1000),
    [startDate] NVARCHAR(1000),
    [endDate] NVARCHAR(1000),
    [raw] NVARCHAR(max) NOT NULL,
    [fetchedAt] DATETIME2 NOT NULL CONSTRAINT [AccountStatement_fetchedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AccountStatement_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AccountStatement_borrowerId_accountNumber_startDate_endDate_key] UNIQUE NONCLUSTERED ([borrowerId],[accountNumber],[startDate],[endDate])
);

-- CreateTable
CREATE TABLE [dbo].[AccountStatementLine] (
    [id] NVARCHAR(1000) NOT NULL,
    [statementId] NVARCHAR(1000) NOT NULL,
    [bookDate] NVARCHAR(1000),
    [reference] NVARCHAR(1000),
    [description] NVARCHAR(1000),
    [narrative] NVARCHAR(1000),
    [valueDate] NVARCHAR(1000),
    [debit] FLOAT(53),
    [credit] FLOAT(53),
    [closingBalance] FLOAT(53),
    CONSTRAINT [AccountStatementLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AccountStatementMetrics] (
    [id] NVARCHAR(1000) NOT NULL,
    [borrowerId] NVARCHAR(1000) NOT NULL,
    [accountNumber] NVARCHAR(1000) NOT NULL,
    [periodStart] NVARCHAR(1000) NOT NULL,
    [periodEnd] NVARCHAR(1000) NOT NULL,
    [monthsAtEbirr] INT,
    [txCountRelevant] INT,
    [billPaymentsCount] INT,
    [avgMonthlyDeposit] FLOAT(53),
    [avgUniqueDepositSources] FLOAT(53),
    [avgMonthlyAirtimeCount] FLOAT(53),
    [avgMonthlyAirtimeValue] FLOAT(53),
    [withdrawalToDepositRatio] FLOAT(53),
    [avgBalance] FLOAT(53),
    [derived] NVARCHAR(max) NOT NULL,
    [computedAt] DATETIME2 NOT NULL CONSTRAINT [AccountStatementMetrics_computedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AccountStatementMetrics_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AccountStatementMetrics_borrowerId_accountNumber_periodStart_periodEnd_key] UNIQUE NONCLUSTERED ([borrowerId],[accountNumber],[periodStart],[periodEnd])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_userId_idx] ON [dbo].[Session]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_jti_idx] ON [dbo].[Session]([jti]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DisbursementControl_updatedById_idx] ON [dbo].[DisbursementControl]([updatedById]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProviderDistribution_distributionDate_idx] ON [dbo].[ProviderDistribution]([distributionDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LoanInstallment_loanId_idx] ON [dbo].[LoanInstallment]([loanId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LoanInstallment_dueDate_idx] ON [dbo].[LoanInstallment]([dueDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_actorId_idx] ON [dbo].[AuditLog]([actorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_action_idx] ON [dbo].[AuditLog]([action]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_entity_entityId_idx] ON [dbo].[AuditLog]([entity], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PendingChange_status_idx] ON [dbo].[PendingChange]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PendingChange_entityType_idx] ON [dbo].[PendingChange]([entityType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DisbursementTransaction_providerId_idx] ON [dbo].[DisbursementTransaction]([providerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DisbursementTransaction_transactionId_idx] ON [dbo].[DisbursementTransaction]([transactionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PhoneAccount_phoneNumber_idx] ON [dbo].[PhoneAccount]([phoneNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountStatement_borrowerId_idx] ON [dbo].[AccountStatement]([borrowerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountStatement_accountNumber_idx] ON [dbo].[AccountStatement]([accountNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountStatementMetrics_borrowerId_idx] ON [dbo].[AccountStatementMetrics]([borrowerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountStatementMetrics_accountNumber_idx] ON [dbo].[AccountStatementMetrics]([accountNumber]);

-- AddForeignKey
ALTER TABLE [dbo].[User] ADD CONSTRAINT [User_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[User] ADD CONSTRAINT [User_loanProviderId_fkey] FOREIGN KEY ([loanProviderId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Session] ADD CONSTRAINT [Session_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DisbursementControl] ADD CONSTRAINT [DisbursementControl_updatedById_fkey] FOREIGN KEY ([updatedById]) REFERENCES [dbo].[User]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProviderDistribution] ADD CONSTRAINT [ProviderDistribution_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[LoanProduct] ADD CONSTRAINT [LoanProduct_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LoanProduct] ADD CONSTRAINT [LoanProduct_dataProvisioningConfigId_fkey] FOREIGN KEY ([dataProvisioningConfigId]) REFERENCES [dbo].[DataProvisioningConfig]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LoanProduct] ADD CONSTRAINT [LoanProduct_eligibilityUploadId_fkey] FOREIGN KEY ([eligibilityUploadId]) REFERENCES [dbo].[DataProvisioningUpload]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LoanCycleConfig] ADD CONSTRAINT [LoanCycleConfig_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[LoanProduct]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Loan] ADD CONSTRAINT [Loan_borrowerId_fkey] FOREIGN KEY ([borrowerId]) REFERENCES [dbo].[Borrower]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Loan] ADD CONSTRAINT [Loan_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[LoanProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Loan] ADD CONSTRAINT [Loan_loanApplicationId_fkey] FOREIGN KEY ([loanApplicationId]) REFERENCES [dbo].[LoanApplication]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Payment] ADD CONSTRAINT [Payment_loanId_fkey] FOREIGN KEY ([loanId]) REFERENCES [dbo].[Loan]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Payment] ADD CONSTRAINT [Payment_installmentId_fkey] FOREIGN KEY ([installmentId]) REFERENCES [dbo].[LoanInstallment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Payment] ADD CONSTRAINT [Payment_journalEntryId_fkey] FOREIGN KEY ([journalEntryId]) REFERENCES [dbo].[JournalEntry]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LoanInstallment] ADD CONSTRAINT [LoanInstallment_loanId_fkey] FOREIGN KEY ([loanId]) REFERENCES [dbo].[Loan]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[LoanApplication] ADD CONSTRAINT [LoanApplication_borrowerId_fkey] FOREIGN KEY ([borrowerId]) REFERENCES [dbo].[Borrower]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[LoanApplication] ADD CONSTRAINT [LoanApplication_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[LoanProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RequiredDocument] ADD CONSTRAINT [RequiredDocument_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[LoanProduct]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UploadedDocument] ADD CONSTRAINT [UploadedDocument_loanApplicationId_fkey] FOREIGN KEY ([loanApplicationId]) REFERENCES [dbo].[LoanApplication]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UploadedDocument] ADD CONSTRAINT [UploadedDocument_requiredDocumentId_fkey] FOREIGN KEY ([requiredDocumentId]) REFERENCES [dbo].[RequiredDocument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DataProvisioningConfig] ADD CONSTRAINT [DataProvisioningConfig_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DataProvisioningUpload] ADD CONSTRAINT [DataProvisioningUpload_configId_fkey] FOREIGN KEY ([configId]) REFERENCES [dbo].[DataProvisioningConfig]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProvisionedData] ADD CONSTRAINT [ProvisionedData_borrowerId_fkey] FOREIGN KEY ([borrowerId]) REFERENCES [dbo].[Borrower]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ProvisionedData] ADD CONSTRAINT [ProvisionedData_configId_fkey] FOREIGN KEY ([configId]) REFERENCES [dbo].[DataProvisioningConfig]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProvisionedData] ADD CONSTRAINT [ProvisionedData_uploadId_fkey] FOREIGN KEY ([uploadId]) REFERENCES [dbo].[DataProvisioningUpload]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ScoringParameter] ADD CONSTRAINT [ScoringParameter_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Rule] ADD CONSTRAINT [Rule_parameterId_fkey] FOREIGN KEY ([parameterId]) REFERENCES [dbo].[ScoringParameter]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[LoanAmountTier] ADD CONSTRAINT [LoanAmountTier_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[LoanProduct]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScoringConfigurationHistory] ADD CONSTRAINT [ScoringConfigurationHistory_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScoringConfigurationProduct] ADD CONSTRAINT [ScoringConfigurationProduct_configId_fkey] FOREIGN KEY ([configId]) REFERENCES [dbo].[ScoringConfigurationHistory]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScoringConfigurationProduct] ADD CONSTRAINT [ScoringConfigurationProduct_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[LoanProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerAccount] ADD CONSTRAINT [LedgerAccount_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[JournalEntry] ADD CONSTRAINT [JournalEntry_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[JournalEntry] ADD CONSTRAINT [JournalEntry_loanId_fkey] FOREIGN KEY ([loanId]) REFERENCES [dbo].[Loan]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_journalEntryId_fkey] FOREIGN KEY ([journalEntryId]) REFERENCES [dbo].[JournalEntry]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_ledgerAccountId_fkey] FOREIGN KEY ([ledgerAccountId]) REFERENCES [dbo].[LedgerAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TermsAndConditions] ADD CONSTRAINT [TermsAndConditions_providerId_fkey] FOREIGN KEY ([providerId]) REFERENCES [dbo].[LoanProvider]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BorrowerAgreement] ADD CONSTRAINT [BorrowerAgreement_borrowerId_fkey] FOREIGN KEY ([borrowerId]) REFERENCES [dbo].[Borrower]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BorrowerAgreement] ADD CONSTRAINT [BorrowerAgreement_termsId_fkey] FOREIGN KEY ([termsId]) REFERENCES [dbo].[TermsAndConditions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PendingChange] ADD CONSTRAINT [PendingChange_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PendingChange] ADD CONSTRAINT [PendingChange_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PendingPayment] ADD CONSTRAINT [PendingPayment_loanId_fkey] FOREIGN KEY ([loanId]) REFERENCES [dbo].[Loan]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PendingPayment] ADD CONSTRAINT [PendingPayment_borrowerId_fkey] FOREIGN KEY ([borrowerId]) REFERENCES [dbo].[Borrower]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountStatement] ADD CONSTRAINT [AccountStatement_borrowerId_fkey] FOREIGN KEY ([borrowerId]) REFERENCES [dbo].[Borrower]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AccountStatementLine] ADD CONSTRAINT [AccountStatementLine_statementId_fkey] FOREIGN KEY ([statementId]) REFERENCES [dbo].[AccountStatement]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AccountStatementMetrics] ADD CONSTRAINT [AccountStatementMetrics_borrowerId_fkey] FOREIGN KEY ([borrowerId]) REFERENCES [dbo].[Borrower]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
