alter table if exists "Order"
  add column if not exists guest_profile_spend_recorded boolean not null default false,
  add column if not exists points_redeemed integer not null default 0,
  add column if not exists loyalty_discount_amount numeric(10,2) not null default 0;

create or replace function resolve_or_create_guest_profile(
  p_restaurant_id text,
  p_name text default null,
  p_phone text default null,
  p_email text default null,
  p_marketing boolean default false,
  p_session_id text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  select id into v_id
  from "GuestProfile"
  where restaurant_id = p_restaurant_id
    and (
      (nullif(trim(p_phone), '') is not null and phone = nullif(trim(p_phone), ''))
      or (nullif(trim(p_email), '') is not null and lower(email) = lower(nullif(trim(p_email), '')))
    )
  limit 1;

  if v_id is null then
    insert into "GuestProfile"(
      restaurant_id,
      name,
      phone,
      email,
      marketing_consent,
      visit_count
    )
    values (
      p_restaurant_id,
      nullif(trim(p_name), ''),
      nullif(trim(p_phone), ''),
      lower(nullif(trim(p_email), '')),
      coalesce(p_marketing, false),
      1
    )
    returning id into v_id;
  else
    update "GuestProfile"
    set name = coalesce(nullif(trim(p_name), ''), name),
        phone = coalesce(nullif(trim(p_phone), ''), phone),
        email = coalesce(lower(nullif(trim(p_email), '')), email),
        marketing_consent = coalesce(p_marketing, false) or marketing_consent,
        last_visit_at = now(),
        visit_count = visit_count + 1,
        updated_at = now()
    where id = v_id;
  end if;

  if p_session_id is not null then
    update "TableSession"
    set guest_profile_id = v_id,
        updated_at = now()
    where id = p_session_id
      and restaurant_id = p_restaurant_id;
  end if;

  return v_id;
end;
$$;

create or replace function get_guest_profile_for_session(p_session_token text)
returns table(id text, loyalty_points integer, name text)
language sql
stable
security definer
set search_path = public
as $$
  select gp.id, gp.loyalty_points, gp.name
  from "TableSession" ts
  join "GuestProfile" gp on gp.id = ts.guest_profile_id
  where ts.token = p_session_token
    and ts.status in ('active', 'billing')
  limit 1;
$$;

create or replace function update_guest_profile_on_order(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id text;
  v_spend numeric;
  v_recorded boolean;
begin
  select o.guest_profile_id, o.total_amount, o.guest_profile_spend_recorded
  into v_profile_id, v_spend, v_recorded
  from "Order" o
  where o.id = p_order_id;

  if v_profile_id is not null and coalesce(v_recorded, false) = false then
    update "GuestProfile"
    set total_spend = total_spend + coalesce(v_spend, 0),
        loyalty_points = loyalty_points + floor(coalesce(v_spend, 0) / 10)::int,
        last_visit_at = now(),
        updated_at = now()
    where id = v_profile_id;

    update "Order"
    set guest_profile_spend_recorded = true,
        updated_at = now()
    where id = p_order_id;
  end if;
end;
$$;

create or replace function admin_sentiment_trend(p_restaurant_id text, p_days int default 30)
returns table(day date, avg_score numeric, review_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    date_trunc('day', created_at)::date as day,
    round(avg(sentiment_score)::numeric, 3) as avg_score,
    count(*) as review_count
  from "OrderFeedback"
  where restaurant_id = p_restaurant_id
    and created_at > now() - make_interval(days => p_days)
    and sentiment_score is not null
  group by 1
  order by 1;
$$;
