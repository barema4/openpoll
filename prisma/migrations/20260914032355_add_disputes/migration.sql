-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('AWAITING_MERCHANT_FEEDBACK', 'AWAITING_BANK_FEEDBACK', 'PENDING', 'RESOLVED');

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "provider_reference" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disputes_provider_reference_key" ON "disputes"("provider_reference");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
