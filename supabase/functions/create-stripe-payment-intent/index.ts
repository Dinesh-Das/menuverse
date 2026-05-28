import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

function clampSplitCount(value: unknown) {
  const count = Number(value || 1);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(10, Math.floor(count)));
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const stripePublishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!stripeKey || !stripePublishableKey) return json({ error: 'Stripe not configured.' }, 503);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Payment service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const tableSessionToken = body.table_session_token;
  if (!tableSessionToken) return json({ error: 'table_session_token is required.' }, 400);

  const splitCount = clampSplitCount(body.split_count);
  const isSplitPayment = splitCount > 1;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' });

  const { data: ordersResult, error: ordersError } = await supabase.rpc('get_table_session_orders', {
    p_table_session_token: tableSessionToken,
  });
  if (ordersError) return json({ error: ordersError.message }, 400);

  const payableOrders = (Array.isArray(ordersResult) ? ordersResult : [])
    .filter((order) => !['cancelled', 'completed'].includes(order.status));
  const totalAmount = payableOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const checkoutAmount = isSplitPayment ? totalAmount / splitCount : totalAmount;
  if (!payableOrders.length || checkoutAmount <= 0) {
    return json({ error: 'No payable orders found for this table session.' }, 400);
  }

  const { data: session, error: sessionError } = await supabase
    .from('TableSession')
    .select('id, restaurant_id')
    .eq('token', tableSessionToken)
    .maybeSingle();
  if (sessionError) return json({ error: sessionError.message }, 500);
  if (!session) return json({ error: 'Table session not found.' }, 404);

  const { data: restaurant, error: restaurantError } = await supabase
    .from('Restaurant')
    .select('id, currency')
    .eq('id', session.restaurant_id)
    .maybeSingle();
  if (restaurantError) return json({ error: restaurantError.message }, 500);

  const { data: bill, error: billError } = await supabase
    .from('SessionBill')
    .select('id')
    .eq('table_session_id', session.id)
    .maybeSingle();
  if (billError) return json({ error: billError.message }, 500);

  const orderIds = payableOrders.map((order) => order.id).filter(Boolean);
  const { data: existingPayments, error: existingPaymentError } = await supabase
    .from('Payment')
    .select('order_id, split_index, split_total, status')
    .in('order_id', orderIds);
  if (existingPaymentError) return json({ error: existingPaymentError.message }, 500);

  let splitIndex = 0;
  if (isSplitPayment) {
    const usedIndexes = new Set((existingPayments || [])
      .filter((payment) => Number(payment.split_total || 1) === splitCount)
      .map((payment) => Number(payment.split_index || 0)));
    while (usedIndexes.has(splitIndex) && splitIndex < splitCount) splitIndex += 1;
    if (splitIndex >= splitCount) {
      return json({ error: 'All split payment slots are already in progress or paid.' }, 409);
    }
  } else if ((existingPayments || []).some((payment) => payment.status === 'captured')) {
    return json({ error: 'One or more orders in this session are already paid.' }, 409);
  }

  const currency = String(restaurant?.currency || 'usd').toLowerCase();
  const amountCents = Math.round(checkoutAmount * 100);
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    automatic_payment_methods: { enabled: true },
    metadata: {
      table_session_id: session.id,
      table_session_token: tableSessionToken,
      restaurant_id: session.restaurant_id,
      session_bill_id: bill?.id || '',
      split_index: String(splitIndex),
      split_total: String(splitCount),
      order_ids: orderIds.join(','),
    },
  });

  const paymentRows = payableOrders.map((order) => ({
    id: crypto.randomUUID(),
    order_id: order.id,
    session_bill_id: bill?.id || null,
    split_index: splitIndex,
    split_total: splitCount,
    razorpay_order_id: paymentIntent.id,
    stripe_payment_intent_id: paymentIntent.id,
    status: 'initiated',
    provider: 'stripe',
    amount: isSplitPayment ? Number(order.total_amount || 0) / splitCount : Number(order.total_amount || 0),
    metadata: {
      table_session_token: tableSessionToken,
      table_session_id: session.id,
      stripe_payment_intent_id: paymentIntent.id,
      split_payment: isSplitPayment,
    },
  }));

  const { error: paymentInsertError } = await supabase
    .from('Payment')
    .insert(paymentRows);
  if (paymentInsertError) return json({ error: paymentInsertError.message }, 500);

  if (isSplitPayment && bill?.id) {
    await supabase
      .from('SessionBill')
      .update({
        split_count: splitCount,
        split_status: 'splitting',
        payment_status: 'partially_paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bill.id);
  }

  return json({
    client_secret: paymentIntent.client_secret,
    publishable_key: stripePublishableKey,
    amount: amountCents,
    currency,
    split_index: splitIndex,
    split_total: splitCount,
    share_amount: checkoutAmount,
  });
});
