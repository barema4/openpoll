-- Organizations.country: OrganizationCountry enum -> free-form ISO-3166-1
-- alpha-2 country code (see src/config/supported-countries.ts). Existing
-- values are remapped, not dropped.
ALTER TABLE "organizations" ALTER COLUMN "country" DROP DEFAULT;
ALTER TABLE "organizations" ALTER COLUMN "country" TYPE TEXT USING (
  CASE "country"::text
    WHEN 'KENYA' THEN 'KE'
    WHEN 'UGANDA' THEN 'UG'
    ELSE "country"::text
  END
);
ALTER TABLE "organizations" ALTER COLUMN "country" SET DEFAULT 'KE';

-- Users.country: same conversion.
ALTER TABLE "users" ALTER COLUMN "country" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "country" TYPE TEXT USING (
  CASE "country"::text
    WHEN 'KENYA' THEN 'KE'
    WHEN 'UGANDA' THEN 'UG'
    ELSE "country"::text
  END
);
ALTER TABLE "users" ALTER COLUMN "country" SET DEFAULT 'KE';

-- Explicit currency, backfilled from each row's resolved country rather
-- than left implicit — Event/PersonalInvoice pick it up from their
-- organization/issuer, Invoice/Transaction inherit it from their event.
ALTER TABLE "events" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES';
UPDATE "events" e SET "currency" = CASE o."country" WHEN 'UG' THEN 'UGX' ELSE 'KES' END
FROM "organizations" o WHERE e."organization_id" = o."id";

ALTER TABLE "invoices" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES';
UPDATE "invoices" i SET "currency" = e."currency"
FROM "events" e WHERE i."event_id" = e."id";

ALTER TABLE "transactions" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES';
UPDATE "transactions" t SET "currency" = e."currency"
FROM "events" e WHERE t."event_id" = e."id";

ALTER TABLE "personal_invoices" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES';
UPDATE "personal_invoices" pi SET "currency" = CASE u."country" WHEN 'UG' THEN 'UGX' ELSE 'KES' END
FROM "users" u WHERE pi."issuer_id" = u."id";

DROP TYPE "OrganizationCountry";
