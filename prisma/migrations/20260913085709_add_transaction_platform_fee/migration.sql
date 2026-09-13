-- AlterTable
ALTER TABLE "personal_invoice_transactions" ADD COLUMN     "platform_fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "platform_fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
