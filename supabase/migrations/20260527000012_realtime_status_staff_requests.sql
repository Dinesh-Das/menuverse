alter table if exists "Order" replica identity full;
alter table if exists "StaffRequest" replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'Order'
    ) then
      alter publication supabase_realtime add table public."Order";
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'StaffRequest'
    ) then
      alter publication supabase_realtime add table public."StaffRequest";
    end if;
  end if;
end $$;

create or replace function update_order_status_secure(
  p_restaurant_id text,
  p_order_id text,
  p_status text,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order "Order"%rowtype;
begin
  if not app_rls_staff_can_access(p_restaurant_id) then
    raise exception 'Not authorized.';
  end if;

  if p_status not in ('pending', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled') then
    raise exception 'Invalid order status.';
  end if;

  select * into v_order
  from "Order"
  where id = p_order_id
    and restaurant_id = p_restaurant_id
  for update;

  if v_order.id is null then
    raise exception 'Order not found for this restaurant.';
  end if;

  if v_order.status <> p_status then
    if not (
      (v_order.status = 'pending' and p_status in ('accepted', 'preparing', 'cancelled')) or
      (v_order.status = 'accepted' and p_status in ('preparing', 'cancelled')) or
      (v_order.status = 'preparing' and p_status in ('ready', 'cancelled')) or
      (v_order.status = 'ready' and p_status = 'served') or
      (v_order.status = 'served' and p_status = 'completed')
    ) then
      raise exception 'Invalid order status transition: % -> %', v_order.status, p_status;
    end if;
  end if;

  update "Order"
  set status = p_status,
      cancel_reason = case
        when p_status = 'cancelled' then nullif(trim(coalesce(p_cancel_reason, '')), '')
        else null
      end,
      updated_at = now()
  where id = p_order_id
    and restaurant_id = p_restaurant_id
  returning * into v_order;

  if p_status = 'completed' then
    begin
      perform update_guest_profile_on_order(p_order_id);
    exception
      when undefined_function then null;
    end;
  end if;

  return to_jsonb(v_order);
end;
$$;

grant execute on function update_order_status_secure(text, text, text, text) to authenticated;
