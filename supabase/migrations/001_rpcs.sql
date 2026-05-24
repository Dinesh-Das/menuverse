create extension if not exists pgcrypto;

alter table if exists "Order"
  add column if not exists table_session_id text references "TableSession"(id),
  add column if not exists subtotal_amount numeric(12,2) not null default 0,
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists service_charge_amount numeric(12,2) not null default 0;

alter table if exists "StaffRequest"
  add column if not exists request_type text not null default 'waiter',
  add column if not exists message text;

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
      coalesce(
        auth.jwt()->>'restaurantId',
        auth.jwt()->'app_metadata'->>'restaurantId',
        auth.jwt()->'user_metadata'->>'restaurantId'
      ) = p_restaurant_id
      and coalesce(
        auth.jwt()->>'role',
        auth.jwt()->'app_metadata'->>'role',
        auth.jwt()->'user_metadata'->>'role'
      ) in ('owner', 'manager', 'staff')
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
      coalesce(
        auth.jwt()->>'restaurantId',
        auth.jwt()->'app_metadata'->>'restaurantId',
        auth.jwt()->'user_metadata'->>'restaurantId'
      ) = p_restaurant_id
      and coalesce(
        auth.jwt()->>'role',
        auth.jwt()->'app_metadata'->>'role',
        auth.jwt()->'user_metadata'->>'role'
      ) in ('owner', 'manager')
    )
    or exists (
      select 1
      from "User" u
      where u.id = auth.uid()::text
        and u.restaurant_id = p_restaurant_id
        and u.role in ('owner', 'manager')
    );
$$;

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

drop function if exists create_order_secure(text, text, text, jsonb, text, text);
drop function if exists create_order_secure(text, text, text, text, text, jsonb);

create or replace function create_order_secure(
  p_restaurant_id text,
  p_table_id text,
  p_table_session_token text default null,
  p_special_instructions text default null,
  p_idempotency_key text default null,
  p_items jsonb default '[]'::jsonb
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
  where id = p_table_id
    and restaurant_id = p_restaurant_id;

  if v_table.id is null then
    raise exception 'Invalid table for this restaurant.';
  end if;

  select * into v_restaurant
  from "Restaurant"
  where id = p_restaurant_id;

  if v_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  if p_table_session_token is not null then
    select * into v_session
    from "TableSession"
    where "TableSession".token = p_table_session_token
      and "TableSession".restaurant_id = p_restaurant_id
      and "TableSession".table_id = p_table_id
      and "TableSession".status = 'active'
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
    where idempotency_key = p_idempotency_key
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
  where "Order".restaurant_id = p_restaurant_id
    and "Order".table_id = p_table_id
    and (v_session.id is null or "Order".table_session_id = v_session.id)
    and "Order".status = 'pending'
    and "Order".created_at > now() - interval '10 minutes';

  if v_pending_count >= 5 then
    raise exception 'Kitchen is processing your previous orders. Please wait before placing another order.';
  end if;

  v_order_id := 'SF-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8));

  insert into "Order" (
    id,
    restaurant_id,
    table_id,
    table_session_id,
    status,
    subtotal_amount,
    tax_amount,
    service_charge_amount,
    total_amount,
    special_instructions,
    idempotency_key,
    created_at,
    updated_at
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
    where id = v_item->>'menu_item_id'
      and restaurant_id = p_restaurant_id
      and available = true;

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

  v_tax_amount := round((v_subtotal * coalesce(v_restaurant.gst_rate, 0)::numeric)::numeric, 2);
  v_service_amount := round((v_subtotal * coalesce(v_restaurant.service_charge_rate, 0)::numeric)::numeric, 2);
  v_total := round((v_subtotal + v_tax_amount + v_service_amount)::numeric, 2);

  if v_total <= 0 then
    raise exception 'Order total must be greater than zero.';
  end if;

  update "Order"
  set subtotal_amount = v_subtotal,
      tax_amount = v_tax_amount,
      service_charge_amount = v_service_amount,
      total_amount = v_total,
      updated_at = now()
  where id = v_order_id;

  update "Table"
  set status = 'occupied',
      updated_at = now()
  where id = p_table_id
    and restaurant_id = p_restaurant_id;

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
returns table(id text, token text, status text)
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
  where "Table".id = p_table_id
    and "Table".restaurant_id = p_restaurant_id
    and coalesce(qr_enabled, true) = true;

  if v_table.id is null then
    raise exception 'Invalid or disabled table QR.';
  end if;

  if p_existing_token is not null then
    select * into v_session
    from "TableSession"
    where "TableSession".token = p_existing_token
      and "TableSession".restaurant_id = p_restaurant_id
      and "TableSession".table_id = p_table_id
      and "TableSession".status = 'active'
    limit 1;
  end if;

  if v_session.id is not null then
    id := v_session.id;
    token := v_session.token;
    status := v_session.status;
    return next;
    return;
  end if;

  update "TableSession"
  set status = 'closed',
      closed_at = coalesce(closed_at, now()),
      updated_at = now()
  where "TableSession".restaurant_id = p_restaurant_id
    and "TableSession".table_id = p_table_id
    and "TableSession".status in ('active', 'billing')
    and "TableSession".opened_at < now() - interval '8 hours';

  begin
    insert into "TableSession" (restaurant_id, table_id, status, opened_at, created_at, updated_at)
    values (p_restaurant_id, p_table_id, 'active', now(), now(), now())
    returning * into v_session;
  exception when unique_violation then
    raise exception 'This table already has an active session. Ask staff for the current table QR.';
  end;

  insert into "SessionBill" (table_session_id)
  values (v_session.id)
  on conflict (table_session_id) do nothing;

  update "Table"
  set status = 'occupied',
      updated_at = now()
  where "Table".id = p_table_id
    and "Table".restaurant_id = p_restaurant_id;

  id := v_session.id;
  token := v_session.token;
  status := v_session.status;
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
  where restaurant_id = p_restaurant_id
    and table_id = p_table_id
    and status in ('active', 'billing')
  order by opened_at desc
  limit 1;

  if v_session.id is null then
    update "Table"
    set status = 'available',
        updated_at = now()
    where id = p_table_id
      and restaurant_id = p_restaurant_id;
    return;
  end if;

  if exists (
    select 1
    from "Order"
    where table_session_id = v_session.id
      and status in ('pending', 'accepted', 'preparing')
  ) then
    raise exception 'Cannot close table while kitchen-active orders exist.';
  end if;

  update "Order"
  set status = 'completed',
      updated_at = now()
  where table_session_id = v_session.id
    and status in ('ready', 'served');

  update "TableSession"
  set status = 'closed',
      closed_at = now(),
      updated_at = now()
  where id = v_session.id;

  update "Table"
  set status = 'available',
      updated_at = now()
  where id = p_table_id
    and restaurant_id = p_restaurant_id;

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

drop function if exists create_staff_request_secure(text, text, text);
drop function if exists create_staff_request_secure(text, text, text, text, text);

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
    raise exception 'A staff request is already pending for this table.';
  end if;

  insert into "StaffRequest" (id, restaurant_id, table_id, request_type, message, status, created_at, updated_at)
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
  returning id into v_request_id;

  return v_request_id;
end;
$$;

grant execute on function create_order_secure(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function start_table_session(text, text, text) to anon, authenticated;
grant execute on function close_table_session(text, text) to authenticated;
grant execute on function get_table_session_orders(text) to anon, authenticated;
grant execute on function create_staff_request_secure(text, text, text, text, text) to anon, authenticated;
