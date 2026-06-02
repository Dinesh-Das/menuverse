import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { hasValidInternalSecret } from '../_shared/internal-auth.ts';

type Analysis = {
  sentiment_label: 'positive' | 'neutral' | 'negative';
  sentiment_score: number;
  sentiment_topics: string[];
  key_phrase: string | null;
  flag_for_review: boolean;
  analysis_source: string;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function baselineAnalysis(rating: number, comment: string | null): Analysis {
  const text = (comment || '').toLowerCase();
  const negativeWords = ['cold', 'late', 'slow', 'bad', 'poor', 'stale', 'salty', 'burnt', 'rude', 'expensive', 'wrong'];
  const positiveWords = ['great', 'excellent', 'fresh', 'fast', 'loved', 'amazing', 'perfect', 'tasty', 'good'];
  const topics = new Set<string>();

  if (/\b(cold|stale|salty|burnt|taste|tasty|fresh|spicy)\b/.test(text)) topics.add('food_quality');
  if (/\b(slow|late|wait|delay|fast)\b/.test(text)) topics.add('wait_time');
  if (/\b(rude|staff|server|waiter|service)\b/.test(text)) topics.add('service');
  if (/\b(portion|quantity|small|large)\b/.test(text)) topics.add('portion_size');
  if (/\b(price|expensive|value|worth)\b/.test(text)) topics.add('value');

  const negativeHits = negativeWords.filter((word) => text.includes(word)).length;
  const positiveHits = positiveWords.filter((word) => text.includes(word)).length;
  const score = clamp((rating / 5) + (positiveHits * 0.06) - (negativeHits * 0.09));
  const sentiment_label = score >= 0.7 ? 'positive' : score <= 0.45 ? 'negative' : 'neutral';
  const trimmed = comment?.trim() || '';

  return {
    sentiment_label,
    sentiment_score: Number(score.toFixed(4)),
    sentiment_topics: [...topics],
    key_phrase: trimmed ? trimmed.slice(0, 160) : null,
    flag_for_review: rating <= 2 || sentiment_label === 'negative',
    analysis_source: 'rating_keyword_baseline',
  };
}

function parseJsonObject(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function anthropicAnalysis(rating: number, comment: string, apiKey: string, model: string): Promise<Analysis | null> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      temperature: 0,
      system: 'You analyze restaurant feedback. Return compact JSON only.',
      messages: [
        {
          role: 'user',
          content: `Analyze this restaurant review. Rating: ${rating}/5. Review: ${comment}

Return JSON with:
{
  "sentiment_label": "positive|neutral|negative",
  "sentiment_score": 0.0,
  "sentiment_topics": ["food_quality","service","wait_time","portion_size","value","ambiance"],
  "key_phrase": "short summary under 15 words",
  "flag_for_review": true
}`,
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const text = payload?.content?.map((part: { text?: string }) => part.text || '').join('\n') || '';
  const parsed = parseJsonObject(text);
  if (!parsed) return null;

  const label = ['positive', 'neutral', 'negative'].includes(parsed.sentiment_label)
    ? parsed.sentiment_label
    : baselineAnalysis(rating, comment).sentiment_label;

  return {
    sentiment_label: label,
    sentiment_score: Number(clamp(Number(parsed.sentiment_score ?? rating / 5)).toFixed(4)),
    sentiment_topics: Array.isArray(parsed.sentiment_topics)
      ? parsed.sentiment_topics.filter((topic: unknown) => typeof topic === 'string').slice(0, 6)
      : [],
    key_phrase: typeof parsed.key_phrase === 'string' ? parsed.key_phrase.slice(0, 160) : null,
    flag_for_review: Boolean(parsed.flag_for_review) || rating <= 2 || label === 'negative',
    analysis_source: `anthropic:${model}`,
  };
}

// Internal contract: the queue processor posts { feedback_id: "<OrderFeedback.id>" }.
serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !internalSecret) {
    return json({ error: 'Feedback analysis service is not configured.' }, 503);
  }

  if (!hasValidInternalSecret(req, internalSecret)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const feedbackId = String(body.feedback_id || '').trim();
  if (!feedbackId) return json({ error: 'feedback_id is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: feedback, error: feedbackError } = await supabase
    .from('OrderFeedback')
    .select('id, restaurant_id, order_id, rating, comment, analysis_locked')
    .eq('id', feedbackId)
    .maybeSingle();

  if (feedbackError) return json({ error: feedbackError.message }, 500);
  if (!feedback) return json({ error: 'Feedback not found.' }, 404);
  if (feedback.analysis_locked) {
    await supabase
      .from('SentimentQueue')
      .update({
        status: 'processed',
        last_error: null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('feedback_id', feedback.id)
      .catch(() => null);
    return json({ analysed: false, skipped: true, reason: 'analysis_locked', feedback_id: feedback.id });
  }

  const comment = feedback.comment || '';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('CLAUDE_API_KEY');
  const model = Deno.env.get('ANTHROPIC_MODEL') || 'claude-3-5-haiku-20241022';
  if (!apiKey) {
    console.warn('[WARN] analyse-feedback: ANTHROPIC_API_KEY not set, using keyword baseline.');
  }
  const analysis = apiKey && comment.trim()
    ? await anthropicAnalysis(feedback.rating, comment, apiKey, model).catch(() => null)
    : null;
  const finalAnalysis = analysis || baselineAnalysis(feedback.rating, comment);

  const { error: updateError } = await supabase
    .from('OrderFeedback')
    .update({
      sentiment_label: finalAnalysis.sentiment_label,
      sentiment_score: finalAnalysis.sentiment_score,
      sentiment_topics: finalAnalysis.sentiment_topics,
      key_phrase: finalAnalysis.key_phrase,
      flag_for_review: finalAnalysis.flag_for_review,
      analysed_at: new Date().toISOString(),
      analysis_source: finalAnalysis.analysis_source,
    })
    .eq('id', feedback.id);

  if (updateError) return json({ error: updateError.message }, 500);

  const { data: orderItems } = await supabase
    .from('OrderItem')
    .select('menu_item_id')
    .eq('order_id', feedback.order_id);

  await Promise.all([
    supabase
      .from('Restaurant')
      .update({ ranking_needs_recalc: true, updated_at: new Date().toISOString() })
      .eq('id', feedback.restaurant_id),
    supabase
      .from('MenuItem')
      .update({ ranking_needs_recalc: true, updated_at: new Date().toISOString() })
      .in('id', (orderItems || []).map(item => item.menu_item_id).filter(Boolean)),
  ]).catch(() => null);

  await supabase.rpc('update_guest_preferences', {
    p_feedback_id: feedback.id,
  }).catch(() => null);

  await supabase
    .from('SentimentQueue')
    .update({
      status: 'processed',
      last_error: null,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('feedback_id', feedback.id)
    .catch(() => null);

  if (finalAnalysis.sentiment_label === 'negative') {
    for (const { menu_item_id } of (orderItems || [])) {
      const { data: menuItem } = await supabase
        .from('MenuItem')
        .select('id, name, negative_streak, last_negative_alert_at, restaurant_id')
        .eq('id', menu_item_id)
        .maybeSingle();

      if (!menuItem) continue;

      const newStreak = Number(menuItem.negative_streak || 0) + 1;
      const lastAlert = menuItem.last_negative_alert_at
        ? new Date(menuItem.last_negative_alert_at)
        : null;
      const cooldownPassed = !lastAlert || (Date.now() - lastAlert.getTime()) > 24 * 3600 * 1000;

      await supabase
        .from('MenuItem')
        .update({ negative_streak: newStreak, updated_at: new Date().toISOString() })
        .eq('id', menu_item_id);

      if (newStreak >= 3 && cooldownPassed) {
        const { data: ownerUser } = await supabase
          .from('User')
          .select('phone')
          .eq('restaurant_id', feedback.restaurant_id)
          .eq('role', 'owner')
          .limit(1)
          .maybeSingle();

        if (ownerUser?.phone) {
          const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
          await supabase.functions.invoke('send-whatsapp-notification', {
            body: {
              to: ownerUser.phone,
              message:
                `Alert: "${menuItem.name}" has received ${newStreak} consecutive negative reviews. ` +
                `Latest comment: "${finalAnalysis.key_phrase || 'no comment'}". Please check your dashboard.`,
              restaurant_id: feedback.restaurant_id,
            },
            headers: internalSecret ? { 'X-Menuverse-Internal-Secret': internalSecret } : undefined,
          }).catch(() => null);
        }

        await supabase
          .from('MenuItem')
          .update({ last_negative_alert_at: new Date().toISOString() })
          .eq('id', menu_item_id);
      }
    }
  } else {
    for (const { menu_item_id } of (orderItems || [])) {
      await supabase
        .from('MenuItem')
        .update({ negative_streak: 0, updated_at: new Date().toISOString() })
        .eq('id', menu_item_id);
    }
  }

  return json({ analysed: true, feedback_id: feedback.id, ...finalAnalysis });
});
