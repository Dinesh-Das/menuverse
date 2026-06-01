-- Allow operators to freeze a reviewed sentiment result so later edits do not
-- enqueue or overwrite it.

alter table if exists "OrderFeedback"
  add column if not exists analysis_locked boolean not null default false;

create or replace function public.notify_sentiment_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_internal_secret text;
  v_missing text[] := array[]::text[];
begin
  if coalesce(new.analysis_locked, false) then
    return new;
  end if;

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

  if v_url is null then
    v_missing := array_append(v_missing, 'app.settings.supabase_url');
  end if;
  if v_internal_secret is null then
    v_missing := array_append(v_missing, 'app.settings.menuverse_internal_secret');
  end if;

  insert into "SentimentQueue" (feedback_id, restaurant_id, status, updated_at)
  values (new.id, new.restaurant_id, 'pending', now())
  on conflict (feedback_id) do update set
    status = 'pending',
    last_error = null,
    processing_at = null,
    processed_at = null,
    updated_at = now();

  if cardinality(v_missing) > 0 then
    perform public.upsert_admin_alert(
      new.restaurant_id,
      'high',
      'Sentiment analysis not configured',
      'Set the protected database setting(s): ' || array_to_string(v_missing, ', ') || '.',
      'trg_sentiment_analysis',
      'sentiment-config-missing',
      jsonb_build_object('missing_settings', to_jsonb(v_missing))
    );
  end if;

  return new;
end;
$$;
