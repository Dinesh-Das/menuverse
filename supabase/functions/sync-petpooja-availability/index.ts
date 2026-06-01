import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { hasValidInternalSecret } from '../_shared/internal-auth.ts';
import { asRecord, asString, loadIntegrationConfig, type SupabaseClient } from '../_shared/integration-config.ts';

type PetpoojaItem = {
  id: string;
  available: boolean;
};

type PetpoojaSyncResult = {
  restaurant_id: string;
  synced: boolean;
  item_count?: number;
  updated_item_count?: number;
  error?: string;
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function parseTargets(body: unknown): string[] {
  const rawTargets = Array.isArray(body) ? body : [body];
  return [...new Set(rawTargets.map(target => asString(asRecord(target).restaurant_id)).filter(Boolean))];
}

function toAvailability(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'available', 'in_stock'].includes(String(value || '').toLowerCase());
}

function normalizeItems(payload: Record<string, unknown>): PetpoojaItem[] {
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.item) ? payload.item : [];
  return rawItems
    .map(asRecord)
    .map(item => ({
      id: asString(item.itemid) || asString(item.id),
      available: toAvailability(item.instock ?? item.in_stock ?? item.available),
    }))
    .filter(item => item.id);
}

async function syncRestaurant(supabase: SupabaseClient, restaurantId: string): Promise<PetpoojaSyncResult> {
  const loaded = await loadIntegrationConfig(supabase, restaurantId, 'pos');
  const config = asRecord(loaded?.config);
  if (!loaded?.enabled || loaded.provider !== 'petpooja') {
    return { restaurant_id: restaurantId, synced: false, error: 'Petpooja POS sync is not enabled.' };
  }

  const apiKey = asString(config.petpooja_api_key) || Deno.env.get('PETPOOJA_API_KEY') || '';
  const appKey = asString(config.petpooja_app_key) || Deno.env.get('PETPOOJA_APP_KEY') || '';
  const petpoojaRestaurantId = asString(config.petpooja_restaurant_id) || Deno.env.get('PETPOOJA_RESTAURANT_ID') || '';
  const endpoint = asString(config.petpooja_inventory_url)
    || joinUrl(asString(config.petpooja_webhook_url) || Deno.env.get('PETPOOJA_WEBHOOK_URL') || 'https://mapi.petpooja.com', '/api/v1/getitems');
  if (!apiKey || !appKey || !petpoojaRestaurantId) {
    return { restaurant_id: restaurantId, synced: false, error: 'Petpooja API key, app key and restaurant ID are required.' };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: apiKey,
      appkey: appKey,
      restaurantid: petpoojaRestaurantId,
    }),
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    return { restaurant_id: restaurantId, synced: false, error: `Petpooja availability sync failed with HTTP ${response.status}.` };
  }

  const items = normalizeItems(payload);
  let updated = 0;
  for (const item of items) {
    const { data, error } = await supabase
      .from('MenuItem')
      .update({ available: item.available, updated_at: new Date().toISOString() })
      .eq('restaurant_id', restaurantId)
      .eq('petpooja_item_id', item.id)
      .select('id');
    if (error) return { restaurant_id: restaurantId, synced: false, error: error.message };
    updated += data?.length || 0;
  }

  await supabase
    .from('IntegrationChannel')
    .update({ status: 'active', last_sync_at: new Date().toISOString(), last_error: null })
    .eq('id', loaded.id);
  return { restaurant_id: restaurantId, synced: true, item_count: items.length, updated_item_count: updated };
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!hasValidInternalSecret(req, Deno.env.get('MENUVERSE_INTERNAL_SECRET'))) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Petpooja availability sync is not configured.' }, 503);

  const restaurantIds = parseTargets(await req.json().catch(() => ({})));
  if (!restaurantIds.length) return json({ error: 'At least one restaurant_id is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const results: PetpoojaSyncResult[] = [];
  for (const restaurantId of restaurantIds) {
    results.push(await syncRestaurant(supabase, restaurantId));
  }
  return json({ synced: results.every(result => result.synced), results }, results.every(result => result.synced) ? 200 : 207);
});
