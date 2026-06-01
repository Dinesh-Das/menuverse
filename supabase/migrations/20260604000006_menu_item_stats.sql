-- Materialize rolling menu-item statistics so ranking recalculation reads one
-- compact row per item instead of joining the full order history each cycle.

create table if not exists "MenuItemStats" (
  menu_item_id text primary key references "MenuItem"(id) on delete cascade,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  order_count_7d integer not null default 0,
  avg_sentiment_score numeric(5,4) not null default 0.5,
  feedback_count_30d integer not null default 0,
  last_ordered_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists menu_item_stats_restaurant_idx
  on "MenuItemStats"(restaurant_id);

alter table if exists "MenuItemStats" enable row level security;

create or replace function public.refresh_menu_item_stats_for_item(p_menu_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into "MenuItemStats" (
    menu_item_id,
    restaurant_id,
    order_count_7d,
    avg_sentiment_score,
    feedback_count_30d,
    last_ordered_at,
    updated_at
  )
  select
    menu_item.id,
    menu_item.restaurant_id,
    coalesce(sum(
      case
        when customer_order.created_at > now() - interval '7 days'
          and customer_order.status <> 'cancelled'
          then order_item.quantity
        else 0
      end
    ), 0)::integer,
    coalesce(avg(feedback.sentiment_score) filter (
      where feedback.created_at > now() - interval '30 days'
        and feedback.sentiment_score is not null
    ), 0.5)::numeric(5,4),
    (count(feedback.id) filter (
      where feedback.created_at > now() - interval '30 days'
    ))::integer,
    max(customer_order.created_at) filter (
      where customer_order.status <> 'cancelled'
    )
  from "MenuItem" menu_item
  left join "OrderItem" order_item on order_item.menu_item_id = menu_item.id
  left join "Order" customer_order on customer_order.id = order_item.order_id
  left join "OrderFeedback" feedback on feedback.order_id = customer_order.id
  where menu_item.id = p_menu_item_id
  group by menu_item.id, menu_item.restaurant_id
  on conflict (menu_item_id) do update set
    restaurant_id = excluded.restaurant_id,
    order_count_7d = excluded.order_count_7d,
    avg_sentiment_score = excluded.avg_sentiment_score,
    feedback_count_30d = excluded.feedback_count_30d,
    last_ordered_at = excluded.last_ordered_at,
    updated_at = now();
end;
$$;

create or replace function public.refresh_menu_item_stats_for_restaurant(p_restaurant_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into "MenuItemStats" (
    menu_item_id,
    restaurant_id,
    order_count_7d,
    avg_sentiment_score,
    feedback_count_30d,
    last_ordered_at,
    updated_at
  )
  select
    menu_item.id,
    menu_item.restaurant_id,
    coalesce(sum(
      case
        when customer_order.created_at > now() - interval '7 days'
          and customer_order.status <> 'cancelled'
          then order_item.quantity
        else 0
      end
    ), 0)::integer,
    coalesce(avg(feedback.sentiment_score) filter (
      where feedback.created_at > now() - interval '30 days'
        and feedback.sentiment_score is not null
    ), 0.5)::numeric(5,4),
    (count(feedback.id) filter (
      where feedback.created_at > now() - interval '30 days'
    ))::integer,
    max(customer_order.created_at) filter (
      where customer_order.status <> 'cancelled'
    ),
    now()
  from "MenuItem" menu_item
  left join "OrderItem" order_item on order_item.menu_item_id = menu_item.id
  left join "Order" customer_order on customer_order.id = order_item.order_id
  left join "OrderFeedback" feedback on feedback.order_id = customer_order.id
  where menu_item.restaurant_id = p_restaurant_id
  group by menu_item.id, menu_item.restaurant_id
  on conflict (menu_item_id) do update set
    restaurant_id = excluded.restaurant_id,
    order_count_7d = excluded.order_count_7d,
    avg_sentiment_score = excluded.avg_sentiment_score,
    feedback_count_30d = excluded.feedback_count_30d,
    last_ordered_at = excluded.last_ordered_at,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.mark_menu_item_stats_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu_item_id text;
  v_restaurant_id text;
begin
  v_menu_item_id := new.menu_item_id;
  select restaurant_id into v_restaurant_id
  from "MenuItem"
  where id = v_menu_item_id;

  perform public.refresh_menu_item_stats_for_item(v_menu_item_id);
  update "MenuItem"
  set ranking_needs_recalc = true,
      updated_at = now()
  where id = v_menu_item_id;
  update "Restaurant"
  set ranking_needs_recalc = true,
      updated_at = now()
  where id = v_restaurant_id;
  return new;
end;
$$;

create or replace function public.refresh_feedback_menu_item_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu_item_id text;
begin
  for v_menu_item_id in
    select distinct menu_item_id
    from "OrderItem"
    where order_id = new.order_id
  loop
    perform public.refresh_menu_item_stats_for_item(v_menu_item_id);
    update "MenuItem"
    set ranking_needs_recalc = true,
        updated_at = now()
    where id = v_menu_item_id;
  end loop;
  update "Restaurant"
  set ranking_needs_recalc = true,
      updated_at = now()
  where id = new.restaurant_id;
  return new;
end;
$$;

create or replace function public.refresh_order_menu_item_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu_item_id text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  for v_menu_item_id in
    select distinct menu_item_id
    from "OrderItem"
    where order_id = new.id
  loop
    perform public.refresh_menu_item_stats_for_item(v_menu_item_id);
    update "MenuItem"
    set ranking_needs_recalc = true,
        updated_at = now()
    where id = v_menu_item_id;
  end loop;
  update "Restaurant"
  set ranking_needs_recalc = true,
      updated_at = now()
  where id = new.restaurant_id;
  return new;
end;
$$;

drop trigger if exists trg_refresh_stats_order_item on "OrderItem";
create trigger trg_refresh_stats_order_item
  after insert on "OrderItem"
  for each row execute function public.mark_menu_item_stats_dirty();

drop trigger if exists trg_refresh_stats_feedback on "OrderFeedback";
create trigger trg_refresh_stats_feedback
  after insert or update of sentiment_score on "OrderFeedback"
  for each row execute function public.refresh_feedback_menu_item_stats();

drop trigger if exists trg_refresh_stats_order_status on "Order";
create trigger trg_refresh_stats_order_status
  after update of status on "Order"
  for each row execute function public.refresh_order_menu_item_stats();

create or replace function public.refresh_all_menu_item_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant record;
  v_count integer := 0;
begin
  for v_restaurant in
    select id from "Restaurant"
  loop
    v_count := v_count + public.refresh_menu_item_stats_for_restaurant(v_restaurant.id);
    update "MenuItem"
    set ranking_needs_recalc = true,
        updated_at = now()
    where restaurant_id = v_restaurant.id;
    update "Restaurant"
    set ranking_needs_recalc = true,
        updated_at = now()
    where id = v_restaurant.id;
  end loop;
  return v_count;
end;
$$;

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

revoke all on function public.refresh_menu_item_stats_for_item(text) from public;
revoke all on function public.refresh_menu_item_stats_for_restaurant(text) from public;
revoke all on function public.refresh_all_menu_item_stats() from public;
revoke all on function public.recalculate_menu_rankings_internal(text) from public;

select public.refresh_all_menu_item_stats();

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('refresh-menu-item-stats-nightly');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'refresh-menu-item-stats-nightly',
      '15 2 * * *',
      'select public.refresh_all_menu_item_stats();'
    );
  end if;
end $$;
