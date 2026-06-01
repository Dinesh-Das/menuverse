-- Follow-up hardening for public restaurant reads, off-premise ordering,
-- and Square catalog availability synchronization.

alter table if exists "Restaurant"
  add column if not exists takeaway_enabled boolean not null default true,
  add column if not exists delivery_enabled boolean not null default true;

alter table if exists "MenuItem"
  add column if not exists pos_catalog_variation_id text;

create unique index if not exists menu_item_restaurant_pos_variation_idx
  on "MenuItem"(restaurant_id, pos_catalog_variation_id)
  where pos_catalog_variation_id is not null;

drop policy if exists restaurant_public_select on "Restaurant";
create policy restaurant_public_select on "Restaurant"
  for select
  to anon
  using (true);

-- Anonymous QR landing reads only need restaurant display and checkout fields.
-- Authenticated staff retain full row access through restaurant_admin_select.
revoke select on "Restaurant" from anon;
grant select (
  id,
  slug,
  name,
  description,
  logo_url,
  primary_color,
  gst_rate,
  service_charge_rate,
  payment_enabled,
  payment_provider,
  currency,
  delivery_fee_flat,
  takeaway_enabled,
  delivery_enabled
) on "Restaurant" to anon;

comment on policy order_public_select_by_setting on "Order" is
  'Intentional defense-in-depth policy. Customer reads use secure RPCs bound to a table-session token; direct anonymous Order reads return no rows unless a trusted server transaction sets app.order_id.';

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
              (to_jsonb(mi) - 'pos_catalog_variation_id') || jsonb_build_object(
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

create or replace function public.get_public_menu_item(p_menu_item_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select (to_jsonb(mi) - 'pos_catalog_variation_id')
    || jsonb_build_object(
      'category', to_jsonb(c),
      'restaurant',
        to_jsonb(r)
        - 'pos_config'
        - 'pos_provider'
        - 'pos_sync_enabled'
        - 'printer_enabled'
        - 'whatsapp_enabled'
        - 'ranking_needs_recalc',
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
        where mg.menu_item_id = mi.id and mg.restaurant_id = mi.restaurant_id
      ), '[]'::jsonb)
    )
  from "MenuItem" mi
  join "MenuCategory" c on c.id = mi.category_id
  join "Restaurant" r on r.id = mi.restaurant_id
  where mi.id = p_menu_item_id and c.archived = false and mi.available = true
  limit 1;
$$;

grant execute on function public.get_public_menu_by_slug(text) to anon, authenticated;
grant execute on function public.get_public_menu_item(text) to anon, authenticated;

alter table if exists "Order"
  add column if not exists source_campaign_id text references "MarketingCampaign"(id) on delete set null;

alter table if exists "MarketingCampaign"
  add column if not exists from_email text;

alter table if exists "IntegrationJob"
  drop constraint if exists "IntegrationJob_job_type_check";

alter table if exists "IntegrationJob"
  add constraint "IntegrationJob_job_type_check"
  check (job_type in ('printer', 'whatsapp', 'pos', 'channel_order', 'channel_menu_sync', 'social_publish'));

create index if not exists order_source_campaign_idx
  on "Order"(restaurant_id, source_campaign_id, created_at desc)
  where source_campaign_id is not null;

alter table if exists "CampaignSend" enable row level security;
drop policy if exists campaign_send_admin_select on "CampaignSend";
create policy campaign_send_admin_select on "CampaignSend"
  for select
  using (
    exists (
      select 1
      from "MarketingCampaign" campaign
      where campaign.id = "CampaignSend".campaign_id
        and app_rls_staff_can_access(campaign.restaurant_id)
    )
  );

create or replace function public.attribute_order_to_campaign_secure(
  p_order_id text,
  p_restaurant_id text,
  p_idempotency_key text,
  p_campaign_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from "Order" o
    join "MarketingCampaign" campaign on campaign.id = p_campaign_id
    where o.id = p_order_id
      and o.restaurant_id = p_restaurant_id
      and o.idempotency_key = p_idempotency_key
      and campaign.restaurant_id = o.restaurant_id
  ) then
    raise exception 'Order campaign attribution could not be verified.';
  end if;

  update "Order"
  set source_campaign_id = p_campaign_id,
      updated_at = now()
  where id = p_order_id
    and restaurant_id = p_restaurant_id
    and idempotency_key = p_idempotency_key
    and source_campaign_id is null;

  return true;
end;
$$;

grant execute on function public.attribute_order_to_campaign_secure(text, text, text, text)
  to anon, authenticated;

create table if not exists "EdgeRateLimit" (
  bucket text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table if exists "EdgeRateLimit" enable row level security;

create or replace function public.consume_edge_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_bucket is null or p_bucket = '' or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit parameters.';
  end if;

  insert into "EdgeRateLimit" (bucket, window_started_at, request_count, updated_at)
  values (p_bucket, now(), 1, now())
  on conflict (bucket) do update set
    window_started_at = case
      when "EdgeRateLimit".window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else "EdgeRateLimit".window_started_at
    end,
    request_count = case
      when "EdgeRateLimit".window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else "EdgeRateLimit".request_count + 1
    end,
    updated_at = now()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_edge_rate_limit(text, integer, integer) to service_role;

create or replace function public.enforce_feedback_submission_rate_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_table_session_id text;
  v_recent_count integer;
begin
  select table_session_id into v_table_session_id
  from "Order"
  where id = new.order_id;

  if v_table_session_id is null then
    return new;
  end if;

  select count(*) into v_recent_count
  from "OrderFeedback" feedback
  join "Order" customer_order on customer_order.id = feedback.order_id
  where customer_order.table_session_id = v_table_session_id
    and feedback.created_at > now() - interval '1 hour';

  if v_recent_count >= 30 then
    raise exception 'Feedback limit reached for this table session. Please try again later.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_feedback_submission_rate_limit on "OrderFeedback";
create trigger trg_feedback_submission_rate_limit
  before insert on "OrderFeedback"
  for each row execute function public.enforce_feedback_submission_rate_limit();

create or replace function public.retry_failed_integration_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_function_url text;
  v_internal_secret text := nullif(current_setting('app.settings.menuverse_internal_secret', true), '');
  v_retried integer := 0;
begin
  v_function_url := nullif(
    trim(trailing '/' from coalesce(
      nullif(current_setting('app.settings.edge_function_base_url', true), ''),
      nullif(current_setting('app.settings.supabase_url', true), '')
    )),
    ''
  );

  if v_function_url is not null and position('/functions/v1' in v_function_url) = 0 then
    v_function_url := v_function_url || '/functions/v1';
  end if;

  with dead_jobs as (
    update "IntegrationJob"
    set status = 'dead_letter',
        updated_at = now()
    where job_type = 'pos'
      and status = 'failed'
      and retry_count >= 3
    returning *
  )
  insert into "AdminAlert" (restaurant_id, severity, title, message, source, metadata)
  select
    restaurant_id,
    'high',
    'POS sync moved to dead letter',
    coalesce(error, 'POS integration job failed after 3 retry attempts.'),
    'integration_retry_worker',
    jsonb_build_object('job_id', id, 'order_id', order_id, 'provider', provider, 'retry_count', retry_count)
  from dead_jobs;

  if v_function_url is null then
    return 0;
  end if;

  for v_job in
    select *
    from "IntegrationJob"
    where job_type = 'pos'
      and status = 'failed'
      and retry_count < 3
      and updated_at < now() - make_interval(mins => power(2, retry_count)::integer)
    order by updated_at asc
    limit 25
  loop
    begin
      perform net.http_post(
        url := v_function_url || '/sync-to-pos',
        headers := jsonb_strip_nulls(jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Menuverse-Internal-Secret', v_internal_secret
        )),
        body := jsonb_build_object(
          'job_id', v_job.id,
          'restaurant_id', v_job.restaurant_id,
          'order_id', v_job.order_id,
          'provider', v_job.provider
        ),
        timeout_milliseconds := 5000
      );
      v_retried := v_retried + 1;
    exception
      when invalid_schema_name or undefined_function then
        return v_retried;
    end;
  end loop;

  return v_retried;
end;
$$;
