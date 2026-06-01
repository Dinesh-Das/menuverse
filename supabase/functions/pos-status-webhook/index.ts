import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { asRecord, asString, createAdminAlert, loadIntegrationConfig } from '../_shared/integration-config.ts';
import { verifyHexHmac, verifySquareSignature } from '../_shared/webhook-crypto.ts';

function parseStatus(provider: string, payload: Record<string, unknown>) {
  if (provider === 'square') {
    const data = asRecord(payload.data);
    const object = asRecord(data.object);
    const updated = asRecord(object.order_updated);
    return { orderId: asString(updated.order_id) || asString(data.id), status: asString(updated.state) };
  }
  return {
    orderId: asString(payload.order_id) || asString(payload.orderid) || asString(payload.pos_order_id),
    status: asString(payload.status) || asString(payload.order_status) || asString(payload.state),
  };
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'POS status webhook is not configured.' }, 503);

  const url = new URL(req.url);
  const restaurantId = asString(url.searchParams.get('restaurant_id'));
  const provider = (asString(url.searchParams.get('provider')) || 'webhook').toLowerCase();
  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);

  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(rawBody || '{}'));
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const loaded = await loadIntegrationConfig(supabase, restaurantId, 'pos');
  const config = asRecord(loaded?.config);

  let signatureValid = false;
  if (provider === 'square') {
    signatureValid = await verifySquareSignature(
      asString(config.square_webhook_signature_key),
      asString(config.square_webhook_url) || req.url,
      rawBody,
      req.headers.get('x-square-hmacsha256-signature') || '',
    );
  } else {
    signatureValid = await verifyHexHmac(
      asString(config.petpooja_webhook_secret) || asString(config.webhook_secret),
      rawBody,
      req.headers.get('x-menuverse-signature') || '',
    );
  }

  if (!signatureValid) {
    await createAdminAlert(supabase, {
      restaurantId,
      title: 'Rejected POS webhook signature',
      message: `A ${provider} POS status webhook failed signature validation.`,
      source: 'pos_status_webhook',
      dedupeKey: `pos-signature:${provider}`,
      metadata: { provider },
    });
    return json({ error: 'Invalid signature.' }, 403);
  }

  if (provider === 'square' && asString(payload.type) === 'catalog.version.updated') {
    const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
    if (!internalSecret) return json({ error: 'Square catalog sync internal secret is not configured.' }, 503);
    const { data, error } = await supabase.functions.invoke('sync-pos-catalog', {
      body: { restaurant_id: restaurantId },
      headers: { 'X-Menuverse-Internal-Secret': internalSecret },
    });
    if (error || data?.error) return json({ error: data?.error || error?.message || 'Square catalog sync failed.' }, 502);
    return json(data);
  }

  const parsed = parseStatus(provider, payload);
  if (!parsed.orderId || !parsed.status) return json({ error: 'POS order ID and status are required.' }, 400);

  const { data, error } = await supabase.rpc('update_order_status_from_pos', {
    p_pos_order_id: parsed.orderId,
    p_provider: provider,
    p_external_status: parsed.status,
    p_payload: payload,
  });
  if (error) {
    await createAdminAlert(supabase, {
      restaurantId,
      title: 'POS status update needs attention',
      message: error.message,
      source: 'pos_status_webhook',
      dedupeKey: `pos-status:${provider}:${parsed.orderId}:${parsed.status}`,
      metadata: { provider, order_id: parsed.orderId, status: parsed.status },
    });
    return json({ error: error.message }, 422);
  }

  return json({ updated: true, order: data });
});
