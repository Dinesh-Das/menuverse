import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeadersFor, jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { asRecord, asString, loadIntegrationConfig } from '../_shared/integration-config.ts';
import { verifyHexHmac } from '../_shared/webhook-crypto.ts';

function extractStructuredOrder(payload: Record<string, unknown>) {
  if (payload.order) return asRecord(payload.order);
  const entry = Array.isArray(payload.entry) ? asRecord(payload.entry[0]) : {};
  const messaging = Array.isArray(entry.messaging) ? asRecord(entry.messaging[0]) : {};
  const postback = asRecord(messaging.postback);
  const raw = asString(postback.payload);
  if (!raw.startsWith('{')) return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse(req);
  const url = new URL(req.url);
  const restaurantId = asString(url.searchParams.get('restaurant_id'));
  const channel = (asString(url.searchParams.get('channel')) || 'instagram').toLowerCase();

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey || !restaurantId) return jsonResponse(req, { error: 'Webhook is not configured.' }, 503);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const loaded = await loadIntegrationConfig(supabase, restaurantId, channel);

  if (req.method === 'GET') {
    const token = url.searchParams.get('hub.verify_token') || '';
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (loaded?.enabled && token === asString(loaded.config.verify_token)) {
      return new Response(challenge, { headers: corsHeadersFor(req, { 'Content-Type': 'text/plain' }) });
    }
    return new Response('Forbidden', { status: 403, headers: corsHeadersFor(req, { 'Content-Type': 'text/plain' }) });
  }
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  if (!loaded?.enabled) return jsonResponse(req, { error: `${channel} is not enabled.` }, 403);

  const rawBody = await req.text();
  const valid = await verifyHexHmac(
    asString(loaded.config.app_secret),
    rawBody,
    req.headers.get('x-hub-signature-256') || '',
  );
  if (!valid) return jsonResponse(req, { error: 'Invalid signature.' }, 403);

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(rawBody || '{}'));
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON.' }, 400);
  }
  const order = extractStructuredOrder(payload);
  const externalOrderId = asString(order.external_order_id) || asString(order.order_id) || asString(order.id);
  const items = Array.isArray(order.items) ? order.items : [];
  if (!externalOrderId || !items.length) {
    return jsonResponse(req, { received: true, message: 'No structured order payload was present.' });
  }

  const { data, error } = await supabase.rpc('create_external_channel_order', {
    p_restaurant_id: restaurantId,
    p_channel: channel,
    p_external_order_id: externalOrderId,
    p_items: items,
    p_customer: asRecord(order.customer),
    p_delivery_address: order.delivery_address ? asRecord(order.delivery_address) : null,
    p_payload: payload,
  });
  if (error) return jsonResponse(req, { error: error.message }, 422);
  return jsonResponse(req, { created: true, order: data });
});
