create or replace function public.sentiment_engine_status(p_restaurant_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'url_configured',
      nullif(current_setting('app.settings.edge_function_base_url', true), '') is not null
      or nullif(current_setting('app.settings.supabase_url', true), '') is not null
      or nullif(current_setting('app.supabase_url', true), '') is not null,
    'last_nlp_analysis', (
      select max(analysed_at)
      from "OrderFeedback"
      where restaurant_id = p_restaurant_id
        and analysis_source like 'anthropic:%'
    ),
    'baseline_only_24h', (
      select count(*)
      from "OrderFeedback"
      where restaurant_id = p_restaurant_id
        and analysis_source in ('rating_baseline', 'rating_keyword_baseline')
        and created_at > now() - interval '24 hours'
    ),
    'total_feedback_24h', (
      select count(*)
      from "OrderFeedback"
      where restaurant_id = p_restaurant_id
        and created_at > now() - interval '24 hours'
    )
  );
$$;

grant execute on function public.sentiment_engine_status(text) to authenticated;
