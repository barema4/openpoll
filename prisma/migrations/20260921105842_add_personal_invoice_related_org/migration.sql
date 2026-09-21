-- AlterTable
ALTER TABLE "personal_invoices" ADD COLUMN     "related_organization_id" TEXT;

-- AddForeignKey
ALTER TABLE "personal_invoices" ADD CONSTRAINT "personal_invoices_related_organization_id_fkey" FOREIGN KEY ("related_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
