-- Track Square token expiry or manual-token rotation deadlines and surface
-- reminders through the existing deduplicated AdminAlert pipeline.

alter table if exists "IntegrationSecret"
  add column if not exists token_expires_at timestamptz;

create table if not exists "SquareOAuthState" (
  state text primary key,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz
);

alter table if exists "SquareOAuthState" enable row level security;

create index if not exists square_oauth_state_expiry_idx
  on "SquareOAuthState"(expires_at);

create or replace function public.check_integration_token_expiry()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret record;
  v_days integer;
  v_count integer := 0;
begin
  for v_secret in
    select secret.restaurant_id, secret.token_expires_at
    from "IntegrationSecret" secret
    join "IntegrationChannel" channel on channel.id = secret.channel_id
    where channel.channel_type = 'pos'
      and channel.provider = 'square'
      and secret.token_expires_at is not null
      and secret.token_expires_at <= now() + interval '30 days'
  loop
    v_days := ceil(extract(epoch from (v_secret.token_expires_at - now())) / 86400.0)::integer;
    perform public.upsert_admin_alert(
      v_secret.restaurant_id,
      case when v_days <= 7 then 'high' else 'medium' end,
      'Square access token needs attention',
      case
        when v_days <= 0 then 'Square access token has expired or passed its rotation deadline. Reconnect Square in Settings.'
        else 'Square access token expires or reaches its rotation deadline in ' || v_days || ' days. Reconnect Square in Settings.'
      end,
      'integration_token_expiry',
      'square-token-expiry',
      jsonb_build_object('days_remaining', v_days, 'token_expires_at', v_secret.token_expires_at)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.check_integration_token_expiry() from public;
grant execute on function public.check_integration_token_expiry() to service_role;

create or replace function public.queue_square_token_refresh_tick()
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
    url := v_url || '/refresh-square-tokens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Menuverse-Internal-Secret', v_internal_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return 1;
exception
  when invalid_schema_name or undefined_function then
    return 0;
end;
$$;

revoke all on function public.queue_square_token_refresh_tick() from public;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('integration-token-expiry-check');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'integration-token-expiry-check',
      '0 9 * * *',
      'select public.check_integration_token_expiry();'
    );

    begin
      perform cron.unschedule('refresh-square-oauth-tokens');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'refresh-square-oauth-tokens',
      '0 8 * * *',
      'select public.queue_square_token_refresh_tick();'
    );
  end if;
end $$;
