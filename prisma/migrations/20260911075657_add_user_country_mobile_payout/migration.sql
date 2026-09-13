-- AlterTable
ALTER TABLE "users" ADD COLUMN     "country" "OrganizationCountry" NOT NULL DEFAULT 'KENYA',
ADD COLUMN     "payout_mobile_number" TEXT,
ADD COLUMN     "payout_mobile_provider" TEXT;
