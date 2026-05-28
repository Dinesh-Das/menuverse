do $$
begin
  create type order_type as enum ('dine_in', 'takeaway', 'delivery');
exception
  when duplicate_object then null;
end $$;

alter table if exists "Restaurant"
  add column if not exists delivery_radius_km numeric(8,2) not null default 5,
  add column if not exists delivery_fee_flat numeric(10,2) not null default 0,
  add column if not exists delivery_provider text,
  add column if not exists delivery_config jsonb not null default '{}'::jsonb;

alter table if exists "Order"
  add column if not exists order_type order_type not null default 'dine_in',
  add column if not exists delivery_address_json jsonb,
  add column if not exists delivery_fee_amount numeric(10,2) not null default 0,
  add column if not exists delivery_distance_km numeric(8,2);

alter table if exists "Order"
  alter column table_id drop not null;

create or replace function create_order_secure(
  p_restaurant_id text,
  p_table_id text,
  p_table_session_token text default null,
  p_items jsonb default '[]'::jsonb,
  p_special_instructions text default null,
  p_idempotency_key text default null,
  p_points_redeemed integer default 0
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
  v_item_note text;
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
  v_loyalty_discount numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_pending_count integer;
  v_points_requested integer := greatest(0, coalesce(p_points_redeemed, 0));
  v_profile_points integer := 0;
begin
  select * into v_restaurant
  from "Restaurant"
  where id = p_restaurant_id;

  if v_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  if p_table_id is not null then
    select * into v_table
    from "Table"
    where id = p_table_id
      and restaurant_id = p_restaurant_id;

    if v_table.id is null then
      raise exception 'Invalid table for this restaurant.';
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

  if p_table_id is not null then
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
  end if;

  v_order_id := 'SF-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8));

  insert into "Order" (
    id,
    restaurant_id,
    table_id,
    table_session_id,
    guest_profile_id,
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
    v_session.guest_profile_id,
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
    v_item_note := left(nullif(trim(coalesce(v_item->>'item_note', v_item->>'notes', '')), ''), 200);

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

    insert into "OrderItem" (id, order_id, menu_item_id, name, quantity, price, modifiers_json, item_note)
    values (
      gen_random_uuid()::text,
      v_order_id,
      v_menu_item.id,
      v_menu_item.name,
      v_quantity,
      v_menu_item.price,
      case when jsonb_array_length(v_mods) > 0 then v_mods::text else null end,
      v_item_note
    );
  end loop;

  v_tax_amount := round((v_subtotal * coalesce(v_restaurant.gst_rate, 0)::numeric)::numeric, 2);
  v_service_amount := round((v_subtotal * coalesce(v_restaurant.service_charge_rate, 0)::numeric)::numeric, 2);
  v_total := round((v_subtotal + v_tax_amount + v_service_amount)::numeric, 2);

  if v_points_requested > 0 then
    if v_session.guest_profile_id is null then
      raise exception 'Loyalty redemption requires a linked guest profile.';
    end if;

    v_points_requested := (v_points_requested / 100) * 100;
    select loyalty_points into v_profile_points
    from "GuestProfile"
    where id = v_session.guest_profile_id
    for update;

    if v_points_requested > v_profile_points then
      raise exception 'Not enough loyalty points.';
    end if;

    v_loyalty_discount := round((v_points_requested::numeric / 10)::numeric, 2);
    if v_loyalty_discount >= v_total then
      raise exception 'Loyalty discount cannot exceed order total.';
    end if;

    update "GuestProfile"
    set loyalty_points = loyalty_points - v_points_requested,
        updated_at = now()
    where id = v_session.guest_profile_id;

    v_total := round((v_total - v_loyalty_discount)::numeric, 2);
  end if;

  if v_total <= 0 then
    raise exception 'Order total must be greater than zero.';
  end if;

  update "Order"
  set subtotal_amount = v_subtotal,
      tax_amount = v_tax_amount,
      service_charge_amount = v_service_amount,
      loyalty_discount_amount = v_loyalty_discount,
      points_redeemed = v_points_requested,
      total_amount = v_total,
      updated_at = now()
  where id = v_order_id;

  if p_table_id is not null then
    update "Table"
    set status = 'occupied',
        updated_at = now()
    where id = p_table_id
      and restaurant_id = p_restaurant_id;
  end if;

  if v_session.id is not null then
    perform refresh_session_bill(v_session.id);
  end if;

  order_ref := v_order_id;
  status := 'pending';
  total_amount := v_total;
  return next;
end;
$$;

grant execute on function create_order_secure(text, text, text, jsonb, text, text, integer)
  to anon, authenticated;

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
  left join "TableSession" ts on ts.id = o.table_session_id
  left join "Table" t on t.id = o.table_id
  where o.id = p_order_id
    and (
      (p_table_session_token is not null and ts.token = p_table_session_token)
      or (p_table_session_token is null and o.table_session_id is null and o.table_id is null)
    );
$$;

grant execute on function get_order_status_secure(text, text) to anon, authenticated;

create or replace function set_order_fulfillment_details(
  p_order_id text,
  p_table_session_token text,
  p_order_type order_type default 'dine_in',
  p_delivery_address jsonb default null,
  p_delivery_fee numeric default 0,
  p_delivery_distance_km numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order "Order"%rowtype;
  v_restaurant "Restaurant"%rowtype;
  v_fee numeric(10,2) := 0;
begin
  select o.* into v_order
  from "Order" o
  left join "TableSession" ts on ts.id = o.table_session_id
  where o.id = p_order_id
    and o.status = 'pending'
    and (
      (p_table_session_token is not null and ts.token = p_table_session_token)
      or (p_table_session_token is null and o.table_session_id is null and o.table_id is null)
    )
  for update;

  if v_order.id is null then
    raise exception 'Order not found for this active session.';
  end if;

  select * into v_restaurant
  from "Restaurant"
  where id = v_order.restaurant_id;

  if p_order_type = 'delivery' then
    if p_delivery_address is null
      or nullif(trim(coalesce(p_delivery_address->>'street', '')), '') is null
      or nullif(trim(coalesce(p_delivery_address->>'city', '')), '') is null
      or nullif(trim(coalesce(p_delivery_address->>'pincode', '')), '') is null then
      raise exception 'Delivery address requires street, city, and pincode.';
    end if;

    if p_delivery_distance_km is not null
      and v_restaurant.delivery_radius_km is not null
      and p_delivery_distance_km > v_restaurant.delivery_radius_km then
      raise exception 'Delivery address is outside this restaurant''s delivery radius.';
    end if;

    v_fee := greatest(0, coalesce(p_delivery_fee, v_restaurant.delivery_fee_flat, 0));
  end if;

  update "Order"
  set order_type = coalesce(p_order_type, 'dine_in'::order_type),
      delivery_address_json = case when p_order_type = 'delivery' then p_delivery_address else null end,
      delivery_fee_amount = v_fee,
      delivery_distance_km = case when p_order_type = 'delivery' then p_delivery_distance_km else null end,
      total_amount = round((subtotal_amount + tax_amount + service_charge_amount - loyalty_discount_amount + v_fee)::numeric, 2),
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  if v_order.table_session_id is not null then
    perform refresh_session_bill(v_order.table_session_id);
  end if;

  return to_jsonb(v_order);
end;
$$;

grant execute on function set_order_fulfillment_details(text, text, order_type, jsonb, numeric, numeric)
  to anon, authenticated;

create table if not exists "WhatsAppSession" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  phone text not null,
  table_id text references "Table"(id) on delete set null,
  table_session_token text,
  state text not null default 'awaiting_category',
  cart_json jsonb not null default '[]'::jsonb,
  context_json jsonb not null default '{}'::jsonb,
  last_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists whatsapp_session_restaurant_phone_idx
  on "WhatsAppSession"(restaurant_id, phone);

alter table if exists "WhatsAppSession" enable row level security;

drop policy if exists "whatsapp_session_staff_access" on "WhatsAppSession";
create policy "whatsapp_session_staff_access" on "WhatsAppSession"
  for all
  using (app_rls_staff_can_access("WhatsAppSession".restaurant_id))
  with check (app_rls_staff_can_access("WhatsAppSession".restaurant_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ar-source-videos',
  'ar-source-videos',
  true,
  157286400,
  array['video/mp4', 'video/quicktime']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ar_source_videos_public_read" on storage.objects;
drop policy if exists "ar_source_videos_staff_upload" on storage.objects;
drop policy if exists "ar_source_videos_staff_update" on storage.objects;
drop policy if exists "ar_source_videos_staff_delete" on storage.objects;

create policy "ar_source_videos_public_read" on storage.objects
  for select using (bucket_id = 'ar-source-videos');

create policy "ar_source_videos_staff_upload" on storage.objects
  for insert with check (
    bucket_id = 'ar-source-videos'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );

create policy "ar_source_videos_staff_update" on storage.objects
  for update using (
    bucket_id = 'ar-source-videos'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  ) with check (
    bucket_id = 'ar-source-videos'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );

create policy "ar_source_videos_staff_delete" on storage.objects
  for delete using (
    bucket_id = 'ar-source-videos'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );
