import { supabase } from './supabase';
import { canTransitionOrderStatus, safeParseModifiers } from './businessRules';

const now = () => new Date().toISOString();
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

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

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, options = {}) {
  const { auth, ...fetchOptions } = options;
  const authHeaders = auth === false ? {} : await getAuthHeader();
  const headers = {
    ...authHeaders,
    ...(fetchOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(fetchOptions.headers || {}),
  };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

// Public customer API

export async function fetchMenu(restaurantSlug) {
  let restaurantQuery = supabase.from('Restaurant').select('*');
  restaurantQuery = restaurantSlug
    ? restaurantQuery.eq('slug', restaurantSlug).maybeSingle()
    : restaurantQuery.limit(1).maybeSingle();

  const { data: restaurant, error: restErr } = await restaurantQuery;
  if (restErr || !restaurant) throw new Error('Restaurant not found');

  const { data: categories, error: catErr } = await supabase
    .from('MenuCategory')
    .select(`
      *,
      items:MenuItem(
        *,
        modifier_groups:ModifierGroup(
          *,
          options:ModifierOption(*)
        )
      )
    `)
    .eq('restaurant_id', restaurant.id)
    .eq('archived', false)
    .order('display_order', { ascending: true });

  if (catErr) throw new Error(catErr.message);

  return {
    restaurant,
    categories: categories?.map(cat => ({
      ...cat,
      items: (cat.items || []).map(item => ({
        ...item,
        tags: safeParseModifiers(item.tags_json) ?? [],
      })),
    })) || [],
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
  const { data, error } = await supabase
    .from('MenuItem')
    .select(`
      *,
      category:MenuCategory(*),
      modifier_groups:ModifierGroup(
        *,
        options:ModifierOption(*)
      )
    `)
    .eq('id', dishId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Menu item not found');
  return {
    ...data,
    tags: safeParseModifiers(data.tags_json) ?? [],
  };
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
  return apiFetch(`/api/public/menu-items/${itemId}/ar`, { auth: false });
}

export async function submitOrderFeedback({ orderId, tableSessionToken, rating, comment = null }) {
  const { data, error } = await supabase.rpc('submit_order_feedback_secure', {
    p_order_id: orderId,
    p_table_session_token: tableSessionToken || localStorage.getItem('mv_table_session_token'),
    p_rating: rating,
    p_comment: comment,
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
  return apiFetch(`/api/admin/menu-items/${itemId}/ar`);
}

export async function adminUploadARAsset(itemId, formData) {
  return apiFetch(`/api/admin/menu-items/${itemId}/ar/upload`, {
    method: 'POST',
    body: formData,
  });
}

export async function adminUpdateARAssetStatus(itemId, payload) {
  return apiFetch(`/api/admin/menu-items/${itemId}/ar/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function adminDeleteARAsset(itemId) {
  return apiFetch(`/api/admin/menu-items/${itemId}/ar`, {
    method: 'DELETE',
  });
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
