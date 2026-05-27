create or replace function recalculate_menu_rankings(p_restaurant_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not app_admin_can_access(p_restaurant_id) then
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
    sentiment_badge = case
      when ranked.order_count_7d = 0 then 'new'
      when ranked.feedback_count >= 2 and ranked.avg_sentiment_score >= 0.82 then 'loved'
      when ranked.order_count_7d >= 10 then 'trending'
      when ranked.feedback_count >= 2 and ranked.avg_sentiment_score <= 0.35 then 'needs_review'
      else null
    end,
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
