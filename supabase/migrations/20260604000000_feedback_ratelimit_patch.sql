-- Add a restaurant-scoped fallback feedback rate limit for delivery and
-- takeaway orders that do not belong to a table session.

create or replace function public.enforce_feedback_submission_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_session_id text;
  v_restaurant_id text;
  v_recent_count integer;
begin
  select table_session_id, restaurant_id
    into v_table_session_id, v_restaurant_id
  from "Order"
  where id = new.order_id;

  if v_table_session_id is not null then
    select count(*) into v_recent_count
    from "OrderFeedback" feedback
    join "Order" customer_order on customer_order.id = feedback.order_id
    where customer_order.table_session_id = v_table_session_id
      and feedback.created_at > now() - interval '1 hour';

    if v_recent_count >= 30 then
      raise exception 'Feedback limit reached for this table session. Please try again later.';
    end if;
  else
    select count(*) into v_recent_count
    from "OrderFeedback" feedback
    join "Order" customer_order on customer_order.id = feedback.order_id
    where customer_order.restaurant_id = v_restaurant_id
      and customer_order.table_session_id is null
      and feedback.created_at > now() - interval '1 hour';

    if v_recent_count >= 10 then
      raise exception 'Feedback rate limit reached. Please try again later.';
    end if;
  end if;

  return new;
end;
$$;
