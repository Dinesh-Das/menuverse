import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { hasValidInternalSecret } from '../_shared/internal-auth.ts';
import { asRecord, asString, loadIntegrationConfig, requireRestaurantRole } from '../_shared/integration-config.ts';

function isAvailableAtLocation(object: Record<string, unknown>, locationId: string) {
  const data = asRecord(object.item_variation_data);
  const absentAt = Array.isArray(object.absent_at_location_ids) ? object.absent_at_location_ids : [];
  if (absentAt.includes(locationId)) return false;

  const presentAt = Array.isArray(object.present_at_location_ids) ? object.present_at_location_ids : [];
  if (!object.present_at_all_locations && presentAt.length > 0 && !presentAt.includes(locationId)) return false;

  const overrides = Array.isArray(data.location_overrides) ? data.location_overrides : [];
  const locationOverride = overrides
    .map(asRecord)
    .find(override => asString(override.location_id) === locationId);
  if (!locationOverride?.sold_out) return true;

  const soldOutUntil = asString(locationOverride.sold_out_valid_until);
  return Boolean(soldOutUntil) && Date.parse(soldOutUntil) <= Date.now();
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Square catalog sync is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const restaurantId = asString(body.restaurant_id);
  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const internalAuthorized = hasValidInternalSecret(req, Deno.env.get('MENUVERSE_INTERNAL_SECRET'));
  if (!internalAuthorized && !(await requireRestaurantRole(supabase, req, restaurantId))) {
    return json({ error: 'Not authorized to sync the POS catalog.' }, 403);
  }

  const loaded = await loadIntegrationConfig(supabase, restaurantId, 'pos');
  const config = asRecord(loaded?.config);
  if (!loaded?.enabled || loaded.provider !== 'square') {
    return json({ error: 'Square POS sync is not enabled for this restaurant.' }, 400);
  }
  if (!config.availability_sync_enabled) {
    return json({ error: 'Enable Square availability sync in POS Settings first.' }, 400);
  }

  const token = asString(config.square_access_token);
  const locationId = asString(config.square_location_id);
  const environment = asString(config.square_environment) || 'production';
  if (!token || !locationId) return json({ error: 'Square access token and location ID are required.' }, 400);

  const base = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const headers = {
    Authorization: `Bearer ${token}`,
    'Square-Version': Deno.env.get('SQUARE_VERSION') || '2026-05-20',
  };
  const variations: Record<string, unknown>[] = [];
  let cursor = '';

  do {
    const url = new URL(`${base}/v2/catalog/list`);
    url.searchParams.set('types', 'ITEM_VARIATION');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers });
    const result = asRecord(await response.json().catch(() => ({})));
    if (!response.ok) return json({ error: `Square catalog sync failed with HTTP ${response.status}.` }, 502);
    if (Array.isArray(result.objects)) variations.push(...result.objects.map(asRecord));
    cursor = asString(result.cursor);
  } while (cursor);

  let updated = 0;
  for (const variation of variations) {
    const variationId = asString(variation.id);
    if (!variationId) continue;
    const { data, error } = await supabase
      .from('MenuItem')
      .update({ available: isAvailableAtLocation(variation, locationId), updated_at: new Date().toISOString() })
      .eq('restaurant_id', restaurantId)
      .eq('pos_catalog_variation_id', variationId)
      .select('id');
    if (error) return json({ error: error.message }, 500);
    updated += data?.length || 0;
  }

  await supabase
    .from('IntegrationChannel')
    .update({ status: 'active', last_sync_at: new Date().toISOString(), last_error: null })
    .eq('id', loaded.id);

  return json({ synced: true, variation_count: variations.length, updated_item_count: updated });
});

