import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

function text(value: unknown) {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function predictionEndpoint() {
  const version = text(Deno.env.get('REPLICATE_MODEL_VERSION'));
  if (version) {
    return {
      url: 'https://api.replicate.com/v1/predictions',
      bodyBase: { version },
    };
  }

  const model = text(Deno.env.get('REPLICATE_MODEL') || 'stability-ai/triposr');
  const [owner, name] = model.split('/');
  return {
    url: `https://api.replicate.com/v1/models/${owner}/${name}/predictions`,
    bodyBase: {},
  };
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'AR video processor is not configured.' }, 503);

  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
  const providedSecret = req.headers.get('X-Menuverse-Internal-Secret');
  if (bearer !== serviceRoleKey && (!internalSecret || providedSecret !== internalSecret)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: assets, error: assetError } = await supabase
    .from('ARAsset')
    .select('id, restaurant_id, menu_item_id, source_video_url, processing_metadata')
    .eq('processing_status', 'queued')
    .not('source_video_url', 'is', null)
    .order('created_at', { ascending: true })
    .limit(3);
  if (assetError) return json({ error: assetError.message }, 500);

  const replicateToken = Deno.env.get('REPLICATE_API_TOKEN');
  const results = [];

  for (const asset of assets || []) {
    const metadata = asRecord(asset.processing_metadata);
    await supabase
      .from('ARAsset')
      .update({
        processing_status: 'processing',
        processing_error: null,
        processing_metadata: metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', asset.id);

    if (!replicateToken) {
      const message = 'Replicate not configured: set REPLICATE_API_TOKEN.';
      console.warn(message);
      await supabase
        .from('ARAsset')
        .update({
          processing_status: 'failed',
          processing_error: message,
          processing_metadata: { ...metadata, error: message },
          updated_at: new Date().toISOString(),
        })
        .eq('id', asset.id);
      results.push({ asset_id: asset.id, status: 'failed', error: message });
      continue;
    }

    try {
      const endpoint = predictionEndpoint();
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${replicateToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...endpoint.bodyBase,
          input: {
            images: [asset.source_video_url],
          },
          webhook: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/replicate-webhook`,
          webhook_events_filter: ['completed', 'failed'],
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(text(payload.detail || payload.error) || `Replicate returned HTTP ${response.status}.`);
      }

      await supabase
        .from('ARAsset')
        .update({
          processing_metadata: {
            ...metadata,
            replicate_prediction_id: payload.id,
            replicate_model: Deno.env.get('REPLICATE_MODEL') || 'stability-ai/triposr',
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', asset.id);

      results.push({ asset_id: asset.id, status: 'processing', prediction_id: payload.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Replicate prediction creation failed.';
      await supabase
        .from('ARAsset')
        .update({
          processing_status: 'failed',
          processing_error: message,
          processing_metadata: { ...metadata, error: message },
          updated_at: new Date().toISOString(),
        })
        .eq('id', asset.id);
      results.push({ asset_id: asset.id, status: 'failed', error: message });
    }
  }

  return json({ processed: results.length, results });
});
