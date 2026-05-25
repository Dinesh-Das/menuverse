create extension if not exists pgcrypto;

create table if not exists "ARAsset" (
  "id" text not null default gen_random_uuid()::text,
  "restaurant_id" text not null,
  "menu_item_id" text not null,
  "source_image_url" text,
  "source_video_url" text,
  "thumbnail_url" text,
  "model_glb_url" text,
  "model_usdz_url" text,
  "preview_image_url" text,
  "file_size" double precision,
  "polygon_count" integer,
  "model_scale" double precision default 1.0,
  "processing_status" text not null default 'not_uploaded',
  "processing_error" text,
  "is_active" boolean not null default false,
  "created_at" timestamp(3) not null default current_timestamp,
  "updated_at" timestamp(3) not null default current_timestamp,
  constraint "ARAsset_pkey" primary key ("id")
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ARAsset_restaurant_id_fkey') then
    alter table "ARAsset"
      add constraint "ARAsset_restaurant_id_fkey"
      foreign key ("restaurant_id") references "Restaurant"("id") on delete restrict on update cascade;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ARAsset_menu_item_id_fkey') then
    alter table "ARAsset"
      add constraint "ARAsset_menu_item_id_fkey"
      foreign key ("menu_item_id") references "MenuItem"("id") on delete restrict on update cascade;
  end if;
end $$;

create unique index if not exists "ARAsset_menu_item_id_key" on "ARAsset"("menu_item_id");

alter table if exists "MenuItem"
  add column if not exists has_ar_preview boolean not null default false,
  add column if not exists ar_preview_enabled boolean not null default false;

alter table if exists "StaffRequest"
  add column if not exists request_type text not null default 'waiter',
  add column if not exists message text;

create index if not exists "Order_restaurant_id_status_idx" on "Order"("restaurant_id", "status");
create index if not exists "Order_table_id_idx" on "Order"("table_id");
create index if not exists "Order_table_session_id_idx" on "Order"("table_session_id");
create index if not exists "MenuItem_restaurant_id_display_order_idx" on "MenuItem"("restaurant_id", "display_order");
create index if not exists "StaffRequest_restaurant_id_idx" on "StaffRequest"("restaurant_id");
