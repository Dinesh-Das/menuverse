create table if not exists "GuestProfile" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  name text,
  phone text,
  email text,
  visit_count integer not null default 0,
  total_spend numeric(10,2) not null default 0,
  loyalty_points integer not null default 0,
  favourite_item_ids jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  notes text,
  marketing_consent boolean not null default false,
  first_visit_at timestamptz not null default now(),
  last_visit_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists guest_profile_restaurant_phone
  on "GuestProfile"(restaurant_id, phone)
  where phone is not null;

create unique index if not exists guest_profile_restaurant_email
  on "GuestProfile"(restaurant_id, email)
  where email is not null;

alter table if exists "TableSession"
  add column if not exists guest_profile_id text references "GuestProfile"(id);

alter table if exists "Order"
  add column if not exists guest_profile_id text references "GuestProfile"(id);

alter table if exists "GuestProfile" enable row level security;

drop policy if exists "guest_profile_restaurant_access" on "GuestProfile";
create policy "guest_profile_restaurant_access" on "GuestProfile"
  for all
  using (app_rls_staff_can_access("GuestProfile".restaurant_id))
  with check (app_rls_staff_can_access("GuestProfile".restaurant_id));
