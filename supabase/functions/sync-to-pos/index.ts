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
    .in('role', ['owner', 'manager'])
    .maybeSingle();
  return !error && Boolean(data);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'POS sync service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const jobId = String(body.job_id || '').trim();
  let restaurantId = String(body.restaurant_id || '').trim();
  let orderId = String(body.order_id || '').trim() || null;

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let existingJob: Record<string, unknown> | null = null;
  if (jobId) {
    const { data: jobRecord, error: jobReadError } = await supabase
      .from('IntegrationJob')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();
    if (jobReadError) return json({ error: jobReadError.message }, 500);
    if (!jobRecord) return json({ error: 'Integration job not found.' }, 404);
    existingJob = jobRecord;
    restaurantId = restaurantId || String(jobRecord.restaurant_id || '');
    orderId = orderId || (jobRecord.order_id ? String(jobRecord.order_id) : null);
  }

  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);

  if (!(await isAuthorized(supabase, req, restaurantId))) {
    return json({ error: 'Not authorized to sync POS orders.' }, 403);
  }

  const { data: restaurant, error: restaurantError } = await supabase
    .from('Restaurant')
    .select('pos_provider')
    .eq('id', restaurantId)
    .maybeSingle();
  if (restaurantError) return json({ error: restaurantError.message }, 500);

  const provider = String(body.provider || existingJob?.provider || restaurant?.pos_provider || Deno.env.get('POS_PROVIDER') || 'webhook').trim();
  const webhookUrl = Deno.env.get('POS_WEBHOOK_URL');
  const accessToken = Deno.env.get('POS_ACCESS_TOKEN');
  const adapterMap: Record<string, string> = {
    petpooja: 'pos-adapter-petpooja',
  };
  const payload = {
    provider,
    order: body.order || null,
    requested_at: new Date().toISOString(),
  };

  let job = existingJob;
  if (job) {
    const { data: updatedJob, error: updateJobError } = await supabase
      .from('IntegrationJob')
      .update({
        provider,
        status: webhookUrl || adapterMap[provider] ? 'pending' : 'pending_configuration',
        payload,
        retry_count: Number(job.retry_count || 0) + 1,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .select('id')
      .single();
    if (updateJobError) return json({ error: updateJobError.message }, 500);
    job = updatedJob;
  } else {
    const { data: insertedJob, error: insertError } = await supabase
      .from('IntegrationJob')
      .insert({
        restaurant_id: restaurantId,
        order_id: orderId,
        job_type: 'pos',
        provider,
        status: webhookUrl || adapterMap[provider] ? 'pending' : 'pending_configuration',
        payload,
      })
      .select('id')
      .single();

    if (insertError) return json({ error: insertError.message }, 500);
    job = insertedJob;
  }

  if (adapterMap[provider]) {
    const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
    const { data: adapterData, error: adapterError } = await supabase.functions.invoke(adapterMap[provider], {
      body: { job_id: job.id, order_id: orderId, restaurant_id: restaurantId },
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        ...(internalSecret ? { 'X-Menuverse-Internal-Secret': internalSecret } : {}),
      },
    });

    if (adapterError || adapterData?.status === 'failed') {
      const error = adapterError?.message || adapterData?.error || 'POS adapter failed.';
      await supabase
        .from('IntegrationJob')
        .update({ status: 'failed', error, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      return json({ queued: true, status: 'failed', job_id: job.id, error }, 502);
    }

    return json({ queued: true, status: adapterData?.status || 'delivered', job_id: job.id, response: adapterData?.response || null });
  }

  if (!webhookUrl) {
    return json({
      queued: true,
      status: 'pending_configuration',
      job_id: job.id,
      message: 'POS provider webhook is not configured.',
    }, 202);
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ job_id: job.id, restaurant_id: restaurantId, order_id: orderId, ...payload }),
  }).catch((error) => error);

  if (response instanceof Error || !response.ok) {
    const error = response instanceof Error ? response.message : await response.text().catch(() => 'POS webhook failed.');
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
