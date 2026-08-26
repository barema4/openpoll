-- CreateEnum
CREATE TYPE "PersonalInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "gateway_wallet_id" TEXT;

-- CreateTable
CREATE TABLE "personal_invoices" (
    "id" TEXT NOT NULL,
    "issuer_id" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "secure_token" TEXT NOT NULL,
    "status" "PersonalInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_invoice_transactions" (
    "id" TEXT NOT NULL,
    "personal_invoice_id" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "payment_rail" "PaymentRail" NOT NULL,
    "amount_settled" DECIMAL(14,2) NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_invoice_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personal_invoices_secure_token_key" ON "personal_invoices"("secure_token");

-- CreateIndex
CREATE UNIQUE INDEX "personal_invoice_transactions_provider_reference_key" ON "personal_invoice_transactions"("provider_reference");

-- AddForeignKey
ALTER TABLE "personal_invoices" ADD CONSTRAINT "personal_invoices_issuer_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_invoice_transactions" ADD CONSTRAINT "personal_invoice_transactions_personal_invoice_id_fkey" FOREIGN KEY ("personal_invoice_id") REFERENCES "personal_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
