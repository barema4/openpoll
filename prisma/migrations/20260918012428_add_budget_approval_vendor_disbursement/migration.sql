-- CreateEnum
CREATE TYPE "BudgetApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'DECLINED', 'FUNDED');

-- CreateEnum
CREATE TYPE "VendorPayoutMethod" AS ENUM ('BANK_ACCOUNT', 'MOBILE_MONEY');

-- AlterTable
ALTER TABLE "budget_categories" ADD COLUMN     "vendor_id" TEXT;

-- AlterTable
ALTER TABLE "disbursements" ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "recipient_mobile_number" TEXT,
ADD COLUMN     "recipient_mobile_provider" TEXT,
ADD COLUMN     "vendor_id" TEXT,
ALTER COLUMN "recipient_account_number" DROP NOT NULL;

-- CreateTable
CREATE TABLE "budget_approvals" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "status" "BudgetApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_by_user_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "funded_by_user_id" TEXT,
    "funded_at" TIMESTAMP(3),

    CONSTRAINT "budget_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payout_method" "VendorPayoutMethod" NOT NULL,
    "payout_bank_code" TEXT,
    "payout_bank_name" TEXT,
    "payout_account_number" TEXT,
    "payout_account_name" TEXT,
    "payout_account_last4" TEXT,
    "payout_mobile_provider" TEXT,
    "payout_mobile_number" TEXT,
    "payout_mobile_number_last4" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_approvals_event_id_key" ON "budget_approvals"("event_id");

-- AddForeignKey
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_approvals" ADD CONSTRAINT "budget_approvals_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
