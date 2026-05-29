create or replace function get_revenue_forecast(
  p_restaurant_id text,
  p_days_ahead integer default 7
)
returns table(
  forecast_date date,
  predicted_orders integer,
  predicted_revenue numeric,
  confidence text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg_daily_orders numeric;
  v_avg_revenue_per_order numeric;
  v_dow_factors numeric[7];
  v_day integer;
  v_forecast_date date;
begin
  select count(*)::numeric / 28, coalesce(avg(total_amount), 0)
    into v_avg_daily_orders, v_avg_revenue_per_order
  from "Order"
  where restaurant_id = p_restaurant_id
    and status not in ('cancelled')
    and created_at >= now() - interval '28 days';

  for v_day in 1..7 loop
    select coalesce((count(*)::numeric / 4) / nullif(v_avg_daily_orders, 0), 1.0)
      into v_dow_factors[v_day]
    from "Order"
    where restaurant_id = p_restaurant_id
      and status not in ('cancelled')
      and extract(isodow from created_at) = v_day
      and created_at >= now() - interval '28 days';
    v_dow_factors[v_day] := coalesce(v_dow_factors[v_day], 1.0);
  end loop;

  for i in 0..(p_days_ahead - 1) loop
    v_forecast_date := (current_date + i * interval '1 day')::date;
    v_day := extract(isodow from v_forecast_date)::integer;
    return query select
      v_forecast_date,
      round(v_avg_daily_orders * v_dow_factors[v_day])::integer,
      round((v_avg_daily_orders * v_dow_factors[v_day]) * v_avg_revenue_per_order, 2),
      case
        when v_avg_daily_orders < 5 then 'low'
        when v_avg_daily_orders < 20 then 'medium'
        else 'high'
      end;
  end loop;
end;
$$;

create or replace view restaurant_staffing_hints as
select
  restaurant_id,
  extract(isodow from created_at)::integer as day_of_week,
  extract(hour from created_at)::integer as hour_of_day,
  count(*) as order_count,
  avg(extract(epoch from (updated_at - created_at))) / 60 as avg_prep_minutes
from "Order"
where status not in ('cancelled')
  and created_at >= now() - interval '90 days'
group by restaurant_id, day_of_week, hour_of_day;
