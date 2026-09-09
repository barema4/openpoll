-- Event.budgetingEnabled: opt-in toggle, off by default.
ALTER TABLE "events" ADD COLUMN "budgeting_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Any event that already has budget categories was already using this
-- feature under the old always-on model — keep it visible for them.
UPDATE "events"
SET "budgeting_enabled" = true
WHERE "id" IN (SELECT DISTINCT "event_id" FROM "budget_categories");

-- Allocation: move from transaction-linked to event-pool-linked.
ALTER TABLE "allocations" ADD COLUMN "event_id" TEXT;
ALTER TABLE "allocations" ADD COLUMN "allocated_by_user_id" TEXT;

-- Backfill event_id from the transaction each existing allocation pointed at.
UPDATE "allocations" AS a
SET "event_id" = t."event_id"
FROM "transactions" AS t
WHERE a."transaction_id" = t."id";

ALTER TABLE "allocations" ALTER COLUMN "event_id" SET NOT NULL;

ALTER TABLE "allocations" DROP CONSTRAINT "allocations_transaction_id_fkey";
ALTER TABLE "allocations" DROP COLUMN "transaction_id";

ALTER TABLE "allocations" ADD CONSTRAINT "allocations_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "allocations" ADD CONSTRAINT "allocations_allocated_by_user_id_fkey"
  FOREIGN KEY ("allocated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
