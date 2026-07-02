BEGIN TRY

BEGIN TRAN;

-- AlterTable: JSON snapshot (profile + loan purposes) captured before the
-- first unreviewed Lersha update is applied, so reviewers can see exactly
-- which fields changed. Cleared when a reviewer approves/rejects the farmer.
ALTER TABLE [dbo].[LershaFarmer] ADD [reviewBaseline] NVARCHAR(max);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
