create extension if not exists pgcrypto;

alter table "Table"
  add column if not exists qr_enabled boolean not null default true;

alter table "Restaurant"
  add column if not exists service_charge_rate numeric not null default 0,
  add column if not exists payment_provider text default 'razorpay',
  add column if not exists payment_enabled boolean not null default false;

create table if not exists "TableSession" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  table_id text not null references "Table"(id) on delete cascade,
  token text not null unique default gen_random_uuid()::text,
  status text not null default 'active' check (status in ('active', 'billing', 'paid', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists table_session_one_active_per_table
  on "TableSession"(restaurant_id, table_id)
  where status in ('active', 'billing');

create table if not exists "SessionBill" (
  id text primary key default gen_random_uuid()::text,
  table_session_id text not null unique references "TableSession"(id) on delete cascade,
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  service_charge numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table "Order"
  add column if not exists table_session_id text references "TableSession"(id),
  add column if not exists subtotal_amount numeric(12,2) not null default 0,
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists service_charge_amount numeric(12,2) not null default 0;

create index if not exists order_table_session_idx on "Order"(table_session_id);

create or replace function app_staff_can_access(p_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
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
  select exists (
    select 1
    from "User" u
    where u.id = auth.uid()::text
      and u.restaurant_id = p_restaurant_id
      and u.role in ('owner', 'manager')
  );
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
begin
  if exists (
    select 1
    from "Table"
    where "Table".id = p_table_id
      and "Table".restaurant_id = p_restaurant_id
      and coalesce("Table".qr_enabled, true) = false
  ) then
    raise exception 'This table QR is disabled.';
  end if;

  if p_existing_token is not null then
    select * into v_session
    from "TableSession"
    where "TableSession".token = p_existing_token
      and "TableSession".restaurant_id = p_restaurant_id
      and "TableSession".table_id = p_table_id
      and "TableSession".status in ('active', 'billing')
    limit 1;
  end if;

  if v_session.id is null then
    select * into v_session
    from "TableSession"
    where "TableSession".restaurant_id = p_restaurant_id
      and "TableSession".table_id = p_table_id
      and "TableSession".status in ('active', 'billing')
    order by opened_at desc
    limit 1;
  end if;

  if v_session.id is null then
    insert into "TableSession" (restaurant_id, table_id)
    values (p_restaurant_id, p_table_id)
    returning * into v_session;

    insert into "SessionBill" (table_session_id)
    values (v_session.id)
    on conflict (table_session_id) do nothing;
  end if;

  update "Table"
  set status = 'occupied', updated_at = now()
  where "Table".id = p_table_id
    and "Table".restaurant_id = p_restaurant_id;

  return query select v_session.id, v_session.token, v_session.status, v_session.table_id, v_session.restaurant_id;
end;
$$;

create or replace function refresh_session_bill(p_table_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id text;
  v_subtotal numeric(12,2);
  v_tax numeric(12,2);
  v_service numeric(12,2);
  v_total numeric(12,2);
begin
  select ts.restaurant_id
    into v_restaurant_id
  from "TableSession" ts
  where ts.id = p_table_session_id;

  select
    coalesce(sum(nullif(o.subtotal_amount, 0)), sum(o.total_amount), 0)::numeric(12,2),
    coalesce(sum(o.tax_amount), 0)::numeric(12,2),
    coalesce(sum(o.service_charge_amount), 0)::numeric(12,2),
    coalesce(sum(o.total_amount), 0)::numeric(12,2)
    into v_subtotal, v_tax, v_service, v_total
  from "Order" o
  where o.table_session_id = p_table_session_id
    and o.status <> 'cancelled';

  insert into "SessionBill" (table_session_id, subtotal, tax_amount, service_charge, total_amount)
  values (p_table_session_id, v_subtotal, v_tax, v_service, v_total)
  on conflict (table_session_id) do update set
    subtotal = excluded.subtotal,
    tax_amount = excluded.tax_amount,
    service_charge = excluded.service_charge,
    total_amount = excluded.total_amount,
    updated_at = now();
end;
$$;

create or replace function create_order_secure(
  p_restaurant_id text,
  p_table_id text,
  p_table_session_token text,
  p_items jsonb,
  p_special_instructions text default null,
  p_idempotency_key text default null
)
returns table(order_ref text, status text, total_amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session "TableSession"%rowtype;
  v_order_id text;
  v_item jsonb;
  v_menu_item "MenuItem"%rowtype;
  v_quantity integer;
  v_mod_ids text[];
  v_mods jsonb;
  v_mod_total numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_tax_rate numeric := 0;
  v_service_rate numeric := 0;
  v_tax_amount numeric := 0;
  v_service_amount numeric := 0;
  v_total numeric := 0;
  v_pending_count integer;
begin
  if p_table_session_token is null then
    raise exception 'A valid table session is required.';
  end if;

  select * into v_session
  from "TableSession"
  where token = p_table_session_token
    and restaurant_id = p_restaurant_id
    and table_id = p_table_id
    and status = 'active'
  limit 1;

  if v_session.id is null then
    raise exception 'Table session is not active.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must include at least one item.';
  end if;

  select coalesce(gst_rate, 0), coalesce(service_charge_rate, 0)
    into v_tax_rate, v_service_rate
  from "Restaurant"
  where id = p_restaurant_id;

  select count(*) into v_pending_count
  from "Order"
  where restaurant_id = p_restaurant_id
    and table_id = p_table_id
    and table_session_id = v_session.id
    and status = 'pending'
    and created_at > now() - interval '10 minutes';

  if v_pending_count >= 5 then
    raise exception 'Kitchen is processing your previous orders. Please wait before placing another order.';
  end if;

  if p_idempotency_key is not null then
    select o.id, o.status, o.total_amount
      into order_ref, status, total_amount
    from "Order" o
    where o.idempotency_key = p_idempotency_key
      and o.restaurant_id = p_restaurant_id;

    if order_ref is not null then
      return next;
      return;
    end if;
  end if;

  v_order_id := 'SF-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8));

  insert into "Order" (
    id, restaurant_id, table_id, table_session_id, status, total_amount,
    special_instructions, idempotency_key, created_at, updated_at
  )
  values (
    v_order_id, p_restaurant_id, p_table_id, v_session.id, 'pending', 0,
    nullif(trim(p_special_instructions), ''), p_idempotency_key, now(), now()
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := greatest(1, least(20, coalesce((v_item->>'quantity')::integer, 1)));

    select * into v_menu_item
    from "MenuItem"
    where id = v_item->>'menu_item_id'
      and restaurant_id = p_restaurant_id
      and available = true;

    if v_menu_item.id is null then
      raise exception 'One or more selected items are unavailable.';
    end if;

    select coalesce(array_agg(value::text), array[]::text[])
      into v_mod_ids
    from jsonb_array_elements_text(coalesce(v_item->'modifier_option_ids', '[]'::jsonb));

    select coalesce(sum(mo.price_delta), 0), coalesce(jsonb_agg(jsonb_build_object('id', mo.id, 'name', mo.name, 'price_delta', mo.price_delta)), '[]'::jsonb)
      into v_mod_total, v_mods
    from "ModifierOption" mo
    join "ModifierGroup" mg on mg.id = mo.group_id
    where mo.id = any(v_mod_ids)
      and mg.restaurant_id = p_restaurant_id
      and mg.menu_item_id = v_menu_item.id;

    v_line_total := (v_menu_item.price + coalesce(v_mod_total, 0)) * v_quantity;
    v_subtotal := v_subtotal + v_line_total;

    insert into "OrderItem" (id, order_id, menu_item_id, name, quantity, price, modifiers_json)
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

  v_tax_amount := round((v_subtotal * v_tax_rate)::numeric, 2);
  v_service_amount := round((v_subtotal * v_service_rate)::numeric, 2);
  v_total := round((v_subtotal + v_tax_amount + v_service_amount)::numeric, 2);

  update "Order"
  set subtotal_amount = round(v_subtotal, 2),
      tax_amount = v_tax_amount,
      service_charge_amount = v_service_amount,
      total_amount = v_total,
      updated_at = now()
  where id = v_order_id;

  update "Table"
  set status = 'occupied', updated_at = now()
  where id = p_table_id
    and restaurant_id = p_restaurant_id;

  perform refresh_session_bill(v_session.id);

  order_ref := v_order_id;
  status := 'pending';
  total_amount := v_total;
  return next;
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
      and ts.status in ('active', 'billing', 'paid')
  ) q;
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
      'payments', '[]'::jsonb
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
  p_table_session_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id text;
begin
  if not exists (
    select 1
    from "TableSession"
    where token = p_table_session_token
      and restaurant_id = p_restaurant_id
      and table_id = p_table_id
      and status = 'active'
  ) then
    raise exception 'A valid active table session is required.';
  end if;

  if exists (
    select 1
    from "StaffRequest"
    where restaurant_id = p_restaurant_id
      and table_id = p_table_id
      and status = 'pending'
      and created_at > now() - interval '1 minute'
  ) then
    raise exception 'A waiter request is already pending for this table.';
  end if;

  insert into "StaffRequest" (id, restaurant_id, table_id, status, created_at, updated_at)
  values (gen_random_uuid()::text, p_restaurant_id, p_table_id, 'pending', now(), now())
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function close_table_session(p_restaurant_id text, p_table_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app_staff_can_access(p_restaurant_id) then
    raise exception 'Not authorized.';
  end if;

  update "Order"
  set status = 'completed', updated_at = now()
  where restaurant_id = p_restaurant_id
    and table_id = p_table_id
    and status in ('pending', 'accepted', 'preparing', 'ready', 'served');

  update "TableSession"
  set status = 'closed', closed_at = now(), updated_at = now()
  where restaurant_id = p_restaurant_id
    and table_id = p_table_id
    and status in ('active', 'billing', 'paid');

  update "Table"
  set status = 'available', updated_at = now()
  where id = p_table_id
    and restaurant_id = p_restaurant_id;
end;
$$;

grant execute on function start_table_session(text, text, text) to anon, authenticated;
grant execute on function create_order_secure(text, text, text, jsonb, text, text) to anon, authenticated;
grant execute on function get_table_session_orders(text) to anon, authenticated;
grant execute on function get_order_status_secure(text, text) to anon, authenticated;
grant execute on function create_staff_request_secure(text, text, text) to anon, authenticated;
grant execute on function close_table_session(text, text) to authenticated;
