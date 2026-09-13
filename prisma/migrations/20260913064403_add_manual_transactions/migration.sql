-- AlterEnum
ALTER TYPE "PaymentRail" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "note" TEXT,
ADD COLUMN     "recorded_by_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
