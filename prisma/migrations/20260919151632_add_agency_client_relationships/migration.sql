-- AlterEnum
ALTER TYPE "OrganizationType" ADD VALUE 'EVENT_COMPANY';

-- CreateTable
CREATE TABLE "agency_client_links" (
    "id" TEXT NOT NULL,
    "agency_organization_id" TEXT NOT NULL,
    "client_organization_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_client_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_client_access" (
    "id" TEXT NOT NULL,
    "agency_organization_id" TEXT NOT NULL,
    "client_organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "granted_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_client_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_client_links_client_organization_id_key" ON "agency_client_links"("client_organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_client_access_user_id_client_organization_id_key" ON "agency_client_access"("user_id", "client_organization_id");

-- AddForeignKey
ALTER TABLE "agency_client_links" ADD CONSTRAINT "agency_client_links_agency_organization_id_fkey" FOREIGN KEY ("agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_client_links" ADD CONSTRAINT "agency_client_links_client_organization_id_fkey" FOREIGN KEY ("client_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_client_access" ADD CONSTRAINT "agency_client_access_agency_organization_id_fkey" FOREIGN KEY ("agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_client_access" ADD CONSTRAINT "agency_client_access_client_organization_id_fkey" FOREIGN KEY ("client_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_client_access" ADD CONSTRAINT "agency_client_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
