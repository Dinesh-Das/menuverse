import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { hasValidInternalSecret } from '../_shared/internal-auth.ts';
import { asRecord, asString, createAdminAlert, type SupabaseClient } from '../_shared/integration-config.ts';

type RefreshResult = {
  restaurant_id: string;
  refreshed: boolean;
  error?: string;
};

async function refreshToken(
  supabase: SupabaseClient,
  secretRow: Record<string, unknown>,
  appId: string,
  appSecret: string,
): Promise<RefreshResult> {
  const restaurantId = asString(secretRow.restaurant_id);
  const channelId = asString(secretRow.channel_id);
  const secrets = asRecord(secretRow.secrets);
  const refreshToken = asString(secrets.square_refresh_token);
  if (!refreshToken) return { restaurant_id: restaurantId, refreshed: false, error: 'No Square refresh token is stored.' };

  const { data: channel } = await supabase
    .from('IntegrationChannel')
    .select('config')
    .eq('id', channelId)
    .eq('provider', 'square')
    .maybeSingle();
  const environment = asString(asRecord(channel?.config).square_environment) || 'production';
  const squareBase = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const response = await fetch(`${squareBase}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Square-Version': Deno.env.get('SQUARE_VERSION') || '2026-05-20',
    },
    body: JSON.stringify({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const error = asString(payload.message) || `Square token refresh failed with HTTP ${response.status}.`;
    await createAdminAlert(supabase, {
      restaurantId,
      title: 'Square token refresh failed',
      message: error,
      source: 'refresh_square_tokens',
      dedupeKey: 'square-token-refresh',
    });
    return { restaurant_id: restaurantId, refreshed: false, error };
  }

  const accessToken = asString(payload.access_token);
  if (!accessToken) return { restaurant_id: restaurantId, refreshed: false, error: 'Square did not return an access token.' };
  const nextRefreshToken = asString(payload.refresh_token) || refreshToken;
  const { error: updateError } = await supabase
    .from('IntegrationSecret')
    .update({
      secrets: {
        ...secrets,
        square_access_token: accessToken,
        square_refresh_token: nextRefreshToken,
      },
      token_expires_at: asString(payload.expires_at) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('channel_id', channelId);
  if (updateError) return { restaurant_id: restaurantId, refreshed: false, error: updateError.message };
  return { restaurant_id: restaurantId, refreshed: true };
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
  const appId = Deno.env.get('SQUARE_APP_ID');
  const appSecret = Deno.env.get('SQUARE_APP_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !appId || !appSecret) {
    return json({ error: 'Square token refresh is not configured.' }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const threshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: secrets, error } = await supabase
    .from('IntegrationSecret')
    .select('channel_id, restaurant_id, secrets, token_expires_at')
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', threshold);
  if (error) return json({ error: error.message }, 500);

  const results: RefreshResult[] = [];
  for (const secretRow of secrets || []) {
    results.push(await refreshToken(supabase, secretRow, appId, appSecret));
  }
  return json({ processed: results.length, results });
});
