import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { asString, requireRestaurantRole } from '../_shared/integration-config.ts';

const SQUARE_SCOPES = [
  'ITEMS_READ',
  'MERCHANT_PROFILE_READ',
  'ORDERS_WRITE',
].join(' ');

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appId = Deno.env.get('SQUARE_APP_ID');
  if (!supabaseUrl || !serviceRoleKey || !appId) {
    return json({ error: 'Square OAuth is not configured.' }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const restaurantId = asString(body.restaurant_id);
  const environment = asString(body.environment) === 'sandbox' ? 'sandbox' : 'production';
  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (!(await requireRestaurantRole(supabase, req, restaurantId))) {
    return json({ error: 'Not authorized to connect Square.' }, 403);
  }

  const state = crypto.randomUUID();
  const { error } = await supabase
    .from('SquareOAuthState')
    .insert({ state, restaurant_id: restaurantId, environment });
  if (error) return json({ error: error.message }, 500);

  const authorizeBase = environment === 'sandbox'
    ? 'https://connect.squareupsandbox.com/oauth2/authorize'
    : 'https://connect.squareup.com/oauth2/authorize';
  const authorizeUrl = new URL(authorizeBase);
  authorizeUrl.searchParams.set('client_id', appId);
  authorizeUrl.searchParams.set('scope', SQUARE_SCOPES);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('redirect_uri', `${supabaseUrl}/functions/v1/square-oauth-callback`);

  return json({ authorize_url: authorizeUrl.toString() });
});
