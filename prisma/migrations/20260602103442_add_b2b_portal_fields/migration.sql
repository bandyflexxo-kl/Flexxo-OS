-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN     "default_margin_pct" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "catalog_description" TEXT,
ADD COLUMN     "default_margin_pct" DECIMAL(6,2),
ADD COLUMN     "google_drive_photo_id" TEXT,
ADD COLUMN     "is_visible_to_customers" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "customer_company_id" TEXT;

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_customer_company_id_fkey" FOREIGN KEY ("customer_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
