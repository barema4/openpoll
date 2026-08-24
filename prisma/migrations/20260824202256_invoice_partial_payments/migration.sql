-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIALLY_PAID';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0;
