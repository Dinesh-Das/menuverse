import type { SupabaseClient } from './integration-config.ts';

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashIdentifier(scope: string, identifier: string) {
  const bytes = new TextEncoder().encode(`${scope}:${identifier}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `${scope}:${toHex(new Uint8Array(digest))}`;
}

export function getClientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '')
    .split(',')[0]
    .trim();
}

export async function consumeRateLimit(
  supabase: SupabaseClient,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
) {
  if (!identifier) return true;
  const { data, error } = await supabase.rpc('consume_edge_rate_limit', {
    p_bucket: await hashIdentifier(scope, identifier),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

