-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('PAYSTACK', 'PAWAPAY', 'STRIPE');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "gateway" "PaymentGateway" NOT NULL DEFAULT 'PAYSTACK';

-- Backfill: country and gateway were 1:1 for every transaction that exists
-- before this migration (PawaPay was Uganda-only, Stripe only reachable via
-- the 44 non-Kenya/Uganda SUPPORTED_COUNTRIES entries) — this is the one
-- safe window to derive `gateway` from the currency actually charged, since
-- after this migration a provider cutover (or the Stripe diaspora fallback)
-- can make a transaction's currency/gateway diverge from what its
-- organization's country implies today. Every other currency already
-- defaulted to PAYSTACK above (Kenya, the only PAYSTACK-shaped country).
UPDATE "transactions" SET "gateway" = 'PAWAPAY' WHERE "currency" = 'UGX';
UPDATE "transactions" SET "gateway" = 'STRIPE' WHERE "currency" NOT IN ('KES', 'UGX');
