-- CreateTable
CREATE TABLE "platform_payout_destinations" (
    "country_code" TEXT NOT NULL,
    "payout_mobile_provider" TEXT NOT NULL,
    "payout_mobile_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_payout_destinations_pkey" PRIMARY KEY ("country_code")
);

-- CreateTable
CREATE TABLE "platform_withdrawals" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "provider_reference" TEXT,
    "requested_by_user_id" TEXT NOT NULL,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "platform_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_withdrawals_provider_reference_key" ON "platform_withdrawals"("provider_reference");

-- AddForeignKey
ALTER TABLE "platform_withdrawals" ADD CONSTRAINT "platform_withdrawals_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
