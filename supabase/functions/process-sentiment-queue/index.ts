import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { hasValidInternalSecret } from '../_shared/internal-auth.ts';

const MAX_ATTEMPTS = 5;

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
  if (!hasValidInternalSecret(req, internalSecret)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Sentiment queue processor is not configured.' }, 503);
  }

  const requestBody = await req.json().catch(() => ({}));
  const batchSize = Math.max(1, Math.min(20, Number(requestBody.batch_size || 20)));
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: jobs, error } = await supabase.rpc('claim_sentiment_queue_jobs', {
    p_batch_size: batchSize,
  });
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const job of jobs || []) {
    const { data, error: invokeError } = await supabase.functions.invoke('analyse-feedback', {
      body: { feedback_id: job.feedback_id },
      headers: { 'X-Menuverse-Internal-Secret': internalSecret },
    });

    if (!invokeError && (data?.analysed || data?.skipped)) {
      await supabase
        .from('SentimentQueue')
        .update({
          status: 'processed',
          last_error: null,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      results.push({ id: job.id, status: 'processed' });
      continue;
    }

    const attempts = Number(job.attempts || 0);
    const nextStatus = attempts >= MAX_ATTEMPTS ? 'dead_letter' : 'failed';
    const message = invokeError?.message || data?.error || 'Feedback analysis failed.';
    await supabase
      .from('SentimentQueue')
      .update({
        status: nextStatus,
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    if (nextStatus === 'dead_letter') {
      await supabase.rpc('upsert_admin_alert', {
        p_restaurant_id: job.restaurant_id,
        p_severity: 'high',
        p_title: 'Feedback analysis moved to dead letter',
        p_message: message,
        p_source: 'process_sentiment_queue',
        p_dedupe_key: `sentiment-dead-letter:${job.feedback_id}`,
        p_metadata: { queue_id: job.id, feedback_id: job.feedback_id, attempts },
      });
    }
    results.push({ id: job.id, status: nextStatus, error: message });
  }

  return json({ processed: results.length, results });
});
