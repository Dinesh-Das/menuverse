import { supabase } from './supabase';
import { canTransitionOrderStatus, safeParseModifiers } from './businessRules';

const now = () => new Date().toISOString();
const AR_BUCKET = 'ar-models';
const MAX_GLB_SIZE = 20 * 1024 * 1024;
const MAX_USDZ_SIZE = 20 * 1024 * 1024;
const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024;
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
    notes: item.notes || null,
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
  };

  // Order creation must go through the create_order_secure RPC only.
  const { data, error } = await supabase.rpc('create_order_secure', rpcPayload);
  if (error) throw new Error(`Secure order creation failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

export async function fetchOrderStatus(orderId) {
  const tableSessionToken = localStorage.getItem('mv_table_session_token');
  if (tableSessionToken) {
    const { data, error } = await supabase.rpc('get_order_status_secure', {
      p_order_id: orderId,
      p_table_session_token: tableSessionToken,
    });
    if (!error && data) return Array.isArray(data) ? data[0] : data;
  }

  throw new Error('Order status requires a valid table session.');
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
  const { data, error } = await supabase.functions.invoke('create-payment-order', {
    body: {
      table_session_token: payload.table_session_token || localStorage.getItem('mv_table_session_token'),
      order_id: payload.order_id || null,
      amount: payload.amount,
    },
  });
  if (error) throw new Error(`Payment order failed: ${error.message}`);
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

  if (data) {
    supabase.functions.invoke('analyse-feedback', {
      body: { feedback_id: data },
    }).catch(() => {});
  }

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

export async function adminFetchFeedbackInsights(restaurantId, days = 30) {
  requireRestaurantId(restaurantId);
  const { data, error } = await supabase.rpc('admin_feedback_insights', {
    p_restaurant_id: restaurantId,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return data;
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
  const { data: current, error: readError } = await supabase
    .from('Order')
    .select('id, status')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw new Error('Order not found for this restaurant.');
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

export async function adminUpdateARAssetStatus(itemId, payload) {
  const menuItem = await fetchMenuItemForAR(itemId);
  const { data: asset, error } = await supabase
    .from('ARAsset')
    .update({
      ...(payload.is_active !== undefined ? { is_active: Boolean(payload.is_active) } : {}),
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
  requireRestaurantId(payload.restaurant_id);
  const { data: result, error } = await supabase
    .from('Table')
    .insert({ ...payload, created_at: now(), updated_at: now() })
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

export async function seedDatabase() {
  throw new Error('Seeding via API is disabled. Use the scratch/seed_100_items.js script instead.');
}
