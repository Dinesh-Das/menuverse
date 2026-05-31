-- Production hardening for sentiment, integrations, omnichannel ordering,
-- split billing, guest profile quality, and public payload redaction.

create extension if not exists pgcrypto;

alter table if exists "AdminAlert"
  add column if not exists dedupe_key text;

create unique index if not exists admin_alert_open_dedupe_idx
  on "AdminAlert"(restaurant_id, source, dedupe_key)
  where resolved_at is null and dedupe_key is not null;

create or replace function public.upsert_admin_alert(
  p_restaurant_id text,
  p_severity text,
  p_title text,
  p_message text,
  p_source text,
  p_dedupe_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  insert into "AdminAlert" (
    restaurant_id, severity, title, message, source, dedupe_key, metadata, created_at
  )
  values (
    p_restaurant_id,
    case when p_severity in ('low', 'medium', 'high') then p_severity else 'medium' end,
    p_title,
    p_message,
    p_source,
    p_dedupe_key,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (restaurant_id, source, dedupe_key)
    where resolved_at is null and dedupe_key is not null
  do update set
    severity = excluded.severity,
    title = excluded.title,
    message = excluded.message,
    metadata = excluded.metadata,
    created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_admin_alert(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.upsert_admin_alert(text, text, text, text, text, text, jsonb) to service_role;

-- Secrets live in a server-only table. IntegrationChannel contains only safe,
-- browser-readable metadata used by the Settings screen.
create table if not exists "IntegrationChannel" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  channel_type text not null check (
    channel_type in (
      'pos', 'whatsapp', 'swiggy', 'zomato', 'ubereats', 'doordash',
      'instagram', 'facebook', 'google_food', 'custom'
    )
  ),
  provider text,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'not_configured' check (
    status in ('not_configured', 'configured', 'active', 'error')
  ),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, channel_type)
);

create table if not exists "IntegrationSecret" (
  channel_id text primary key references "IntegrationChannel"(id) on delete cascade,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  secrets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists "IntegrationChannel" enable row level security;
alter table if exists "IntegrationSecret" enable row level security;

drop policy if exists integration_channel_admin_read on "IntegrationChannel";
create policy integration_channel_admin_read on "IntegrationChannel"
  for select using (app_admin_can_access(restaurant_id));

-- IntegrationSecret intentionally has no browser-facing policy. Service-role
-- Edge Functions bypass RLS and return redacted key names only.

insert into "IntegrationChannel" (restaurant_id, channel_type, provider, enabled, config, status)
select
  id,
  'pos',
  nullif(pos_provider, ''),
  coalesce(pos_sync_enabled, false),
  '{}'::jsonb,
  case when nullif(pos_provider, '') is null then 'not_configured' else 'configured' end
from "Restaurant"
on conflict (restaurant_id, channel_type) do update set
  provider = coalesce(excluded.provider, "IntegrationChannel".provider),
  enabled = excluded.enabled,
  updated_at = now();

insert into "IntegrationSecret" (channel_id, restaurant_id, secrets)
select c.id, c.restaurant_id, coalesce(r.pos_config, '{}'::jsonb)
from "IntegrationChannel" c
join "Restaurant" r on r.id = c.restaurant_id
where c.channel_type = 'pos'
  and coalesce(r.pos_config, '{}'::jsonb) <> '{}'::jsonb
on conflict (channel_id) do update set
  secrets = "IntegrationSecret".secrets || excluded.secrets,
  updated_at = now();

update "Restaurant"
set pos_config = '{}'::jsonb
where coalesce(pos_config, '{}'::jsonb) <> '{}'::jsonb;

create or replace function public.prevent_legacy_pos_config_storage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.pos_config := '{}'::jsonb;
  return new;
end;
$$;

drop trigger if exists trg_prevent_legacy_pos_config_storage on "Restaurant";
create trigger trg_prevent_legacy_pos_config_storage
  before insert or update of pos_config on "Restaurant"
  for each row
  execute function public.prevent_legacy_pos_config_storage();

alter table if exists "IntegrationJob"
  drop constraint if exists "IntegrationJob_job_type_check";

alter table if exists "IntegrationJob"
  add constraint "IntegrationJob_job_type_check"
  check (job_type in ('printer', 'whatsapp', 'pos', 'channel_order', 'channel_menu_sync'));

alter table if exists "Order"
  add column if not exists external_channel text,
  add column if not exists external_order_id text;

create unique index if not exists order_external_channel_id_idx
  on "Order"(restaurant_id, external_channel, external_order_id)
  where external_channel is not null and external_order_id is not null;

alter table if exists "MenuItem"
  add column if not exists ranking_needs_recalc boolean not null default false;

alter table if exists "Restaurant"
  add column if not exists ranking_needs_recalc boolean not null default false;

alter table if exists "WhatsAppSession"
  add column if not exists expires_at timestamptz not null default (now() + interval '24 hours');

create index if not exists whatsapp_session_expires_idx
  on "WhatsAppSession"(expires_at);

create table if not exists "SentimentQueue" (
  id text primary key default gen_random_uuid()::text,
  feedback_id text not null unique references "OrderFeedback"(id) on delete cascade,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed', 'dead_letter')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processing_at timestamptz,
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists sentiment_queue_status_created_idx
  on "SentimentQueue"(status, created_at);

create index if not exists sentiment_queue_restaurant_idx
  on "SentimentQueue"(restaurant_id, created_at);

alter table if exists "SentimentQueue" enable row level security;

create or replace function public.notify_sentiment_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_internal_secret text;
  v_missing text[] := array[]::text[];
begin
  v_url := nullif(
    trim(trailing '/' from coalesce(
      nullif(current_setting('app.settings.edge_function_base_url', true), ''),
      nullif(current_setting('app.settings.supabase_url', true), ''),
      nullif(current_setting('app.supabase_url', true), '')
    )),
    ''
  );
  v_internal_secret := coalesce(
    nullif(current_setting('app.settings.menuverse_internal_secret', true), ''),
    nullif(current_setting('app.menuverse_internal_secret', true), '')
  );

  if v_url is null then
    v_missing := array_append(v_missing, 'app.settings.supabase_url');
  end if;
  if v_internal_secret is null then
    v_missing := array_append(v_missing, 'app.settings.menuverse_internal_secret');
  end if;

  insert into "SentimentQueue" (feedback_id, restaurant_id, status, updated_at)
  values (new.id, new.restaurant_id, 'pending', now())
  on conflict (feedback_id) do update set
    status = 'pending',
    last_error = null,
    processing_at = null,
    processed_at = null,
    updated_at = now();

  if cardinality(v_missing) > 0 then
    perform public.upsert_admin_alert(
      new.restaurant_id,
      'high',
      'Sentiment analysis not configured',
      'Set the protected database setting(s): ' || array_to_string(v_missing, ', ') || '.',
      'trg_sentiment_analysis',
      'sentiment-config-missing',
      jsonb_build_object('missing_settings', to_jsonb(v_missing))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sentiment_analysis on public."OrderFeedback";
create trigger trg_sentiment_analysis
  after insert or update of rating, comment, food_rating, service_rating, value_rating, item_ratings
  on public."OrderFeedback"
  for each row
  execute function public.notify_sentiment_analysis();

create or replace function public.process_sentiment_queue_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_internal_secret text;
begin
  v_url := nullif(
    trim(trailing '/' from coalesce(
      nullif(current_setting('app.settings.edge_function_base_url', true), ''),
      nullif(current_setting('app.settings.supabase_url', true), ''),
      nullif(current_setting('app.supabase_url', true), '')
    )),
    ''
  );
  v_internal_secret := coalesce(
    nullif(current_setting('app.settings.menuverse_internal_secret', true), ''),
    nullif(current_setting('app.menuverse_internal_secret', true), '')
  );

  if v_url is null or v_internal_secret is null then
    return 0;
  end if;
  if position('/functions/v1' in v_url) = 0 then
    v_url := v_url || '/functions/v1';
  end if;

  perform net.http_post(
    url := v_url || '/process-sentiment-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Menuverse-Internal-Secret', v_internal_secret
    ),
    body := jsonb_build_object('batch_size', 20),
    timeout_milliseconds := 5000
  );
  return 1;
exception
  when invalid_schema_name or undefined_function then
    return 0;
end;
$$;

revoke all on function public.process_sentiment_queue_tick() from public;

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
      mi.id,
      coalesce(sum(
        case when o.created_at > now() - interval '7 days' and o.status <> 'cancelled'
          then oi.quantity else 0 end
      ), 0)::integer as order_count_7d,
      coalesce(avg(ofb.sentiment_score) filter (
        where ofb.created_at > now() - interval '30 days' and ofb.sentiment_score is not null
      ), 0.5)::numeric(5,4) as avg_sentiment_score,
      count(ofb.id) filter (where ofb.created_at > now() - interval '30 days') as feedback_count
    from "MenuItem" mi
    left join "OrderItem" oi on oi.menu_item_id = mi.id
    left join "Order" o on o.id = oi.order_id
    left join "OrderFeedback" ofb on ofb.order_id = o.id
    where mi.restaurant_id = p_restaurant_id
    group by mi.id
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
    dynamic_rank = case
      when mi.ranking_locked then coalesce(mi.dynamic_rank, mi.display_order)
      when ranked.order_count_7d < 5 then least(ranked.computed_rank, greatest(1, ceil(ranked.total_items / 2.0)::integer))
      else ranked.computed_rank
    end,
    ranking_needs_recalc = false,
    updated_at = now()
  from ranked
  where mi.id = ranked.id;

  get diagnostics v_count = row_count;

  update "Restaurant"
  set ranking_needs_recalc = false,
      updated_at = now()
  where id = p_restaurant_id;

  return v_count;
end;
$$;

revoke all on function public.recalculate_menu_rankings_internal(text) from public;

create or replace function public.recalculate_menu_rankings(p_restaurant_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or app_admin_can_access(p_restaurant_id)) then
    raise exception 'Not authorized.';
  end if;
  return public.recalculate_menu_rankings_internal(p_restaurant_id);
end;
$$;

grant execute on function public.recalculate_menu_rankings(text) to authenticated, service_role;

create or replace function public.process_dirty_menu_rankings()
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
    select id from "Restaurant" where ranking_needs_recalc = true order by updated_at asc limit 100
  loop
    perform public.recalculate_menu_rankings_internal(v_restaurant.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.process_dirty_menu_rankings() from public;

create or replace function public.queue_pending_pos_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_internal_secret text;
  v_job record;
  v_count integer := 0;
begin
  v_url := nullif(
    trim(trailing '/' from coalesce(
      nullif(current_setting('app.settings.edge_function_base_url', true), ''),
      nullif(current_setting('app.settings.supabase_url', true), ''),
      nullif(current_setting('app.supabase_url', true), '')
    )),
    ''
  );
  v_internal_secret := coalesce(
    nullif(current_setting('app.settings.menuverse_internal_secret', true), ''),
    nullif(current_setting('app.menuverse_internal_secret', true), '')
  );
  if v_url is null or v_internal_secret is null then
    return 0;
  end if;
  if position('/functions/v1' in v_url) = 0 then
    v_url := v_url || '/functions/v1';
  end if;

  for v_job in
    select *
    from "IntegrationJob"
    where job_type = 'pos' and status = 'pending'
    order by created_at asc
    limit 25
  loop
    perform net.http_post(
      url := v_url || '/sync-to-pos',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Menuverse-Internal-Secret', v_internal_secret
      ),
      body := jsonb_build_object(
        'job_id', v_job.id,
        'restaurant_id', v_job.restaurant_id,
        'order_id', v_job.order_id,
        'provider', v_job.provider
      ),
      timeout_milliseconds := 5000
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
exception
  when invalid_schema_name or undefined_function then
    return v_count;
end;
$$;

revoke all on function public.queue_pending_pos_jobs() from public;

create or replace function public.queue_pos_sync_for_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant "Restaurant"%rowtype;
begin
  select * into v_restaurant from "Restaurant" where id = new.restaurant_id;
  if coalesce(v_restaurant.pos_sync_enabled, false) and nullif(v_restaurant.pos_provider, '') is not null then
    insert into "IntegrationJob" (restaurant_id, order_id, job_type, provider, status, payload)
    values (
      new.restaurant_id,
      new.id,
      'pos',
      v_restaurant.pos_provider,
      'pending',
      jsonb_build_object('order_id', new.id, 'queued_at', now())
    );
  elsif coalesce(v_restaurant.pos_sync_enabled, false) then
    perform public.upsert_admin_alert(
      new.restaurant_id,
      'high',
      'POS sync is enabled but not configured',
      'Select a POS provider and save its credentials in Settings > Integrations.',
      'pos_order_trigger',
      'pos-config-missing',
      jsonb_build_object('order_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_queue_pos_sync_for_order on public."Order";
create trigger trg_queue_pos_sync_for_order
  after insert on public."Order"
  for each row execute function public.queue_pos_sync_for_order();

create or replace function public.set_session_split_count(
  p_table_session_id text,
  p_split_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session "TableSession"%rowtype;
  v_bill "SessionBill"%rowtype;
begin
  if p_split_count < 1 or p_split_count > 20 then
    raise exception 'Split count must be between 1 and 20.';
  end if;
  select * into v_session from "TableSession" where id = p_table_session_id and status in ('active', 'billing');
  if v_session.id is null or not app_staff_can_access(v_session.restaurant_id) then
    raise exception 'Not authorized to update this table session.';
  end if;
  update "SessionBill"
  set split_count = p_split_count,
      split_status = case when p_split_count > 1 then 'splitting' else 'full' end,
      updated_at = now()
  where table_session_id = p_table_session_id
  returning * into v_bill;
  return to_jsonb(v_bill);
end;
$$;

grant execute on function public.set_session_split_count(text, integer) to authenticated;

create or replace function public.get_session_bill_secure(p_table_session_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(sb)
  from "SessionBill" sb
  join "TableSession" ts on ts.id = sb.table_session_id
  where ts.token = p_table_session_token
    and ts.status in ('active', 'billing', 'paid')
  limit 1;
$$;

grant execute on function public.get_session_bill_secure(text) to anon, authenticated;

create or replace function public.admin_sentiment_configuration_status(p_restaurant_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app_admin_can_access(p_restaurant_id) then
    raise exception 'Not authorized.';
  end if;
  return jsonb_build_object(
    'supabase_url_configured',
    coalesce(
      nullif(current_setting('app.settings.edge_function_base_url', true), ''),
      nullif(current_setting('app.settings.supabase_url', true), ''),
      nullif(current_setting('app.supabase_url', true), '')
    ) is not null,
    'internal_secret_configured',
    coalesce(
      nullif(current_setting('app.settings.menuverse_internal_secret', true), ''),
      nullif(current_setting('app.menuverse_internal_secret', true), '')
    ) is not null
  );
end;
$$;

grant execute on function public.admin_sentiment_configuration_status(text) to authenticated;

create or replace function public.update_order_status_from_pos(
  p_pos_order_id text,
  p_provider text,
  p_external_status text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order "Order"%rowtype;
  v_next_status text;
  v_valid boolean := false;
begin
  select o.* into v_order
  from "Order" o
  join "Restaurant" r on r.id = o.restaurant_id
  where o.pos_order_id = p_pos_order_id
    and lower(coalesce(r.pos_provider, '')) = lower(coalesce(p_provider, ''))
  limit 1;
  if v_order.id is null then
    raise exception 'Unknown POS order ID.';
  end if;

  v_next_status := case lower(coalesce(p_external_status, ''))
    when 'open' then 'accepted'
    when 'accepted' then 'accepted'
    when 'confirmed' then 'accepted'
    when 'in_progress' then 'preparing'
    when 'preparing' then 'preparing'
    when 'ready' then 'ready'
    when 'completed' then 'completed'
    when 'served' then 'served'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'rejected' then 'cancelled'
    else null
  end;
  if v_next_status is null then
    raise exception 'Unsupported POS status: %', p_external_status;
  end if;
  if v_order.status = v_next_status then
    return to_jsonb(v_order);
  end if;

  v_valid := case v_order.status
    when 'pending' then v_next_status in ('accepted', 'preparing', 'cancelled')
    when 'accepted' then v_next_status in ('preparing', 'ready', 'cancelled')
    when 'preparing' then v_next_status in ('ready', 'cancelled')
    when 'ready' then v_next_status in ('served', 'completed')
    when 'served' then v_next_status = 'completed'
    else false
  end;
  if not v_valid then
    raise exception 'Invalid POS status transition from % to %.', v_order.status, v_next_status;
  end if;

  update "Order"
  set status = v_next_status,
      cancel_reason = case when v_next_status = 'cancelled' then 'Cancelled by POS' else cancel_reason end,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into "IntegrationJob" (restaurant_id, order_id, job_type, provider, status, payload, response)
  values (
    v_order.restaurant_id,
    v_order.id,
    'pos',
    p_provider,
    'delivered',
    coalesce(p_payload, '{}'::jsonb),
    jsonb_build_object('direction', 'inbound', 'status', v_next_status)
  );

  return to_jsonb(v_order);
end;
$$;

revoke all on function public.update_order_status_from_pos(text, text, text, jsonb) from public;
grant execute on function public.update_order_status_from_pos(text, text, text, jsonb) to service_role;

create or replace function public.create_external_channel_order(
  p_restaurant_id text,
  p_channel text,
  p_external_order_id text,
  p_items jsonb,
  p_customer jsonb default '{}'::jsonb,
  p_delivery_address jsonb default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing "Order"%rowtype;
  v_created record;
begin
  select * into v_existing
  from "Order"
  where restaurant_id = p_restaurant_id
    and external_channel = p_channel
    and external_order_id = p_external_order_id;
  if v_existing.id is not null then
    return to_jsonb(v_existing) || jsonb_build_object('deduplicated', true);
  end if;

  select * into v_created
  from public.create_order_secure(
    p_restaurant_id => p_restaurant_id,
    p_table_id => null,
    p_table_session_token => null,
    p_items => p_items,
    p_special_instructions => 'Inbound ' || p_channel || ' order',
    p_idempotency_key => 'channel:' || p_channel || ':' || p_external_order_id,
    p_points_redeemed => 0
  );

  update "Order"
  set external_channel = p_channel,
      external_order_id = p_external_order_id,
      order_type = case when p_delivery_address is null then 'takeaway'::order_type else 'delivery'::order_type end,
      delivery_address_json = p_delivery_address,
      updated_at = now()
  where id = v_created.order_ref
  returning * into v_existing;

  insert into "IntegrationJob" (restaurant_id, order_id, job_type, provider, status, payload, response)
  values (
    p_restaurant_id,
    v_existing.id,
    'channel_order',
    p_channel,
    'delivered',
    coalesce(p_payload, '{}'::jsonb),
    jsonb_build_object('direction', 'inbound', 'external_order_id', p_external_order_id, 'customer', p_customer)
  );
  return to_jsonb(v_existing);
end;
$$;

revoke all on function public.create_external_channel_order(text, text, text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_external_channel_order(text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;

create table if not exists "GuestProfileMergeAudit" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  keep_profile_id text not null references "GuestProfile"(id) on delete restrict,
  discarded_profile_snapshot jsonb not null,
  merged_by text references "User"(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table if exists "GuestProfileMergeAudit" enable row level security;
drop policy if exists guest_merge_audit_admin_read on "GuestProfileMergeAudit";
create policy guest_merge_audit_admin_read on "GuestProfileMergeAudit"
  for select using (app_admin_can_access(restaurant_id));

create or replace function public.merge_guest_profiles(p_keep_id text, p_discard_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep "GuestProfile"%rowtype;
  v_discard "GuestProfile"%rowtype;
begin
  if p_keep_id = p_discard_id then
    raise exception 'Choose two different guest profiles.';
  end if;
  select * into v_keep from "GuestProfile" where id = p_keep_id for update;
  select * into v_discard from "GuestProfile" where id = p_discard_id for update;
  if v_keep.id is null or v_discard.id is null or v_keep.restaurant_id <> v_discard.restaurant_id then
    raise exception 'Guest profiles were not found in the same restaurant.';
  end if;
  if not app_admin_can_access(v_keep.restaurant_id) then
    raise exception 'Not authorized.';
  end if;

  update "Order" set guest_profile_id = v_keep.id where guest_profile_id = v_discard.id;
  update "TableSession" set guest_profile_id = v_keep.id where guest_profile_id = v_discard.id;
  if to_regclass('"CampaignSend"') is not null then
    update "CampaignSend" set guest_profile_id = v_keep.id where guest_profile_id = v_discard.id;
  end if;

  update "GuestProfile" gp
  set
    name = coalesce(gp.name, v_discard.name),
    phone = coalesce(gp.phone, v_discard.phone),
    email = coalesce(gp.email, v_discard.email),
    visit_count = gp.visit_count + v_discard.visit_count,
    total_spend = gp.total_spend + v_discard.total_spend,
    loyalty_points = gp.loyalty_points + v_discard.loyalty_points,
    marketing_consent = gp.marketing_consent or v_discard.marketing_consent,
    tags = (
      select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(gp.tags, '[]'::jsonb) || coalesce(v_discard.tags, '[]'::jsonb))
    ),
    preferred_tags = (
      select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(gp.preferred_tags, '[]'::jsonb) || coalesce(v_discard.preferred_tags, '[]'::jsonb))
    ),
    disliked_tags = (
      select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(gp.disliked_tags, '[]'::jsonb) || coalesce(v_discard.disliked_tags, '[]'::jsonb))
    ),
    updated_at = now()
  where gp.id = v_keep.id;

  insert into "GuestProfileMergeAudit" (restaurant_id, keep_profile_id, discarded_profile_snapshot, merged_by)
  values (v_keep.restaurant_id, v_keep.id, to_jsonb(v_discard), auth.uid()::text);

  delete from "GuestProfile" where id = v_discard.id;
  return (select to_jsonb(gp) from "GuestProfile" gp where gp.id = v_keep.id);
end;
$$;

grant execute on function public.merge_guest_profiles(text, text) to authenticated;

create or replace function public.find_possible_guest_duplicates(p_restaurant_id text)
returns table(keep_id text, duplicate_id text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    b.id,
    case
      when a.phone is not null and a.phone = b.phone then 'same phone'
      when a.email is not null and lower(a.email) = lower(b.email) then 'same email'
      else 'similar name'
    end
  from "GuestProfile" a
  join "GuestProfile" b on b.restaurant_id = a.restaurant_id and b.id > a.id
  where a.restaurant_id = p_restaurant_id
    and app_admin_can_access(p_restaurant_id)
    and (
      (a.phone is not null and a.phone = b.phone)
      or (a.email is not null and lower(a.email) = lower(b.email))
      or (
        a.name is not null and b.name is not null
        and lower(trim(a.name)) = lower(trim(b.name))
        and (a.phone is not null or a.email is not null)
        and (b.phone is not null or b.email is not null)
      )
    );
$$;

grant execute on function public.find_possible_guest_duplicates(text) to authenticated;

-- Public menu documents must never serialize private integration metadata.
create or replace function public.get_public_menu_by_slug(p_restaurant_slug text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with selected_restaurant as (
    select r.*
    from "Restaurant" r
    where p_restaurant_slug is null or r.slug = p_restaurant_slug
    order by r.created_at asc
    limit 1
  )
  select jsonb_build_object(
    'restaurant',
      to_jsonb(sr)
      - 'pos_config'
      - 'pos_provider'
      - 'pos_sync_enabled'
      - 'printer_enabled'
      - 'whatsapp_enabled'
      - 'ranking_needs_recalc',
    'categories', coalesce((
      select jsonb_agg(
        to_jsonb(c) || jsonb_build_object(
          'items', coalesce((
            select jsonb_agg(
              to_jsonb(mi) || jsonb_build_object(
                'modifier_groups', coalesce((
                  select jsonb_agg(
                    to_jsonb(mg) || jsonb_build_object(
                      'options', coalesce((
                        select jsonb_agg(to_jsonb(mo) order by mo.name)
                        from "ModifierOption" mo where mo.group_id = mg.id
                      ), '[]'::jsonb)
                    ) order by mg.created_at, mg.name
                  )
                  from "ModifierGroup" mg
                  where mg.menu_item_id = mi.id and mg.restaurant_id = sr.id
                ), '[]'::jsonb)
              )
              order by coalesce(mi.dynamic_rank, mi.display_order), mi.display_order, mi.name
            )
            from "MenuItem" mi
            where mi.category_id = c.id and mi.restaurant_id = sr.id and mi.available = true
          ), '[]'::jsonb)
        ) order by c.display_order, c.name
      )
      from "MenuCategory" c where c.restaurant_id = sr.id and c.archived = false
    ), '[]'::jsonb)
  )
  from selected_restaurant sr;
$$;

grant execute on function public.get_public_menu_by_slug(text) to anon, authenticated;

-- Keep one current create_order_secure overload and document its contract.
drop function if exists public.create_order_secure(text, text, text, jsonb, text, text);
comment on function public.create_order_secure(text, text, text, jsonb, text, text, integer)
  is 'Canonical secure order RPC: restaurant, table, session token, items, instructions, idempotency key, loyalty points.';

do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception
    when insufficient_privilege or undefined_file then null;
  end;
  begin
    create extension if not exists pg_net with schema extensions;
  exception
    when insufficient_privilege or undefined_file then null;
  end;

  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin perform cron.unschedule('process-sentiment-queue'); exception when others then null; end;
    begin perform cron.unschedule('recalculate-dirty-menu-rankings'); exception when others then null; end;
    begin perform cron.unschedule('queue-pending-pos-jobs'); exception when others then null; end;
    begin perform cron.unschedule('cleanup-expired-whatsapp-sessions'); exception when others then null; end;
    begin perform cron.unschedule('process-ar-video-queue'); exception when others then null; end;

    perform cron.schedule('process-sentiment-queue', '30 seconds', 'select public.process_sentiment_queue_tick();');
    perform cron.schedule('recalculate-dirty-menu-rankings', '*/10 * * * *', 'select public.process_dirty_menu_rankings();');
    perform cron.schedule('queue-pending-pos-jobs', '* * * * *', 'select public.queue_pending_pos_jobs();');
    perform cron.schedule('cleanup-expired-whatsapp-sessions', '15 3 * * *', 'delete from "WhatsAppSession" where expires_at < now();');
    perform cron.schedule(
      'process-ar-video-queue',
      '*/1 * * * *',
      $cron$
        select net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/process-ar-video',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Menuverse-Internal-Secret', current_setting('app.settings.menuverse_internal_secret')
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  end if;
end $$;
