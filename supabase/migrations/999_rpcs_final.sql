-- Keep fresh installs aligned after the older 20260516 RPC migrations run.

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
    table_id := v_session.table_id;
    restaurant_id := v_session.restaurant_id;
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

grant execute on function create_order_secure(text, text, text, jsonb, text, text) to anon, authenticated;
grant execute on function start_table_session(text, text, text) to anon, authenticated;
grant execute on function close_table_session(text, text) to authenticated;
