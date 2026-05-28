do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception
    when insufficient_privilege or undefined_file then
      null;
  end;
end $$;

create or replace function public.try_jsonb_array(p_value text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_json jsonb;
begin
  if p_value is null or trim(p_value) = '' then
    return '[]'::jsonb;
  end if;

  begin
    v_json := p_value::jsonb;
  exception
    when others then
      return '[]'::jsonb;
  end;

  if jsonb_typeof(v_json) = 'array' then
    return v_json;
  end if;

  return '[]'::jsonb;
end;
$$;

alter table if exists "MenuItem"
  add column if not exists tags_json jsonb not null default '[]'::jsonb;

alter table if exists "MenuItem"
  alter column tags_json type jsonb using public.try_jsonb_array(tags_json::text),
  alter column tags_json set default '[]'::jsonb;

drop function if exists submit_order_feedback_secure(text, text, integer, text, integer, integer, integer, jsonb);

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
  v_function_url text;
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

  v_function_url := nullif(
    trim(trailing '/' from coalesce(
      nullif(current_setting('app.settings.edge_function_base_url', true), ''),
      nullif(current_setting('app.settings.supabase_url', true), '')
    )),
    ''
  );

  if v_function_url is not null then
    if position('/functions/v1' in v_function_url) = 0 then
      v_function_url := v_function_url || '/functions/v1';
    end if;

    begin
      perform net.http_post(
        url := v_function_url || '/analyse-feedback',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('feedback_id', v_feedback_id),
        timeout_milliseconds := 2000
      );
    exception
      when invalid_schema_name or undefined_function then
        null;
    end;
  end if;

  return v_feedback_id;
end;
$$;

grant execute on function submit_order_feedback_secure(text, text, integer, text, integer, integer, integer, jsonb)
  to anon, authenticated;

create or replace function recalculate_menu_rankings(p_restaurant_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not (auth.role() = 'service_role' or app_admin_can_access(p_restaurant_id)) then
    raise exception 'Not authorized.';
  end if;

  with stats as (
    select
      mi.id,
      mi.restaurant_id,
      coalesce(sum(
        case
          when o.created_at > now() - interval '7 days'
            and o.status <> 'cancelled'
          then oi.quantity
          else 0
        end
      ), 0)::integer as order_count_7d,
      coalesce(avg(ofb.sentiment_score) filter (
        where ofb.created_at > now() - interval '30 days'
          and ofb.sentiment_score is not null
      ), 0.5)::numeric(5,4) as avg_sentiment_score,
      count(ofb.id) filter (where ofb.created_at > now() - interval '30 days') as feedback_count
    from "MenuItem" mi
    left join "OrderItem" oi on oi.menu_item_id = mi.id
    left join "Order" o on o.id = oi.order_id
    left join "OrderFeedback" ofb on ofb.order_id = o.id
    where mi.restaurant_id = p_restaurant_id
    group by mi.id, mi.restaurant_id
  ),
  ranked as (
    select
      s.*,
      count(*) over ()::integer as total_items,
      case
        when s.order_count_7d = 0 then 'new'
        when s.feedback_count >= 2 and s.avg_sentiment_score >= 0.82 then 'loved'
        when s.order_count_7d >= 10 then 'trending'
        when s.feedback_count >= 2 and s.avg_sentiment_score <= 0.35 then 'needs_review'
        else null
      end as sentiment_badge,
      row_number() over (
        order by
          ((s.avg_sentiment_score * 60.0) + (least(s.order_count_7d, 50)::numeric / 50.0 * 40.0)) desc,
          mi.display_order asc,
          mi.name asc
      )::integer as computed_rank
    from stats s
    join "MenuItem" mi on mi.id = s.id
  )
  update "MenuItem" mi
  set
    avg_sentiment_score = ranked.avg_sentiment_score,
    order_count_7d = ranked.order_count_7d,
    sentiment_badge = ranked.sentiment_badge,
    tags_json = (
      select coalesce(jsonb_agg(dedup.tag order by dedup.sort_order, dedup.tag), '[]'::jsonb)
      from (
        select tag, min(sort_order) as sort_order
        from (
          select existing.tag, existing.sort_order
          from jsonb_array_elements_text(public.try_jsonb_array(mi.tags_json::text))
            with ordinality as existing(tag, sort_order)
          where existing.tag not in ('new', 'loved', 'trending', 'needs_review')

          union all

          select ranked.sentiment_badge, 1000000::bigint
          where ranked.sentiment_badge is not null
        ) merged
        group by tag
      ) dedup
    ),
    dynamic_rank = case
      when mi.ranking_locked then coalesce(mi.dynamic_rank, mi.display_order)
      when ranked.order_count_7d < 5 then least(ranked.computed_rank, greatest(1, ceil(ranked.total_items / 2.0)::integer))
      else ranked.computed_rank
    end,
    updated_at = now()
  from ranked
  where mi.id = ranked.id
    and mi.restaurant_id = p_restaurant_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function recalculate_menu_rankings(text) to authenticated;
