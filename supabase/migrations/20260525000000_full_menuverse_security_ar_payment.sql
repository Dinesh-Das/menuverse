-- Consolidated Menuverse Supabase migration.
-- Use this as the one-file version of the security, table-session, payment,
-- staff-request, feedback, public-menu, AR, index, and RLS changes from this chat.
-- It assumes the original Menuverse base tables already exist:
-- Restaurant, User, Table, MenuCategory, MenuItem, ModifierGroup,
-- ModifierOption, Order, OrderItem, and Payment.

create extension if not exists pgcrypto;

do $$
declare
  missing_tables text[];
begin
  select array_agg(table_name)
    into missing_tables
  from unnest(array[
    'Restaurant',
    'User',
    'Table',
    'MenuCategory',
    'MenuItem',
    'ModifierGroup',
    'ModifierOption',
    'Order',
    'OrderItem',
    'Payment'
  ]) as required(table_name)
  where to_regclass(format('public.%I', table_name)) is null;

  if missing_tables is not null then
    raise exception 'Menuverse base tables are missing: %', array_to_string(missing_tables, ', ');
  end if;
end $$;

-- Additive schema changes.
alter table "Restaurant"
  add column if not exists "gst_rate" numeric not null default 0.05,
  add column if not exists "service_charge_rate" numeric not null default 0,
  add column if not exists "payment_provider" text default 'razorpay',
  add column if not exists "payment_enabled" boolean not null default false;

alter table "Table"
  add column if not exists "qr_enabled" boolean not null default true,
  add column if not exists "open_session_join_enabled" boolean not null default false;

create table if not exists "TableSession" (
  "id" text primary key default gen_random_uuid()::text,
  "restaurant_id" text not null references "Restaurant"("id") on delete cascade,
  "table_id" text not null references "Table"("id") on delete cascade,
  "token" text not null unique default gen_random_uuid()::text,
  "status" text not null default 'active' check ("status" in ('active', 'billing', 'paid', 'closed')),
  "opened_at" timestamptz not null default now(),
  "closed_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

alter table "TableSession"
  add column if not exists "restaurant_id" text,
  add column if not exists "table_id" text,
  add column if not exists "token" text,
  add column if not exists "status" text not null default 'active',
  add column if not exists "opened_at" timestamptz not null default now(),
  add column if not exists "closed_at" timestamptz,
  add column if not exists "created_at" timestamptz not null default now(),
  add column if not exists "updated_at" timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'TableSession_restaurant_id_fkey') then
    alter table "TableSession"
      add constraint "TableSession_restaurant_id_fkey"
      foreign key ("restaurant_id") references "Restaurant"("id") on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'TableSession_table_id_fkey') then
    alter table "TableSession"
      add constraint "TableSession_table_id_fkey"
      foreign key ("table_id") references "Table"("id") on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'TableSession_token_key') then
    alter table "TableSession"
      add constraint "TableSession_token_key" unique ("token");
  end if;
end $$;

create unique index if not exists "table_session_one_active_per_table"
  on "TableSession"("restaurant_id", "table_id")
  where "status" in ('active', 'billing');

create table if not exists "SessionBill" (
  "id" text primary key default gen_random_uuid()::text,
  "table_session_id" text not null unique references "TableSession"("id") on delete cascade,
  "subtotal" numeric(12,2) not null default 0,
  "tax_amount" numeric(12,2) not null default 0,
  "service_charge" numeric(12,2) not null default 0,
  "discount_amount" numeric(12,2) not null default 0,
  "total_amount" numeric(12,2) not null default 0,
  "payment_status" text not null default 'unpaid' check ("payment_status" in ('unpaid', 'partially_paid', 'paid', 'refunded')),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists "OrderFeedback" (
  "id" text primary key default gen_random_uuid()::text,
  "restaurant_id" text not null references "Restaurant"("id") on delete cascade,
  "order_id" text not null unique references "Order"("id") on delete cascade,
  "rating" integer not null check ("rating" between 1 and 5),
  "comment" text,
  "created_at" timestamptz not null default now()
);

create table if not exists "StaffRequest" (
  "id" text primary key default gen_random_uuid()::text,
  "restaurant_id" text not null references "Restaurant"("id") on delete cascade,
  "table_id" text not null references "Table"("id") on delete cascade,
  "request_type" text not null default 'waiter',
  "message" text,
  "status" text not null default 'pending' check ("status" in ('pending', 'resolved')),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

alter table "StaffRequest"
  add column if not exists "request_type" text not null default 'waiter',
  add column if not exists "message" text;

alter table "Order"
  add column if not exists "table_session_id" text,
  add column if not exists "subtotal_amount" numeric(12,2) not null default 0,
  add column if not exists "tax_amount" numeric(12,2) not null default 0,
  add column if not exists "service_charge_amount" numeric(12,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'Order_table_session_id_fkey') then
    alter table "Order"
      add constraint "Order_table_session_id_fkey"
      foreign key ("table_session_id") references "TableSession"("id") on delete set null;
  end if;
end $$;

alter table "Payment"
  add column if not exists "razorpay_payment_id" text,
  add column if not exists "status" text not null default 'initiated',
  add column if not exists "amount" numeric(12,2) not null default 0,
  add column if not exists "updated_at" timestamptz not null default now();

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

  if not exists (select 1 from pg_constraint where conname = 'ARAsset_menu_item_id_fkey') then
    alter table "ARAsset"
      add constraint "ARAsset_menu_item_id_fkey"
      foreign key ("menu_item_id") references "MenuItem"("id") on delete restrict on update cascade;
  end if;
end $$;

alter table "MenuItem"
  add column if not exists "has_ar_preview" boolean not null default false,
  add column if not exists "ar_preview_enabled" boolean not null default false;

create unique index if not exists "ARAsset_menu_item_id_key" on "ARAsset"("menu_item_id");
create unique index if not exists "Payment_order_id_key" on "Payment"("order_id");
create unique index if not exists "Order_idempotency_key_key" on "Order"("idempotency_key") where "idempotency_key" is not null;
create index if not exists "Order_restaurant_id_status_idx" on "Order"("restaurant_id", "status");
create index if not exists "Order_table_id_idx" on "Order"("table_id");
create index if not exists "Order_table_session_id_idx" on "Order"("table_session_id");
create index if not exists "MenuItem_restaurant_id_display_order_idx" on "MenuItem"("restaurant_id", "display_order");
create index if not exists "StaffRequest_restaurant_id_idx" on "StaffRequest"("restaurant_id");

-- Auth helpers.
create or replace function app_jwt_restaurant_id()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt()->>'restaurantId',
    auth.jwt()->'app_metadata'->>'restaurantId',
    auth.jwt()->'user_metadata'->>'restaurantId'
  );
$$;

create or replace function app_jwt_app_role()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt()->>'role',
    auth.jwt()->'app_metadata'->>'role',
    auth.jwt()->'user_metadata'->>'role'
  );
$$;

create or replace function app_staff_can_access(p_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or (
      app_jwt_restaurant_id() = p_restaurant_id
      and app_jwt_app_role() in ('owner', 'manager', 'staff')
    )
    or exists (
      select 1
      from "User" u
      where u.id = auth.uid()::text
        and u.restaurant_id = p_restaurant_id
        and u.role in ('owner', 'manager', 'staff')
    );
$$;

create or replace function app_admin_can_access(p_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or (
      app_jwt_restaurant_id() = p_restaurant_id
      and app_jwt_app_role() in ('owner', 'manager')
    )
    or exists (
      select 1
      from "User" u
      where u.id = auth.uid()::text
        and u.restaurant_id = p_restaurant_id
        and u.role in ('owner', 'manager')
    );
$$;

create or replace function app_rls_staff_can_access(p_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_staff_can_access(p_restaurant_id);
$$;

-- Billing and customer RPCs.
create or replace function refresh_session_bill(p_table_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(12,2);
  v_tax numeric(12,2);
  v_service numeric(12,2);
  v_total numeric(12,2);
begin
  select
    coalesce(sum(o.subtotal_amount), 0)::numeric(12,2),
    coalesce(sum(o.tax_amount), 0)::numeric(12,2),
    coalesce(sum(o.service_charge_amount), 0)::numeric(12,2),
    coalesce(sum(o.total_amount), 0)::numeric(12,2)
    into v_subtotal, v_tax, v_service, v_total
  from "Order" o
  where o.table_session_id = p_table_session_id
    and o.status <> 'cancelled';

  insert into "SessionBill" ("table_session_id", "subtotal", "tax_amount", "service_charge", "total_amount")
  values (p_table_session_id, v_subtotal, v_tax, v_service, v_total)
  on conflict ("table_session_id") do update set
    "subtotal" = excluded."subtotal",
    "tax_amount" = excluded."tax_amount",
    "service_charge" = excluded."service_charge",
    "total_amount" = excluded."total_amount",
    "updated_at" = now();
end;
$$;

create or replace function create_order_secure(
  p_restaurant_id text,
  p_table_id text,
  p_table_session_token text default null,
  p_items jsonb default '[]'::jsonb,
  p_special_instructions text default null,
  p_idempotency_key text default null
)
returns table(order_ref text, status text, total_amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table "Table"%rowtype;
  v_restaurant "Restaurant"%rowtype;
  v_session "TableSession"%rowtype;
  v_existing_order "Order"%rowtype;
  v_order_id text;
  v_item jsonb;
  v_menu_item "MenuItem"%rowtype;
  v_quantity integer;
  v_mod_ids text[];
  v_mod_count integer;
  v_valid_mod_count integer;
  v_mods jsonb := '[]'::jsonb;
  v_mod_total numeric(12,2) := 0;
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_tax_amount numeric(12,2) := 0;
  v_service_amount numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_pending_count integer;
begin
  select * into v_table
  from "Table"
  where "Table"."id" = p_table_id
    and "Table"."restaurant_id" = p_restaurant_id;

  if v_table.id is null then
    raise exception 'Invalid table for this restaurant.';
  end if;

  select * into v_restaurant
  from "Restaurant"
  where "Restaurant"."id" = p_restaurant_id;

  if v_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  if p_table_session_token is not null then
    select * into v_session
    from "TableSession"
    where "TableSession"."token" = p_table_session_token
      and "TableSession"."restaurant_id" = p_restaurant_id
      and "TableSession"."table_id" = p_table_id
      and "TableSession"."status" = 'active'
    limit 1;

    if v_session.id is null then
      raise exception 'Table session is not active.';
    end if;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must include at least one item.';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing_order
    from "Order"
    where "Order"."idempotency_key" = p_idempotency_key
    limit 1;

    if v_existing_order.id is not null then
      if v_existing_order.restaurant_id <> p_restaurant_id then
        raise exception 'Idempotency key already belongs to another restaurant.';
      end if;

      order_ref := v_existing_order.id;
      status := v_existing_order.status;
      total_amount := v_existing_order.total_amount;
      return next;
      return;
    end if;
  end if;

  select count(*) into v_pending_count
  from "Order"
  where "Order"."restaurant_id" = p_restaurant_id
    and "Order"."table_id" = p_table_id
    and (v_session.id is null or "Order"."table_session_id" = v_session.id)
    and "Order"."status" = 'pending'
    and "Order"."created_at" > now() - interval '10 minutes';

  if v_pending_count >= 5 then
    raise exception 'Kitchen is processing your previous orders. Please wait before placing another order.';
  end if;

  v_order_id := 'SF-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8));

  insert into "Order" (
    "id",
    "restaurant_id",
    "table_id",
    "table_session_id",
    "status",
    "subtotal_amount",
    "tax_amount",
    "service_charge_amount",
    "total_amount",
    "special_instructions",
    "idempotency_key",
    "created_at",
    "updated_at"
  )
  values (
    v_order_id,
    p_restaurant_id,
    p_table_id,
    v_session.id,
    'pending',
    0,
    0,
    0,
    0,
    nullif(trim(coalesce(p_special_instructions, '')), ''),
    p_idempotency_key,
    now(),
    now()
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := coalesce((v_item->>'quantity')::integer, 1);
    if v_quantity < 1 or v_quantity > 20 then
      raise exception 'Invalid quantity.';
    end if;

    select * into v_menu_item
    from "MenuItem"
    where "MenuItem"."id" = v_item->>'menu_item_id'
      and "MenuItem"."restaurant_id" = p_restaurant_id
      and "MenuItem"."available" = true;

    if v_menu_item.id is null then
      raise exception 'One or more selected items are unavailable.';
    end if;

    select coalesce(array_agg(distinct value::text), array[]::text[])
      into v_mod_ids
    from jsonb_array_elements_text(coalesce(v_item->'modifier_option_ids', '[]'::jsonb));

    v_mod_count := cardinality(v_mod_ids);
    v_valid_mod_count := 0;
    v_mod_total := 0;
    v_mods := '[]'::jsonb;

    if v_mod_count > 0 then
      select
        count(distinct mo.id),
        coalesce(sum(mo.price_delta)::numeric, 0)::numeric(12,2),
        coalesce(
          jsonb_agg(
            distinct jsonb_build_object('id', mo.id, 'name', mo.name, 'price_delta', mo.price_delta)
          ),
          '[]'::jsonb
        )
        into v_valid_mod_count, v_mod_total, v_mods
      from "ModifierOption" mo
      join "ModifierGroup" mg on mg.id = mo.group_id
      where mo.id = any(v_mod_ids)
        and mg.restaurant_id = p_restaurant_id
        and mg.menu_item_id = v_menu_item.id;

      if v_valid_mod_count <> v_mod_count then
        raise exception 'Invalid modifier option for selected item.';
      end if;
    end if;

    v_line_total := round(((v_menu_item.price::numeric + v_mod_total) * v_quantity)::numeric, 2);
    v_subtotal := v_subtotal + v_line_total;

    insert into "OrderItem" ("id", "order_id", "menu_item_id", "name", "quantity", "price", "modifiers_json")
    values (
      gen_random_uuid()::text,
      v_order_id,
      v_menu_item.id,
      v_menu_item.name,
      v_quantity,
      v_menu_item.price,
      case when jsonb_array_length(v_mods) > 0 then v_mods::text else null end
    );
  end loop;

  v_tax_amount := round((v_subtotal * coalesce(v_restaurant.gst_rate, 0)::numeric)::numeric, 2);
  v_service_amount := round((v_subtotal * coalesce(v_restaurant.service_charge_rate, 0)::numeric)::numeric, 2);
  v_total := round((v_subtotal + v_tax_amount + v_service_amount)::numeric, 2);

  if v_total <= 0 then
    raise exception 'Order total must be greater than zero.';
  end if;

  update "Order"
  set "subtotal_amount" = v_subtotal,
      "tax_amount" = v_tax_amount,
      "service_charge_amount" = v_service_amount,
      "total_amount" = v_total,
      "updated_at" = now()
  where "id" = v_order_id;

  update "Table"
  set "status" = 'occupied',
      "updated_at" = now()
  where "id" = p_table_id
    and "restaurant_id" = p_restaurant_id;

  if v_session.id is not null then
    perform refresh_session_bill(v_session.id);
  end if;

  order_ref := v_order_id;
  status := 'pending';
  total_amount := v_total;
  return next;
end;
$$;

create or replace function start_table_session(
  p_restaurant_id text,
  p_table_id text,
  p_existing_token text default null
)
returns table(id text, token text, status text, table_id text, restaurant_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session "TableSession"%rowtype;
  v_table "Table"%rowtype;
begin
  select * into v_table
  from "Table"
  where "Table"."id" = p_table_id
    and "Table"."restaurant_id" = p_restaurant_id
    and coalesce("Table"."qr_enabled", true) = true;

  if v_table.id is null then
    raise exception 'Invalid or disabled table QR.';
  end if;

  if p_existing_token is not null then
    select * into v_session
    from "TableSession"
    where "TableSession"."token" = p_existing_token
      and "TableSession"."restaurant_id" = p_restaurant_id
      and "TableSession"."table_id" = p_table_id
      and "TableSession"."status" = 'active'
    limit 1;
  end if;

  if v_session.id is not null then
    id := v_session.id;
    token := v_session.token;
    status := v_session.status;
    table_id := v_session.table_id;
    restaurant_id := v_session.restaurant_id;
    return next;
    return;
  end if;

  update "TableSession"
  set "status" = 'closed',
      "closed_at" = coalesce("closed_at", now()),
      "updated_at" = now()
  where "TableSession"."restaurant_id" = p_restaurant_id
    and "TableSession"."table_id" = p_table_id
    and "TableSession"."status" in ('active', 'billing')
    and "TableSession"."opened_at" < now() - interval '8 hours';

  begin
    insert into "TableSession" ("restaurant_id", "table_id", "status", "opened_at", "created_at", "updated_at")
    values (p_restaurant_id, p_table_id, 'active', now(), now(), now())
    returning * into v_session;
  exception when unique_violation then
    raise exception 'This table already has an active session. Ask staff for the current table QR.';
  end;

  insert into "SessionBill" ("table_session_id")
  values (v_session.id)
  on conflict ("table_session_id") do nothing;

  update "Table"
  set "status" = 'occupied',
      "updated_at" = now()
  where "Table"."id" = p_table_id
    and "Table"."restaurant_id" = p_restaurant_id;

  id := v_session.id;
  token := v_session.token;
  status := v_session.status;
  table_id := v_session.table_id;
  restaurant_id := v_session.restaurant_id;
  return next;
end;
$$;

create or replace function close_table_session(
  p_restaurant_id text,
  p_table_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session "TableSession"%rowtype;
begin
  if not app_staff_can_access(p_restaurant_id) then
    raise exception 'Not authorized.';
  end if;

  select * into v_session
  from "TableSession"
  where "restaurant_id" = p_restaurant_id
    and "table_id" = p_table_id
    and "status" in ('active', 'billing')
  order by "opened_at" desc
  limit 1;

  if v_session.id is null then
    update "Table"
    set "status" = 'available',
        "updated_at" = now()
    where "id" = p_table_id
      and "restaurant_id" = p_restaurant_id;
    return;
  end if;

  if exists (
    select 1
    from "Order"
    where "table_session_id" = v_session.id
      and "status" in ('pending', 'accepted', 'preparing')
  ) then
    raise exception 'Cannot close table while kitchen-active orders exist.';
  end if;

  update "Order"
  set "status" = 'completed',
      "updated_at" = now()
  where "table_session_id" = v_session.id
    and "status" in ('ready', 'served');

  update "TableSession"
  set "status" = 'closed',
      "closed_at" = now(),
      "updated_at" = now()
  where "id" = v_session.id;

  update "Table"
  set "status" = 'available',
      "updated_at" = now()
  where "id" = p_table_id
    and "restaurant_id" = p_restaurant_id;

  perform refresh_session_bill(v_session.id);
end;
$$;

create or replace function get_table_session_orders(p_table_session_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(order_doc order by (order_doc->>'created_at')::timestamptz desc), '[]'::jsonb)
  from (
    select to_jsonb(o.*)
      || jsonb_build_object(
        'items', coalesce((
          select jsonb_agg(to_jsonb(oi.*) || jsonb_build_object('menu_item', to_jsonb(mi.*)))
          from "OrderItem" oi
          left join "MenuItem" mi on mi.id = oi.menu_item_id
          where oi.order_id = o.id
        ), '[]'::jsonb)
      ) as order_doc
    from "Order" o
    join "TableSession" ts on ts.id = o.table_session_id
    where ts.token = p_table_session_token
  ) q;
$$;

create or replace function get_public_menu_by_slug(p_restaurant_slug text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with selected_restaurant as (
    select r.*
    from "Restaurant" r
    where p_restaurant_slug is null
      or r.slug = p_restaurant_slug
    order by r.created_at asc
    limit 1
  )
  select jsonb_build_object(
    'restaurant', to_jsonb(sr),
    'categories', coalesce((
      select jsonb_agg(
        to_jsonb(c)
        || jsonb_build_object(
          'items', coalesce((
            select jsonb_agg(
              to_jsonb(mi)
              || jsonb_build_object(
                'modifier_groups', coalesce((
                  select jsonb_agg(
                    to_jsonb(mg)
                    || jsonb_build_object(
                      'options', coalesce((
                        select jsonb_agg(to_jsonb(mo) order by mo.name)
                        from "ModifierOption" mo
                        where mo.group_id = mg.id
                      ), '[]'::jsonb)
                    )
                    order by mg.created_at, mg.name
                  )
                  from "ModifierGroup" mg
                  where mg.menu_item_id = mi.id
                    and mg.restaurant_id = sr.id
                ), '[]'::jsonb)
              )
              order by mi.display_order, mi.name
            )
            from "MenuItem" mi
            where mi.category_id = c.id
              and mi.restaurant_id = sr.id
          ), '[]'::jsonb)
        )
        order by c.display_order, c.name
      )
      from "MenuCategory" c
      where c.restaurant_id = sr.id
        and c.archived = false
    ), '[]'::jsonb)
  )
  from selected_restaurant sr;
$$;

create or replace function get_public_menu_item(p_menu_item_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(mi)
    || jsonb_build_object(
      'category', to_jsonb(c),
      'restaurant', to_jsonb(r),
      'modifier_groups', coalesce((
        select jsonb_agg(
          to_jsonb(mg)
          || jsonb_build_object(
            'options', coalesce((
              select jsonb_agg(to_jsonb(mo) order by mo.name)
              from "ModifierOption" mo
              where mo.group_id = mg.id
            ), '[]'::jsonb)
          )
          order by mg.created_at, mg.name
        )
        from "ModifierGroup" mg
        where mg.menu_item_id = mi.id
          and mg.restaurant_id = mi.restaurant_id
      ), '[]'::jsonb)
    )
  from "MenuItem" mi
  join "MenuCategory" c on c.id = mi.category_id
  join "Restaurant" r on r.id = mi.restaurant_id
  where mi.id = p_menu_item_id
    and c.archived = false
  limit 1;
$$;

create or replace function get_order_status_secure(p_order_id text, p_table_session_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(o.*)
    || jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(oi.*) || jsonb_build_object('menu_item', to_jsonb(mi.*)))
        from "OrderItem" oi
        left join "MenuItem" mi on mi.id = oi.menu_item_id
        where oi.order_id = o.id
      ), '[]'::jsonb),
      'table', to_jsonb(t.*),
      'payments', coalesce((
        select jsonb_agg(to_jsonb(p.*))
        from "Payment" p
        where p.order_id = o.id
      ), '[]'::jsonb)
    )
  from "Order" o
  join "TableSession" ts on ts.id = o.table_session_id
  left join "Table" t on t.id = o.table_id
  where o.id = p_order_id
    and ts.token = p_table_session_token;
$$;

create or replace function create_staff_request_secure(
  p_restaurant_id text,
  p_table_id text,
  p_table_session_token text,
  p_request_type text default 'waiter',
  p_message text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id text;
  v_request_type text := coalesce(nullif(trim(p_request_type), ''), 'waiter');
begin
  if v_request_type not in ('waiter', 'water', 'bill', 'other') then
    raise exception 'Invalid staff request type.';
  end if;

  if not exists (
    select 1
    from "TableSession"
    where "token" = p_table_session_token
      and "restaurant_id" = p_restaurant_id
      and "table_id" = p_table_id
      and "status" = 'active'
  ) then
    raise exception 'A valid active table session is required.';
  end if;

  if exists (
    select 1
    from "StaffRequest"
    where "restaurant_id" = p_restaurant_id
      and "table_id" = p_table_id
      and "status" = 'pending'
      and "created_at" > now() - interval '1 minute'
  ) then
    raise exception 'A staff request is already pending for this table.';
  end if;

  insert into "StaffRequest" ("id", "restaurant_id", "table_id", "request_type", "message", "status", "created_at", "updated_at")
  values (
    gen_random_uuid()::text,
    p_restaurant_id,
    p_table_id,
    v_request_type,
    nullif(trim(coalesce(p_message, '')), ''),
    'pending',
    now(),
    now()
  )
  returning "id" into v_request_id;

  return v_request_id;
end;
$$;

create or replace function submit_order_feedback_secure(
  p_order_id text,
  p_table_session_token text,
  p_rating integer,
  p_comment text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order "Order"%rowtype;
  v_feedback_id text;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.';
  end if;

  select o.* into v_order
  from "Order" o
  join "TableSession" ts on ts.id = o.table_session_id
  where o.id = p_order_id
    and ts.token = p_table_session_token
    and o.status in ('served', 'completed')
  limit 1;

  if v_order.id is null then
    raise exception 'Feedback is only available for served or completed orders in this table session.';
  end if;

  insert into "OrderFeedback" ("id", "restaurant_id", "order_id", "rating", "comment", "created_at")
  values (gen_random_uuid()::text, v_order.restaurant_id, v_order.id, p_rating, nullif(trim(p_comment), ''), now())
  on conflict ("order_id") do update set
    "rating" = excluded."rating",
    "comment" = excluded."comment"
  returning "id" into v_feedback_id;

  return v_feedback_id;
end;
$$;

create or replace function remove_staff_member_secure(
  p_restaurant_id text,
  p_member_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from "User" u
    where u.id = auth.uid()::text
      and u.restaurant_id = p_restaurant_id
      and u.role = 'owner'
  ) then
    raise exception 'Only the restaurant owner can remove team members.';
  end if;

  if p_member_id = auth.uid()::text then
    raise exception 'You cannot remove yourself.';
  end if;

  if exists (
    select 1 from "User"
    where id = p_member_id
      and restaurant_id = p_restaurant_id
      and role = 'owner'
  ) then
    raise exception 'Owner accounts cannot be removed from this screen.';
  end if;

  delete from "User"
  where id = p_member_id
    and restaurant_id = p_restaurant_id
    and role in ('manager', 'staff');
end;
$$;

grant execute on function create_order_secure(text, text, text, jsonb, text, text) to anon, authenticated;
grant execute on function start_table_session(text, text, text) to anon, authenticated;
grant execute on function close_table_session(text, text) to authenticated;
grant execute on function get_table_session_orders(text) to anon, authenticated;
grant execute on function get_public_menu_by_slug(text) to anon, authenticated;
grant execute on function get_public_menu_item(text) to anon, authenticated;
grant execute on function get_order_status_secure(text, text) to anon, authenticated;
grant execute on function create_staff_request_secure(text, text, text, text, text) to anon, authenticated;
grant execute on function submit_order_feedback_secure(text, text, integer, text) to anon, authenticated;
grant execute on function remove_staff_member_secure(text, text) to authenticated;

-- RLS.
alter table "Restaurant" enable row level security;
alter table "Table" enable row level security;
alter table "TableSession" enable row level security;
alter table "MenuCategory" enable row level security;
alter table "MenuItem" enable row level security;
alter table "ModifierGroup" enable row level security;
alter table "ModifierOption" enable row level security;
alter table "Order" enable row level security;
alter table "OrderItem" enable row level security;
alter table "Payment" enable row level security;
alter table "OrderFeedback" enable row level security;
alter table "StaffRequest" enable row level security;
alter table "User" enable row level security;
alter table "ARAsset" enable row level security;

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'Restaurant',
        'Table',
        'TableSession',
        'MenuCategory',
        'MenuItem',
        'ModifierGroup',
        'ModifierOption',
        'Order',
        'OrderItem',
        'Payment',
        'OrderFeedback',
        'StaffRequest',
        'User',
        'ARAsset'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy "restaurant_public_select" on "Restaurant"
  for select
  using (true);

create policy "restaurant_admin_select" on "Restaurant"
  for select
  using (app_rls_staff_can_access("Restaurant"."id"));

create policy "restaurant_admin_insert" on "Restaurant"
  for insert
  with check (app_rls_staff_can_access("Restaurant"."id"));

create policy "restaurant_admin_update" on "Restaurant"
  for update
  using (app_rls_staff_can_access("Restaurant"."id"))
  with check (app_rls_staff_can_access("Restaurant"."id"));

create policy "user_self_select" on "User"
  for select
  using ("id" = auth.uid()::text or app_rls_staff_can_access("User"."restaurant_id"));

create policy "user_admin_insert" on "User"
  for insert
  with check (app_rls_staff_can_access("User"."restaurant_id"));

create policy "user_admin_update" on "User"
  for update
  using (app_rls_staff_can_access("User"."restaurant_id"))
  with check (app_rls_staff_can_access("User"."restaurant_id"));

create policy "table_public_qr_select" on "Table"
  for select
  using (coalesce("qr_enabled", true) = true);

create policy "table_admin_select" on "Table"
  for select
  using (app_rls_staff_can_access("Table"."restaurant_id"));

create policy "table_admin_insert" on "Table"
  for insert
  with check (app_rls_staff_can_access("Table"."restaurant_id"));

create policy "table_admin_update" on "Table"
  for update
  using (app_rls_staff_can_access("Table"."restaurant_id"))
  with check (app_rls_staff_can_access("Table"."restaurant_id"));

create policy "tablesession_admin_select" on "TableSession"
  for select
  using (app_rls_staff_can_access("TableSession"."restaurant_id"));

create policy "tablesession_admin_insert" on "TableSession"
  for insert
  with check (app_rls_staff_can_access("TableSession"."restaurant_id"));

create policy "tablesession_admin_update" on "TableSession"
  for update
  using (app_rls_staff_can_access("TableSession"."restaurant_id"))
  with check (app_rls_staff_can_access("TableSession"."restaurant_id"));

create policy "menucategory_public_select_by_slug" on "MenuCategory"
  for select
  using (
    "archived" = false
    and "restaurant_id" = (
      select r.id from "Restaurant" r
      where r.slug = current_setting('app.restaurant_slug', true)
      limit 1
    )
  );

create policy "menucategory_admin_select" on "MenuCategory"
  for select
  using (app_rls_staff_can_access("MenuCategory"."restaurant_id"));

create policy "menucategory_admin_insert" on "MenuCategory"
  for insert
  with check (app_rls_staff_can_access("MenuCategory"."restaurant_id"));

create policy "menucategory_admin_update" on "MenuCategory"
  for update
  using (app_rls_staff_can_access("MenuCategory"."restaurant_id"))
  with check (app_rls_staff_can_access("MenuCategory"."restaurant_id"));

create policy "menuitem_public_select_by_slug" on "MenuItem"
  for select
  using (
    "restaurant_id" = (
      select r.id from "Restaurant" r
      where r.slug = current_setting('app.restaurant_slug', true)
      limit 1
    )
  );

create policy "menuitem_admin_select" on "MenuItem"
  for select
  using (app_rls_staff_can_access("MenuItem"."restaurant_id"));

create policy "menuitem_admin_insert" on "MenuItem"
  for insert
  with check (app_rls_staff_can_access("MenuItem"."restaurant_id"));

create policy "menuitem_admin_update" on "MenuItem"
  for update
  using (app_rls_staff_can_access("MenuItem"."restaurant_id"))
  with check (app_rls_staff_can_access("MenuItem"."restaurant_id"));

create policy "modifiergroup_public_select_by_slug" on "ModifierGroup"
  for select
  using (
    exists (
      select 1
      from "MenuItem" mi
      join "Restaurant" r on r.id = mi.restaurant_id
      join "MenuCategory" c on c.id = mi.category_id
      where mi.id = "ModifierGroup"."menu_item_id"
        and c.archived = false
        and r.slug = current_setting('app.restaurant_slug', true)
    )
  );

create policy "modifiergroup_admin_select" on "ModifierGroup"
  for select
  using (app_rls_staff_can_access("ModifierGroup"."restaurant_id"));

create policy "modifiergroup_admin_insert" on "ModifierGroup"
  for insert
  with check (app_rls_staff_can_access("ModifierGroup"."restaurant_id"));

create policy "modifiergroup_admin_update" on "ModifierGroup"
  for update
  using (app_rls_staff_can_access("ModifierGroup"."restaurant_id"))
  with check (app_rls_staff_can_access("ModifierGroup"."restaurant_id"));

create policy "modifieroption_public_select_by_slug" on "ModifierOption"
  for select
  using (
    exists (
      select 1
      from "ModifierGroup" mg
      join "MenuItem" mi on mi.id = mg.menu_item_id
      join "Restaurant" r on r.id = mi.restaurant_id
      join "MenuCategory" c on c.id = mi.category_id
      where mg.id = "ModifierOption"."group_id"
        and c.archived = false
        and r.slug = current_setting('app.restaurant_slug', true)
    )
  );

create policy "modifieroption_admin_select" on "ModifierOption"
  for select
  using (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption"."group_id"
        and app_rls_staff_can_access(mg.restaurant_id)
    )
  );

create policy "modifieroption_admin_insert" on "ModifierOption"
  for insert
  with check (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption"."group_id"
        and app_rls_staff_can_access(mg.restaurant_id)
    )
  );

create policy "modifieroption_admin_update" on "ModifierOption"
  for update
  using (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption"."group_id"
        and app_rls_staff_can_access(mg.restaurant_id)
    )
  )
  with check (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption"."group_id"
        and app_rls_staff_can_access(mg.restaurant_id)
    )
  );

-- Public INSERT on Order is intentionally omitted. Order creation must use
-- create_order_secure(), whose SECURITY DEFINER body performs ownership,
-- price, modifier, idempotency, tax, and service-charge validation.
create policy "order_public_select_by_setting" on "Order"
  for select
  using ("id" = current_setting('app.order_id', true));

create policy "order_admin_select" on "Order"
  for select
  using (app_rls_staff_can_access("Order"."restaurant_id"));

create policy "order_admin_insert" on "Order"
  for insert
  with check (app_rls_staff_can_access("Order"."restaurant_id"));

create policy "order_admin_update" on "Order"
  for update
  using (app_rls_staff_can_access("Order"."restaurant_id"))
  with check (app_rls_staff_can_access("Order"."restaurant_id"));

create policy "orderitem_admin_select" on "OrderItem"
  for select
  using (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem"."order_id"
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "orderitem_admin_insert" on "OrderItem"
  for insert
  with check (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem"."order_id"
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "orderitem_admin_update" on "OrderItem"
  for update
  using (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem"."order_id"
        and app_rls_staff_can_access(o.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem"."order_id"
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "payment_admin_select" on "Payment"
  for select
  using (
    exists (
      select 1 from "Order" o
      where o.id = "Payment"."order_id"
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "payment_admin_insert" on "Payment"
  for insert
  with check (
    exists (
      select 1 from "Order" o
      where o.id = "Payment"."order_id"
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "payment_admin_update" on "Payment"
  for update
  using (
    exists (
      select 1 from "Order" o
      where o.id = "Payment"."order_id"
        and app_rls_staff_can_access(o.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from "Order" o
      where o.id = "Payment"."order_id"
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "feedback_admin_select" on "OrderFeedback"
  for select
  using (app_rls_staff_can_access("OrderFeedback"."restaurant_id"));

create policy "feedback_admin_insert" on "OrderFeedback"
  for insert
  with check (app_rls_staff_can_access("OrderFeedback"."restaurant_id"));

create policy "feedback_admin_update" on "OrderFeedback"
  for update
  using (app_rls_staff_can_access("OrderFeedback"."restaurant_id"))
  with check (app_rls_staff_can_access("OrderFeedback"."restaurant_id"));

create policy "staffrequest_admin_select" on "StaffRequest"
  for select
  using (app_rls_staff_can_access("StaffRequest"."restaurant_id"));

create policy "staffrequest_admin_insert" on "StaffRequest"
  for insert
  with check (app_rls_staff_can_access("StaffRequest"."restaurant_id"));

create policy "staffrequest_admin_update" on "StaffRequest"
  for update
  using (app_rls_staff_can_access("StaffRequest"."restaurant_id"))
  with check (app_rls_staff_can_access("StaffRequest"."restaurant_id"));

create policy "arasset_admin_select" on "ARAsset"
  for select
  using (app_rls_staff_can_access("ARAsset"."restaurant_id"));

create policy "arasset_admin_insert" on "ARAsset"
  for insert
  with check (app_rls_staff_can_access("ARAsset"."restaurant_id"));

create policy "arasset_admin_update" on "ARAsset"
  for update
  using (app_rls_staff_can_access("ARAsset"."restaurant_id"))
  with check (app_rls_staff_can_access("ARAsset"."restaurant_id"));
