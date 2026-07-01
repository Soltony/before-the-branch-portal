BEGIN TRY

BEGIN TRAN;

-- AlterTable: baseline price for Lersha loan purposes (price changes are
-- measured against this, not the last changed value).
ALTER TABLE [dbo].[LershaLoanPurpose] ADD [originalUnitPrice] FLOAT(53);

-- AlterTable: English contract content for TermsAndConditions.
ALTER TABLE [dbo].[TermsAndConditions] ADD [contentEn] NVARCHAR(max);

-- Backfill existing rows: treat the current unit price as the original
-- baseline. Wrapped in EXEC so the just-added column is resolvable (SQL Server
-- compiles a batch before executing it).
EXEC('UPDATE [dbo].[LershaLoanPurpose] SET [originalUnitPrice] = [unitPrice] WHERE [originalUnitPrice] IS NULL');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
