import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
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

  const payload = {
    ticket: body.ticket || {},
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
