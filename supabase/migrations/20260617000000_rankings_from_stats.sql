create or replace function public.recalculate_menu_rankings_internal(p_restaurant_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with stats as (
    select
      menu_item.id,
      coalesce(item_stats.order_count_7d, 0)::integer as order_count_7d,
      coalesce(item_stats.avg_sentiment_score, 0.5)::numeric(5,4) as avg_sentiment_score,
      coalesce(item_stats.feedback_count_30d, 0)::integer as feedback_count
    from "MenuItem" menu_item
    left join "MenuItemStats" item_stats on item_stats.menu_item_id = menu_item.id
    where menu_item.restaurant_id = p_restaurant_id
  ),
  ranked as (
    select
      stats.*,
      count(*) over ()::integer as total_items,
      case
        when stats.order_count_7d = 0 then 'new'
        when stats.feedback_count >= 2 and stats.avg_sentiment_score >= 0.82 then 'loved'
        when stats.order_count_7d >= 10 then 'trending'
        when stats.feedback_count >= 2 and stats.avg_sentiment_score <= 0.35 then 'needs_review'
        else null
      end as sentiment_badge,
      row_number() over (
        order by
          ((stats.avg_sentiment_score * 60.0) + (least(stats.order_count_7d, 50)::numeric / 50.0 * 40.0)) desc,
          menu_item.display_order asc,
          menu_item.name asc
      )::integer as computed_rank
    from stats
    join "MenuItem" menu_item on menu_item.id = stats.id
  )
  update "MenuItem" menu_item
  set
    avg_sentiment_score = ranked.avg_sentiment_score,
    order_count_7d = ranked.order_count_7d,
    sentiment_badge = ranked.sentiment_badge,
    dynamic_rank = case
      when menu_item.ranking_locked then coalesce(menu_item.dynamic_rank, menu_item.display_order)
      when ranked.order_count_7d < 5 then least(ranked.computed_rank, greatest(1, ceil(ranked.total_items / 2.0)::integer))
      else ranked.computed_rank
    end,
    ranking_needs_recalc = false,
    updated_at = now()
  from ranked
  where menu_item.id = ranked.id;

  get diagnostics v_count = row_count;

  update "Restaurant"
  set ranking_needs_recalc = false,
      updated_at = now()
  where id = p_restaurant_id;

  return v_count;
end;
$$;

revoke all on function public.recalculate_menu_rankings_internal(text) from public;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin perform cron.unschedule('refresh-menu-item-stats-nightly'); exception when others then null; end;
    begin perform cron.unschedule('refresh-menu-item-stats'); exception when others then null; end;

    perform cron.schedule(
      'refresh-menu-item-stats',
      '*/15 * * * *',
      'select public.refresh_all_menu_item_stats();'
    );
  end if;
end $$;
