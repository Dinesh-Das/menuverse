alter table if exists "Restaurant"
  add column if not exists pos_config jsonb not null default '{}'::jsonb;

do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception
    when insufficient_privilege or undefined_file then
      null;
  end;

  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'retry-failed-integration-jobs',
      '*/5 * * * *',
      $cron$
      update "IntegrationJob"
      set status = 'pending',
          retry_count = retry_count + 1,
          updated_at = now()
      where status = 'failed'
        and retry_count < 5
        and updated_at < now() - interval '2 minutes' * (retry_count + 1);
      $cron$
    );
  end if;
end $$;
