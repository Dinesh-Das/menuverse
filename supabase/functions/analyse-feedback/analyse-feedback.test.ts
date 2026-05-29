import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

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

Deno.test('positive rating produces positive label', () => {
  const result = baselineAnalysis(5, 'Amazing food, loved it!');
  assertEquals(result.sentiment_label, 'positive');
  assertEquals(result.flag_for_review, false);
});

Deno.test('negative keyword overrides moderate rating', () => {
  const result = baselineAnalysis(3, 'Food was cold and service was rude');
  assertEquals(result.sentiment_label, 'negative');
  assertEquals(result.flag_for_review, true);
});

Deno.test('rating 1 always flags for review', () => {
  const result = baselineAnalysis(1, '');
  assertEquals(result.flag_for_review, true);
});

Deno.test('topics extracted from food quality keyword', () => {
  const result = baselineAnalysis(4, 'The biryani tasted fresh');
  assertEquals(result.sentiment_topics.includes('food_quality'), true);
});
