do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin perform cron.unschedule('expire-stale-whatsapp-sessions'); exception when others then null; end;

    perform cron.schedule(
      'expire-stale-whatsapp-sessions',
      '*/30 * * * *',
      $cron$
        update "WhatsAppSession"
        set state = 'expired',
            updated_at = now()
        where updated_at < now() - interval '2 hours'
          and state not in ('completed', 'expired');
      $cron$
    );
  end if;
end $$;
