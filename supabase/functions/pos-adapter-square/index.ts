import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { loadIntegrationConfig } from '../_shared/integration-config.ts';

type SupabaseClient = ReturnType<typeof createClient>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function moneyAmount(item: Record<string, unknown>) {
  if (item.price_in_paise !== undefined && item.price_in_paise !== null) {
    return Math.round(Number(item.price_in_paise || 0));
  }
  const price = Number(item.unit_price ?? item.price ?? 0);
  return Math.round(price * 100);
}

function tableNumberFromOrder(order: Record<string, unknown>) {
  const table = asRecord(order.table);
  return asString(order.table_number)
    || asString(table.number)
    || asString(table.table_number)
    || '';
}

function squareErrorDetail(body: unknown, fallback: string) {
  const payload = asRecord(body);
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  if (!errors.length) return fallback;
  return errors
    .map(error => {
      const record = asRecord(error);
      return [record.category, record.code, record.detail].filter(Boolean).join(': ');
    })
    .filter(Boolean)
    .join('; ') || fallback;
}

async function markJobFailed(supabase: SupabaseClient, jobId: string, error: string) {
  await supabase
    .from('IntegrationJob')
    .update({ status: 'failed', error, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
  const providedSecret = req.headers.get('X-Menuverse-Internal-Secret');
  if (!internalSecret || providedSecret !== internalSecret) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Square adapter is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const jobId = asString(body.job_id);
  const orderId = asString(body.order_id);
  const restaurantId = asString(body.restaurant_id);
  if (!jobId || !orderId || !restaurantId) {
    return json({ error: 'job_id, order_id and restaurant_id are required.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: job, error: jobError } = await supabase
    .from('IntegrationJob')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) return json({ error: jobError.message }, 500);
  if (!job) return json({ error: 'Integration job not found.' }, 404);
  if (job.job_type !== 'pos' || job.provider !== 'square') {
    return json({ error: 'Integration job is not a Square POS job.' }, 400);
  }

  const { data: restaurant, error: restaurantError } = await supabase
    .from('Restaurant')
    .select('id, name, pos_config')
    .eq('id', restaurantId)
    .maybeSingle();
  if (restaurantError) return json({ error: restaurantError.message }, 500);
  if (!restaurant) return json({ error: 'Restaurant not found.' }, 404);

  const privateConfig = await loadIntegrationConfig(supabase, restaurantId, 'pos');
  const config = { ...asRecord(restaurant.pos_config), ...asRecord(privateConfig?.config) };
  const accessToken = asString(config.square_access_token) || Deno.env.get('SQUARE_ACCESS_TOKEN') || '';
  const locationId = asString(config.square_location_id) || Deno.env.get('SQUARE_LOCATION_ID') || '';
  const environment = (asString(config.square_environment) || Deno.env.get('SQUARE_ENVIRONMENT') || 'production').toLowerCase();
  const currency = (asString(config.square_currency) || 'USD').toUpperCase();
  const squareVersion = Deno.env.get('SQUARE_VERSION') || '2026-05-20';

  if (!accessToken || !locationId) {
    const message = 'Square access token and location ID are required.';
    await markJobFailed(supabase, jobId, message);
    return json({ status: 'failed', job_id: jobId, error: message }, 502);
  }

  const { data: order, error: orderError } = await supabase
    .from('Order')
    .select('*, table:Table(*), order_items:OrderItem(*)')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (orderError) return json({ error: orderError.message }, 500);
  if (!order) return json({ error: 'Order not found.' }, 404);

  const tableNumber = tableNumberFromOrder(order);
  const pickupAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const lineItems = (order.order_items || []).map((rawItem: unknown) => {
    const item = asRecord(rawItem);
    return {
      name: asString(item.name) || 'Menu item',
      quantity: String(Number(item.quantity || 1)),
      base_price_money: {
        amount: moneyAmount(item),
        currency,
      },
      ...(asString(item.item_note) ? { note: asString(item.item_note) } : {}),
    };
  });

  const squarePayload = {
    idempotency_key: jobId,
    order: {
      location_id: locationId,
      reference_id: orderId,
      line_items: lineItems,
      metadata: {
        menuverse_order_id: orderId,
        table_number: tableNumber,
      },
      fulfillments: [
        {
          type: 'PICKUP',
          state: 'PROPOSED',
          pickup_details: {
            note: `Table ${tableNumber}`,
            pickup_at: pickupAt,
          },
        },
      ],
    },
  };

  const endpointBase = environment === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';

  try {
    const response = await fetch(`${endpointBase}/v2/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': squareVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(squarePayload),
    });

    const responseBody = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
    if (![200, 201].includes(response.status)) {
      const detail = squareErrorDetail(responseBody, 'Square order sync failed.');
      await markJobFailed(supabase, jobId, detail);
      return json({ status: 'failed', job_id: jobId, error: detail }, 502);
    }

    const squareOrderId = asString(asRecord(responseBody.order).id);
    await supabase
      .from('IntegrationJob')
      .update({
        status: 'delivered',
        response: { square_order_id: squareOrderId },
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (squareOrderId) {
      await supabase
        .from('Order')
        .update({ pos_order_id: squareOrderId, updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .eq('restaurant_id', restaurantId);
    }

    return json({ status: 'delivered', job_id: jobId, square_order_id: squareOrderId || undefined });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Square order sync failed.';
    await markJobFailed(supabase, jobId, detail);
    return json({ status: 'failed', job_id: jobId, error: detail }, 502);
  }
});
