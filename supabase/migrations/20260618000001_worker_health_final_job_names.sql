-- Keep the background-worker health check aligned with the final scheduled
-- job names after the June 17 cron migrations.

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
    'expire-stale-whatsapp-sessions',
    'process-ar-video-queue',
    'integration-token-expiry-check',
    'refresh-square-oauth-tokens',
    'sync-square-catalog-availability',
    'refresh-menu-item-stats',
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

select public.verify_required_cron_jobs();
