import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { asRecord, asString, createAdminAlert, loadIntegrationConfig } from '../_shared/integration-config.ts';
import { verifyHexHmac } from '../_shared/webhook-crypto.ts';
import { normalizeAggregatorOrder, signatureForAggregator } from '../_shared/aggregator-adapters.ts';

const SUPPORTED_CHANNELS = new Set(['swiggy', 'zomato', 'ubereats', 'doordash', 'google_food', 'custom']);

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Aggregator webhook is not configured.' }, 503);

  const url = new URL(req.url);
  const restaurantId = asString(url.searchParams.get('restaurant_id'));
  const channel = (asString(url.searchParams.get('channel')) || 'custom').toLowerCase();
  if (!restaurantId || !SUPPORTED_CHANNELS.has(channel)) return json({ error: 'Valid restaurant_id and channel are required.' }, 400);

  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(rawBody || '{}'));
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const loaded = await loadIntegrationConfig(supabase, restaurantId, channel);
  if (!loaded?.enabled) return json({ error: `${channel} is not enabled.` }, 403);

  const valid = await verifyHexHmac(
    asString(loaded.config.webhook_secret),
    rawBody,
    signatureForAggregator(req, channel),
  );
  if (!valid) {
    await createAdminAlert(supabase, {
      restaurantId,
      title: 'Rejected channel webhook signature',
      message: `An inbound ${channel} order failed signature validation.`,
      source: 'aggregator_order_webhook',
      dedupeKey: `channel-signature:${channel}`,
      metadata: { channel },
    });
    return json({ error: 'Invalid signature.' }, 403);
  }

  const normalized = normalizeAggregatorOrder(channel, payload);
  const { externalOrderId, items } = normalized;
  if (!externalOrderId || !items.length) return json({ error: 'external_order_id and items are required.' }, 400);

  const { data, error } = await supabase.rpc('create_external_channel_order', {
    p_restaurant_id: restaurantId,
    p_channel: channel,
    p_external_order_id: externalOrderId,
    p_items: items,
    p_customer: normalized.customer,
    p_delivery_address: normalized.deliveryAddress,
    p_payload: payload,
  });
  if (error) {
    await createAdminAlert(supabase, {
      restaurantId,
      title: 'Inbound channel order failed',
      message: error.message,
      source: 'aggregator_order_webhook',
      dedupeKey: `channel-order:${channel}:${externalOrderId}`,
      metadata: { channel, external_order_id: externalOrderId },
    });
    return json({ error: error.message }, 422);
  }
  return json({ created: true, order: data });
});
