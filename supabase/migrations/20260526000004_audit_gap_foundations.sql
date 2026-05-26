create extension if not exists pgcrypto;

-- Restaurant-owned image assets for logos and menu photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-assets',
  'restaurant-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.app_storage_staff_can_access(p_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or (
      coalesce(
        auth.jwt()->>'restaurantId',
        auth.jwt()->'app_metadata'->>'restaurantId',
        auth.jwt()->'user_metadata'->>'restaurantId'
      ) = p_restaurant_id
      and coalesce(
        auth.jwt()->>'role',
        auth.jwt()->'app_metadata'->>'role',
        auth.jwt()->'user_metadata'->>'role'
      ) in ('owner', 'manager', 'staff')
    )
    or exists (
      select 1
      from "User" u
      where u.id = auth.uid()::text
        and u.restaurant_id = p_restaurant_id
        and u.role in ('owner', 'manager', 'staff')
    );
$$;

drop policy if exists "restaurant_assets_public_read" on storage.objects;
drop policy if exists "restaurant_assets_staff_upload" on storage.objects;
drop policy if exists "restaurant_assets_staff_update" on storage.objects;
drop policy if exists "restaurant_assets_staff_delete" on storage.objects;

create policy "restaurant_assets_public_read" on storage.objects
  for select using (bucket_id = 'restaurant-assets');

create policy "restaurant_assets_staff_upload" on storage.objects
  for insert with check (
    bucket_id = 'restaurant-assets'
    and app_storage_staff_can_access((storage.foldername(name))[2])
  );

create policy "restaurant_assets_staff_update" on storage.objects
  for update using (
    bucket_id = 'restaurant-assets'
    and app_storage_staff_can_access((storage.foldername(name))[2])
  ) with check (
    bucket_id = 'restaurant-assets'
    and app_storage_staff_can_access((storage.foldername(name))[2])
  );

create policy "restaurant_assets_staff_delete" on storage.objects
  for delete using (
    bucket_id = 'restaurant-assets'
    and app_storage_staff_can_access((storage.foldername(name))[2])
  );

alter table if exists "Restaurant"
  add column if not exists pos_provider text,
  add column if not exists pos_sync_enabled boolean not null default false,
  add column if not exists printer_enabled boolean not null default false,
  add column if not exists whatsapp_enabled boolean not null default false;

alter table if exists "Payment"
  add column if not exists provider text not null default 'razorpay',
  add column if not exists payment_method text,
  add column if not exists provider_fee numeric(12,2),
  add column if not exists paid_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists "OrderFeedback"
  add column if not exists food_rating integer check (food_rating between 1 and 5),
  add column if not exists service_rating integer check (service_rating between 1 and 5),
  add column if not exists value_rating integer check (value_rating between 1 and 5),
  add column if not exists item_ratings jsonb not null default '[]'::jsonb,
  add column if not exists sentiment_label text,
  add column if not exists sentiment_score numeric(5,4),
  add column if not exists sentiment_topics jsonb not null default '[]'::jsonb,
  add column if not exists key_phrase text,
  add column if not exists analysed_at timestamptz,
  add column if not exists flag_for_review boolean not null default false,
  add column if not exists analysis_source text;

alter table if exists "MenuItem"
  add column if not exists avg_sentiment_score numeric(5,4) not null default 0.5,
  add column if not exists sentiment_badge text,
  add column if not exists order_count_7d integer not null default 0,
  add column if not exists dynamic_rank integer,
  add column if not exists ranking_locked boolean not null default false;

create index if not exists "MenuItem_restaurant_dynamic_rank_idx"
  on "MenuItem"("restaurant_id", "dynamic_rank", "display_order");

create index if not exists "OrderFeedback_restaurant_created_idx"
  on "OrderFeedback"("restaurant_id", "created_at");

create table if not exists "StaffInvite" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager', 'staff')),
  status text not null default 'sent' check (status in ('sent', 'accepted', 'revoked', 'failed')),
  invited_by text references "User"(id) on delete set null,
  invited_user_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists "StaffInvite_restaurant_idx"
  on "StaffInvite"("restaurant_id", "created_at");

create table if not exists "IntegrationJob" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  order_id text references "Order"(id) on delete set null,
  job_type text not null check (job_type in ('printer', 'whatsapp', 'pos')),
  provider text,
  status text not null default 'pending' check (status in ('pending', 'pending_configuration', 'delivered', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  response jsonb,
  error text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists "IntegrationJob_restaurant_type_idx"
  on "IntegrationJob"("restaurant_id", "job_type", "created_at");

create table if not exists "GuestContact" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  table_session_id text not null unique references "TableSession"(id) on delete cascade,
  name text,
  phone text,
  email text,
  marketing_consent boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists "GuestContact_restaurant_idx"
  on "GuestContact"("restaurant_id", "last_seen_at");

alter table if exists "StaffInvite" enable row level security;
alter table if exists "IntegrationJob" enable row level security;
alter table if exists "GuestContact" enable row level security;

drop policy if exists "staffinvite_admin_select" on "StaffInvite";
drop policy if exists "staffinvite_owner_insert" on "StaffInvite";
drop policy if exists "staffinvite_owner_update" on "StaffInvite";
drop policy if exists "integrationjob_staff_select" on "IntegrationJob";
drop policy if exists "integrationjob_staff_insert" on "IntegrationJob";
drop policy if exists "integrationjob_staff_update" on "IntegrationJob";
drop policy if exists "guestcontact_staff_select" on "GuestContact";
drop policy if exists "guestcontact_staff_update" on "GuestContact";

create policy "staffinvite_admin_select" on "StaffInvite"
  for select using (app_rls_staff_can_access("StaffInvite".restaurant_id));

create policy "staffinvite_owner_insert" on "StaffInvite"
  for insert with check (app_admin_can_access("StaffInvite".restaurant_id));

create policy "staffinvite_owner_update" on "StaffInvite"
  for update using (app_admin_can_access("StaffInvite".restaurant_id))
  with check (app_admin_can_access("StaffInvite".restaurant_id));

create policy "integrationjob_staff_select" on "IntegrationJob"
  for select using (app_rls_staff_can_access("IntegrationJob".restaurant_id));

create policy "integrationjob_staff_insert" on "IntegrationJob"
  for insert with check (app_rls_staff_can_access("IntegrationJob".restaurant_id));

create policy "integrationjob_staff_update" on "IntegrationJob"
  for update using (app_rls_staff_can_access("IntegrationJob".restaurant_id))
  with check (app_rls_staff_can_access("IntegrationJob".restaurant_id));

create policy "guestcontact_staff_select" on "GuestContact"
  for select using (app_rls_staff_can_access("GuestContact".restaurant_id));

create policy "guestcontact_staff_update" on "GuestContact"
  for update using (app_rls_staff_can_access("GuestContact".restaurant_id))
  with check (app_rls_staff_can_access("GuestContact".restaurant_id));

drop function if exists submit_order_feedback_secure(text, text, integer, text);

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
    nullif(trim(coalesce(p_comment, '')), ''),
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
      when ranked.feedback_count >= 2 and ranked.avg_sentiment_score >= 0.82 then 'loved'
      when ranked.order_count_7d >= 10 then 'trending'
      when ranked.feedback_count >= 2 and ranked.avg_sentiment_score <= 0.35 then 'needs_review'
      else null
    end,
    dynamic_rank = case
      when mi.ranking_locked then coalesce(mi.dynamic_rank, mi.display_order)
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

create or replace function admin_feedback_insights(
  p_restaurant_id text,
  p_days integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with authz as (
    select app_admin_can_access(p_restaurant_id) as allowed
  ),
  bounds as (
    select now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365))) as since_at
  ),
  feedback as (
    select *
    from "OrderFeedback"
    where (select allowed from authz)
      and restaurant_id = p_restaurant_id
      and created_at >= (select since_at from bounds)
  ),
  topic_counts as (
    select topic, count(*)::integer as count
    from feedback f
    cross join lateral jsonb_array_elements_text(coalesce(f.sentiment_topics, '[]'::jsonb)) topic
    group by topic
    order by count(*) desc, topic
    limit 5
  ),
  recent_negative as (
    select id, order_id, rating, sentiment_label, sentiment_score, key_phrase, created_at
    from feedback
    where coalesce(flag_for_review, false) = true
       or sentiment_label = 'negative'
       or rating <= 2
    order by created_at desc
    limit 5
  )
  select jsonb_build_object(
    'authorized', (select allowed from authz),
    'feedback_count', (select count(*) from feedback),
    'avg_rating', coalesce((select round(avg(rating)::numeric, 2) from feedback), 0),
    'avg_sentiment_score', coalesce((select round(avg(sentiment_score)::numeric, 4) from feedback where sentiment_score is not null), 0.5),
    'negative_count', (select count(*) from feedback where sentiment_label = 'negative' or rating <= 2),
    'flagged_count', (select count(*) from feedback where coalesce(flag_for_review, false)),
    'top_topics', coalesce((select jsonb_agg(to_jsonb(t)) from topic_counts t), '[]'::jsonb),
    'recent_negative', coalesce((select jsonb_agg(to_jsonb(r)) from recent_negative r), '[]'::jsonb)
  );
$$;

grant execute on function admin_feedback_insights(text, integer) to authenticated;

create or replace function upsert_guest_contact_secure(
  p_restaurant_id text,
  p_table_session_token text,
  p_name text default null,
  p_phone text default null,
  p_email text default null,
  p_marketing_consent boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session "TableSession"%rowtype;
  v_guest_id text;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
begin
  select * into v_session
  from "TableSession"
  where token = p_table_session_token
    and restaurant_id = p_restaurant_id
    and status in ('active', 'billing', 'paid')
  limit 1;

  if v_session.id is null then
    raise exception 'A valid table session is required.';
  end if;

  if v_phone is null and v_email is null and nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'At least one contact field is required.';
  end if;

  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address.';
  end if;

  insert into "GuestContact" (
    restaurant_id,
    table_session_id,
    name,
    phone,
    email,
    marketing_consent,
    last_seen_at,
    created_at,
    updated_at
  )
  values (
    p_restaurant_id,
    v_session.id,
    nullif(trim(coalesce(p_name, '')), ''),
    v_phone,
    v_email,
    coalesce(p_marketing_consent, false),
    now(),
    now(),
    now()
  )
  on conflict (table_session_id) do update set
    name = coalesce(excluded.name, "GuestContact".name),
    phone = coalesce(excluded.phone, "GuestContact".phone),
    email = coalesce(excluded.email, "GuestContact".email),
    marketing_consent = excluded.marketing_consent,
    last_seen_at = now(),
    updated_at = now()
  returning id into v_guest_id;

  return v_guest_id;
end;
$$;

grant execute on function upsert_guest_contact_secure(text, text, text, text, text, boolean)
  to anon, authenticated;

create or replace function get_public_menu_by_slug(p_restaurant_slug text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with selected_restaurant as (
    select r.*
    from "Restaurant" r
    where p_restaurant_slug is null
      or r.slug = p_restaurant_slug
    order by r.created_at asc
    limit 1
  )
  select jsonb_build_object(
    'restaurant', to_jsonb(sr),
    'categories', coalesce((
      select jsonb_agg(
        to_jsonb(c)
        || jsonb_build_object(
          'items', coalesce((
            select jsonb_agg(
              to_jsonb(mi)
              || jsonb_build_object(
                'modifier_groups', coalesce((
                  select jsonb_agg(
                    to_jsonb(mg)
                    || jsonb_build_object(
                      'options', coalesce((
                        select jsonb_agg(to_jsonb(mo) order by mo.name)
                        from "ModifierOption" mo
                        where mo.group_id = mg.id
                      ), '[]'::jsonb)
                    )
                    order by mg.created_at, mg.name
                  )
                  from "ModifierGroup" mg
                  where mg.menu_item_id = mi.id
                    and mg.restaurant_id = sr.id
                ), '[]'::jsonb)
              )
              order by coalesce(mi.dynamic_rank, mi.display_order), mi.display_order, mi.name
            )
            from "MenuItem" mi
            where mi.category_id = c.id
              and mi.restaurant_id = sr.id
              and mi.available = true
          ), '[]'::jsonb)
        )
        order by c.display_order, c.name
      )
      from "MenuCategory" c
      where c.restaurant_id = sr.id
        and c.archived = false
    ), '[]'::jsonb)
  )
  from selected_restaurant sr;
$$;

grant execute on function get_public_menu_by_slug(text) to anon, authenticated;
