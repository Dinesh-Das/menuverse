-- Close the remaining audit gaps without changing the existing public order
-- contract: parallel table landing, atomic sentiment claims, batched ranking
-- refreshes, and visible background-worker health.

create or replace function public.start_table_session_for_table(
  p_table_id text,
  p_existing_token text default null
)
returns table(id text, token text, status text, table_id text, restaurant_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id text;
begin
  select restaurant_id into v_restaurant_id
  from "Table"
  where "Table".id = p_table_id
    and coalesce(qr_enabled, true) = true;

  if v_restaurant_id is null then
    raise exception 'Invalid or disabled table QR.';
  end if;

  return query
  select *
  from public.start_table_session(v_restaurant_id, p_table_id, p_existing_token);
end;
$$;

grant execute on function public.start_table_session_for_table(text, text) to anon, authenticated;

create or replace function public.claim_sentiment_queue_jobs(p_batch_size integer default 20)
returns setof "SentimentQueue"
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select queue.id
    from "SentimentQueue" queue
    where (
      queue.status in ('pending', 'failed')
      or (
        queue.status = 'processing'
        and coalesce(queue.processing_at, queue.updated_at) < now() - interval '10 minutes'
      )
    )
      and queue.attempts < 5
    order by queue.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_batch_size, 20), 20))
  )
  update "SentimentQueue" queue
  set status = 'processing',
      attempts = queue.attempts + 1,
      processing_at = now(),
      updated_at = now()
  from candidates
  where queue.id = candidates.id
  returning queue.*;
$$;

revoke all on function public.claim_sentiment_queue_jobs(integer) from public;
grant execute on function public.claim_sentiment_queue_jobs(integer) to service_role;

create or replace function public.mark_menu_item_stats_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id text;
begin
  select restaurant_id into v_restaurant_id
  from "MenuItem"
  where id = new.menu_item_id;

  update "MenuItem"
  set ranking_needs_recalc = true,
      updated_at = now()
  where id = new.menu_item_id;

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
begin
  update "MenuItem"
  set ranking_needs_recalc = true,
      updated_at = now()
  where id in (
    select distinct menu_item_id
    from "OrderItem"
    where order_id = new.order_id
  );

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
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  update "MenuItem"
  set ranking_needs_recalc = true,
      updated_at = now()
  where id in (
    select distinct menu_item_id
    from "OrderItem"
    where order_id = new.id
  );

  update "Restaurant"
  set ranking_needs_recalc = true,
      updated_at = now()
  where id = new.restaurant_id;

  return new;
end;
$$;

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
    select id
    from "Restaurant"
    where ranking_needs_recalc = true
    order by updated_at asc
    limit 100
  loop
    perform public.refresh_menu_item_stats_for_restaurant(v_restaurant.id);
    perform public.recalculate_menu_rankings_internal(v_restaurant.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.process_dirty_menu_rankings() from public;

create or replace function public.verify_required_cron_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required_jobs text[] := array[
    'retry-failed-integration-jobs',
    'process-sentiment-queue',
    'recalculate-dirty-menu-rankings',
    'queue-pending-pos-jobs',
    'cleanup-expired-whatsapp-sessions',
    'process-ar-video-queue',
    'integration-token-expiry-check',
    'refresh-square-oauth-tokens',
    'sync-square-catalog-availability',
    'refresh-menu-item-stats-nightly',
    'sync-petpooja-availability'
  ];
  v_missing_jobs text[] := array[]::text[];
  v_restaurant record;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $query$
      select coalesce(array_agg(required_job order by required_job), array[]::text[])
      from unnest($1::text[]) required_job
      where not exists (
        select 1 from cron.job where jobname = required_job
      )
    $query$
    into v_missing_jobs
    using v_required_jobs;
  else
    v_missing_jobs := v_required_jobs;
  end if;

  if cardinality(v_missing_jobs) > 0 then
    for v_restaurant in select id from "Restaurant"
    loop
      perform public.upsert_admin_alert(
        v_restaurant.id,
        'high',
        'Background workers need attention',
        'Required pg_cron jobs are missing: ' || array_to_string(v_missing_jobs, ', ') || '.',
        'background_worker_health',
        'missing-required-cron-jobs',
        jsonb_build_object('missing_jobs', to_jsonb(v_missing_jobs))
      );
    end loop;
  else
    update "AdminAlert"
    set resolved_at = now()
    where source = 'background_worker_health'
      and dedupe_key = 'missing-required-cron-jobs'
      and resolved_at is null;
  end if;

  return jsonb_build_object(
    'cron_available', exists (select 1 from pg_namespace where nspname = 'cron'),
    'required_jobs_configured', cardinality(v_missing_jobs) = 0,
    'missing_jobs', to_jsonb(v_missing_jobs)
  );
end;
$$;

revoke all on function public.verify_required_cron_jobs() from public;
grant execute on function public.verify_required_cron_jobs() to service_role;

create or replace function public.admin_sentiment_configuration_status(p_restaurant_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_required_jobs text[] := array[
    'process-sentiment-queue',
    'recalculate-dirty-menu-rankings'
  ];
  v_missing_jobs text[] := array[]::text[];
  v_cron_available boolean;
  v_queue_pending integer;
  v_queue_dead_letter integer;
  v_analyses_last_24h integer;
  v_ai_analyses_last_24h integer;
  v_baseline_analyses_last_24h integer;
begin
  if not app_admin_can_access(p_restaurant_id) then
    raise exception 'Not authorized.';
  end if;

  v_cron_available := exists (select 1 from pg_namespace where nspname = 'cron');
  if v_cron_available then
    execute $query$
      select coalesce(array_agg(required_job order by required_job), array[]::text[])
      from unnest($1::text[]) required_job
      where not exists (
        select 1 from cron.job where jobname = required_job
      )
    $query$
    into v_missing_jobs
    using v_required_jobs;
  else
    v_missing_jobs := v_required_jobs;
  end if;

  select count(*)::integer into v_queue_pending
  from "SentimentQueue"
  where restaurant_id = p_restaurant_id
    and status in ('pending', 'failed', 'processing');

  select count(*)::integer into v_queue_dead_letter
  from "SentimentQueue"
  where restaurant_id = p_restaurant_id
    and status = 'dead_letter';

  select
    count(*)::integer,
    count(*) filter (where analysis_source like 'anthropic:%')::integer,
    count(*) filter (where analysis_source = 'rating_keyword_baseline')::integer
  into v_analyses_last_24h, v_ai_analyses_last_24h, v_baseline_analyses_last_24h
  from "OrderFeedback"
  where restaurant_id = p_restaurant_id
    and analysed_at >= now() - interval '24 hours';

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
    ) is not null,
    'cron_available', v_cron_available,
    'required_cron_jobs_configured', cardinality(v_missing_jobs) = 0,
    'missing_cron_jobs', to_jsonb(v_missing_jobs),
    'queue_pending', v_queue_pending,
    'queue_dead_letter', v_queue_dead_letter,
    'analyses_last_24h', v_analyses_last_24h,
    'ai_analyses_last_24h', v_ai_analyses_last_24h,
    'baseline_analyses_last_24h', v_baseline_analyses_last_24h
  );
end;
$$;

grant execute on function public.admin_sentiment_configuration_status(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('verify-background-worker-health');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'verify-background-worker-health',
      '20 3 * * *',
      'select public.verify_required_cron_jobs();'
    );
  end if;
end $$;

select public.verify_required_cron_jobs();
