import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://menuverse.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Recommendation service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const restaurantId = String(body.restaurant_id || '').trim();
  const cartItemIds = Array.isArray(body.cart_item_ids) ? body.cart_item_ids.map(String) : [];
  const guestProfileId = body.guest_profile_id ? String(body.guest_profile_id) : null;
  const limit = Math.max(1, Math.min(20, Number(body.limit || 5)));
  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: items, error: itemError } = await supabase
    .from('MenuItem')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('available', true);
  if (itemError) return json({ error: itemError.message }, 500);

  let favouriteIds = new Set<string>();
  if (guestProfileId) {
    const { data: profile } = await supabase
      .from('GuestProfile')
      .select('favourite_item_ids')
      .eq('id', guestProfileId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    favouriteIds = new Set(Array.isArray(profile?.favourite_item_ids) ? profile.favourite_item_ids.map(String) : []);
  }

  const cartIds = new Set(cartItemIds);
  const ranked = (items || [])
    .filter((item) => !cartIds.has(item.id))
    .map((item) => {
      const sentimentScore = Number(item.avg_sentiment_score ?? 0.5) * 45;
      const orderScore = Math.min(Number(item.order_count_7d || 0), 30);
      const badgeScore = item.sentiment_badge === 'loved' ? 12 : item.sentiment_badge === 'trending' ? 10 : item.sentiment_badge === 'new' ? 6 : 0;
      const guestScore = favouriteIds.has(item.id) ? 20 : 0;
      const arScore = item.has_ar_preview || item.ar_preview_enabled ? 4 : 0;
      return { ...item, recommendation_score: sentimentScore + orderScore + badgeScore + guestScore + arScore };
    })
    .sort((a, b) => Number(b.recommendation_score) - Number(a.recommendation_score))
    .slice(0, limit);

  return json({ items: ranked });
});
