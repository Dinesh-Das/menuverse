create extension if not exists pgcrypto;

create table if not exists "OrderFeedback" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  order_id text not null unique references "Order"(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists "StaffRequest" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  table_id text not null references "Table"(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
