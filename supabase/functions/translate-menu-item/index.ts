import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

const LOCALE_NAMES: Record<string, string> = {
  hi: 'Hindi',
  ta: 'Tamil',
  bn: 'Bengali',
  mr: 'Marathi',
  te: 'Telugu',
};

async function requireMenuManager(
  supabase: ReturnType<typeof createClient>,
  jwt: string,
  restaurantId: string,
) {
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData.user) return false;

  const { data, error } = await supabase
    .from('User')
    .select('id')
    .eq('id', userData.user.id)
    .eq('restaurant_id', restaurantId)
    .in('role', ['owner', 'manager'])
    .maybeSingle();

  return !error && Boolean(data);
}

function parseTranslation(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed?.name) return null;
    return {
      name: String(parsed.name).trim(),
      description: parsed.description == null ? null : String(parsed.description).trim(),
    };
  } catch {
    return null;
  }
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Menu translation service is not configured.' }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const itemId = String(body.item_id || '').trim();
  const targetLocale = String(body.locale || '').trim().toLowerCase();
  if (!itemId || !targetLocale) return json({ error: 'item_id and locale are required.' }, 400);
  if (!LOCALE_NAMES[targetLocale]) return json({ error: 'Unsupported locale.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: item, error: itemError } = await supabase
    .from('MenuItem')
    .select('id, restaurant_id, name, description')
    .eq('id', itemId)
    .maybeSingle();
  if (itemError) return json({ error: itemError.message }, 500);
  if (!item) return json({ error: 'Item not found.' }, 404);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt || !(await requireMenuManager(supabase, jwt, item.restaurant_id))) {
    return json({ error: 'Not authorized to translate menu items.' }, 403);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI translation not configured.' }, 503);

  const language = LOCALE_NAMES[targetLocale];
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-3-5-haiku-20241022',
      max_tokens: 200,
      system: 'You translate restaurant menu items. Return only valid JSON, no preamble.',
      messages: [{
        role: 'user',
        content: `Translate this menu item to ${language}. Return JSON: {"name":"...","description":"..."}\n\nItem:\nName: ${item.name}\nDescription: ${item.description || ''}`,
      }],
    }),
  });

  if (!response.ok) return json({ error: 'AI translation service error.' }, 502);
  const payload = await response.json().catch(() => null);
  const text = (payload?.content || []).map((part: { text?: string }) => part.text || '').join('');
  const translated = parseTranslation(text);
  if (!translated) return json({ error: 'Translation parse error.' }, 502);

  const { data: savedTranslation, error: saveError } = await supabase
    .from('MenuItemTranslation')
    .upsert({
      menu_item_id: itemId,
      locale: targetLocale,
      name: translated.name,
      description: translated.description,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'menu_item_id,locale' })
    .select()
    .single();

  if (saveError) return json({ error: saveError.message }, 500);
  return json(savedTranslation);
});
