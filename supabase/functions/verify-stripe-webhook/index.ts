import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!stripeKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Stripe webhook is not configured.' }, 503);
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Missing Stripe signature.' }, 400);

  const rawBody = await req.text();
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `Invalid signature: ${message}` }, 400);
  }

  if (event.type !== 'payment_intent.succeeded') {
    return json({ received: true, ignored: event.type });
  }

  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: payments, error: paymentReadError } = await supabase
    .from('Payment')
    .select('id, order_id, session_bill_id, split_index, split_total')
    .eq('stripe_payment_intent_id', paymentIntent.id);
  if (paymentReadError) return json({ error: paymentReadError.message }, 500);

  const orderIds = (payments || []).map((payment) => payment.order_id).filter(Boolean);
  if (!orderIds.length) return json({ error: 'No local payment records found.' }, 404);

  const now = new Date().toISOString();
  const { error: paymentUpdateError } = await supabase
    .from('Payment')
    .update({
      status: 'captured',
      payment_method: paymentIntent.payment_method_types?.[0] || null,
      paid_at: now,
      metadata: {
        stripe: {
          payment_intent_id: paymentIntent.id,
          payment_method: paymentIntent.payment_method || null,
          receipt_email: paymentIntent.receipt_email || null,
        },
      },
      updated_at: now,
    })
    .eq('stripe_payment_intent_id', paymentIntent.id);
  if (paymentUpdateError) return json({ error: paymentUpdateError.message }, 500);

  const { data: orders, error: orderReadError } = await supabase
    .from('Order')
    .select('id, restaurant_id, table_session_id')
    .in('id', orderIds);
  if (orderReadError) return json({ error: orderReadError.message }, 500);

  const sessionBillIds = [...new Set((payments || []).map((payment) => payment.session_bill_id).filter(Boolean))];
  const splitTotal = Math.max(1, ...(payments || []).map((payment) => Number(payment.split_total || 1)));
  let allSplitSharesPaid = true;

  for (const billId of sessionBillIds) {
    const { data: billPayments, error: billPaymentReadError } = await supabase
      .from('Payment')
      .select('split_index, split_total, status')
      .eq('session_bill_id', billId);
    if (billPaymentReadError) return json({ error: billPaymentReadError.message }, 500);

    const billSplitTotal = Math.max(1, ...(billPayments || []).map((payment) => Number(payment.split_total || 1)));
    const paidSplitIndexes = new Set((billPayments || [])
      .filter((payment) => payment.status === 'captured')
      .map((payment) => Number(payment.split_index || 0)));
    const paidCount = Math.min(paidSplitIndexes.size, billSplitTotal);
    const billFullyPaid = paidCount >= billSplitTotal;
    if (!billFullyPaid) allSplitSharesPaid = false;

    const { error: billUpdateError } = await supabase
      .from('SessionBill')
      .update({
        split_count: billSplitTotal,
        split_paid: paidCount,
        split_status: billSplitTotal > 1
          ? (billFullyPaid ? 'fully_split_paid' : 'partially_paid')
          : 'full',
        payment_status: billFullyPaid ? 'paid' : 'partially_paid',
        updated_at: now,
      })
      .eq('id', billId);
    if (billUpdateError) return json({ error: billUpdateError.message }, 500);
  }

  const shouldCompleteOrders = splitTotal <= 1 || allSplitSharesPaid;
  if (shouldCompleteOrders) {
    const { error: orderUpdateError } = await supabase
      .from('Order')
      .update({ status: 'completed', updated_at: now })
      .in('id', orderIds);
    if (orderUpdateError) return json({ error: orderUpdateError.message }, 500);

    await Promise.all(orderIds.map((orderId) =>
      supabase.rpc('update_guest_profile_on_order', { p_order_id: orderId })
        .then(({ error }) => {
          if (error && !/function .*update_guest_profile_on_order/i.test(error.message)) {
            console.warn(`Guest profile spend update failed for order ${orderId}: ${error.message}`);
          }
        })
    ));
  }

  const tableSessionIds = [...new Set((orders || []).map((order) => order.table_session_id).filter(Boolean))];
  if (tableSessionIds.length) {
    const { error: sessionUpdateError } = await supabase
      .from('TableSession')
      .update({ status: 'billing', updated_at: now })
      .in('id', tableSessionIds);
    if (sessionUpdateError) return json({ error: sessionUpdateError.message }, 500);
  }

  return json({ received: true, payment_intent_id: paymentIntent.id });
});
