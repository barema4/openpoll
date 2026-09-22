-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "agency_plan_expires_at" TIMESTAMP(3),
ADD COLUMN     "stripe_customer_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripe_customer_id_key" ON "organizations"("stripe_customer_id");
