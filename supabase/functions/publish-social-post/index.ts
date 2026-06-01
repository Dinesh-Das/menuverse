import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { asString, loadIntegrationConfig, requireRestaurantRole } from '../_shared/integration-config.ts';

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Social publishing is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const restaurantId = asString(body.restaurant_id);
  const channelType = (asString(body.channel_type) || asString(body.channel)).toLowerCase();
  const message = asString(body.message);
  if (!restaurantId || !['instagram', 'facebook'].includes(channelType)) {
    return json({ error: 'restaurant_id and a supported social channel are required.' }, 400);
  }
  if (!message) return json({ error: 'Post message is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (!(await requireRestaurantRole(supabase, req, restaurantId))) {
    return json({ error: 'Not authorized to publish social posts.' }, 403);
  }

  const channel = await loadIntegrationConfig(supabase, restaurantId, channelType);
  const publishUrl = asString(channel?.config.publish_url);
  const accessToken = asString(channel?.config.access_token);
  if (!channel?.enabled || !publishUrl) {
    return json({ error: `Enable ${channelType} and configure its social publishing endpoint first.` }, 400);
  }

  const payload = {
    restaurant_id: restaurantId,
    channel: channelType,
    message,
    image_url: asString(body.image_url) || null,
    ordering_link: asString(body.ordering_link) || asString(channel.config.ordering_link) || null,
    requested_at: new Date().toISOString(),
  };
  const jobId = asString(body.job_id);
  const jobWrite = jobId
    ? supabase
      .from('IntegrationJob')
      .update({ status: 'pending', error: null, payload, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('restaurant_id', restaurantId)
    : supabase
      .from('IntegrationJob')
      .insert({
        restaurant_id: restaurantId,
        job_type: 'social_publish',
        provider: channelType,
        status: 'pending',
        payload,
      });
  const { data: job, error: jobError } = await jobWrite.select('id').single();
  if (jobError) return json({ error: jobError.message }, 500);

  const response = await fetch(publishUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ job_id: job.id, ...payload }),
  }).catch(error => error);

  if (response instanceof Error || !response.ok) {
    const error = response instanceof Error ? response.message : await response.text().catch(() => 'Social publishing endpoint failed.');
    await supabase.from('IntegrationJob').update({ status: 'failed', error, updated_at: new Date().toISOString() }).eq('id', job.id);
    return json({ error, job_id: job.id }, 502);
  }

  const responseBody = await response.json().catch(() => ({ ok: true }));
  await supabase.from('IntegrationJob').update({ status: 'delivered', response: responseBody, updated_at: new Date().toISOString() }).eq('id', job.id);
  await supabase.from('IntegrationChannel').update({ status: 'active', last_sync_at: new Date().toISOString(), last_error: null }).eq('id', channel.id);
  return json({ published: true, job_id: job.id });
});
