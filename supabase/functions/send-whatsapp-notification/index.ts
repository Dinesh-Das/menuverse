import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-menuverse-internal-secret',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

async function isAuthorized(supabase: ReturnType<typeof createClient>, req: Request, restaurantId: string) {
  const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
  const providedSecret = req.headers.get('X-Menuverse-Internal-Secret');
  if (internalSecret && providedSecret === internalSecret) return true;

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
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
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'WhatsApp service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const restaurantId = String(body.restaurant_id || '').trim();
  const to = String(body.to || body.phone || '').trim();
  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);
  if (!to) return json({ error: 'A destination phone number is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (!(await isAuthorized(supabase, req, restaurantId))) {
    return json({ error: 'Not authorized to send WhatsApp notifications.' }, 403);
  }

  const payload = {
    to,
    template: body.template || null,
    message: body.message || null,
    variables: body.variables || {},
    requested_at: new Date().toISOString(),
  };

  const webhookUrl = Deno.env.get('WHATSAPP_WEBHOOK_URL');
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const provider = Deno.env.get('WHATSAPP_PROVIDER') || (webhookUrl ? 'webhook' : 'unconfigured');

  const { data: job, error: insertError } = await supabase
    .from('IntegrationJob')
    .insert({
      restaurant_id: restaurantId,
      job_type: 'whatsapp',
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
      message: 'WhatsApp provider webhook is not configured.',
    }, 202);
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ job_id: job.id, restaurant_id: restaurantId, ...payload }),
  }).catch((error) => error);

  if (response instanceof Error || !response.ok) {
    const error = response instanceof Error ? response.message : await response.text().catch(() => 'WhatsApp webhook failed.');
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
