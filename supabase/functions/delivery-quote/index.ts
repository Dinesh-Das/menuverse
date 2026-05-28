import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

type DeliveryAddress = {
  street?: string;
  city?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
};

function cleanText(value: unknown) {
  return String(value || '').trim();
}

function parseShiprocketRate(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const companies = (data?.available_courier_companies || payload.available_courier_companies || []) as Array<Record<string, unknown>>;
  const best = companies
    .map((company) => ({
      courier_name: cleanText(company.courier_name || company.name),
      rate: Number(company.rate ?? company.freight_charge ?? company.delivery_charge ?? 0),
      etd: cleanText(company.etd || company.estimated_delivery_days),
    }))
    .filter(company => Number.isFinite(company.rate) && company.rate >= 0)
    .sort((a, b) => a.rate - b.rate)[0];

  return best || null;
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRad(bLat - aLat);
  const lngDelta = toRad(bLng - aLng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Delivery quote service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const restaurantId = cleanText(body.restaurant_id);
  const address = (body.address || {}) as DeliveryAddress;
  const orderValue = Number(body.order_value || 0);

  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);
  if (!cleanText(address.pincode)) return json({ error: 'Delivery pincode is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: restaurant, error } = await supabase
    .from('Restaurant')
    .select('id, currency, delivery_fee_flat, delivery_provider, delivery_radius_km, delivery_config')
    .eq('id', restaurantId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!restaurant) return json({ error: 'Restaurant not found.' }, 404);

  const deliveryConfig = (restaurant.delivery_config || {}) as Record<string, unknown>;
  const provider = cleanText(restaurant.delivery_provider || deliveryConfig.provider || 'flat') || 'flat';
  const flatFee = Number(restaurant.delivery_fee_flat || deliveryConfig.flat_fee || 0);
  const currency = cleanText(restaurant.currency || deliveryConfig.currency || 'inr').toLowerCase();
  const radiusKm = Number(restaurant.delivery_radius_km || 0);
  const restaurantLat = Number(deliveryConfig.latitude || deliveryConfig.lat);
  const restaurantLng = Number(deliveryConfig.longitude || deliveryConfig.lng);
  const customerLat = Number(address.latitude);
  const customerLng = Number(address.longitude);
  const hasCoordinates = [restaurantLat, restaurantLng, customerLat, customerLng].every(Number.isFinite);
  const deliveryDistanceKm = hasCoordinates
    ? Number(distanceKm(restaurantLat, restaurantLng, customerLat, customerLng).toFixed(2))
    : null;

  if (radiusKm > 0 && deliveryDistanceKm !== null && deliveryDistanceKm > radiusKm) {
    return json({
      serviceable: false,
      provider,
      fee: 0,
      currency,
      radius_km: radiusKm,
      distance_km: deliveryDistanceKm,
      message: `Delivery is available within ${radiusKm} km.`,
    });
  }

  if (provider === 'shiprocket') {
    const token = cleanText(deliveryConfig.shiprocket_token || Deno.env.get('SHIPROCKET_API_TOKEN'));
    const pickupPostcode = cleanText(deliveryConfig.pickup_postcode || Deno.env.get('SHIPROCKET_PICKUP_POSTCODE'));

    if (token && pickupPostcode) {
      const params = new URLSearchParams({
        pickup_postcode: pickupPostcode,
        delivery_postcode: cleanText(address.pincode),
        cod: '0',
        weight: cleanText(deliveryConfig.default_weight_kg || '0.5'),
        order_value: String(Math.max(0, orderValue)),
      });

      const response = await fetch(`https://apiv2.shiprocket.in/v1/external/courier/serviceability/?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }).catch((fetchError) => fetchError);

      if (!(response instanceof Error) && response.ok) {
        const payload = await response.json().catch(() => ({}));
        const bestRate = parseShiprocketRate(payload);
        if (bestRate) {
          return json({
            serviceable: true,
            provider,
            courier_name: bestRate.courier_name || 'Shiprocket',
            etd: bestRate.etd || null,
            fee: bestRate.rate,
            currency,
            radius_km: radiusKm || null,
            distance_km: deliveryDistanceKm,
          });
        }
      }
    }
  }

  return json({
    serviceable: true,
    provider,
    fee: Math.max(0, flatFee),
    currency,
    radius_km: radiusKm || null,
    distance_km: deliveryDistanceKm,
    message: provider === 'shiprocket'
      ? 'Using the configured flat delivery fee because Shiprocket serviceability is unavailable.'
      : null,
  });
});
