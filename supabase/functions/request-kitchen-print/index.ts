import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

async function requireStaff(supabase: ReturnType<typeof createClient>, jwt: string, restaurantId: string) {
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData.user) return false;

  const { data, error } = await supabase
    .from('User')
    .select('id')
    .eq('id', userData.user.id)
    .eq('restaurant_id', restaurantId)
    .in('role', ['owner', 'manager', 'staff'])
    .maybeSingle();

  return !error && Boolean(data);
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Printer service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const restaurantId = String(body.restaurant_id || '').trim();
  const orderId = String(body.order_id || '').trim() || null;
  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (!jwt || !(await requireStaff(supabase, jwt, restaurantId))) {
    return json({ error: 'Not authorized to print kitchen tickets.' }, 403);
  }

  let ticket = body.ticket && typeof body.ticket === 'object'
    ? body.ticket as Record<string, unknown>
    : {};

  if (orderId) {
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select('id, table_session_id')
      .eq('id', orderId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (orderError) return json({ error: orderError.message }, 500);

    if (order?.table_session_id) {
      const { data: sessionTicket, error: ticketError } = await supabase
        .rpc('consolidate_session_orders_to_ticket', {
          p_session_id: order.table_session_id,
        });
      if (ticketError) return json({ error: ticketError.message }, 500);
      ticket = {
        type: 'session_ticket',
        ...(sessionTicket && typeof sessionTicket === 'object' ? sessionTicket : {}),
      };
    } else {
      ticket = { type: 'order_ticket', ...ticket };
    }
  }

  const payload = {
    ticket,
    requested_at: new Date().toISOString(),
  };

  const webhookUrl = Deno.env.get('KOT_WEBHOOK_URL') || Deno.env.get('PRINTER_WEBHOOK_URL');
  const provider = Deno.env.get('KOT_PROVIDER') || Deno.env.get('PRINTER_PROVIDER') || 'webhook';
  const secret = Deno.env.get('KOT_WEBHOOK_SECRET') || Deno.env.get('PRINTER_WEBHOOK_SECRET');

  const { data: job, error: insertError } = await supabase
    .from('IntegrationJob')
    .insert({
      restaurant_id: restaurantId,
      order_id: orderId,
      job_type: 'printer',
      provider,
      status: webhookUrl ? 'pending' : 'pending_configuration',
      payload,
    })
    .select('id')
    .single();

  if (insertError) return json({ error: insertError.message }, 500);

  if (!webhookUrl) {
    return json({
      queued: true,
      status: 'pending_configuration',
      job_id: job.id,
      message: 'KOT printer webhook is not configured.',
    }, 202);
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Menuverse-Secret': secret } : {}),
    },
    body: JSON.stringify({ job_id: job.id, restaurant_id: restaurantId, order_id: orderId, ...payload }),
  }).catch((error) => error);

  if (response instanceof Error || !response.ok) {
    const error = response instanceof Error ? response.message : await response.text().catch(() => 'Printer webhook failed.');
    await supabase
      .from('IntegrationJob')
      .update({ status: 'failed', error, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    return json({ queued: true, status: 'failed', job_id: job.id, error }, 502);
  }

  const responseBody = await response.json().catch(() => ({ ok: true }));
  await supabase
    .from('IntegrationJob')
    .update({ status: 'delivered', response: responseBody, updated_at: new Date().toISOString() })
    .eq('id', job.id);

  return json({ queued: true, status: 'delivered', job_id: job.id });
});
