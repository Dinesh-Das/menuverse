-- Allow feedback at the "ready" stage. The customer UI can prompt once food
-- is ready for service, so the secure RPC must accept the same status.

create or replace function submit_order_feedback_secure(
  p_order_id text,
  p_table_session_token text,
  p_rating integer,
  p_comment text default null,
  p_food_rating integer default null,
  p_service_rating integer default null,
  p_value_rating integer default null,
  p_item_ratings jsonb default '[]'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order "Order"%rowtype;
  v_feedback_id text;
  v_label text;
  v_score numeric(5,4);
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.';
  end if;

  if p_food_rating is not null and (p_food_rating < 1 or p_food_rating > 5) then
    raise exception 'Food rating must be between 1 and 5.';
  end if;

  if p_service_rating is not null and (p_service_rating < 1 or p_service_rating > 5) then
    raise exception 'Service rating must be between 1 and 5.';
  end if;

  if p_value_rating is not null and (p_value_rating < 1 or p_value_rating > 5) then
    raise exception 'Value rating must be between 1 and 5.';
  end if;

  select o.* into v_order
  from "Order" o
  join "TableSession" ts on ts.id = o.table_session_id
  where o.id = p_order_id
    and ts.token = p_table_session_token
    and o.status in ('ready', 'served', 'completed')
  limit 1;

  if v_order.id is null then
    raise exception 'Feedback is only available for ready, served, or completed orders in this table session.';
  end if;

  v_label := case
    when p_rating >= 4 then 'positive'
    when p_rating = 3 then 'neutral'
    else 'negative'
  end;
  v_score := round((p_rating::numeric / 5.0)::numeric, 4);

  insert into "OrderFeedback" (
    id,
    restaurant_id,
    order_id,
    rating,
    comment,
    food_rating,
    service_rating,
    value_rating,
    item_ratings,
    sentiment_label,
    sentiment_score,
    sentiment_topics,
    key_phrase,
    analysed_at,
    flag_for_review,
    analysis_source,
    created_at
  )
  values (
    gen_random_uuid()::text,
    v_order.restaurant_id,
    v_order.id,
    p_rating,
    nullif(left(trim(coalesce(p_comment, '')), 200), ''),
    p_food_rating,
    p_service_rating,
    p_value_rating,
    coalesce(p_item_ratings, '[]'::jsonb),
    v_label,
    v_score,
    case when p_rating <= 2 then '["experience"]'::jsonb else '[]'::jsonb end,
    left(nullif(trim(coalesce(p_comment, '')), ''), 160),
    now(),
    p_rating <= 2,
    'rating_baseline',
    now()
  )
  on conflict (order_id) do update set
    rating = excluded.rating,
    comment = excluded.comment,
    food_rating = excluded.food_rating,
    service_rating = excluded.service_rating,
    value_rating = excluded.value_rating,
    item_ratings = excluded.item_ratings,
    sentiment_label = excluded.sentiment_label,
    sentiment_score = excluded.sentiment_score,
    sentiment_topics = excluded.sentiment_topics,
    key_phrase = excluded.key_phrase,
    analysed_at = excluded.analysed_at,
    flag_for_review = excluded.flag_for_review,
    analysis_source = excluded.analysis_source
  returning id into v_feedback_id;

  return v_feedback_id;
end;
$$;

grant execute on function submit_order_feedback_secure(text, text, integer, text, integer, integer, integer, jsonb)
  to anon, authenticated;
