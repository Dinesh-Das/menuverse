-- Incremental migration for AR assets, order/menu indexes, and typed staff requests.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "ARAsset" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "restaurant_id" TEXT NOT NULL,
  "menu_item_id" TEXT NOT NULL,
  "source_image_url" TEXT,
  "source_video_url" TEXT,
  "thumbnail_url" TEXT,
  "model_glb_url" TEXT,
  "model_usdz_url" TEXT,
  "preview_image_url" TEXT,
  "file_size" DOUBLE PRECISION,
  "polygon_count" INTEGER,
  "model_scale" DOUBLE PRECISION DEFAULT 1.0,
  "processing_status" TEXT NOT NULL DEFAULT 'not_uploaded',
  "processing_error" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ARAsset_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ARAsset_restaurant_id_fkey') THEN
    ALTER TABLE "ARAsset"
      ADD CONSTRAINT "ARAsset_restaurant_id_fkey"
      FOREIGN KEY ("restaurant_id") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ARAsset_menu_item_id_fkey') THEN
    ALTER TABLE "ARAsset"
      ADD CONSTRAINT "ARAsset_menu_item_id_fkey"
      FOREIGN KEY ("menu_item_id") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ARAsset_menu_item_id_key" ON "ARAsset"("menu_item_id");

ALTER TABLE "MenuItem"
  ADD COLUMN IF NOT EXISTS "has_ar_preview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ar_preview_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StaffRequest"
  ADD COLUMN IF NOT EXISTS "request_type" TEXT NOT NULL DEFAULT 'waiter',
  ADD COLUMN IF NOT EXISTS "message" TEXT;

CREATE INDEX IF NOT EXISTS "Order_restaurant_id_status_idx" ON "Order"("restaurant_id", "status");
CREATE INDEX IF NOT EXISTS "Order_table_id_idx" ON "Order"("table_id");
CREATE INDEX IF NOT EXISTS "Order_table_session_id_idx" ON "Order"("table_session_id");
CREATE INDEX IF NOT EXISTS "MenuItem_restaurant_id_display_order_idx" ON "MenuItem"("restaurant_id", "display_order");
CREATE INDEX IF NOT EXISTS "StaffRequest_restaurant_id_idx" ON "StaffRequest"("restaurant_id");
