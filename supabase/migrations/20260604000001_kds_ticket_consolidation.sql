-- Consolidate open orders for a table session into one kitchen ticket payload.

create or replace function public.consolidate_session_orders_to_ticket(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id text;
  v_result jsonb;
begin
  select ts.restaurant_id
    into v_restaurant_id
  from "TableSession" ts
  where ts.id = p_session_id;

  if v_restaurant_id is null then
    raise exception 'Table session not found.';
  end if;

  if not (auth.role() = 'service_role' or app_staff_can_access(v_restaurant_id)) then
    raise exception 'Not authorized to print this kitchen ticket.';
  end if;

  select jsonb_build_object(
    'session_id', ts.id,
    'restaurant_id', ts.restaurant_id,
    'table_id', ts.table_id,
    'table', table_row.number,
    'opened_at', ts.opened_at,
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'order_id', customer_order.id,
          'status', customer_order.status,
          'special_instructions', customer_order.special_instructions,
          'created_at', customer_order.created_at
        )
        order by customer_order.created_at
      )
      from "Order" customer_order
      where customer_order.table_session_id = ts.id
        and customer_order.status not in ('cancelled', 'completed')
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'order_id', customer_order.id,
          'name', order_item.name,
          'quantity', order_item.quantity,
          'modifiers', public.try_jsonb_array(order_item.modifiers_json),
          'note', order_item.item_note
        )
        order by customer_order.created_at, order_item.name
      )
      from "Order" customer_order
      join "OrderItem" order_item on order_item.order_id = customer_order.id
      where customer_order.table_session_id = ts.id
        and customer_order.status not in ('cancelled', 'completed')
    ), '[]'::jsonb)
  )
    into v_result
  from "TableSession" ts
  join "Table" table_row on table_row.id = ts.table_id
  where ts.id = p_session_id;

  return v_result;
end;
$$;

revoke all on function public.consolidate_session_orders_to_ticket(text) from public;
grant execute on function public.consolidate_session_orders_to_ticket(text) to authenticated, service_role;
