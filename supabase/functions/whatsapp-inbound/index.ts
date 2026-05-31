import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeadersFor, jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { asString, loadIntegrationConfig } from '../_shared/integration-config.ts';

type InboundBody = Record<string, unknown>;
type MenuItemRow = { id: string; name: string; price: number; available: boolean };
type CategoryRow = { id: string; name: string; items: MenuItemRow[] };
type CartLine = { menu_item_id: string; quantity: number; name?: string; price?: number };

function text(value: unknown) {
  return String(value || '').trim();
}

function normalizePhone(value: unknown) {
  return text(value).replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[char] || char));
}

function parseRestaurantMap() {
  try {
    return JSON.parse(Deno.env.get('WHATSAPP_RESTAURANT_MAP') || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

async function parseInbound(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  let body: InboundBody = {};
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    body = Object.fromEntries(form.entries()) as InboundBody;
  } else {
    body = await req.json().catch(() => ({}));
  }

  const value = ((body.entry as Array<Record<string, unknown>> | undefined)?.[0]?.changes as Array<Record<string, unknown>> | undefined)?.[0]?.value as Record<string, unknown> | undefined;
  const message = (value?.messages as Array<Record<string, unknown>> | undefined)?.[0] || {};
  const interactive = message.interactive as Record<string, unknown> | undefined;
  const buttonReply = interactive?.button_reply as Record<string, unknown> | undefined;
  const listReply = interactive?.list_reply as Record<string, unknown> | undefined;
  const textObject = message.text as Record<string, unknown> | undefined;

  const incomingText = text(
    body.Body
    || body.text
    || textObject?.body
    || buttonReply?.id
    || buttonReply?.title
    || listReply?.id
    || listReply?.title
  );

  const from = normalizePhone(body.From || body.from || message.from || body.wa_id);
  const to = normalizePhone(body.To || body.to || value?.metadata && (value.metadata as Record<string, unknown>).display_phone_number);

  return {
    body,
    incomingText,
    from,
    to,
    isTwilio: Boolean(body.MessageSid || String(body.From || '').startsWith('whatsapp:')),
  };
}

function responseFor(req: Request, body: InboundBody, reply: string, isTwilio: boolean) {
  if (isTwilio) {
    return new Response(`<Response><Message>${escapeXml(reply)}</Message></Response>`, {
      headers: {
        ...corsHeadersFor(req, { 'Content-Type': 'application/xml; charset=utf-8' }),
      },
    });
  }

  return jsonResponse(req, { ok: true, reply, body }, 200);
}

function renderCategories(categories: CategoryRow[]) {
  const lines = categories.slice(0, 9).map((category, index) => `${index + 1}. ${category.name}`);
  return `Menu categories\n${lines.join('\n')}\n\nReply with a number.`;
}

function renderItems(category: CategoryRow) {
  const lines = category.items.slice(0, 9).map((item, index) => `${index + 1}. ${item.name} - ${item.price}`);
  return `${category.name}\n${lines.join('\n')}\n\nReply with an item number. Reply M for menu or C to confirm.`;
}

function renderCart(cart: CartLine[]) {
  if (!cart.length) return 'Your cart is empty.';
  const lines = cart.map((line, index) => `${index + 1}. ${line.name || line.menu_item_id} x ${line.quantity}`);
  return `Cart\n${lines.join('\n')}\n\nReply C to confirm or M for menu.`;
}

function parseNumber(input: string) {
  const match = input.match(/\d+/);
  return match ? Number(match[0]) : null;
}

async function maybeSendProviderReply(to: string, reply: string, config: Record<string, unknown> = {}) {
  const webhookUrl = asString(config.endpoint) || Deno.env.get('WHATSAPP_INBOUND_REPLY_WEBHOOK_URL');
  if (!webhookUrl || !to) return;
  const accessToken = asString(config.access_token) || Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ to, message: reply }),
  }).catch(() => null);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse(req);

  const url = new URL(req.url);
  if (req.method === 'GET') {
    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    const provided = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (verifyToken && provided === verifyToken) {
      return new Response(challenge, { headers: corsHeadersFor(req, { 'Content-Type': 'text/plain' }) });
    }
    return new Response('Forbidden', { status: 403, headers: corsHeadersFor(req, { 'Content-Type': 'text/plain' }) });
  }

  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(req, { error: 'WhatsApp inbound service is not configured.' }, 503);

  const inbound = await parseInbound(req);
  const restaurantMap = parseRestaurantMap();
  const restaurantId = text(
    url.searchParams.get('restaurant_id')
    || inbound.body.restaurant_id
    || restaurantMap[inbound.to]
    || restaurantMap[normalizePhone(inbound.to)]
    || Deno.env.get('WHATSAPP_DEFAULT_RESTAURANT_ID')
  );
  const tableId = text(url.searchParams.get('table_id') || inbound.body.table_id) || null;
  const tableSessionToken = text(url.searchParams.get('table_session_token') || inbound.body.table_session_token) || null;

  if (!restaurantId || !inbound.from) {
    return responseFor(req, inbound.body, 'This restaurant WhatsApp number is not configured yet.', inbound.isTwilio);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const channel = await loadIntegrationConfig(supabase, restaurantId, 'whatsapp');
  if (channel && !channel.enabled) {
    return responseFor(req, inbound.body, 'WhatsApp ordering is not enabled for this restaurant.', inbound.isTwilio);
  }
  const [{ data: restaurant }, { data: categories, error: categoryError }] = await Promise.all([
    supabase.from('Restaurant').select('id, slug, name').eq('id', restaurantId).maybeSingle(),
    supabase
      .from('MenuCategory')
      .select('id, name, items:MenuItem(id, name, price, available)')
      .eq('restaurant_id', restaurantId)
      .order('display_order', { ascending: true }),
  ]);

  if (!restaurant || categoryError) {
    const reply = categoryError?.message || 'This restaurant menu is not available right now.';
    return responseFor(req, inbound.body, reply, inbound.isTwilio);
  }

  const availableCategories = (categories || [])
    .map((category: CategoryRow) => ({
      ...category,
      items: (category.items || []).filter(item => item.available),
    }))
    .filter((category: CategoryRow) => category.items.length > 0);

  const { data: existingSession } = await supabase
    .from('WhatsAppSession')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('phone', inbound.from)
    .maybeSingle();

  let session = existingSession || {
    restaurant_id: restaurantId,
    phone: inbound.from,
    table_id: tableId,
    table_session_token: tableSessionToken,
    state: 'awaiting_category',
    cart_json: [],
    context_json: {},
  };

  const lower = inbound.incomingText.toLowerCase();
  const cart = Array.isArray(session.cart_json) ? session.cart_json as CartLine[] : [];
  let reply = '';

  if (!inbound.incomingText || lower === 'hi' || lower === 'menu' || lower === 'm' || lower === 'reset') {
    if (lower === 'reset') cart.splice(0, cart.length);
    session.state = 'awaiting_category';
    session.context_json = {};
    reply = renderCategories(availableCategories);
  } else if (lower === 'cart') {
    reply = renderCart(cart);
  } else if (lower === 'c' || lower === 'confirm' || lower === 'checkout') {
    if (!cart.length) {
      reply = `${renderCart(cart)}\n\nReply M to browse the menu.`;
    } else {
      const idempotencyKey = `wa-${restaurantId}-${inbound.from}-${Date.now()}`;
      const { data: created, error: orderError } = await supabase.rpc('create_order_secure', {
        p_restaurant_id: restaurantId,
        p_table_id: tableId,
        p_table_session_token: tableSessionToken,
        p_items: cart.map(line => ({
          menu_item_id: line.menu_item_id,
          quantity: line.quantity,
          modifier_option_ids: [],
        })),
        p_special_instructions: 'WhatsApp inbound order',
        p_idempotency_key: idempotencyKey,
        p_points_redeemed: 0,
      });

      if (orderError) {
        reply = `Could not place the order: ${orderError.message}`;
      } else {
        const order = Array.isArray(created) ? created[0] : created;
        if (!tableSessionToken) {
          await supabase.rpc('set_order_fulfillment_details', {
            p_order_id: order.order_ref,
            p_table_session_token: null,
            p_order_type: 'takeaway',
            p_delivery_address: null,
            p_delivery_fee: 0,
            p_delivery_distance_km: null,
          }).catch(() => null);
        }
        cart.splice(0, cart.length);
        session.state = 'complete';
        const appBase = (Deno.env.get('CUSTOMER_APP_URL') || Deno.env.get('APP_ORIGIN') || '').replace(/\/$/, '');
        const path = restaurant.slug ? `/r/${restaurant.slug}/order/${order.order_ref}` : `/order/${order.order_ref}`;
        const link = appBase ? `${appBase}${path}` : path;
        reply = `Order ${order.order_ref} confirmed.\nTrack it here: ${link}`;
      }
    }
  } else if (session.state === 'awaiting_item') {
    const categoryId = text((session.context_json as Record<string, unknown>)?.category_id);
    const category = availableCategories.find(item => item.id === categoryId);
    const selectedIndex = (parseNumber(inbound.incomingText) || 0) - 1;
    const item = category?.items?.[selectedIndex];
    if (!category || !item) {
      session.state = 'awaiting_category';
      session.context_json = {};
      reply = renderCategories(availableCategories);
    } else {
      const existing = cart.find(line => line.menu_item_id === item.id);
      if (existing) existing.quantity = Math.min(20, existing.quantity + 1);
      else cart.push({ menu_item_id: item.id, quantity: 1, name: item.name, price: item.price });
      reply = `${item.name} added.\n\n${renderCart(cart)}`;
    }
  } else {
    const selectedIndex = (parseNumber(inbound.incomingText) || 0) - 1;
    const category = availableCategories[selectedIndex];
    if (!category) {
      reply = renderCategories(availableCategories);
    } else {
      session.state = 'awaiting_item';
      session.context_json = { category_id: category.id };
      reply = renderItems(category);
    }
  }

  const upsertPayload = {
    restaurant_id: restaurantId,
    phone: inbound.from,
    table_id: tableId || session.table_id || null,
    table_session_token: tableSessionToken || session.table_session_token || null,
    state: session.state,
    cart_json: cart,
    context_json: session.context_json || {},
    last_message: inbound.incomingText,
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  await supabase
    .from('WhatsAppSession')
    .upsert(upsertPayload, { onConflict: 'restaurant_id,phone' });

  await maybeSendProviderReply(inbound.from, reply, channel?.config || {});
  return responseFor(req, inbound.body, reply, inbound.isTwilio);
});
