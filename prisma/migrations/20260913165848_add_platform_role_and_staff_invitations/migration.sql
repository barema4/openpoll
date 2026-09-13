-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "PlatformStaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "platform_role" "PlatformRole";

-- CreateTable
CREATE TABLE "platform_staff_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "PlatformStaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_staff_invitations_token_hash_key" ON "platform_staff_invitations"("token_hash");

-- AddForeignKey
ALTER TABLE "platform_staff_invitations" ADD CONSTRAINT "platform_staff_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
