import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rate-limit.ts';

function clampSplitCount(value: unknown) {
  const count = Number(value || 1);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(10, Math.floor(count)));
}

function clampSplitIndex(value: unknown, splitCount: number) {
  const index = Number(value);
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(splitCount - 1, Math.floor(index)));
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
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

  const splitCount = clampSplitCount(body.split_count);
  const isSplitPayment = splitCount > 1;
  const hasRequestedSplitIndex = Object.prototype.hasOwnProperty.call(body, 'split_index');
  const requestedSplitIndex = clampSplitIndex(body.split_index, splitCount);
  const requestedAmount = Number(body.amount || 0);
  const splitDetail = body.split_detail && typeof body.split_detail === 'object' ? body.split_detail : null;

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  try {
    const allowed = await Promise.all([
      consumeRateLimit(supabase, 'razorpay-session', tableSessionToken, 10, 60),
      consumeRateLimit(supabase, 'razorpay-ip', getClientIp(req), 10, 60),
    ]);
    if (!allowed.every(Boolean)) return json({ error: 'Too many payment attempts. Please wait a minute and try again.' }, 429);
  } catch (error) {
    console.error('[rate-limit] consumeRateLimit failed, allowing through:', error);
    // Payment availability takes precedence while the rate-limit store is unavailable.
  }

  const { data, error } = await supabase.rpc('get_table_session_orders', {
    p_table_session_token: tableSessionToken,
  });

  if (error) return json({ error: error.message }, 400);

  const orders = Array.isArray(data) ? data : [];
  const payableOrders = orders.filter((order) => !['cancelled', 'completed'].includes(order.status));
  const totalAmountRupees = payableOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const checkoutAmountRupees = requestedAmount > 0
    ? requestedAmount
    : isSplitPayment ? totalAmountRupees / splitCount : totalAmountRupees;
  const amountPaise = Math.round(checkoutAmountRupees * 100);

  if (!payableOrders.length || amountPaise <= 0) {
    return json({ error: 'No payable orders found for this table session.' }, 400);
  }

  const { data: tableSession, error: sessionError } = await supabase
    .from('TableSession')
    .select('id, restaurant_id')
    .eq('token', tableSessionToken)
    .maybeSingle();
  if (sessionError) return json({ error: sessionError.message }, 500);
  if (!tableSession) return json({ error: 'Table session not found.' }, 404);

  const { data: bill, error: billError } = await supabase
    .from('SessionBill')
    .select('id, split_count, split_paid, split_status')
    .eq('table_session_id', tableSession.id)
    .maybeSingle();
  if (billError) return json({ error: billError.message }, 500);

  const orderIds = payableOrders.map((order) => order.id).filter(Boolean);
  const { data: existingPayments, error: existingPaymentError } = await supabase
    .from('Payment')
    .select('id, order_id, razorpay_order_id, status, amount, split_index, split_total, session_bill_id')
    .in('order_id', orderIds);

  if (existingPaymentError) return json({ error: existingPaymentError.message }, 500);

  if (!isSplitPayment && (existingPayments || []).some((payment) => payment.status === 'captured')) {
    return json({ error: 'One or more orders in this session are already paid.' }, 409);
  }

  let splitIndex = 0;
  if (isSplitPayment) {
    const usedIndexes = new Set((existingPayments || [])
      .filter((payment) => Number(payment.split_total || 1) === splitCount)
      .map((payment) => Number(payment.split_index || 0)));
    if (hasRequestedSplitIndex) {
      if (usedIndexes.has(requestedSplitIndex)) {
        return json({ error: 'This split payment slot is already in progress or paid.' }, 409);
      }
      splitIndex = requestedSplitIndex;
    } else {
      while (usedIndexes.has(splitIndex) && splitIndex < splitCount) splitIndex += 1;
    }
    if (splitIndex >= splitCount) {
      return json({ error: 'All split payment slots are already in progress or paid.' }, 409);
    }
  }

  const expectedAmounts = new Map(payableOrders.map((order) => [
    order.id,
    requestedAmount > 0
      ? checkoutAmountRupees * (Number(order.total_amount || 0) / Math.max(totalAmountRupees, 1))
      : isSplitPayment ? Number(order.total_amount || 0) / splitCount : Number(order.total_amount || 0),
  ]));

  const reusableRazorpayOrderId = isSplitPayment
    ? null
    : [...new Set((existingPayments || [])
      .filter((payment) =>
        payment.status === 'initiated'
        && payment.razorpay_order_id
        && Number(payment.split_index || 0) === 0
        && Number(payment.split_total || 1) === 1)
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
      split_index: 0,
      split_total: 1,
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
      receipt: `${tableSession.id.slice(0, 20)}-${Date.now()}`,
      notes: {
        table_session_token: tableSessionToken,
        table_session_id: tableSession.id,
        split_index: splitIndex,
        split_total: splitCount,
        split_detail: splitDetail ? JSON.stringify(splitDetail).slice(0, 500) : '',
      },
    }),
  });

  const razorpayOrder = await razorpayResponse.json().catch(() => null);
  if (!razorpayResponse.ok) {
    return json({
      error: razorpayOrder?.error?.description || 'Failed to create Razorpay order.',
    }, 502);
  }

  const existingByOrderId = new Map((existingPayments || [])
    .filter((payment) => Number(payment.split_index || 0) === splitIndex)
    .map((payment) => [payment.order_id, payment]));
  const now = new Date().toISOString();
  const paymentRows = payableOrders.map((order) => ({
    id: crypto.randomUUID(),
    order_id: order.id,
    session_bill_id: bill?.id || null,
    split_index: splitIndex,
    split_total: splitCount,
    razorpay_order_id: razorpayOrder.id,
    status: 'initiated',
    provider: 'razorpay',
    amount: Number(expectedAmounts.get(order.id) || 0),
    metadata: {
      table_session_token: tableSessionToken,
      table_session_id: tableSession.id,
      razorpay_receipt: razorpayOrder.receipt || null,
      split_payment: isSplitPayment,
      ...(splitDetail ? { split_detail: splitDetail } : {}),
    },
  }));

  const newPaymentRows = paymentRows.filter((row) => !existingByOrderId.has(row.order_id));
  if (newPaymentRows.length) {
    const { error: insertPaymentError } = await supabase
      .from('Payment')
      .insert(newPaymentRows);

    if (insertPaymentError) return json({ error: insertPaymentError.message }, 500);
  }

  const updateResults = await Promise.all(paymentRows
    .filter((row) => existingByOrderId.has(row.order_id))
    .map((row) => supabase
      .from('Payment')
      .update({
        session_bill_id: row.session_bill_id,
        split_index: row.split_index,
        split_total: row.split_total,
        razorpay_order_id: row.razorpay_order_id,
        status: row.status,
        provider: row.provider,
        amount: row.amount,
        metadata: row.metadata,
        updated_at: now,
      })
      .eq('id', existingByOrderId.get(row.order_id).id)));

  const updatePaymentError = updateResults.find((result) => result.error)?.error;
  if (updatePaymentError) return json({ error: updatePaymentError.message }, 500);

  if (isSplitPayment && bill?.id) {
    await supabase
      .from('SessionBill')
      .update({
        split_count: splitCount,
        split_status: 'splitting',
        payment_status: 'partially_paid',
        updated_at: now,
      })
      .eq('id', bill.id);
  }

  return json({
    razorpay_order_id: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency || 'INR',
    key_id: razorpayKeyId,
    split_index: splitIndex,
    split_total: splitCount,
    share_amount: checkoutAmountRupees,
  });
});
