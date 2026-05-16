import { supabase } from './supabase';
import { canTransitionOrderStatus } from './businessRules';

const now = () => new Date().toISOString();
const allowClientOrderFallback = import.meta.env.DEV && import.meta.env.VITE_ALLOW_CLIENT_ORDER_FALLBACK === 'true';

function genOrderId() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `SF-${date}-${rand}`;
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
    notes: item.notes || null,
  }));
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
    categories: categories?.map(cat => ({ ...cat, items: cat.items || [] })) || [],
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
  return data;
}

async function placeOrderClientFallback(payload) {
  const orderId = genOrderId();
  const ts = now();

  const { count, error: countErr } = await supabase
    .from('Order')
    .select('id', { count: 'exact', head: true })
    .eq('table_id', payload.table_id)
    .eq('restaurant_id', payload.restaurant_id)
    .eq('status', 'pending');
  if (countErr) throw new Error(`Anti-spam check failed: ${countErr.message}`);
  if (count >= 5) throw new Error('Kitchen is processing your previous orders. Please wait before placing another order.');

  const itemIds = payload.items.map(i => i.menu_item_id);
  const { data: dbItems, error: dbErr } = await supabase
    .from('MenuItem')
    .select('id, name, price, available, restaurant_id')
    .in('id', itemIds)
    .eq('restaurant_id', payload.restaurant_id);
  if (dbErr) throw new Error(`Price verification failed: ${dbErr.message}`);

  let totalAmount = 0;
  for (const item of payload.items) {
    const dbItem = dbItems.find(i => i.id === item.menu_item_id);
    if (!dbItem) throw new Error(`Item ${item.name || item.menu_item_id} not found`);
    if (!dbItem.available) throw new Error(`${dbItem.name} is currently unavailable`);
    totalAmount += Number(dbItem.price) * Number(item.quantity || 1);
  }

  const { error: orderError } = await supabase.from('Order').insert({
    id: orderId,
    restaurant_id: payload.restaurant_id,
    table_id: payload.table_id,
    table_session_id: payload.table_session_id || null,
    total_amount: Number(totalAmount.toFixed(2)),
    special_instructions: payload.special_instructions || null,
    idempotency_key: payload.idempotency_key,
    status: 'pending',
    created_at: ts,
    updated_at: ts,
  });
  if (orderError) throw new Error(`Order failed: ${orderError.message}`);

  const orderItems = payload.items.map(item => {
    const dbItem = dbItems.find(i => i.id === item.menu_item_id);
    return {
      id: crypto.randomUUID(),
      order_id: orderId,
      menu_item_id: item.menu_item_id,
      name: dbItem.name,
      quantity: item.quantity,
      price: dbItem.price,
      modifiers_json: item.modifiers?.length ? JSON.stringify(item.modifiers) : null,
    };
  });

  const { error: itemsError } = await supabase.from('OrderItem').insert(orderItems);
  if (itemsError) {
    await supabase.from('Order').delete().eq('id', orderId).eq('restaurant_id', payload.restaurant_id);
    throw new Error(`Order items failed: ${itemsError.message}`);
  }

  await supabase
    .from('Table')
    .update({ status: 'occupied', updated_at: ts })
    .eq('id', payload.table_id)
    .eq('restaurant_id', payload.restaurant_id);

  return { order_ref: orderId, status: 'pending', total_amount: Number(totalAmount.toFixed(2)) };
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

  const { data, error } = await supabase.rpc('create_order_secure', rpcPayload);
  if (!error) return Array.isArray(data) ? data[0] : data;

  if (allowClientOrderFallback) {
    console.warn('[Menuverse] create_order_secure RPC unavailable; using opted-in local demo fallback.', error.message);
    return placeOrderClientFallback(payload);
  }

  throw new Error(`Secure order creation is not available: ${error.message}`);
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

  if (!allowClientOrderFallback) throw new Error('Order status requires a valid table session.');

  const { data, error } = await supabase
    .from('Order')
    .select(`
      *,
      items:OrderItem(*, menu_item:MenuItem(*)),
      table:Table(*),
      payments:Payment(*)
    `)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Order not found');
  return data;
}

export async function fetchTableOrders(tableId) {
  const tableSessionToken = localStorage.getItem('mv_table_session_token');
  if (tableSessionToken) {
    const { data, error } = await supabase.rpc('get_table_session_orders', {
      p_table_session_token: tableSessionToken,
    });
    if (!error) return data || [];
  }

  if (!allowClientOrderFallback) throw new Error('Table bill requires a valid table session.');

  const { data, error } = await supabase
    .from('Order')
    .select('*, items:OrderItem(*, menu_item:MenuItem(*))')
    .eq('table_id', tableId)
    .in('status', ['pending', 'accepted', 'preparing', 'ready', 'served', 'completed'])
    .order('created_at', { ascending: false });
  if (error) throw new Error('Failed to fetch table orders');
  return data || [];
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

export async function createStaffRequest({ restaurantId, tableId, tableSessionToken }) {
  const { data, error } = await supabase.rpc('create_staff_request_secure', {
    p_restaurant_id: requireRestaurantId(restaurantId),
    p_table_id: tableId,
    p_table_session_token: tableSessionToken || localStorage.getItem('mv_table_session_token'),
  });
  if (error) throw new Error(error.message);
  return data;
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
  const ts = now();
  const { error: sessionErr } = await supabase.rpc('close_table_session', {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
  });
  if (sessionErr && !allowClientOrderFallback) throw new Error(sessionErr.message);

  if (sessionErr && allowClientOrderFallback) {
    const { count: activeCount, error: activeErr } = await supabase
      .from('Order')
      .select('id', { count: 'exact', head: true })
      .eq('table_id', tableId)
      .eq('restaurant_id', restaurantId)
      .in('status', ['pending', 'accepted', 'preparing']);
    if (activeErr) throw new Error(activeErr.message);
    if (activeCount > 0) throw new Error('Cannot clear table while kitchen-active orders exist.');

    const { error: oErr } = await supabase
      .from('Order')
      .update({ status: 'completed', updated_at: ts })
      .eq('table_id', tableId)
      .eq('restaurant_id', restaurantId)
      .in('status', ['ready', 'served']);
    if (oErr) throw new Error(oErr.message);

    const { error: tErr } = await supabase
      .from('Table')
      .update({ status: 'available', updated_at: ts })
      .eq('id', tableId)
      .eq('restaurant_id', restaurantId);
    if (tErr) throw new Error(tErr.message);
  }

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
