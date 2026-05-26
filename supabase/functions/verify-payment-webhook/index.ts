import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toHex(signature);
}

async function sendRestaurantBroadcast(
  supabase: ReturnType<typeof createClient>,
  restaurantId: string,
  payload: Record<string, unknown>,
) {
  const channel = supabase.channel(`restaurant:${restaurantId}`);
  const subscribed = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve(true);
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });

  if (!subscribed) {
    await supabase.removeChannel(channel);
    return false;
  }

  const response = await channel.send({
    type: 'broadcast',
    event: 'payment:captured',
    payload,
  });
  await supabase.removeChannel(channel);
  return response === 'ok';
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Payment webhook is not configured.' }, { status: 503 });
  }

  const rawBody = await req.text();
  const providedSignature = req.headers.get('X-Razorpay-Signature') || '';
  const expectedSignature = await hmacSha256Hex(webhookSecret, rawBody);

  if (!timingSafeEqual(expectedSignature, providedSignature)) {
    return Response.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  if (event.event !== 'payment.captured') {
    return Response.json({ received: true, ignored: event.event || null });
  }

  const paymentEntity = event.payload?.payment?.entity;
  const razorpayOrderId = paymentEntity?.order_id;
  const razorpayPaymentId = paymentEntity?.id;
  if (!razorpayOrderId || !razorpayPaymentId) {
    return Response.json({ error: 'Missing Razorpay payment identifiers.' }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: payments, error: paymentReadError } = await supabase
    .from('Payment')
    .select('id, order_id')
    .eq('razorpay_order_id', razorpayOrderId);

  if (paymentReadError) {
    return Response.json({ error: paymentReadError.message }, { status: 500 });
  }

  const orderIds = (payments || []).map((payment) => payment.order_id);
  if (!orderIds.length) {
    return Response.json({ error: 'No local payment records found.' }, { status: 404 });
  }

  const { data: orders, error: orderReadError } = await supabase
    .from('Order')
    .select('id, restaurant_id, table_session_id')
    .in('id', orderIds);

  if (orderReadError) {
    return Response.json({ error: orderReadError.message }, { status: 500 });
  }

  const restaurantIds = [...new Set((orders || []).map((order) => order.restaurant_id).filter(Boolean))];
  const tableSessionIds = [...new Set((orders || []).map((order) => order.table_session_id).filter(Boolean))];

  const { error: paymentUpdateError } = await supabase
    .from('Payment')
    .update({
      status: 'captured',
      razorpay_payment_id: razorpayPaymentId,
      payment_method: paymentEntity?.method || paymentEntity?.wallet || paymentEntity?.vpa || null,
      provider_fee: typeof paymentEntity?.fee === 'number' ? paymentEntity.fee / 100 : null,
      paid_at: new Date().toISOString(),
      metadata: {
        razorpay: {
          method: paymentEntity?.method || null,
          wallet: paymentEntity?.wallet || null,
          vpa: paymentEntity?.vpa || null,
          bank: paymentEntity?.bank || null,
          card_id: paymentEntity?.card_id || null,
          captured: paymentEntity?.captured ?? null,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('razorpay_order_id', razorpayOrderId);

  if (paymentUpdateError) {
    return Response.json({ error: paymentUpdateError.message }, { status: 500 });
  }

  const { error: orderUpdateError } = await supabase
    .from('Order')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .in('id', orderIds);

  if (orderUpdateError) {
    return Response.json({ error: orderUpdateError.message }, { status: 500 });
  }

  if (tableSessionIds.length) {
    const { error: sessionUpdateError } = await supabase
      .from('TableSession')
      .update({
        status: 'billing',
        updated_at: new Date().toISOString(),
      })
      .in('id', tableSessionIds);

    if (sessionUpdateError) {
      return Response.json({ error: sessionUpdateError.message }, { status: 500 });
    }
  }

  await Promise.all(restaurantIds.map(async (restaurantId) => {
    const delivered = await sendRestaurantBroadcast(
      supabase,
      restaurantId,
      {
        restaurant_id: restaurantId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        order_ids: orderIds,
        table_session_ids: tableSessionIds,
      },
    );
    if (!delivered) {
      console.warn(`Payment captured broadcast was not delivered for restaurant ${restaurantId}.`);
    }
  }));

  return Response.json({ received: true });
});
