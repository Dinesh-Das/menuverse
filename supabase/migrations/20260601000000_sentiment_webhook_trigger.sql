-- Asynchronously analyse new feedback after it is saved.
--
-- Configure these protected Postgres settings in the Supabase project:
--   alter database postgres set "app.settings.supabase_url" = 'https://your-project.supabase.co';
--   alter database postgres set "app.settings.service_role_key" = '<service-role-key>';
--
-- The legacy aliases app.supabase_url and app.service_role_key are also supported.
-- As an alternative, configure a Supabase Dashboard Database Webhook for
-- public.OrderFeedback INSERT and drop trg_sentiment_analysis to avoid duplicate requests.

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_sentiment_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_service_role_key text;
begin
  v_url := nullif(
    trim(trailing '/' from coalesce(
      nullif(current_setting('app.settings.edge_function_base_url', true), ''),
      nullif(current_setting('app.settings.supabase_url', true), ''),
      nullif(current_setting('app.supabase_url', true), '')
    )),
    ''
  );
  v_service_role_key := coalesce(
    nullif(current_setting('app.settings.service_role_key', true), ''),
    nullif(current_setting('app.service_role_key', true), '')
  );

  if v_url is null or v_service_role_key is null then
    return new;
  end if;

  if position('/functions/v1' in v_url) = 0 then
    v_url := v_url || '/functions/v1';
  end if;

  perform net.http_post(
    url := v_url || '/analyse-feedback',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object('feedback_id', new.id::text),
    timeout_milliseconds := 2000
  );

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists trg_sentiment_analysis on public."OrderFeedback";
create trigger trg_sentiment_analysis
  after insert on public."OrderFeedback"
  for each row
  execute function public.notify_sentiment_analysis();

-- The trigger owns analysis enqueueing now. Keep the validated feedback RPC focused
-- on persistence so the customer request does not depend on Edge Function latency.
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
    and o.status in ('served', 'completed')
  limit 1;

  if v_order.id is null then
    raise exception 'Feedback is only available for served or completed orders in this table session.';
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
