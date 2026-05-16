create extension if not exists pgcrypto;

alter table "Table"
  add column if not exists open_session_join_enabled boolean not null default false;

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
  where id = p_table_id
    and restaurant_id = p_restaurant_id
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
      and "TableSession".status in ('active', 'billing')
    limit 1;
  end if;

  if v_session.id is null and coalesce(v_table.open_session_join_enabled, false) = true then
    select * into v_session
    from "TableSession"
    where "TableSession".restaurant_id = p_restaurant_id
      and "TableSession".table_id = p_table_id
      and "TableSession".status in ('active', 'billing')
    order by "TableSession".opened_at desc
    limit 1;
  end if;

  if v_session.id is null and exists (
    select 1
    from "TableSession"
    where "TableSession".restaurant_id = p_restaurant_id
      and "TableSession".table_id = p_table_id
      and "TableSession".status in ('active', 'billing')
  ) then
    raise exception 'This table already has an active session. Ask staff for the current table QR.';
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

  insert into "OrderFeedback" (id, restaurant_id, order_id, rating, comment, created_at)
  values (gen_random_uuid()::text, v_order.restaurant_id, v_order.id, p_rating, nullif(trim(p_comment), ''), now())
  on conflict (order_id) do update set
    rating = excluded.rating,
    comment = excluded.comment
  returning id into v_feedback_id;

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

  if exists (
    select 1
    from "Order"
    where restaurant_id = p_restaurant_id
      and table_id = p_table_id
      and status in ('pending', 'accepted', 'preparing')
  ) then
    raise exception 'Cannot close table while kitchen-active orders exist.';
  end if;

  update "Order"
  set status = 'completed', updated_at = now()
  where restaurant_id = p_restaurant_id
    and table_id = p_table_id
    and status in ('ready', 'served');

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
grant execute on function submit_order_feedback_secure(text, text, integer, text) to anon, authenticated;
grant execute on function remove_staff_member_secure(text, text) to authenticated;
grant execute on function close_table_session(text, text) to authenticated;
