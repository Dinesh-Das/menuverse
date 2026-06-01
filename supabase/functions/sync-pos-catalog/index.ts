import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { hasValidInternalSecret } from '../_shared/internal-auth.ts';
import {
  asRecord,
  asString,
  loadIntegrationConfig,
  requireRestaurantRole,
  type SupabaseClient,
} from '../_shared/integration-config.ts';

type CatalogSyncResult = {
  restaurant_id: string;
  synced: true;
  variation_count: number;
  updated_item_count: number;
};

class CatalogSyncError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function isAvailableAtLocation(object: Record<string, unknown>, locationId: string): boolean {
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

function parseTargets(body: unknown): string[] {
  const rawTargets = Array.isArray(body) ? body : [body];
  return [...new Set(rawTargets.map(target => asString(asRecord(target).restaurant_id)).filter(Boolean))];
}

async function syncCatalogForRestaurant(supabase: SupabaseClient, restaurantId: string): Promise<CatalogSyncResult> {
  const loaded = await loadIntegrationConfig(supabase, restaurantId, 'pos');
  const config = asRecord(loaded?.config);
  if (!loaded?.enabled || loaded.provider !== 'square') {
    throw new CatalogSyncError('Square POS sync is not enabled for this restaurant.', 400);
  }
  if (!config.availability_sync_enabled) {
    throw new CatalogSyncError('Enable Square availability sync in POS Settings first.', 400);
  }

  const token = asString(config.square_access_token);
  const locationId = asString(config.square_location_id);
  const environment = asString(config.square_environment) || 'production';
  if (!token || !locationId) {
    throw new CatalogSyncError('Square access token and location ID are required.', 400);
  }

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
    if (!response.ok) {
      throw new CatalogSyncError(`Square catalog sync failed with HTTP ${response.status}.`, 502);
    }
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
    if (error) throw new CatalogSyncError(error.message);
    updated += data?.length || 0;
  }

  await supabase
    .from('IntegrationChannel')
    .update({ status: 'active', last_sync_at: new Date().toISOString(), last_error: null })
    .eq('id', loaded.id);

  return {
    restaurant_id: restaurantId,
    synced: true,
    variation_count: variations.length,
    updated_item_count: updated,
  };
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Square catalog sync is not configured.' }, 503);

  const body: unknown = await req.json().catch(() => ({}));
  const restaurantIds = parseTargets(body);
  if (!restaurantIds.length) return json({ error: 'At least one restaurant_id is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const internalAuthorized = hasValidInternalSecret(req, Deno.env.get('MENUVERSE_INTERNAL_SECRET'));
  if (!internalAuthorized) {
    if (restaurantIds.length !== 1 || !(await requireRestaurantRole(supabase, req, restaurantIds[0]))) {
      return json({ error: 'Not authorized to sync the POS catalog.' }, 403);
    }
  }

  const results: CatalogSyncResult[] = [];
  const errors: { restaurant_id: string; error: string; status: number }[] = [];
  for (const restaurantId of restaurantIds) {
    try {
      results.push(await syncCatalogForRestaurant(supabase, restaurantId));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Square catalog sync failed.';
      const status = error instanceof CatalogSyncError ? error.status : 500;
      errors.push({ restaurant_id: restaurantId, error: detail, status });
      await supabase
        .from('IntegrationChannel')
        .update({ status: 'error', last_error: detail, updated_at: new Date().toISOString() })
        .eq('restaurant_id', restaurantId)
        .eq('channel_type', 'pos');
    }
  }

  if (restaurantIds.length === 1 && errors.length) {
    return json({ error: errors[0].error }, errors[0].status);
  }

  return json({
    synced: errors.length === 0,
    updated_item_count: results.reduce((sum, result) => sum + result.updated_item_count, 0),
    results,
    errors,
  }, errors.length ? 207 : 200);
});
