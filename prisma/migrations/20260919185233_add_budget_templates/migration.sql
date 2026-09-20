-- CreateTable
CREATE TABLE "budget_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_template_items" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,4),
    "fixed_amount" DECIMAL(14,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "budget_template_items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "budget_templates" ADD CONSTRAINT "budget_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_template_items" ADD CONSTRAINT "budget_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "budget_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
