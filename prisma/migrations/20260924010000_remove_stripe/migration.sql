-- AlterEnum
BEGIN;
CREATE TYPE "PaymentGateway_new" AS ENUM ('PAYSTACK', 'PAWAPAY');
ALTER TABLE "public"."transactions" ALTER COLUMN "gateway" DROP DEFAULT;
ALTER TABLE "transactions" ALTER COLUMN "gateway" TYPE "PaymentGateway_new" USING ("gateway"::text::"PaymentGateway_new");
ALTER TYPE "PaymentGateway" RENAME TO "PaymentGateway_old";
ALTER TYPE "PaymentGateway_new" RENAME TO "PaymentGateway";
DROP TYPE "public"."PaymentGateway_old";
ALTER TABLE "transactions" ALTER COLUMN "gateway" SET DEFAULT 'PAYSTACK';
COMMIT;

-- DropIndex
DROP INDEX "organizations_stripe_customer_id_key";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "agency_plan_expires_at",
DROP COLUMN "stripe_connect_account_id",
DROP COLUMN "stripe_connect_payouts_enabled",
DROP COLUMN "stripe_customer_id",
ADD COLUMN     "has_agency_plan" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "stripe_connect_account_id",
DROP COLUMN "stripe_connect_payouts_enabled";
