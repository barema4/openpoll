-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('ORGANIZER', 'PUBLIC_PLEDGE');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "source" "InvoiceSource" NOT NULL DEFAULT 'ORGANIZER';
