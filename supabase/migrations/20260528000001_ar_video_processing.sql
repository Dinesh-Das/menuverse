alter table if exists "ARAsset"
  add column if not exists processing_metadata jsonb not null default '{}'::jsonb,
  add column if not exists replicate_prediction_id text generated always as
    (processing_metadata->>'replicate_prediction_id') stored;

create index if not exists ar_asset_replicate_id_idx
  on "ARAsset"(replicate_prediction_id)
  where replicate_prediction_id is not null;

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

  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('process-ar-video-queue');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'process-ar-video-queue',
      '*/1 * * * *',
      $cron$
        select net.http_post(
          url := current_setting('app.supabase_url') || '/functions/v1/process-ar-video',
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
