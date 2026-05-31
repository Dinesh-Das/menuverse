import { supabase } from './supabase';
import { canTransitionOrderStatus, safeParseModifiers } from './businessRules';

const now = () => new Date().toISOString();
const AR_BUCKET = 'ar-models';
const AR_SOURCE_VIDEO_BUCKET = 'ar-source-videos';
const MAX_GLB_SIZE = 20 * 1024 * 1024;
const MAX_USDZ_SIZE = 20 * 1024 * 1024;
const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024;
const MAX_AR_VIDEO_SIZE = 150 * 1024 * 1024;
const GLB_MIME_TYPES = new Set(['model/gltf-binary', 'application/octet-stream', '']);
const USDZ_MIME_TYPES = new Set([
  'model/vnd.usdz+zip',
  'model/vnd.pixar.usd',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  '',
]);
const THUMBNAIL_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AR_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', '']);

function viteFlag(name) {
  return String(import.meta.env?.[name] || '').toLowerCase() === 'true';
}

const ENABLE_SERVER_RECOMMENDATIONS = viteFlag('VITE_ENABLE_SERVER_RECOMMENDATIONS');
const ENABLE_AR_EDGE_PROCESSING = viteFlag('VITE_ENABLE_AR_EDGE_PROCESSING');
const ENABLE_DELIVERY_QUOTE_EDGE = viteFlag('VITE_ENABLE_DELIVERY_QUOTE_EDGE');
const ENABLE_POS_EDGE_SYNC = viteFlag('VITE_ENABLE_POS_EDGE_SYNC');
const ALLOW_CLIENT_ORDER_FALLBACK = viteFlag('VITE_ALLOW_CLIENT_ORDER_FALLBACK');

if (import.meta.env.PROD && ALLOW_CLIENT_ORDER_FALLBACK) {
  console.error(
    '[Menuverse] SECURITY WARNING: VITE_ALLOW_CLIENT_ORDER_FALLBACK is enabled in production. ' +
    'This is a misconfiguration. The client fallback is unavailable in this build.'
  );
}

function requireRestaurantId(restaurantId) {
  if (!restaurantId) throw new Error('Restaurant context is required for this operation.');
  return restaurantId;
}

function normalizeOrderItems(items = []) {
  return items.map(item => ({
    menu_item_id: item.menu_item_id || item.id,
    quantity: Number(item.quantity ?? item.qty ?? 1),
    modifier_option_ids: (item.modifier_option_ids || item.modifiers || item.selectedModifiers || [])
      .map(mod => typeof mod === 'string' ? mod : mod.id)
      .filter(Boolean),
    item_note: item.item_note || item.itemNote || item.notes || null,
  }));
}

function normalizeRpcJson(data) {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function normalizeMenuItem(item) {
  return {
    ...item,
    tags: safeParseModifiers(item.tags_json) ?? [],
    modifier_groups: (item.modifier_groups || []).map(group => ({
      ...group,
      options: group.options || [],
    })),
  };
}

export const MENU_LOCALE_LABELS = {
  hi: 'हिंदी',
  ta: 'தமிழ்',
  bn: 'বাংলা',
  mr: 'मराठी',
  te: 'తెలుగు',
};

export function getPreferredMenuLocale() {
  const saved = localStorage.getItem('mv_menu_locale');
  if (saved) return saved;
  const locale = navigator.language?.split('-')?.[0]?.toLowerCase() || 'en';
  return MENU_LOCALE_LABELS[locale] ? locale : 'en';
}

export function resetMenuLocaleToEnglish() {
  localStorage.setItem('mv_menu_locale', 'en');
  return 'en';
}

export function applyMenuTranslation(item, translation) {
  if (!translation) return item;
  return {
    ...item,
    original_name: item.original_name || item.name,
    original_description: item.original_description || item.description,
    name: translation.name || item.name,
    description: translation.description ?? item.description,
    translated_locale: translation.locale || true,
  };
}

export function applyMenuTranslationsToCategories(categories, translationsByItemId) {
  return (categories || []).map(category => ({
    ...category,
    items: (category.items || []).map(item => applyMenuTranslation(item, translationsByItemId[item.id])),
  }));
}

export async function fetchMenuTranslations(menuItemIds, locale) {
  const ids = [...new Set((menuItemIds || []).filter(Boolean))];
  if (!locale || locale === 'en' || ids.length === 0) return {};

  const { data, error } = await supabase
    .from('MenuItemTranslation')
    .select('menu_item_id, locale, name, description')
    .eq('locale', locale)
    .in('menu_item_id', ids);
  if (error) throw new Error(error.message);

  return (data || []).reduce((acc, row) => {
    acc[row.menu_item_id] = row;
    return acc;
  }, {});
}

export async function fetchMenuItemTranslation(menuItemId, locale) {
  if (!locale || locale === 'en' || !menuItemId) return null;
  const { data, error } = await supabase
    .from('MenuItemTranslation')
    .select('menu_item_id, locale, name, description')
    .eq('menu_item_id', menuItemId)
    .eq('locale', locale)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

function getFileExtension(file) {
  return file?.name?.split('.').pop()?.toLowerCase() || '';
}

function assertUploadFile(file, { label, maxBytes, extensions, mimeTypes }) {
  if (!file || typeof file === 'string') throw new Error(`${label} is required.`);
  if (file.size > maxBytes) throw new Error(`${label} exceeds the allowed size.`);
  const ext = getFileExtension(file);
  if (!extensions.includes(ext)) throw new Error(`${label} has an unsupported file extension.`);
  if (!mimeTypes.has(file.type || '')) throw new Error(`${label} has an unsupported file type.`);
}

function storagePathFromPublicUrl(publicUrl) {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${AR_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(publicUrl.slice(index + marker.length));
}

async function uploadARFile(path, file, contentType) {
  const { error } = await supabase.storage
    .from(AR_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || contentType,
    });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(AR_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function uploadARSourceVideo(path, file) {
  const { error } = await supabase.storage
    .from(AR_SOURCE_VIDEO_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || 'video/mp4',
    });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(AR_SOURCE_VIDEO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function fetchMenuItemForAR(itemId) {
  const { data, error } = await supabase
    .from('MenuItem')
    .select('id, restaurant_id')
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Menu item not found for this restaurant.');
  return data;
}

async function removeARStorageFiles(asset) {
  const paths = [
    asset?.model_glb_url,
    asset?.model_usdz_url,
    asset?.thumbnail_url,
    asset?.preview_image_url,
  ]
    .map(storagePathFromPublicUrl)
    .filter(Boolean);

  if (paths.length) {
    const { error } = await supabase.storage.from(AR_BUCKET).remove([...new Set(paths)]);
    if (error) throw new Error(error.message);
  }
}

// Public customer API

export async function fetchMenu(restaurantSlug) {
  const { data, error } = await supabase.rpc('get_public_menu_by_slug', {
    p_restaurant_slug: restaurantSlug || null,
  });
  if (error) throw new Error(error.message);

  const payload = normalizeRpcJson(data);
  if (!payload?.restaurant) throw new Error('Restaurant not found');

  return {
    restaurant: payload.restaurant,
    categories: (payload.categories || []).map(cat => ({
      ...cat,
      items: (cat.items || []).map(normalizeMenuItem),
    })),
  };
}

export async function fetchTableInfo(tableId) {
  const { data, error } = await supabase
    .from('Table')
    .select('*, restaurant:Restaurant(*)')
    .eq('id', tableId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Table not found');
  return data;
}

export async function startOrResumeTableSession({ restaurantId, tableId, existingToken }) {
  const { data, error } = await supabase.rpc('start_table_session', {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
    p_existing_token: existingToken || null,
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function fetchMenuItem(dishId) {
  const { data, error } = await supabase.rpc('get_public_menu_item', {
    p_menu_item_id: dishId,
  });
  if (error) throw new Error(error.message);
  const item = normalizeRpcJson(data);
  if (!item) throw new Error('Menu item not found');
  return normalizeMenuItem(item);
}

export async function placeOrder(payload) {
  const restaurantId = requireRestaurantId(payload.restaurant_id);
  const tableSessionToken = payload.table_session_token || localStorage.getItem('mv_table_session_token');
  const rpcPayload = {
    p_restaurant_id: restaurantId,
    p_table_id: payload.table_id,
    p_table_session_token: tableSessionToken || null,
    p_special_instructions: payload.special_instructions || null,
    p_idempotency_key: payload.idempotency_key || crypto.randomUUID(),
    p_items: normalizeOrderItems(payload.items),
    p_points_redeemed: Number(payload.points_redeemed || 0),
  };

  // Order creation must go through the create_order_secure RPC only.
  const { data, error } = await supabase.rpc('create_order_secure', rpcPayload);
  if (error) throw new Error(`Secure order creation failed: ${error.message}`);
  const orderResult = Array.isArray(data) ? data[0] : data;

  if (payload.order_type && payload.order_type !== 'dine_in') {
    const { data: fulfillment, error: fulfillmentError } = await supabase.rpc('set_order_fulfillment_details', {
      p_order_id: orderResult.order_ref,
      p_table_session_token: tableSessionToken || null,
      p_order_type: payload.order_type,
      p_delivery_address: payload.delivery_address || null,
      p_delivery_fee: Number(payload.delivery_fee || 0),
      p_delivery_distance_km: payload.delivery_distance_km ?? null,
    });
    if (fulfillmentError) throw new Error(fulfillmentError.message);
    return {
      ...orderResult,
      total_amount: fulfillment?.total_amount ?? orderResult.total_amount,
    };
  }

  return orderResult;
}

export async function fetchOrderStatus(orderId) {
  const tableSessionToken = localStorage.getItem('mv_table_session_token');
  const { data, error } = await supabase.rpc('get_order_status_secure', {
    p_order_id: orderId,
    p_table_session_token: tableSessionToken || null,
  });
  if (!error && data) return Array.isArray(data) ? data[0] : data;

  throw new Error('Order status is not available for this session.');
}

export async function fetchTableOrders(_tableId) {
  const tableSessionToken = localStorage.getItem('mv_table_session_token');
  if (tableSessionToken) {
    const { data, error } = await supabase.rpc('get_table_session_orders', {
      p_table_session_token: tableSessionToken,
    });
    if (!error) return data || [];
  }

  throw new Error('Table bill requires a valid table session.');
}

export async function createPayment(payload) {
  const body = {
    table_session_token: payload.table_session_token || localStorage.getItem('mv_table_session_token'),
    order_id: payload.order_id || null,
    amount: payload.amount,
    split_count: payload.split_count || 1,
    split_detail: payload.split_detail || null,
  };
  if (payload.split_index !== undefined && payload.split_index !== null) {
    body.split_index = payload.split_index;
  }

  const { data, error } = await supabase.functions.invoke('create-payment-order', {
    body,
  });
  if (error) throw new Error(`Payment order failed: ${error.message}`);
  return data;
}

export async function createStripePaymentIntent(payload) {
  const body = {
    table_session_token: payload.table_session_token || localStorage.getItem('mv_table_session_token'),
    amount: payload.amount,
    split_count: payload.split_count || 1,
    split_detail: payload.split_detail || null,
    setup_only: payload.setup_only === true,
  };
  if (payload.split_index !== undefined && payload.split_index !== null) {
    body.split_index = payload.split_index;
  }

  const { data, error } = await supabase.functions.invoke('create-stripe-payment-intent', {
    body,
  });
  if (error) throw new Error(`Stripe payment intent failed: ${error.message}`);
  return data;
}

export async function createStaffRequest({ restaurantId, tableId, tableSessionToken, requestType = 'waiter', message = null }) {
  const { data, error } = await supabase.rpc('create_staff_request_secure', {
    p_restaurant_id: requireRestaurantId(restaurantId),
    p_table_id: tableId,
    p_table_session_token: tableSessionToken || localStorage.getItem('mv_table_session_token'),
    p_request_type: requestType,
    p_message: message,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchPublicARAsset(itemId) {
  const { data, error } = await supabase.rpc('get_public_ar_asset', {
    p_menu_item_id: itemId,
  });
  if (error) throw new Error(error.message);
  const asset = normalizeRpcJson(data);
  if (!asset) throw new Error('AR preview is not active.');
  return asset;
}

export async function submitOrderFeedback({
  orderId,
  tableSessionToken,
  rating,
  comment = null,
  foodRating = null,
  serviceRating = null,
  valueRating = null,
  itemRatings = [],
}) {
  const extendedPayload = {
    p_order_id: orderId,
    p_table_session_token: tableSessionToken || localStorage.getItem('mv_table_session_token'),
    p_rating: rating,
    p_comment: comment,
    p_food_rating: foodRating,
    p_service_rating: serviceRating,
    p_value_rating: valueRating,
    p_item_ratings: itemRatings,
  };

  let { data, error } = await supabase.rpc('submit_order_feedback_secure', extendedPayload);

  if (error && /function .*submit_order_feedback_secure/i.test(error.message)) {
    ({ data, error } = await supabase.rpc('submit_order_feedback_secure', {
      p_order_id: extendedPayload.p_order_id,
      p_table_session_token: extendedPayload.p_table_session_token,
      p_rating: extendedPayload.p_rating,
      p_comment: extendedPayload.p_comment,
    }));
  }

  if (error) throw new Error(error.message);

  return data;
}

export async function saveGuestContact({
  restaurantId,
  tableSessionToken,
  name = null,
  phone = null,
  email = null,
  marketingConsent = false,
}) {
  const { data, error } = await supabase.rpc('upsert_guest_contact_secure', {
    p_restaurant_id: requireRestaurantId(restaurantId),
    p_table_session_token: tableSessionToken || localStorage.getItem('mv_table_session_token'),
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_marketing_consent: Boolean(marketingConsent),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolveOrCreateGuestProfile({
  restaurantId,
  tableSessionId = null,
  name = null,
  phone = null,
  email = null,
  marketingConsent = false,
}) {
  const { data, error } = await supabase.rpc('resolve_or_create_guest_profile', {
    p_restaurant_id: requireRestaurantId(restaurantId),
    p_name: name || null,
    p_phone: phone || null,
    p_email: email || null,
    p_marketing: Boolean(marketingConsent),
    p_session_id: tableSessionId || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function getGuestProfileForSession(tableSessionToken) {
  const token = tableSessionToken || localStorage.getItem('mv_table_session_token');
  if (!token) return null;
  const { data, error } = await supabase.rpc('get_guest_profile_for_session', {
    p_session_token: token,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] || null : data;
}

export async function fetchRecommendations({ restaurantId, cartItemIds = [], guestProfileId = null, limit = 5 }) {
  requireRestaurantId(restaurantId);
  if (!ENABLE_SERVER_RECOMMENDATIONS) return [];

  const { data, error } = await supabase.functions.invoke('get-recommendations', {
    body: {
      restaurant_id: restaurantId,
      cart_item_ids: cartItemIds,
      guest_profile_id: guestProfileId,
      limit,
    },
  });
  if (error) throw new Error(error.message);
  return data?.items || [];
}

export async function sendMenuChatMessage({ restaurantId, message, history = [] }) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase.functions.invoke('menu-chat', {
    body: { restaurant_id: restaurantId, message, history },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchDeliveryQuote({ restaurantId, address, orderValue = 0 }) {
  requireRestaurantId(restaurantId);
  if (!ENABLE_DELIVERY_QUOTE_EDGE) {
    return { serviceable: true, provider: 'local', fee: null, address, order_value: orderValue };
  }

  const { data, error } = await supabase.functions.invoke('delivery-quote', {
    body: {
      restaurant_id: restaurantId,
      address,
      order_value: orderValue,
    },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function adminFetchFeedbackInsights(restaurantId, days = 30) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase.rpc('admin_feedback_insights', {
    p_restaurant_id: restaurantId,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function adminFetchSentimentTrend(restaurantId, days = 30) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase.rpc('admin_sentiment_trend', {
    p_restaurant_id: restaurantId,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminFetchFlaggedFeedback(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('OrderFeedback')
    .select('id, order_id, rating, comment, sentiment_label, created_at')
    .eq('restaurant_id', restaurantId)
    .eq('flag_for_review', true)
    .lte('rating', 2)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminResolveFeedback(feedbackId, restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('OrderFeedback')
    .update({ flag_for_review: false })
    .eq('id', feedbackId)
    .eq('restaurant_id', restaurantId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function adminFetchPendingStaffRequests(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('StaffRequest')
    .select('*, table:Table(number, section)')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminResolveStaffRequest(requestId, restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('StaffRequest')
    .update({ status: 'resolved', updated_at: now() })
    .eq('id', requestId)
    .eq('restaurant_id', restaurantId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function adminFetchIntegrationJobs(restaurantId, limit = 50) {
  requireRestaurantId(restaurantId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: jobs, error: jobsError }, { data: recent, error: recentError }] = await Promise.all([
    supabase
      .from('IntegrationJob')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('IntegrationJob')
      .select('status')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', since),
  ]);
  if (jobsError) throw new Error(jobsError.message);
  if (recentError) throw new Error(recentError.message);
  return {
    jobs: jobs || [],
    summary: {
      delivered: (recent || []).filter(job => job.status === 'delivered').length,
      failed: (recent || []).filter(job => job.status === 'failed').length,
    },
  };
}

export async function adminRetryIntegrationJob(jobId, restaurantId) {
  requireRestaurantId(restaurantId);
  const { data: job, error: readError } = await supabase
    .from('IntegrationJob')
    .select('*')
    .eq('id', jobId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!job) throw new Error('Integration job not found.');

  const { data, error } = await supabase
    .from('IntegrationJob')
    .update({ status: 'pending', error: null, updated_at: now() })
    .eq('id', jobId)
    .eq('restaurant_id', restaurantId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (job.job_type === 'pos' && ENABLE_POS_EDGE_SYNC) {
    const { error: retryError } = await supabase.functions.invoke('sync-to-pos', {
      body: {
        job_id: job.id,
        restaurant_id: restaurantId,
        order_id: job.order_id,
        provider: job.provider,
      },
    });
    if (retryError) throw new Error(retryError.message);
  }

  return data;
}

export async function adminFetchGuests(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('GuestProfile')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('last_visit_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminFetchGuestOrders(restaurantId, guestProfileId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('Order')
    .select('id, status, total_amount, created_at, items:OrderItem(name, quantity, item_note)')
    .eq('restaurant_id', restaurantId)
    .eq('guest_profile_id', guestProfileId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminUpdateGuestProfile(guestProfileId, restaurantId, payload) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('GuestProfile')
    .update({ ...payload, updated_at: now() })
    .eq('id', guestProfileId)
    .eq('restaurant_id', restaurantId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function adminFetchCampaigns(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('MarketingCampaign')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminCreateCampaign(restaurantId, payload) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('MarketingCampaign')
    .insert({
      restaurant_id: restaurantId,
      name: payload.name,
      channel: payload.channel,
      subject: payload.subject || null,
      message_body: payload.message_body,
      audience_filter: payload.audience_filter || {},
      status: payload.status || 'draft',
      created_at: now(),
      updated_at: now(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function adminSendCampaign(campaignId) {
  const { data, error } = await supabase.functions.invoke('send-campaign', {
    body: { campaign_id: campaignId },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function adminEstimateCampaignRecipients(restaurantId, audienceFilter = {}) {
  requireRestaurantId(restaurantId);
  let query = supabase
    .from('GuestProfile')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('marketing_consent', true);
  if (audienceFilter.min_visits) query = query.gte('visit_count', Number(audienceFilter.min_visits));
  if (audienceFilter.last_visit_days) {
    query = query.gte('last_visit_at', new Date(Date.now() - Number(audienceFilter.last_visit_days) * 86400000).toISOString());
  }
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function adminFetchCampaignAnalytics(restaurantId, campaignId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('CampaignSend')
    .select('status, channel')
    .eq('campaign_id', campaignId);
  if (error) throw new Error(error.message);

  const totals = {
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0,
  };
  (data || []).forEach(send => {
    const status = send.status || 'sent';
    totals.sent += 1;
    if (status === 'delivered' || status === 'opened' || status === 'clicked') totals.delivered += 1;
    if (status === 'opened' || status === 'clicked') totals.opened += 1;
    if (status === 'clicked') totals.clicked += 1;
    if (status === 'bounced') totals.bounced += 1;
    if (status === 'failed') totals.failed += 1;
  });
  return totals;
}

export async function adminFetchBranchOverview(groupOwnerId) {
  if (!groupOwnerId) throw new Error('Owner context is required.');
  const { data, error } = await supabase.rpc('admin_branch_overview', {
    p_group_owner_id: groupOwnerId,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminFetchRevenueForecast(restaurantId, daysAhead = 7) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase.rpc('get_revenue_forecast', {
    p_restaurant_id: restaurantId,
    p_days_ahead: daysAhead,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminFetchPeakHours(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('restaurant_staffing_hints')
    .select('*')
    .eq('restaurant_id', restaurantId);
  if (error) throw new Error(error.message);
  return data || [];
}

// Admin API

export async function adminFetchOrders(status, restaurantId, limit = 100, offset = 0) {
  requireRestaurantId(restaurantId);
  let query = supabase
    .from('Order')
    .select('*, items:OrderItem(*, menu_item:MenuItem(*)), table:Table(*)', { count: 'exact' })
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { data: data || [], count: count || 0 };
}

export async function adminUpdateOrderStatus(orderId, status, cancelReason, restaurantId) {
  requireRestaurantId(restaurantId);
  const rpcResult = await supabase.rpc('update_order_status_secure', {
    p_restaurant_id: restaurantId,
    p_order_id: orderId,
    p_status: status,
    p_cancel_reason: cancelReason || null,
  });

  if (!rpcResult.error) {
    return normalizeRpcJson(rpcResult.data);
  }

  const missingRpc = /function .*update_order_status_secure|could not find.*update_order_status_secure/i.test(rpcResult.error.message);
  if (!missingRpc) throw new Error(rpcResult.error.message);

  const { data: current, error: readError } = await supabase
    .from('Order')
    .select('id, status')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw new Error('Order not found for this restaurant.');
  if (current.status === status) return current;
  if (!canTransitionOrderStatus(current.status, status)) {
    throw new Error(`Invalid order status transition: ${current.status} -> ${status}`);
  }

  const { data, error } = await supabase
    .from('Order')
    .update({ status, cancel_reason: cancelReason || null, updated_at: now() })
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  if (status === 'completed') {
    try {
      const { error: spendError } = await supabase.rpc('update_guest_profile_on_order', { p_order_id: orderId });
      if (spendError) console.warn('Guest profile spend update skipped:', spendError.message);
    } catch (err) {
      console.warn('Guest profile spend update skipped:', err.message);
    }
  }
  return data;
}

export async function adminFetchMenuItems(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('MenuItem')
    .select('*, category:MenuCategory(*), modifier_groups:ModifierGroup(*, options:ModifierOption(*))')
    .eq('restaurant_id', restaurantId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminFetchARAsset(itemId) {
  const { data, error } = await supabase
    .from('ARAsset')
    .select('*')
    .eq('menu_item_id', itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('AR asset not found.');
  return data;
}

export async function adminUploadARAsset(itemId, formData) {
  const menuItem = await fetchMenuItemForAR(itemId);
  const glbFile = formData.get('glb_file');
  const usdzFile = formData.get('usdz_file');
  const thumbnailFile = formData.get('thumbnail');

  assertUploadFile(glbFile, {
    label: 'GLB file',
    maxBytes: MAX_GLB_SIZE,
    extensions: ['glb'],
    mimeTypes: GLB_MIME_TYPES,
  });
  if (usdzFile) {
    assertUploadFile(usdzFile, {
      label: 'USDZ file',
      maxBytes: MAX_USDZ_SIZE,
      extensions: ['usdz'],
      mimeTypes: USDZ_MIME_TYPES,
    });
  }
  if (thumbnailFile) {
    assertUploadFile(thumbnailFile, {
      label: 'Thumbnail',
      maxBytes: MAX_THUMBNAIL_SIZE,
      extensions: ['jpg', 'jpeg', 'png', 'webp'],
      mimeTypes: THUMBNAIL_MIME_TYPES,
    });
  }

  const basePath = `${menuItem.restaurant_id}/${itemId}`;
  const storageUpdates = {
    model_glb_url: await uploadARFile(`${basePath}/model.glb`, glbFile, 'model/gltf-binary'),
    processing_status: 'ready',
    processing_error: null,
    file_size: glbFile.size + (usdzFile?.size || 0) + (thumbnailFile?.size || 0),
    updated_at: now(),
  };

  if (usdzFile) {
    storageUpdates.model_usdz_url = await uploadARFile(`${basePath}/model.usdz`, usdzFile, 'model/vnd.usdz+zip');
  }
  if (thumbnailFile) {
    const thumbExt = getFileExtension(thumbnailFile);
    storageUpdates.thumbnail_url = await uploadARFile(`${basePath}/thumbnail.${thumbExt}`, thumbnailFile, thumbnailFile.type);
    storageUpdates.preview_image_url = storageUpdates.thumbnail_url;
  }

  const { data: asset, error } = await supabase
    .from('ARAsset')
    .upsert({
      restaurant_id: menuItem.restaurant_id,
      menu_item_id: itemId,
      ...storageUpdates,
    }, { onConflict: 'menu_item_id' })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const { error: itemError } = await supabase
    .from('MenuItem')
    .update({ has_ar_preview: true, updated_at: now() })
    .eq('id', itemId)
    .eq('restaurant_id', menuItem.restaurant_id);
  if (itemError) throw new Error(itemError.message);

  return asset;
}

export async function adminUploadARSourceVideo(itemId, file) {
  const menuItem = await fetchMenuItemForAR(itemId);
  assertUploadFile(file, {
    label: 'Source video',
    maxBytes: MAX_AR_VIDEO_SIZE,
    extensions: ['mp4', 'mov'],
    mimeTypes: AR_VIDEO_MIME_TYPES,
  });

  const ext = getFileExtension(file);
  const path = `${menuItem.restaurant_id}/${itemId}/source-${crypto.randomUUID()}.${ext}`;
  const publicUrl = await uploadARSourceVideo(path, file);

  const { data: asset, error } = await supabase
    .from('ARAsset')
    .upsert({
      restaurant_id: menuItem.restaurant_id,
      menu_item_id: itemId,
      source_video_url: publicUrl,
      processing_status: 'queued',
      processing_error: null,
      updated_at: now(),
    }, { onConflict: 'menu_item_id' })
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (ENABLE_AR_EDGE_PROCESSING) {
    supabase.functions.invoke('process-ar-asset', {
      body: {
        asset_id: asset.id,
        source_video_url: publicUrl,
        storage_path: path,
      },
    }).catch(err => console.warn('[Menuverse] AR processing enqueue skipped:', err.message));
  }

  return asset;
}

export async function adminUpdateARAssetStatus(itemId, payload) {
  const menuItem = await fetchMenuItemForAR(itemId);
  const { data: asset, error } = await supabase
    .from('ARAsset')
    .update({
      ...(payload.is_active !== undefined ? { is_active: Boolean(payload.is_active) } : {}),
      ...(payload.processing_status !== undefined ? { processing_status: payload.processing_status } : {}),
      ...(payload.processing_error !== undefined ? { processing_error: payload.processing_error } : {}),
      updated_at: now(),
    })
    .eq('menu_item_id', itemId)
    .eq('restaurant_id', menuItem.restaurant_id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (payload.ar_preview_enabled !== undefined) {
    const { error: itemError } = await supabase
      .from('MenuItem')
      .update({ ar_preview_enabled: Boolean(payload.ar_preview_enabled), updated_at: now() })
      .eq('id', itemId)
      .eq('restaurant_id', menuItem.restaurant_id);
    if (itemError) throw new Error(itemError.message);
  }

  return asset;
}

export async function adminDeleteARAsset(itemId) {
  const menuItem = await fetchMenuItemForAR(itemId);
  const asset = await adminFetchARAsset(itemId);
  await removeARStorageFiles(asset);

  const { error } = await supabase
    .from('ARAsset')
    .delete()
    .eq('menu_item_id', itemId)
    .eq('restaurant_id', menuItem.restaurant_id);
  if (error) throw new Error(error.message);

  const { error: itemError } = await supabase
    .from('MenuItem')
    .update({ has_ar_preview: false, ar_preview_enabled: false, updated_at: now() })
    .eq('id', itemId)
    .eq('restaurant_id', menuItem.restaurant_id);
  if (itemError) throw new Error(itemError.message);

  return true;
}

export async function adminCreateMenuItem(payload) {
  requireRestaurantId(payload.restaurant_id);
  const { data: result, error } = await supabase
    .from('MenuItem')
    .insert({ ...payload, created_at: now(), updated_at: now() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function adminCreateCategory({ restaurantId, name, display_order = 0 }) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('MenuCategory')
    .insert({
      restaurant_id: restaurantId,
      name,
      display_order,
      created_at: now(),
      updated_at: now(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function adminSeedSampleMenu(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase.rpc('seed_sample_menu', {
    p_restaurant_id: restaurantId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function adminUpdateMenuItem(id, payload, restaurantId) {
  requireRestaurantId(restaurantId);
  const { restaurant_id: _restaurantId, ...safePayload } = payload;
  const { data: result, error } = await supabase
    .from('MenuItem')
    .update({ ...safePayload, updated_at: now() })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .select();
  if (error) throw new Error(error.message);
  return { updated: result?.length };
}

export async function adminTranslateMenuItem(itemId, locale) {
  const { data, error } = await supabase.functions.invoke('translate-menu-item', {
    body: { item_id: itemId, locale },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function adminUpdateItemModifiers(itemId, restaurantId, groups) {
  requireRestaurantId(restaurantId);
  const { data: existingGroups, error: existingError } = await supabase
    .from('ModifierGroup')
    .select('id')
    .eq('menu_item_id', itemId)
    .eq('restaurant_id', restaurantId);
  if (existingError) throw new Error(existingError.message);

  if (existingGroups?.length > 0) {
    const groupIds = existingGroups.map(g => g.id);
    const { error: optionDeleteError } = await supabase.from('ModifierOption').delete().in('group_id', groupIds);
    if (optionDeleteError) throw new Error(optionDeleteError.message);
    const { error: groupDeleteError } = await supabase
      .from('ModifierGroup')
      .delete()
      .in('id', groupIds)
      .eq('restaurant_id', restaurantId);
    if (groupDeleteError) throw new Error(groupDeleteError.message);
  }

  if (!groups || groups.length === 0) return;

  for (const group of groups) {
    const groupId = crypto.randomUUID();
    const { error: groupError } = await supabase.from('ModifierGroup').insert({
      id: groupId,
      restaurant_id: restaurantId,
      menu_item_id: itemId,
      name: group.name,
      required: Boolean(group.required),
      created_at: now(),
      updated_at: now(),
    });
    if (groupError) throw new Error(groupError.message);

    if (group.options?.length > 0) {
      const optionsToInsert = group.options.map(option => ({
        id: crypto.randomUUID(),
        group_id: groupId,
        name: option.name,
        price_delta: parseFloat(option.price_delta) || 0,
      }));
      const { error: optionError } = await supabase.from('ModifierOption').insert(optionsToInsert);
      if (optionError) throw new Error(optionError.message);
    }
  }
}

export async function adminFetchCategories(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('MenuCategory')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminFetchTables(restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('Table')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('number', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminCreateTable(payload) {
  const restaurantId = payload.restaurant_id || payload.restaurantId;
  requireRestaurantId(restaurantId);
  const tablePayload = payload.tableNumber
    ? {
      restaurant_id: restaurantId,
      number: payload.tableNumber,
      surface_type: payload.surface_type || 'table',
      surface_label: payload.surface_label || null,
      section: payload.section,
      capacity: payload.capacity,
      status: payload.status,
    }
    : { ...payload, restaurant_id: restaurantId };
  const { data: result, error } = await supabase
    .from('Table')
    .insert({ ...tablePayload, created_at: now(), updated_at: now() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function adminUpdateTable(id, payload, restaurantId) {
  requireRestaurantId(restaurantId);
  const { restaurant_id: _restaurantId, ...safePayload } = payload;
  const { data: result, error } = await supabase
    .from('Table')
    .update({ ...safePayload, updated_at: now() })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function adminDeleteTable(id, restaurantId) {
  requireRestaurantId(restaurantId);
  const { error } = await supabase
    .from('Table')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', restaurantId);
  if (error) throw new Error(error.message);
  return true;
}

export async function adminClearTable(tableId, restaurantId) {
  requireRestaurantId(restaurantId);
  const { error: sessionErr } = await supabase.rpc('close_table_session', {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
  });
  if (sessionErr) throw new Error(sessionErr.message);

  return true;
}

export async function adminRemoveStaffMember(memberId, restaurantId) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase.rpc('remove_staff_member_secure', {
    p_restaurant_id: restaurantId,
    p_member_id: memberId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function adminUpdateRestaurant(id, payload) {
  requireRestaurantId(id);
  const { data: result, error } = await supabase
    .from('Restaurant')
    .update({ ...payload, updated_at: now() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function adminUpdateRestaurantQrColors(restaurantId, colors) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase
    .from('Restaurant')
    .update({
      qr_fg_color: colors.qr_fg_color,
      qr_bg_color: colors.qr_bg_color,
      qr_eye_color: colors.qr_eye_color,
      updated_at: now(),
    })
    .eq('id', restaurantId)
    .select('id, qr_fg_color, qr_bg_color, qr_eye_color')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function seedDatabase() {
  throw new Error('Seeding via API is disabled. Use the scratch/seed_100_items.js script instead.');
}
