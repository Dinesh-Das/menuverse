import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import {
  asRecord,
  asString,
  loadIntegrationConfig,
  redactChannel,
  requireRestaurantRole,
  upsertIntegrationConfig,
} from '../_shared/integration-config.ts';

function posSecretPatch(provider: string, input: Record<string, unknown>) {
  if (provider === 'square') {
    return {
      square_access_token: asString(input.access_token),
      square_webhook_signature_key: asString(input.webhook_signing_secret),
    };
  }
  if (provider === 'petpooja') {
    return {
      petpooja_api_key: asString(input.api_key),
      petpooja_app_key: asString(input.app_key),
      petpooja_webhook_secret: asString(input.webhook_signing_secret),
    };
  }
  return {
    webhook_secret: asString(input.webhook_signing_secret),
    access_token: asString(input.access_token),
  };
}

function posSafeConfig(provider: string, input: Record<string, unknown>) {
  if (provider === 'square') {
    return {
      square_location_id: asString(input.location_id),
      square_environment: asString(input.environment) || 'production',
      square_currency: (asString(input.currency) || 'USD').toUpperCase(),
      square_webhook_url: asString(input.webhook_url),
      availability_sync_enabled: Boolean(input.availability_sync_enabled),
    };
  }
  if (provider === 'petpooja') {
    return {
      petpooja_restaurant_id: asString(input.restaurant_id),
      petpooja_webhook_url: asString(input.endpoint),
    };
  }
  return {
    webhook_url: asString(input.endpoint),
    status_webhook_url: asString(input.webhook_url),
  };
}

async function testPosConnection(config: Record<string, unknown>) {
  const provider = asString(config.provider);
  const values = asRecord(config.config);
  if (provider === 'square') {
    const token = asString(values.square_access_token);
    const environment = asString(values.square_environment) || 'production';
    if (!token || !asString(values.square_location_id)) {
      throw new Error('Square access token and location ID are required.');
    }
    const base = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
    const response = await fetch(`${base}/v2/locations`, {
      headers: { Authorization: `Bearer ${token}`, 'Square-Version': Deno.env.get('SQUARE_VERSION') || '2026-05-20' },
    });
    if (!response.ok) throw new Error(`Square connection failed with HTTP ${response.status}.`);
    return 'Square credentials are valid.';
  }
  if (provider === 'petpooja') {
    if (!asString(values.petpooja_api_key) || !asString(values.petpooja_app_key) || !asString(values.petpooja_restaurant_id)) {
      throw new Error('Petpooja API key, app key, and restaurant ID are required.');
    }
    return 'Petpooja credentials are complete. Save and place a test order to verify provider delivery.';
  }
  if (!asString(values.webhook_url)) throw new Error('Custom webhook endpoint is required.');
  return 'Custom POS webhook configuration is complete.';
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Integration settings service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const action = asString(body.action) || 'get';
  const restaurantId = asString(body.restaurant_id);
  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (!(await requireRestaurantRole(supabase, req, restaurantId))) {
    return json({ error: 'Not authorized to manage integrations.' }, 403);
  }

  if (action === 'get') {
    const { data: channels, error } = await supabase
      .from('IntegrationChannel')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('channel_type');
    if (error) return json({ error: error.message }, 500);

    const { data: secrets } = await supabase
      .from('IntegrationSecret')
      .select('channel_id, secrets')
      .eq('restaurant_id', restaurantId);
    const secretKeys = new Map((secrets || []).map(row => [row.channel_id, Object.keys(asRecord(row.secrets))]));
    return json({ channels: (channels || []).map(channel => redactChannel(channel, secretKeys.get(channel.id) || [])) });
  }

  if (action === 'save_pos') {
    const provider = asString(body.provider) || 'none';
    const enabled = Boolean(body.enabled) && provider !== 'none';
    const input = asRecord(body.settings);
    const channel = await upsertIntegrationConfig(supabase, {
      restaurantId,
      channelType: 'pos',
      provider,
      enabled,
      config: posSafeConfig(provider, input),
      secrets: posSecretPatch(provider, input),
    });
    const { error } = await supabase
      .from('Restaurant')
      .update({
        pos_provider: provider === 'none' ? null : provider,
        pos_sync_enabled: enabled,
        pos_config: {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', restaurantId);
    if (error) return json({ error: error.message }, 500);
    return json({ saved: true, channel });
  }

  if (action === 'save_channel') {
    const channelType = asString(body.channel_type);
    if (!channelType || channelType === 'pos') return json({ error: 'A non-POS channel_type is required.' }, 400);
    const settings = asRecord(body.settings);
    const channel = await upsertIntegrationConfig(supabase, {
      restaurantId,
      channelType,
      provider: asString(body.provider) || channelType,
      enabled: Boolean(body.enabled),
      config: {
        endpoint: asString(settings.endpoint),
        menu_sync_url: asString(settings.menu_sync_url),
        publish_url: asString(settings.publish_url),
        ordering_link: asString(settings.ordering_link),
        account_id: asString(settings.account_id),
        phone_number_id: asString(settings.phone_number_id),
        webhook_url: asString(settings.webhook_url),
      },
      secrets: {
        access_token: asString(settings.access_token),
        webhook_secret: asString(settings.webhook_secret),
        verify_token: asString(settings.verify_token),
        app_secret: asString(settings.app_secret),
      },
    });
    if (channelType === 'whatsapp') {
      await supabase
        .from('Restaurant')
        .update({ whatsapp_enabled: Boolean(body.enabled), updated_at: new Date().toISOString() })
        .eq('id', restaurantId);
    }
    return json({ saved: true, channel });
  }

  if (action === 'test_pos') {
    const loaded = await loadIntegrationConfig(supabase, restaurantId, 'pos');
    if (!loaded) return json({ error: 'Save POS settings before testing the connection.' }, 400);
    try {
      const message = await testPosConnection({ provider: loaded.provider, config: loaded.config });
      return json({ ok: true, message });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'POS connection failed.' }, 400);
    }
  }

  return json({ error: 'Unsupported action.' }, 400);
});
