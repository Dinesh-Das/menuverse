-- Poll Square catalog availability every 30 minutes as a fallback for missed
-- catalog.version.updated webhooks.

create or replace function public.queue_square_catalog_sync_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_internal_secret text;
  v_targets jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object('restaurant_id', id)), '[]'::jsonb)
    into v_targets
  from "Restaurant"
  where pos_sync_enabled = true
    and pos_provider = 'square';

  if jsonb_array_length(v_targets) = 0 then
    return 0;
  end if;

  perform net.http_post(
    url := v_url || '/sync-pos-catalog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Menuverse-Internal-Secret', v_internal_secret
    ),
    body := v_targets,
    timeout_milliseconds := 5000
  );
  return jsonb_array_length(v_targets);
exception
  when invalid_schema_name or undefined_function then
    return 0;
end;
$$;

revoke all on function public.queue_square_catalog_sync_tick() from public;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('sync-square-catalog-availability');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'sync-square-catalog-availability',
      '*/30 * * * *',
      'select public.queue_square_catalog_sync_tick();'
    );
  end if;
end $$;
