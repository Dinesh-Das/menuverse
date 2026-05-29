function categoryNameFor(item, categories = []) {
  return categories.find(category => category.id === item.category_id)?.name?.toLowerCase() || '';
}

function hasCategory(cartItems, categories, needles) {
  return cartItems.some(item => {
    const name = categoryNameFor(item, categories);
    return needles.some(needle => name.includes(needle));
  });
}

function isInCategory(item, categories, needles) {
  const name = categoryNameFor(item, categories);
  return needles.some(needle => name.includes(needle));
}

function tagsFor(item) {
  if (Array.isArray(item.tags)) return item.tags;
  if (Array.isArray(item.tags_json)) return item.tags_json;
  try {
    const parsed = JSON.parse(item.tags_json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recommendationScore(item, cartItems, categories, guestProfile = null) {
  const sentimentScore = Number(item.avg_sentiment_score ?? 0.5) * 35;
  const orderScore = Math.min(Number(item.order_count_7d || 0), 25);
  let complementScore = 0;

  const hasMain = cartItems.length > 0 && !hasCategory(cartItems, categories, ['drink', 'beverage', 'dessert', 'sweet']);
  if (hasMain && isInCategory(item, categories, ['drink', 'beverage', 'dessert', 'sweet', 'side'])) {
    complementScore += 45;
  }

  if (cartItems.some(cartItem => cartItem.dietary_flag === item.dietary_flag && item.dietary_flag)) {
    complementScore += 8;
  }

  if (item.sentiment_badge === 'loved') complementScore += 12;
  if (item.sentiment_badge === 'trending') complementScore += 10;
  if (item.has_ar_preview || item.ar_preview_enabled) complementScore += 4;

  const itemTags = tagsFor(item);
  if (guestProfile?.preferred_tags?.length) {
    const overlap = itemTags.filter(tag => guestProfile.preferred_tags.includes(tag)).length;
    complementScore += overlap * 15;
  }
  if (guestProfile?.disliked_tags?.length) {
    const hasDisliked = itemTags.some(tag => guestProfile.disliked_tags.includes(tag));
    if (hasDisliked) return -Infinity;
  }
  if (guestProfile?.dietary_preference && item.dietary_flag === guestProfile.dietary_preference) {
    complementScore += 20;
  }

  return sentimentScore + orderScore + complementScore;
}

export function sortRecommendedItems(candidates = [], cartItems = [], categories = [], guestProfile = null) {
  const cartIds = new Set(cartItems.map(item => item.id));
  return [...candidates]
    .filter(item => item.available && !cartIds.has(item.id))
    .map(item => ({
      ...item,
      recommendation_score: recommendationScore(item, cartItems, categories, guestProfile),
    }))
    .filter(item => Number.isFinite(item.recommendation_score))
    .sort((a, b) => b.recommendation_score - a.recommendation_score);
}
