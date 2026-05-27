import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://menuverse.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-menuverse-internal-secret',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'POS adapter is not configured.' }, 503);

  const endpoint = Deno.env.get('PETPOOJA_KOT_URL');
  const token = Deno.env.get('PETPOOJA_TOKEN');
  const fallbackRestId = Deno.env.get('PETPOOJA_REST_ID');
  if (!endpoint) return json({ error: 'PETPOOJA_KOT_URL is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const jobId = String(body.job_id || '').trim();
  const orderId = String(body.order_id || '').trim();
  const restaurantId = String(body.restaurant_id || '').trim();
  if (!orderId || !restaurantId) return json({ error: 'order_id and restaurant_id are required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (!(await isAuthorized(supabase, req, restaurantId, serviceRoleKey))) {
    return json({ error: 'Not authorized to run the Petpooja adapter.' }, 403);
  }

  const { data: restaurant, error: restaurantError } = await supabase
    .from('Restaurant')
    .select('id, name, pos_config')
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
  const restID = config.petpooja_rest_id || config.restID || fallbackRestId;
  if (!restID) return json({ error: 'Petpooja restaurant ID is not configured.' }, 503);

  const petpoojaPayload = {
    restID,
    orderType: '1',
    tableNo: String(order.table?.number || ''),
    items: (order.items || []).map((item: Record<string, unknown>) => {
      const modifiers = parseModifiers(item.modifiers_json);
      const customization = [
        ...modifiers.map((modifier: Record<string, unknown>) => modifier.name).filter(Boolean),
        item.item_note ? `Note: ${item.item_note}` : null,
      ].filter(Boolean).join(', ');

      return {
        itemid: String(item.menu_item_id || ''),
        itemname: String(item.name || ''),
        itemqty: Number(item.quantity || 1),
        itemprice: Number(item.price || 0),
        item_tax: '',
        customization,
      };
    }),
    orderNote: order.special_instructions || '',
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(petpoojaPayload),
  }).catch((error) => error);

  if (response instanceof Error || !response.ok) {
    const error = response instanceof Error ? response.message : await response.text().catch(() => 'Petpooja KOT sync failed.');
    if (jobId) {
      await supabase
        .from('IntegrationJob')
        .update({
          status: 'failed',
          error,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }
    return json({ status: 'failed', error, payload: petpoojaPayload }, 502);
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
