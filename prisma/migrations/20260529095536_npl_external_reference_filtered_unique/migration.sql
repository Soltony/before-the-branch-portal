BEGIN TRY

BEGIN TRAN;

-- SQL Server's plain UNIQUE constraint treats NULLs as equal, so it only
-- permits a single row with NULL externalReference. Credit notifications
-- that arrive without an external reference (the common case) would then
-- collide on the second insert. Replace the constraint with a filtered
-- unique index that only enforces uniqueness for non-NULL values.

-- DropConstraint
ALTER TABLE [dbo].[NplCreditNotification] DROP CONSTRAINT [NplCreditNotification_externalReference_key];

-- CreateIndex (filtered unique: ignores NULLs)
CREATE UNIQUE NONCLUSTERED INDEX [NplCreditNotification_externalReference_key]
    ON [dbo].[NplCreditNotification]([externalReference])
    WHERE [externalReference] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
