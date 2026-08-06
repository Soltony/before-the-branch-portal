BEGIN TRY

BEGIN TRAN;

-- AlterTable: the borrower's own bank account, credited for every disbursement
-- made to this farmer (agri-input loans and insurance). Lersha sends no account
-- at registration, so the approver selects one from the accounts the core
-- banking system holds against the farmer's phone number at approval time.
ALTER TABLE [dbo].[LershaFarmer] ADD
    [disbursementAccountNo] NVARCHAR(1000),
    [disbursementAccountName] NVARCHAR(1000),
    [disbursementAccountSelectedAt] DATETIME2,
    [disbursementAccountSelectedBy] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
