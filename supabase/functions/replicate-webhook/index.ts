import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

function text(value: unknown) {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstUrl(value: unknown): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item);
      if (found) return found;
    }
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = firstUrl(nested);
      if (found) return found;
    }
  }
  return null;
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Replicate webhook is not configured.' }, 503);

  const expectedSecret = text(Deno.env.get('REPLICATE_WEBHOOK_SECRET'));
  if (!expectedSecret) return json({ error: 'Replicate webhook secret is not configured.' }, 503);
  if (new URL(req.url).searchParams.get('secret') !== expectedSecret) return json({ error: 'Forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const predictionId = text(body.id);
  const status = text(body.status);
  if (!predictionId) return json({ ok: true });

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: asset, error: assetError } = await supabase
    .from('ARAsset')
    .select('*')
    .eq('replicate_prediction_id', predictionId)
    .maybeSingle();
  if (assetError) return json({ error: assetError.message }, 500);
  if (!asset) return json({ ok: true });

  const metadata = asRecord(asset.processing_metadata);

  if (status === 'failed' || status === 'canceled') {
    const message = text(body.error) || 'Replicate prediction failed.';
    await supabase
      .from('ARAsset')
      .update({
        processing_status: 'failed',
        processing_error: message,
        processing_metadata: { ...metadata, error: message },
        updated_at: new Date().toISOString(),
      })
      .eq('id', asset.id);
    return json({ ok: true });
  }

  if (status !== 'succeeded') return json({ ok: true });

  const glbSourceUrl = firstUrl(body.output);
  if (!glbSourceUrl) {
    const message = 'Replicate completed without a model URL.';
    await supabase
      .from('ARAsset')
      .update({
        processing_status: 'failed',
        processing_error: message,
        processing_metadata: { ...metadata, error: message },
        updated_at: new Date().toISOString(),
      })
      .eq('id', asset.id);
    return json({ ok: true });
  }

  const modelResponse = await fetch(glbSourceUrl);
  if (!modelResponse.ok) return json({ error: 'Unable to download Replicate model output.' }, 502);
  const modelBlob = await modelResponse.blob();
  const modelPath = `${asset.restaurant_id}/${asset.menu_item_id}/model.glb`;
  const { error: uploadError } = await supabase.storage
    .from('ar-models')
    .upload(modelPath, modelBlob, {
      upsert: true,
      contentType: 'model/gltf-binary',
    });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data: publicUrlData } = supabase.storage.from('ar-models').getPublicUrl(modelPath);
  const modelGlbUrl = publicUrlData.publicUrl;
  const updates: Record<string, unknown> = {
    model_glb_url: modelGlbUrl,
    processing_status: 'complete',
    processing_error: null,
    processing_metadata: { ...metadata, replicate_output_url: glbSourceUrl },
    updated_at: new Date().toISOString(),
  };

  const converterUrl = Deno.env.get('AR_USDZ_CONVERTER_URL');
  if (converterUrl) {
    const converterResponse = await fetch(converterUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ glb_url: modelGlbUrl }),
    }).catch(() => null);
    if (converterResponse?.ok) {
      const converterPayload = await converterResponse.json().catch(() => ({}));
      const usdzUrl = text(converterPayload.usdz_url || converterPayload.model_usdz_url || converterPayload.url);
      if (usdzUrl) updates.model_usdz_url = usdzUrl;
    }
  }

  await supabase
    .from('ARAsset')
    .update(updates)
    .eq('id', asset.id);

  await supabase
    .from('MenuItem')
    .update({ has_ar_preview: true, updated_at: new Date().toISOString() })
    .eq('id', asset.menu_item_id)
    .eq('restaurant_id', asset.restaurant_id);

  return json({ ok: true, model_glb_url: modelGlbUrl });
});
