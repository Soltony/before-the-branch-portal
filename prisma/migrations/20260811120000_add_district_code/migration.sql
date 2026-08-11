BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[User] ADD [districtCode] INT;

-- AlterTable
ALTER TABLE [dbo].[LershaFarmer] ADD [districtCode] INT;

-- CreateIndex
CREATE NONCLUSTERED INDEX [LershaFarmer_districtCode_idx] ON [dbo].[LershaFarmer]([districtCode]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
