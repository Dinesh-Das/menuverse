do $$
begin
  create type loyalty_tier as enum ('bronze', 'silver', 'gold', 'platinum');
exception
  when duplicate_object then null;
end $$;

alter table if exists "GuestProfile"
  add column if not exists loyalty_tier loyalty_tier not null default 'bronze';

alter table if exists "MarketingCampaign"
  add column if not exists failed_count integer not null default 0,
  add column if not exists message_template text;

create or replace function recalculate_loyalty_tier(p_guest_id text)
returns loyalty_tier
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile "GuestProfile"%rowtype;
  v_tier loyalty_tier;
begin
  select * into v_profile
  from "GuestProfile"
  where id = p_guest_id;

  if v_profile.id is null then
    raise exception 'Guest profile not found.';
  end if;

  v_tier := case
    when coalesce(v_profile.visit_count, 0) >= 50 or coalesce(v_profile.total_spend, 0) >= 50000 then 'platinum'::loyalty_tier
    when coalesce(v_profile.visit_count, 0) >= 20 or coalesce(v_profile.total_spend, 0) >= 10000 then 'gold'::loyalty_tier
    when coalesce(v_profile.visit_count, 0) >= 5 or coalesce(v_profile.total_spend, 0) >= 2000 then 'silver'::loyalty_tier
    else 'bronze'::loyalty_tier
  end;

  update "GuestProfile"
  set loyalty_tier = v_tier,
      updated_at = now()
  where id = p_guest_id;

  return v_tier;
end;
$$;

grant execute on function recalculate_loyalty_tier(text) to authenticated;

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

  if v_profile_id is not null then
    perform recalculate_loyalty_tier(v_profile_id);
  end if;
end;
$$;

drop function if exists get_guest_profile_for_session(text);
create or replace function get_guest_profile_for_session(p_session_token text)
returns table(id text, loyalty_points integer, loyalty_tier loyalty_tier, name text, phone text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select gp.id, gp.loyalty_points, gp.loyalty_tier, gp.name, gp.phone, gp.email
  from "TableSession" ts
  join "GuestProfile" gp on gp.id = ts.guest_profile_id
  where ts.token = p_session_token
    and ts.status in ('active', 'billing')
  limit 1;
$$;

grant execute on function get_guest_profile_for_session(text) to anon, authenticated;

create or replace function update_guest_preferences(p_feedback_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id text;
  v_new_tags text[];
begin
  select o.guest_profile_id into v_guest_id
  from "OrderFeedback" ofb
  join "Order" o on o.id = ofb.order_id
  where ofb.id = p_feedback_id;

  if v_guest_id is null then
    return jsonb_build_object('updated', false, 'reason', 'no_guest_profile');
  end if;

  with guest_feedback as (
    select ofb.*, o.guest_profile_id
    from "OrderFeedback" ofb
    join "Order" o on o.id = ofb.order_id
    where o.guest_profile_id = v_guest_id
  ),
  item_feedback as (
    select
      gf.id as feedback_id,
      gf.rating,
      gf.food_rating,
      gf.value_rating,
      gf.sentiment_topics,
      coalesce((item_rating.value->>'rating')::integer, gf.food_rating, gf.rating) as item_score,
      mi.dietary_flag,
      public.try_jsonb_array(mi.tags_json::text) as item_tags
    from guest_feedback gf
    join "OrderItem" oi on oi.order_id = gf.order_id
    left join lateral (
      select elem as value
      from jsonb_array_elements(coalesce(gf.item_ratings, '[]'::jsonb)) elem
      where elem->>'menu_item_id' = oi.menu_item_id
         or elem->>'order_item_id' = oi.id
      limit 1
    ) item_rating on true
    left join "MenuItem" mi on mi.id = oi.menu_item_id
  ),
  tag_candidates as (
    select 'prefers_veg' as tag
    where (
      select count(*)
      from item_feedback
      where item_score >= 4
        and sentiment_topics ? 'food_quality'
        and (dietary_flag = 'veg' or item_tags ? 'veg' or item_tags ? 'vegan')
    ) >= 3

    union all
    select 'spicy'
    where (
      select count(*)
      from item_feedback
      where item_score >= 4
        and sentiment_topics ? 'food_quality'
        and item_tags ? 'spicy'
    ) >= 3

    union all
    select 'portion_lover'
    where (
      select count(*)
      from guest_feedback
      where rating >= 4
        and sentiment_topics ? 'portion_size'
    ) >= 3

    union all
    select 'value_seeker'
    where (
      select count(*)
      from guest_feedback
      where coalesce(value_rating, rating) >= 4
    ) >= 3

    union all
    select 'ambiance_focused'
    where (
      select count(*)
      from guest_feedback
      where rating >= 4
        and sentiment_topics ? 'ambiance'
    ) >= 3
  )
  select coalesce(array_agg(tag), array[]::text[]) into v_new_tags
  from tag_candidates;

  if cardinality(v_new_tags) = 0 then
    return jsonb_build_object('updated', false, 'guest_id', v_guest_id, 'tags', '[]'::jsonb);
  end if;

  update "GuestProfile" gp
  set tags = (
        select coalesce(jsonb_agg(distinct_tags.tag order by distinct_tags.tag), '[]'::jsonb)
        from (
          select existing.tag
          from jsonb_array_elements_text(coalesce(gp.tags, '[]'::jsonb)) existing(tag)
          union
          select unnest(v_new_tags)
        ) distinct_tags
      ),
      updated_at = now()
  where gp.id = v_guest_id;

  return jsonb_build_object('updated', true, 'guest_id', v_guest_id, 'tags', to_jsonb(v_new_tags));
end;
$$;

grant execute on function update_guest_preferences(text) to authenticated;
