import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
  const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');

  if (!supabaseUrl || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) {
    return json({ error: 'Payment service is not configured.' }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const tableSessionToken = body.table_session_token;
  if (!tableSessionToken) {
    return json({ error: 'table_session_token is required.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.rpc('get_table_session_orders', {
    p_table_session_token: tableSessionToken,
  });

  if (error) return json({ error: error.message }, 400);

  const orders = Array.isArray(data) ? data : [];
  const payableOrders = orders.filter((order) => !['cancelled', 'completed'].includes(order.status));
  const amountRupees = payableOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const amountPaise = Math.round(amountRupees * 100);

  if (!payableOrders.length || amountPaise <= 0) {
    return json({ error: 'No payable orders found for this table session.' }, 400);
  }

  const orderIds = payableOrders.map((order) => order.id).filter(Boolean);
  const { data: existingPayments, error: existingPaymentError } = await supabase
    .from('Payment')
    .select('id, order_id, razorpay_order_id, status, amount')
    .in('order_id', orderIds);

  if (existingPaymentError) return json({ error: existingPaymentError.message }, 500);

  if ((existingPayments || []).some((payment) => payment.status === 'captured')) {
    return json({ error: 'One or more orders in this session are already paid.' }, 409);
  }

  const expectedAmounts = new Map(payableOrders.map((order) => [order.id, Number(order.total_amount || 0)]));
  const reusableRazorpayOrderId = [...new Set((existingPayments || [])
    .filter((payment) => payment.status === 'initiated' && payment.razorpay_order_id)
    .map((payment) => payment.razorpay_order_id))]
    .find((razorpayOrderId) => orderIds.every((orderId) => {
      const payment = (existingPayments || []).find((candidate) =>
        candidate.order_id === orderId
        && candidate.razorpay_order_id === razorpayOrderId
        && candidate.status === 'initiated'
      );
      return payment && Math.abs(Number(payment.amount || 0) - Number(expectedAmounts.get(orderId) || 0)) < 0.01;
    }));

  if (reusableRazorpayOrderId) {
    return json({
      razorpay_order_id: reusableRazorpayOrderId,
      amount: amountPaise,
      currency: 'INR',
      key_id: razorpayKeyId,
    });
  }

  const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: tableSessionToken,
      notes: {
        table_session_token: tableSessionToken,
      },
    }),
  });

  const razorpayOrder = await razorpayResponse.json().catch(() => null);
  if (!razorpayResponse.ok) {
    return json({
      error: razorpayOrder?.error?.description || 'Failed to create Razorpay order.',
    }, 502);
  }

  const existingByOrderId = new Map((existingPayments || []).map((payment) => [payment.order_id, payment]));
  const now = new Date().toISOString();
  const newPaymentRows = payableOrders
    .filter((order) => !existingByOrderId.has(order.id))
    .map((order) => ({
      id: crypto.randomUUID(),
      order_id: order.id,
      razorpay_order_id: razorpayOrder.id,
      status: 'initiated',
      amount: Number(order.total_amount || 0),
    }));

  if (newPaymentRows.length) {
    const { error: insertPaymentError } = await supabase
      .from('Payment')
      .insert(newPaymentRows);

    if (insertPaymentError) return json({ error: insertPaymentError.message }, 500);
  }

  const updateResults = await Promise.all(payableOrders
    .filter((order) => existingByOrderId.has(order.id))
    .map((order) => supabase
      .from('Payment')
      .update({
        razorpay_order_id: razorpayOrder.id,
        status: 'initiated',
        amount: Number(order.total_amount || 0),
        updated_at: now,
      })
      .eq('id', existingByOrderId.get(order.id).id)));

  const updatePaymentError = updateResults.find((result) => result.error)?.error;
  if (updatePaymentError) return json({ error: updatePaymentError.message }, 500);

  return json({
    razorpay_order_id: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency || 'INR',
    key_id: razorpayKeyId,
  });
});
