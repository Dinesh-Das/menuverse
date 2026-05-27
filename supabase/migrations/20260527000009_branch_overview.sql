alter table if exists "Restaurant"
  add column if not exists group_owner_id text;

create or replace function admin_branch_overview(p_group_owner_id text)
returns table(
  restaurant_id text,
  restaurant_name text,
  orders_today bigint,
  revenue_today numeric,
  avg_sentiment numeric,
  active_tables bigint,
  top_dish text
)
language sql
stable
security definer
set search_path = public
as $$
  with restaurants as (
    select id, name
    from "Restaurant"
    where group_owner_id = p_group_owner_id
  ),
  today_orders as (
    select restaurant_id, count(*) as orders_today, coalesce(sum(total_amount) filter (where status <> 'cancelled'), 0) as revenue_today
    from "Order"
    where created_at >= date_trunc('day', now())
    group by restaurant_id
  ),
  sentiment as (
    select restaurant_id, round(avg(sentiment_score)::numeric, 3) as avg_sentiment
    from "OrderFeedback"
    where created_at >= now() - interval '30 days'
      and sentiment_score is not null
    group by restaurant_id
  ),
  active_sessions as (
    select restaurant_id, count(distinct table_id) as active_tables
    from "TableSession"
    where status in ('active', 'billing')
    group by restaurant_id
  ),
  dish_rank as (
    select o.restaurant_id, oi.name, count(*) as order_count,
           row_number() over (partition by o.restaurant_id order by count(*) desc, oi.name) as rank
    from "Order" o
    join "OrderItem" oi on oi.order_id = o.id
    where o.created_at >= now() - interval '30 days'
      and o.status <> 'cancelled'
    group by o.restaurant_id, oi.name
  )
  select
    r.id,
    r.name,
    coalesce(t.orders_today, 0),
    coalesce(t.revenue_today, 0),
    coalesce(s.avg_sentiment, 0.5),
    coalesce(a.active_tables, 0),
    coalesce(d.name, '-')
  from restaurants r
  left join today_orders t on t.restaurant_id = r.id
  left join sentiment s on s.restaurant_id = r.id
  left join active_sessions a on a.restaurant_id = r.id
  left join dish_rank d on d.restaurant_id = r.id and d.rank = 1
  order by r.name;
$$;
