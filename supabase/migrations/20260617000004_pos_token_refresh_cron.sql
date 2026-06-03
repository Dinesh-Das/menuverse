-- Square OAuth access tokens expire; refresh them daily after opening checks.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('refresh-square-oauth-tokens');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'refresh-square-oauth-tokens',
      '0 9 * * *',
      'select public.queue_square_token_refresh_tick();'
    );
  end if;
end $$;
