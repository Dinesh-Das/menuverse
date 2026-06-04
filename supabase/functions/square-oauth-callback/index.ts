import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { asRecord, asString } from '../_shared/integration-config.ts';

const SQUARE_WEBHOOK_EVENT_TYPES = ['order.updated', 'order.fulfillment.updated', 'catalog.version.updated'];

function redirectWithStatus(status: string, detail = ''): Response {
  const appUrl = Deno.env.get('APP_URL') || Deno.env.get('APP_ORIGIN') || 'http://localhost:5173';
  const target = new URL('/admin/settings', appUrl);
  target.searchParams.set('integration', 'square');
  target.searchParams.set('status', status);
  if (detail) target.searchParams.set('detail', detail.slice(0, 180));
  return Response.redirect(target.toString(), 302);
}

function squareErrorMessage(body: Record<string, unknown>) {
  const errors = Array.isArray(body.errors) ? body.errors.map(asRecord) : [];
  const firstError = errors[0] || {};
  return asString(firstError.detail)
    || asString(firstError.message)
    || asString(body.message)
    || 'Square webhook registration failed.';
}

async function createSquareWebhookSubscription({
  squareBase,
  squareVersion,
  accessToken,
  supabaseUrl,
  restaurantId,
}: {
  squareBase: string;
  squareVersion: string;
  accessToken: string;
  supabaseUrl: string;
  restaurantId: string;
}) {
  const webhookUrl = `${supabaseUrl}/functions/v1/pos-status-webhook?restaurant_id=${encodeURIComponent(restaurantId)}&provider=square`;
  const registeredAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetch(`${squareBase}/v2/webhooks/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': squareVersion,
      },
      body: JSON.stringify({
        idempotency_key: `menuverse-square-webhook-${restaurantId}`,
        subscription: {
          name: `Menuverse ${restaurantId}`,
          enabled: true,
          notification_url: webhookUrl,
          event_types: SQUARE_WEBHOOK_EVENT_TYPES,
        },
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Square webhook registration failed.';
    return {
      ok: false,
      detail: message,
      configPatch: {
        square_webhook_url: webhookUrl,
        status_webhook_url: webhookUrl,
        square_webhook_event_types: SQUARE_WEBHOOK_EVENT_TYPES,
        square_webhook_registration_status: 'failed',
        square_webhook_registration_error: message,
      },
      secretPatch: {},
    };
  }
  const body = asRecord(await response.json().catch(() => ({})));

  if (!response.ok) {
    const message = squareErrorMessage(body);
    return {
      ok: false,
      detail: message,
      configPatch: {
        square_webhook_url: webhookUrl,
        status_webhook_url: webhookUrl,
        square_webhook_event_types: SQUARE_WEBHOOK_EVENT_TYPES,
        square_webhook_registration_status: 'failed',
        square_webhook_registration_error: message,
      },
      secretPatch: {},
    };
  }

  const subscription = asRecord(body.subscription);
  const signatureKey = asString(subscription.signature_key);
  return {
    ok: true,
    detail: '',
    configPatch: {
      square_webhook_url: webhookUrl,
      status_webhook_url: webhookUrl,
      square_webhook_subscription_id: asString(subscription.id),
      square_webhook_event_types: SQUARE_WEBHOOK_EVENT_TYPES,
      square_webhook_registration_status: 'registered',
      square_webhook_registered_at: registeredAt,
      square_webhook_registration_error: null,
    },
    secretPatch: signatureKey ? { square_webhook_signature_key: signatureKey } : {},
  };
}

serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const url = new URL(req.url);
  const code = asString(url.searchParams.get('code'));
  const state = asString(url.searchParams.get('state'));
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appId = Deno.env.get('SQUARE_APP_ID');
  const appSecret = Deno.env.get('SQUARE_APP_SECRET');
  if (!code || !state) return redirectWithStatus('error', 'Missing OAuth code or state.');
  if (!supabaseUrl || !serviceRoleKey || !appId || !appSecret) {
    return redirectWithStatus('error', 'Square OAuth is not configured.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: oauthState, error: stateError } = await supabase
    .from('SquareOAuthState')
    .select('state, restaurant_id, environment')
    .eq('state', state)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (stateError || !oauthState) return redirectWithStatus('error', 'OAuth state is invalid or expired.');

  await supabase
    .from('SquareOAuthState')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state', state)
    .is('consumed_at', null);

  const squareBase = oauthState.environment === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
  const tokenResponse = await fetch(`${squareBase}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Square-Version': Deno.env.get('SQUARE_VERSION') || '2026-05-20',
    },
    body: JSON.stringify({
      client_id: appId,
      client_secret: appSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${supabaseUrl}/functions/v1/square-oauth-callback`,
    }),
  });
  const tokenBody = asRecord(await tokenResponse.json().catch(() => ({})));
  if (!tokenResponse.ok) {
    return redirectWithStatus('error', asString(tokenBody.message) || 'Square token exchange failed.');
  }

  const accessToken = asString(tokenBody.access_token);
  const refreshToken = asString(tokenBody.refresh_token);
  const tokenExpiresAt = asString(tokenBody.expires_at) || null;
  if (!accessToken) return redirectWithStatus('error', 'Square did not return an access token.');

  const { data: channel, error: channelError } = await supabase
    .from('IntegrationChannel')
    .upsert({
      restaurant_id: oauthState.restaurant_id,
      channel_type: 'pos',
      provider: 'square',
      enabled: true,
      status: 'configured',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,channel_type' })
    .select('id, config')
    .single();
  if (channelError) return redirectWithStatus('error', channelError.message);

  const { data: existingSecret } = await supabase
    .from('IntegrationSecret')
    .select('secrets')
    .eq('channel_id', channel.id)
    .maybeSingle();
  const squareVersion = Deno.env.get('SQUARE_VERSION') || '2026-05-20';
  const webhookRegistration = await createSquareWebhookSubscription({
    squareBase,
    squareVersion,
    accessToken,
    supabaseUrl,
    restaurantId: oauthState.restaurant_id,
  });
  const { error: secretError } = await supabase
    .from('IntegrationSecret')
    .upsert({
      channel_id: channel.id,
      restaurant_id: oauthState.restaurant_id,
      secrets: {
        ...asRecord(existingSecret?.secrets),
        square_access_token: accessToken,
        ...(refreshToken ? { square_refresh_token: refreshToken } : {}),
        ...webhookRegistration.secretPatch,
      },
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'channel_id' });
  if (secretError) return redirectWithStatus('error', secretError.message);

  const { error: channelUpdateError } = await supabase
    .from('IntegrationChannel')
    .update({
      config: {
        ...asRecord(channel.config),
        ...webhookRegistration.configPatch,
      },
      status: webhookRegistration.ok ? 'active' : 'configured',
      last_error: webhookRegistration.ok ? null : webhookRegistration.detail,
      last_sync_at: webhookRegistration.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', channel.id);
  if (channelUpdateError) return redirectWithStatus('error', channelUpdateError.message);

  await supabase
    .from('Restaurant')
    .update({ pos_provider: 'square', pos_sync_enabled: true, updated_at: new Date().toISOString() })
    .eq('id', oauthState.restaurant_id);

  return redirectWithStatus(
    'connected',
    webhookRegistration.ok ? 'Square webhook registered automatically.' : `Connected; webhook registration needs attention: ${webhookRegistration.detail}`,
  );
});
