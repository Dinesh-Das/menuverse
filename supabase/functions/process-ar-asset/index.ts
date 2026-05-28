import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

type ARAsset = {
  id: string;
  restaurant_id: string;
  menu_item_id: string;
  source_video_url: string | null;
};

function cleanText(value: unknown) {
  return String(value || '').trim();
}

function extractStoragePath(payload: Record<string, unknown>) {
  const record = (payload.record || payload.object || {}) as Record<string, unknown>;
  return cleanText(payload.storage_path || payload.name || record.name || record.path);
}

function findGlbUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (/^https?:\/\//i.test(candidate) && /\.glb($|\?)/i.test(candidate)) return candidate;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findGlbUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const preferredKeys = ['glb', 'glb_url', 'model_glb_url', 'model', 'model_url', 'mesh', 'output'];
    for (const key of preferredKeys) {
      const found = findGlbUrl(objectValue[key]);
      if (found) return found;
    }
    for (const nested of Object.values(objectValue)) {
      const found = findGlbUrl(nested);
      if (found) return found;
    }
  }
  return null;
}

function replicateEndpoint() {
  const version = cleanText(Deno.env.get('REPLICATE_MODEL_VERSION'));
  if (version) {
    return {
      url: 'https://api.replicate.com/v1/predictions',
      bodyBase: { version },
    };
  }

  const model = cleanText(Deno.env.get('REPLICATE_MODEL') || 'stability-ai/triposr');
  const [owner, name] = model.split('/');
  if (!owner || !name) throw new Error('REPLICATE_MODEL must be in owner/model format.');
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
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'AR processing service is not configured.' }, 503);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const assetId = cleanText(body.asset_id);
  const storagePath = extractStoragePath(body);
  const sourceVideoUrl = cleanText(body.source_video_url);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let asset: ARAsset | null = null;
  if (assetId) {
    const { data, error } = await supabase
      .from('ARAsset')
      .select('id, restaurant_id, menu_item_id, source_video_url')
      .eq('id', assetId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    asset = data as ARAsset | null;
  } else if (storagePath) {
    const [restaurantId, menuItemId] = storagePath.split('/');
    if (restaurantId && menuItemId) {
      const { data, error } = await supabase
        .from('ARAsset')
        .select('id, restaurant_id, menu_item_id, source_video_url')
        .eq('restaurant_id', restaurantId)
        .eq('menu_item_id', menuItemId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      asset = data as ARAsset | null;
    }
  }

  if (!asset) return json({ error: 'AR asset was not found for this video upload.' }, 404);
  const videoUrl = sourceVideoUrl || asset.source_video_url;
  if (!videoUrl) return json({ error: 'AR source video URL is required.' }, 400);

  await supabase
    .from('ARAsset')
    .update({
      processing_status: 'processing',
      processing_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', asset.id);

  const replicateToken = Deno.env.get('REPLICATE_API_TOKEN');
  if (!replicateToken) {
    await supabase
      .from('ARAsset')
      .update({
        processing_status: 'failed',
        processing_error: 'REPLICATE_API_TOKEN is not configured.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', asset.id);
    return json({ error: 'REPLICATE_API_TOKEN is not configured.' }, 503);
  }

  try {
    const endpoint = replicateEndpoint();
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=60',
        'Cancel-After': Deno.env.get('REPLICATE_CANCEL_AFTER') || '20m',
      },
      body: JSON.stringify({
        ...endpoint.bodyBase,
        input: {
          video: videoUrl,
          video_url: videoUrl,
          input_video: videoUrl,
        },
      }),
    });

    const prediction = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(cleanText(prediction.detail || prediction.error) || `Replicate returned ${response.status}.`);
    }

    const glbUrl = findGlbUrl(prediction.output);
    if (glbUrl) {
      await supabase
        .from('ARAsset')
        .update({
          model_glb_url: glbUrl,
          processing_status: 'complete',
          processing_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', asset.id);

      await supabase
        .from('MenuItem')
        .update({
          has_ar_preview: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', asset.menu_item_id)
        .eq('restaurant_id', asset.restaurant_id);

      return json({ ok: true, status: 'complete', asset_id: asset.id, model_glb_url: glbUrl });
    }

    await supabase
      .from('ARAsset')
      .update({
        processing_status: prediction.status === 'failed' ? 'failed' : 'processing',
        processing_error: prediction.status === 'failed'
          ? cleanText(prediction.error || 'Replicate prediction failed.')
          : `Replicate prediction ${cleanText(prediction.id)} is ${cleanText(prediction.status || 'queued')}.`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', asset.id);

    return json({
      ok: true,
      status: prediction.status || 'processing',
      asset_id: asset.id,
      prediction_id: prediction.id || null,
      prediction_url: prediction.urls?.get || null,
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AR processing failed.';
    await supabase
      .from('ARAsset')
      .update({
        processing_status: 'failed',
        processing_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', asset.id);
    return json({ error: message }, 502);
  }
});
