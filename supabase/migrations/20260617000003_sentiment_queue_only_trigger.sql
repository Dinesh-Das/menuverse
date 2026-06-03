-- Keep feedback writes fast and deterministic: the trigger only queues work.
-- The pg_cron worker is the only database path that invokes Edge Functions.

create unique index if not exists sentiment_queue_feedback_id_unique_idx
  on "SentimentQueue"(feedback_id);

create or replace function public.notify_sentiment_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.analysis_locked, false) then
    return new;
  end if;

  insert into "SentimentQueue" (feedback_id, restaurant_id, status, updated_at)
  values (new.id, new.restaurant_id, 'pending', now())
  on conflict (feedback_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sentiment_analysis on public."OrderFeedback";
create trigger trg_sentiment_analysis
  after insert or update of rating, comment, food_rating, service_rating, value_rating, item_ratings
  on public."OrderFeedback"
  for each row
  execute function public.notify_sentiment_analysis();

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('process-sentiment-queue');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'process-sentiment-queue',
      '* * * * *',
      'select public.process_sentiment_queue_tick();'
    );
  end if;
end $$;
