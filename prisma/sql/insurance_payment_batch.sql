-- Adds batchId to LershaInsurancePayment to group all payments created from a
-- single /api/v1/nib/insuranceRequest call. Existing rows are backfilled to
-- their own id so each legacy request appears as its own single-farmer batch.
BEGIN TRY

BEGIN TRAN;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.LershaInsurancePayment') AND name = 'batchId'
)
BEGIN
  ALTER TABLE [dbo].[LershaInsurancePayment] ADD [batchId] NVARCHAR(1000);
END;

EXEC('UPDATE [dbo].[LershaInsurancePayment] SET [batchId] = [id] WHERE [batchId] IS NULL');

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'LershaInsurancePayment_batchId_idx'
    AND object_id = OBJECT_ID('dbo.LershaInsurancePayment')
)
BEGIN
  CREATE NONCLUSTERED INDEX [LershaInsurancePayment_batchId_idx]
    ON [dbo].[LershaInsurancePayment]([batchId]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
