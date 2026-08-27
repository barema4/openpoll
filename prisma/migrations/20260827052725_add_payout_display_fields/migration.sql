-- AlterTable
ALTER TABLE "events" ADD COLUMN     "payout_account_last4" TEXT,
ADD COLUMN     "payout_account_name" TEXT,
ADD COLUMN     "payout_bank_name" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "payout_account_last4" TEXT,
ADD COLUMN     "payout_account_name" TEXT,
ADD COLUMN     "payout_bank_name" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "payout_account_last4" TEXT,
ADD COLUMN     "payout_account_name" TEXT,
ADD COLUMN     "payout_bank_name" TEXT;
