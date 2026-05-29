import assert from 'node:assert/strict';
import { sortRecommendedItems } from '../recommendations.js';

const categories = [
  { id: 'cat-drink', name: 'Drinks' },
  { id: 'cat-main', name: 'Mains' },
];

const items = [
  { id: 'i1', available: true, avg_sentiment_score: 0.9, order_count_7d: 20, category_id: 'cat-main', sentiment_badge: 'loved' },
  { id: 'i2', available: true, avg_sentiment_score: 0.5, order_count_7d: 5, category_id: 'cat-drink', sentiment_badge: null },
  { id: 'i3', available: false, avg_sentiment_score: 0.95, order_count_7d: 50, category_id: 'cat-main', sentiment_badge: 'trending' },
  { id: 'i4', available: true, avg_sentiment_score: 0.6, order_count_7d: 10, category_id: 'cat-main', sentiment_badge: null },
];

const cartWithMain = [{ id: 'i4', category_id: 'cat-main' }];
const result1 = sortRecommendedItems(items, cartWithMain, categories);
assert(!result1.some(i => i.id === 'i3'), 'Unavailable items must be excluded');
assert(!result1.some(i => i.id === 'i4'), 'Cart items must be excluded');
assert(
  result1.findIndex(i => i.id === 'i2') < result1.findIndex(i => i.id === 'i1'),
  'Drink should rank higher than another main when cart contains a main'
);

const result2 = sortRecommendedItems(items, [], categories);
assert.equal(result2[0].id, 'i1', 'Highest sentiment item leads with empty cart');

const result3 = sortRecommendedItems(
  [
    { id: 'spicy', available: true, avg_sentiment_score: 0.5, order_count_7d: 1, category_id: 'cat-main', tags: ['spicy'] },
    { id: 'mushroom', available: true, avg_sentiment_score: 1, order_count_7d: 50, category_id: 'cat-main', tags: ['mushroom'] },
  ],
  [],
  categories,
  { preferred_tags: ['spicy'], disliked_tags: ['mushroom'], dietary_preference: null }
);
assert.equal(result3[0].id, 'spicy', 'Preferred tags should boost recommendations');
assert(!result3.some(item => item.id === 'mushroom'), 'Disliked tags should be excluded');

console.log('recommendations.test.js: all assertions passed');
