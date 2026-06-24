BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[PriceChangeControl] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [PriceChangeControl_id_df] DEFAULT 'global',
    [thresholdPercent] FLOAT(53) NOT NULL CONSTRAINT [PriceChangeControl_thresholdPercent_df] DEFAULT 10,
    [updatedById] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PriceChangeControl_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PriceChangeControl_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PriceChangeControl_updatedById_idx] ON [dbo].[PriceChangeControl]([updatedById]);

-- AddForeignKey
ALTER TABLE [dbo].[PriceChangeControl] ADD CONSTRAINT [PriceChangeControl_updatedById_fkey] FOREIGN KEY ([updatedById]) REFERENCES [dbo].[User]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
