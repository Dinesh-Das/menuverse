create table if not exists "ARAsset" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  menu_item_id text not null unique references "MenuItem"(id) on delete cascade,
  source_image_url text,
  source_video_url text,
  thumbnail_url text,
  model_glb_url text,
  model_usdz_url text,
  preview_image_url text,
  file_size double precision,
  polygon_count integer,
  model_scale double precision default 1.0,
  processing_status text not null default 'not_uploaded',
  processing_error text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists "MenuItem"
  add column if not exists has_ar_preview boolean not null default false,
  add column if not exists ar_preview_enabled boolean not null default false;

alter table if exists "StaffRequest"
  add column if not exists request_type text not null default 'waiter',
  add column if not exists message text;

create index if not exists order_restaurant_status_idx on "Order"(restaurant_id, status);
create index if not exists order_table_idx on "Order"(table_id);
create index if not exists order_table_session_idx on "Order"(table_session_id);
create index if not exists menuitem_restaurant_display_order_idx on "MenuItem"(restaurant_id, display_order);
create index if not exists staffrequest_restaurant_idx on "StaffRequest"(restaurant_id);
