BEGIN TRY

BEGIN TRAN;

-- SQL Server's UNIQUE constraint permits only a SINGLE NULL row, so every loan
-- request after the first fails with P2002 because referenceNo is NULL until it
-- is assigned later (in OtpConfirmation). Replace the plain unique constraint
-- with a filtered unique index that enforces uniqueness only for non-null
-- referenceNo values, allowing many in-flight requests with NULL referenceNo.
ALTER TABLE [dbo].[LershaLoanRequest] DROP CONSTRAINT [LershaLoanRequest_referenceNo_key];

CREATE UNIQUE NONCLUSTERED INDEX [LershaLoanRequest_referenceNo_key]
  ON [dbo].[LershaLoanRequest]([referenceNo])
  WHERE [referenceNo] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
