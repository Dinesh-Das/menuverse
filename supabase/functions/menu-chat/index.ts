import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Menu chat service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const restaurantId = String(body.restaurant_id || '').trim();
  const message = String(body.message || '').slice(0, 500).trim();
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  if (!restaurantId || !message) return json({ error: 'Missing fields.' }, 400);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI chat not configured.' }, 503);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: menuItems, error } = await supabase
    .from('MenuItem')
    .select('id, name, description, price, dietary_flag, tags_json, available, avg_sentiment_score')
    .eq('restaurant_id', restaurantId)
    .eq('available', true);
  if (error) return json({ error: error.message }, 500);

  const menuContext = (menuItems || [])
    .map((item) => `- ${item.name} (Rs. ${item.price})${item.dietary_flag ? ` [${item.dietary_flag}]` : ''}: ${(item.description || '').slice(0, 80)} id=${item.id}`)
    .join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-3-5-haiku-20241022',
      max_tokens: 400,
      system: `You are a friendly menu assistant. Suggest 1-3 dishes from this menu and include prices.
Current menu:
${menuContext}

Rules:
1. If asked to add items to cart, respond with JSON only: {"action":"add","items":[{"id":"<menu_item_id>","name":"<name>","qty":1}]}.
2. Otherwise respond conversationally under 80 words.
3. If no menu item matches, say so politely.`,
      messages: [
        ...history.map((entry: { role?: string; content?: string }) => ({
          role: entry.role === 'assistant' ? 'assistant' : 'user',
          content: String(entry.content || '').slice(0, 500),
        })),
        { role: 'user', content: message },
      ],
    }),
  });

  if (!response.ok) return json({ error: 'AI service error.' }, 502);
  const payload = await response.json();
  const text = (payload.content || []).map((part: { text?: string }) => part.text || '').join('');
  let action = null;
  const jsonMatch = text.match(/\{[\s\S]*"action"\s*:\s*"add"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      action = JSON.parse(jsonMatch[0]);
    } catch {
      action = null;
    }
  }

  return json({ reply: action ? 'Adding to your cart!' : text, action });
});
