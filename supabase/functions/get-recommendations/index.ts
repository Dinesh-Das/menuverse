import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

function tagsFor(item: Record<string, unknown>) {
  const tags = item.tags_json;
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
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
  let guestProfile: {
    preferred_tags?: string[];
    disliked_tags?: string[];
    dietary_preference?: string | null;
  } | null = null;
  if (guestProfileId) {
    const { data: profile } = await supabase
      .from('GuestProfile')
      .select('favourite_item_ids, preferred_tags, disliked_tags, dietary_preference')
      .eq('id', guestProfileId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    favouriteIds = new Set(Array.isArray(profile?.favourite_item_ids) ? profile.favourite_item_ids.map(String) : []);
    guestProfile = {
      preferred_tags: Array.isArray(profile?.preferred_tags) ? profile.preferred_tags.map(String) : [],
      disliked_tags: Array.isArray(profile?.disliked_tags) ? profile.disliked_tags.map(String) : [],
      dietary_preference: profile?.dietary_preference ? String(profile.dietary_preference) : null,
    };
  }

  const cartIds = new Set(cartItemIds);
  const ranked = (items || [])
    .filter((item) => !cartIds.has(item.id))
    .map((item) => {
      const sentimentScore = Number(item.avg_sentiment_score ?? 0.5) * 45;
      const orderScore = Math.min(Number(item.order_count_7d || 0), 30);
      const badgeScore = item.sentiment_badge === 'loved' ? 12 : item.sentiment_badge === 'trending' ? 10 : item.sentiment_badge === 'new' ? 6 : 0;
      let guestScore = favouriteIds.has(item.id) ? 20 : 0;
      const itemTags = tagsFor(item);
      if (guestProfile?.preferred_tags?.length) {
        const overlap = itemTags.filter(tag => guestProfile?.preferred_tags?.includes(tag)).length;
        guestScore += overlap * 15;
      }
      if (guestProfile?.disliked_tags?.length) {
        const hasDisliked = itemTags.some(tag => guestProfile?.disliked_tags?.includes(tag));
        if (hasDisliked) return null;
      }
      if (guestProfile?.dietary_preference && item.dietary_flag === guestProfile.dietary_preference) {
        guestScore += 20;
      }
      const arScore = item.has_ar_preview || item.ar_preview_enabled ? 4 : 0;
      return {
        ...item,
        guest_score: guestScore,
        recommendation_score: sentimentScore + orderScore + badgeScore + guestScore + arScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.recommendation_score) - Number(a.recommendation_score))
    .slice(0, limit);

  return json({ items: ranked });
});
