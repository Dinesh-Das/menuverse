do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception
    when insufficient_privilege or undefined_file then
      null;
  end;

  begin
    create extension if not exists pg_cron with schema extensions;
  exception
    when insufficient_privilege or undefined_file then
      null;
  end;
end $$;

alter table if exists "IntegrationJob"
  drop constraint if exists "IntegrationJob_status_check";

alter table if exists "IntegrationJob"
  add constraint "IntegrationJob_status_check"
  check (status in ('pending', 'pending_configuration', 'delivered', 'failed', 'dead_letter'));

create table if not exists "AdminAlert" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  severity text not null check (severity in ('low', 'medium', 'high')),
  title text not null,
  message text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists admin_alert_restaurant_created_idx
  on "AdminAlert"(restaurant_id, created_at desc);

alter table if exists "AdminAlert" enable row level security;

drop policy if exists "admin_alert_staff_access" on "AdminAlert";
create policy "admin_alert_staff_access" on "AdminAlert"
  for all
  using (app_rls_staff_can_access("AdminAlert".restaurant_id))
  with check (app_rls_staff_can_access("AdminAlert".restaurant_id));

create or replace function retry_failed_integration_jobs()
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
    where status = 'failed'
      and retry_count >= 3
    returning *
  )
  insert into "AdminAlert" (restaurant_id, severity, title, message, source, metadata)
  select
    restaurant_id,
    'high',
    'POS sync moved to dead letter',
    coalesce(error, 'Integration job failed after 3 retry attempts.'),
    'integration_retry_worker',
    jsonb_build_object('job_id', id, 'order_id', order_id, 'provider', provider, 'retry_count', retry_count)
  from dead_jobs;

  if v_function_url is null then
    return 0;
  end if;

  for v_job in
    select *
    from "IntegrationJob"
    where status = 'failed'
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

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('retry-failed-integration-jobs');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'retry-failed-integration-jobs',
      '*/2 * * * *',
      'select public.retry_failed_integration_jobs();'
    );
  end if;
end $$;
