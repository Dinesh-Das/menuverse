import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { asString, loadIntegrationConfig, requireRestaurantRole } from '../_shared/integration-config.ts';
import { hasValidInternalSecret } from '../_shared/internal-auth.ts';

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Menu sync is not configured.' }, 503);
  const body = await req.json().catch(() => ({}));
  const restaurantId = asString(body.restaurant_id);
  const channel = asString(body.channel);
  if (!restaurantId || !channel) return json({ error: 'restaurant_id and channel are required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const internal = hasValidInternalSecret(req, Deno.env.get('MENUVERSE_INTERNAL_SECRET'));
  if (!internal && !(await requireRestaurantRole(supabase, req, restaurantId))) return json({ error: 'Forbidden' }, 403);

  const loaded = await loadIntegrationConfig(supabase, restaurantId, channel);
  const endpoint = asString(loaded?.config.menu_sync_url) || asString(loaded?.config.endpoint);
  if (!loaded?.enabled || !endpoint) return json({ error: `${channel} menu sync endpoint is not configured.` }, 400);

  const { data: menuItems, error } = await supabase
    .from('MenuItem')
    .select('id, name, description, price, available, dietary_flag, tags_json, category:MenuCategory(name)')
    .eq('restaurant_id', restaurantId);
  if (error) return json({ error: error.message }, 500);

  const { data: job, error: insertError } = await supabase
    .from('IntegrationJob')
    .insert({ restaurant_id: restaurantId, job_type: 'channel_menu_sync', provider: channel, status: 'pending', payload: { item_count: menuItems?.length || 0 } })
    .select('id')
    .single();
  if (insertError) return json({ error: insertError.message }, 500);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(asString(loaded.config.access_token) ? { Authorization: `Bearer ${asString(loaded.config.access_token)}` } : {}),
    },
    body: JSON.stringify({ restaurant_id: restaurantId, channel, items: menuItems || [] }),
  }).catch(error => error);
  if (response instanceof Error || !response.ok) {
    const message = response instanceof Error ? response.message : await response.text();
    await supabase.from('IntegrationJob').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', job.id);
    return json({ error: message, job_id: job.id }, 502);
  }

  await supabase.from('IntegrationJob').update({ status: 'delivered', updated_at: new Date().toISOString() }).eq('id', job.id);
  await supabase.from('IntegrationChannel').update({ status: 'active', last_sync_at: new Date().toISOString(), last_error: null }).eq('id', loaded.id);
  return json({ synced: true, job_id: job.id, item_count: menuItems?.length || 0 });
});

