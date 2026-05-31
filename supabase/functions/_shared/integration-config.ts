import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export type SupabaseClient = ReturnType<typeof createClient>;
export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

export function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function compactRecord(value: JsonRecord) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== '' && entry !== null && entry !== undefined),
  );
}

export async function requireRestaurantRole(
  supabase: SupabaseClient,
  req: Request,
  restaurantId: string,
  roles = ['owner', 'manager'],
) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !authData.user) return null;

  const { data, error } = await supabase
    .from('User')
    .select('id, role, restaurant_id')
    .eq('id', authData.user.id)
    .eq('restaurant_id', restaurantId)
    .in('role', roles)
    .maybeSingle();

  return error ? null : data;
}

export async function loadIntegrationConfig(
  supabase: SupabaseClient,
  restaurantId: string,
  channelType: string,
) {
  const { data: channel, error } = await supabase
    .from('IntegrationChannel')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('channel_type', channelType)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!channel) return null;

  const { data: secretRow, error: secretError } = await supabase
    .from('IntegrationSecret')
    .select('secrets')
    .eq('channel_id', channel.id)
    .maybeSingle();
  if (secretError) throw new Error(secretError.message);

  return {
    ...channel,
    safeConfig: asRecord(channel.config),
    secrets: asRecord(secretRow?.secrets),
    config: { ...asRecord(channel.config), ...asRecord(secretRow?.secrets) },
  };
}

export function redactChannel(channel: JsonRecord, secretKeys: string[] = []) {
  return {
    id: channel.id,
    restaurant_id: channel.restaurant_id,
    channel_type: channel.channel_type,
    provider: channel.provider,
    enabled: Boolean(channel.enabled),
    config: asRecord(channel.config),
    status: channel.status,
    last_sync_at: channel.last_sync_at,
    last_error: channel.last_error,
    configured_secret_keys: secretKeys.sort(),
  };
}

export async function upsertIntegrationConfig(
  supabase: SupabaseClient,
  {
    restaurantId,
    channelType,
    provider,
    enabled,
    config = {},
    secrets = {},
  }: {
    restaurantId: string;
    channelType: string;
    provider?: string | null;
    enabled?: boolean;
    config?: JsonRecord;
    secrets?: JsonRecord;
  },
) {
  const { data: channel, error } = await supabase
    .from('IntegrationChannel')
    .upsert({
      restaurant_id: restaurantId,
      channel_type: channelType,
      provider: provider || channelType,
      enabled: Boolean(enabled),
      config: compactRecord(config),
      status: enabled ? 'configured' : 'not_configured',
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,channel_type' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  const nextSecrets = compactRecord(secrets);
  if (Object.keys(nextSecrets).length) {
    const { data: existing, error: existingError } = await supabase
      .from('IntegrationSecret')
      .select('secrets')
      .eq('channel_id', channel.id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const { error: secretError } = await supabase
      .from('IntegrationSecret')
      .upsert({
        channel_id: channel.id,
        restaurant_id: restaurantId,
        secrets: { ...asRecord(existing?.secrets), ...nextSecrets },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'channel_id' });
    if (secretError) throw new Error(secretError.message);
  }

  const { data: savedSecrets } = await supabase
    .from('IntegrationSecret')
    .select('secrets')
    .eq('channel_id', channel.id)
    .maybeSingle();

  return redactChannel(channel, Object.keys(asRecord(savedSecrets?.secrets)));
}

export async function createAdminAlert(
  supabase: SupabaseClient,
  {
    restaurantId,
    title,
    message,
    source,
    dedupeKey,
    severity = 'high',
    metadata = {},
  }: {
    restaurantId: string;
    title: string;
    message: string;
    source: string;
    dedupeKey: string;
    severity?: 'low' | 'medium' | 'high';
    metadata?: JsonRecord;
  },
) {
  await supabase.rpc('upsert_admin_alert', {
    p_restaurant_id: restaurantId,
    p_severity: severity,
    p_title: title,
    p_message: message,
    p_source: source,
    p_dedupe_key: dedupeKey,
    p_metadata: metadata,
  });
}

