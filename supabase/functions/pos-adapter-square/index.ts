import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

function parseModifiers(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function isAuthorized(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  restaurantId: string,
  serviceRoleKey: string,
) {
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (bearer && bearer === serviceRoleKey) return true;

  const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
  const providedSecret = req.headers.get('X-Menuverse-Internal-Secret');
  if (internalSecret && providedSecret === internalSecret) return true;

  if (!bearer) return false;
  const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
  if (userError || !userData.user) return false;

  const { data, error } = await supabase
    .from('User')
    .select('id')
    .eq('id', userData.user.id)
    .eq('restaurant_id', restaurantId)
    .in('role', ['owner', 'manager'])
    .maybeSingle();
  return !error && Boolean(data);
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Square adapter is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const jobId = String(body.job_id || '').trim();
  const orderId = String(body.order_id || '').trim();
  const restaurantId = String(body.restaurant_id || '').trim();
  if (!orderId || !restaurantId) return json({ error: 'order_id and restaurant_id are required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (!(await isAuthorized(supabase, req, restaurantId, serviceRoleKey))) {
    return json({ error: 'Not authorized to run the Square adapter.' }, 403);
  }

  const { data: restaurant, error: restaurantError } = await supabase
    .from('Restaurant')
    .select('id, name, currency, pos_config')
    .eq('id', restaurantId)
    .maybeSingle();
  if (restaurantError) return json({ error: restaurantError.message }, 500);
  if (!restaurant) return json({ error: 'Restaurant not found.' }, 404);

  const { data: order, error: orderError } = await supabase
    .from('Order')
    .select('*, table:Table(number), items:OrderItem(*)')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (orderError) return json({ error: orderError.message }, 500);
  if (!order) return json({ error: 'Order not found.' }, 404);

  const config = restaurant.pos_config || {};
  const accessToken = config.square_access_token || Deno.env.get('SQUARE_ACCESS_TOKEN');
  const locationId = config.square_location_id || Deno.env.get('SQUARE_LOCATION_ID');
  if (!accessToken || !locationId) return json({ error: 'Square access token and location ID are required.' }, 503);

  const currency = String(config.square_currency || restaurant.currency || 'USD').toUpperCase();
  const tableNumber = String(order.table?.number || order.table_id?.slice(-4) || '');
  const squarePayload = {
    idempotency_key: jobId || `${order.id}-square`,
    order: {
      location_id: locationId,
      reference_id: order.id,
      source: { name: 'Menuverse' },
      line_items: (order.items || []).map((item: Record<string, unknown>) => {
        const modifiers = parseModifiers(item.modifiers_json);
        const note = [
          ...modifiers.map((modifier: Record<string, unknown>) => modifier.name).filter(Boolean),
          item.item_note ? `Note: ${item.item_note}` : null,
        ].filter(Boolean).join(', ');

        return {
          name: String(item.name || 'Menu item'),
          quantity: String(Number(item.quantity || 1)),
          base_price_money: {
            amount: Math.round(Number(item.price || 0) * 100),
            currency,
          },
          ...(note ? { note } : {}),
        };
      }),
      fulfillments: [
        {
          type: 'PICKUP',
          state: 'PROPOSED',
          pickup_details: {
            schedule_type: 'ASAP',
            note: `DINE_IN${tableNumber ? ` table ${tableNumber}` : ''}`,
            recipient: { display_name: tableNumber ? `Table ${tableNumber}` : restaurant.name || 'Dine-in guest' },
          },
        },
      ],
      metadata: {
        menuverse_order_id: order.id,
        restaurant_id: restaurantId,
        table_number: tableNumber,
        fulfillment_type: 'DINE_IN',
      },
    },
  };

  const endpointBase = config.square_environment === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';

  const response = await fetch(`${endpointBase}/v2/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': Deno.env.get('SQUARE_VERSION') || '2026-05-20',
    },
    body: JSON.stringify(squarePayload),
  }).catch((error) => error);

  if (response instanceof Error || !response.ok) {
    const error = response instanceof Error ? response.message : await response.text().catch(() => 'Square order sync failed.');
    if (jobId) {
      await supabase
        .from('IntegrationJob')
        .update({ status: 'failed', error, updated_at: new Date().toISOString() })
        .eq('id', jobId);
    }
    return json({ status: 'failed', error, payload: squarePayload }, 502);
  }

  const responseBody = await response.json().catch(() => ({ ok: true }));
  if (jobId) {
    await supabase
      .from('IntegrationJob')
      .update({
        status: 'delivered',
        response: responseBody,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }

  return json({ status: 'delivered', response: responseBody });
});
