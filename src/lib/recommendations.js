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

function recommendationScore(item, cartItems, categories) {
  const sentimentScore = Number(item.avg_sentiment_score ?? 0.5) * 35;
  const orderScore = Math.min(Number(item.order_count_7d || 0), 25);
  let complementScore = 0;

  const hasMain = cartItems.length > 0 && !hasCategory(cartItems, categories, ['drink', 'beverage', 'dessert', 'sweet']);
  if (hasMain && isInCategory(item, categories, ['drink', 'beverage', 'dessert', 'sweet', 'side'])) {
    complementScore += 28;
  }

  if (cartItems.some(cartItem => cartItem.dietary_flag === item.dietary_flag && item.dietary_flag)) {
    complementScore += 8;
  }

  if (item.sentiment_badge === 'loved') complementScore += 12;
  if (item.sentiment_badge === 'trending') complementScore += 10;
  if (item.has_ar_preview || item.ar_preview_enabled) complementScore += 4;

  return sentimentScore + orderScore + complementScore;
}

export function sortRecommendedItems(candidates = [], cartItems = [], categories = []) {
  const cartIds = new Set(cartItems.map(item => item.id));
  return [...candidates]
    .filter(item => item.available && !cartIds.has(item.id))
    .sort((a, b) => recommendationScore(b, cartItems, categories) - recommendationScore(a, cartItems, categories));
}
