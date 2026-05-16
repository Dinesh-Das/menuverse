import { supabase } from './supabase';

// ── Helpers ───────────────────────────────────────────────────
const now = () => new Date().toISOString();

function genOrderId() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `SF-${date}-${rand}`;
}

// ── Public (Customer) API ─────────────────────────────────────

export async function fetchMenu(restaurantSlug) {
  let restaurantQuery = supabase.from('Restaurant').select('*');
  if (restaurantSlug) {
    restaurantQuery = restaurantQuery.eq('slug', restaurantSlug).maybeSingle();
  } else {
    restaurantQuery = restaurantQuery.limit(1).maybeSingle();
  }

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

  const visibleCategories = categories?.map(cat => ({
    ...cat,
    items: cat.items || []
  })) || [];

  return { restaurant, categories: visibleCategories };
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

export async function placeOrder(payload) {
  const orderId = genOrderId();
  const ts = now();

  // 0. Anti-Spam check: max 5 pending orders per table (scoped to restaurant)
  const { count, error: countErr } = await supabase
    .from('Order')
    .select('id', { count: 'exact', head: true })
    .eq('table_id', payload.table_id)
    .eq('restaurant_id', payload.restaurant_id)  // SEC-07: scope to restaurant
    .eq('status', 'pending');
    
  if (countErr) throw new Error(`Anti-spam check failed: ${countErr.message}`);
  if (count >= 5) {
    throw new Error('Kitchen is processing your previous orders. Please wait for them to be accepted before placing a new one.');
  }

  // 0.5 Price Verification
  const itemIds = payload.items.map(i => i.menu_item_id);
  if (itemIds.length > 0) {
    const { data: dbItems, error: dbErr } = await supabase
      .from('MenuItem')
      .select('id, price, available')
      .in('id', itemIds);
    if (dbErr) throw new Error(`Price verification failed: ${dbErr.message}`);

    for (const item of payload.items) {
      const dbItem = dbItems.find(i => i.id === item.menu_item_id);
      if (!dbItem) throw new Error(`Item ${item.name} not found`);
      if (!dbItem.available) {
        throw new Error(`${item.name} is currently unavailable`);
      }
      if (Math.abs(dbItem.price - item.price) > 1) {
        throw new Error(`Price mismatch for ${item.name}: expected ₹${dbItem.price}, got ₹${item.price}`);
      }
    }
  }

  // 1. Insert the Order
  const { error: orderError } = await supabase.from('Order').insert({
    id: orderId,
    restaurant_id: payload.restaurant_id,
    table_id: payload.table_id,
    total_amount: payload.total_amount,
    special_instructions: payload.special_instructions || null,
    idempotency_key: payload.idempotency_key,
    status: 'pending',
    created_at: ts,
    updated_at: ts,
  });
  if (orderError) throw new Error(`Order failed: ${orderError.message}`);

  // 2. Insert Order Items (no timestamps — OrderItem has no created_at/updated_at columns)
  const orderItems = payload.items.map(item => ({
    id: crypto.randomUUID(),
    order_id: orderId,
    menu_item_id: item.menu_item_id,
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    modifiers_json: item.modifiers?.length ? JSON.stringify(item.modifiers) : null,
  }));

  const { error: itemsError } = await supabase.from('OrderItem').insert(orderItems);
  if (itemsError) {
    await supabase.from('Order').delete().eq('id', orderId);
    throw new Error(`Order items failed: ${itemsError.message}`);
  }

  // 3. Mark table as occupied (Table has updated_at)
  await supabase.from('Table').update({ status: 'occupied', updated_at: ts }).eq('id', payload.table_id);

  // 4. Optional: Insert simulated payment
  if (payload.payment) {
    const { error: pErr } = await supabase.from('Payment').insert({
      id: crypto.randomUUID(),
      order_id: orderId,
      razorpay_order_id: payload.payment.razorpay_order_id || 'sim_order_' + Date.now(),
      razorpay_payment_id: payload.payment.razorpay_payment_id || 'sim_pay_' + Date.now(),
      status: payload.payment.status || 'success',
      amount: payload.payment.amount,
      created_at: ts,
      updated_at: ts
    });
    if (pErr) console.warn('Simulated payment failed (table might be missing or RLS blocked):', pErr.message);
  }

  return { order_ref: orderId, status: 'pending', total_amount: payload.total_amount };
}

export async function fetchOrderStatus(orderId) {
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
  const { data, error } = await supabase
    .from('Order')
    .select(`*, items:OrderItem(*, menu_item:MenuItem(*))`)
    .eq('table_id', tableId)
    // BUG-09: Include 'completed' so multi-round bills are never understated
    .in('status', ['pending', 'accepted', 'preparing', 'ready', 'served', 'completed'])
    .order('created_at', { ascending: false });
  if (error) throw new Error('Failed to fetch table orders');
  return data || [];
}

export async function createPayment(payload) {
  const { error } = await supabase.from('Payment').insert({
    id: crypto.randomUUID(),
    order_id: payload.order_id,
    razorpay_order_id: payload.razorpay_order_id || 'sim_order_' + Date.now(),
    razorpay_payment_id: payload.razorpay_payment_id || 'sim_pay_' + Date.now(),
    status: payload.status || 'success',
    amount: payload.amount,
    created_at: now(),
    updated_at: now()
  });
  if (error) throw new Error(`Payment failed: ${error.message}`);
  return true;
}

// ── Admin API ─────────────────────────────────────────────────

export async function adminFetchOrders(status, restaurantId, limit = 100, offset = 0) {
  let query = supabase
    .from('Order')
    .select(`*, items:OrderItem(*, menu_item:MenuItem(*)), table:Table(*)`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (restaurantId) query = query.eq('restaurant_id', restaurantId);
  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { data: data || [], count: count || 0 };
}

export async function adminUpdateOrderStatus(orderId, status, cancelReason) {
  // Order has updated_at but no DB default — inject it
  const { data, error } = await supabase
    .from('Order')
    .update({ status, cancel_reason: cancelReason || null, updated_at: now() })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function adminFetchMenuItems(restaurantId) {
  let query = supabase
    .from('MenuItem')
    .select('*, category:MenuCategory(*), modifier_groups:ModifierGroup(*, options:ModifierOption(*))')
    .order('display_order', { ascending: true });

  if (restaurantId) query = query.eq('restaurant_id', restaurantId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminCreateMenuItem(payload) {
  const { data: result, error } = await supabase
    .from('MenuItem')
    .insert({ ...payload, created_at: now(), updated_at: now() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function adminUpdateMenuItem(id, payload) {
  const { data: result, error } = await supabase
    .from('MenuItem')
    .update({ ...payload, updated_at: now() })
    .eq('id', id)
    .select();
  if (error) throw new Error(error.message);
  return { updated: result?.length };
}

export async function adminUpdateItemModifiers(itemId, restaurantId, groups) {
  const { data: existingGroups } = await supabase.from('ModifierGroup').select('id').eq('menu_item_id', itemId);
  if (existingGroups && existingGroups.length > 0) {
    const groupIds = existingGroups.map(g => g.id);
    await supabase.from('ModifierOption').delete().in('group_id', groupIds);
    await supabase.from('ModifierGroup').delete().in('id', groupIds);
  }

  if (!groups || groups.length === 0) return;

  for (const g of groups) {
    const groupId = crypto.randomUUID();
    await supabase.from('ModifierGroup').insert({
      id: groupId,
      restaurant_id: restaurantId,
      menu_item_id: itemId,
      name: g.name,
      required: g.required,
      created_at: now(),
      updated_at: now()
    });

    if (g.options && g.options.length > 0) {
      const optionsToInsert = g.options.map(o => ({
        id: crypto.randomUUID(),
        group_id: groupId,
        name: o.name,
        price_delta: parseFloat(o.price_delta) || 0
      }));
      await supabase.from('ModifierOption').insert(optionsToInsert);
    }
  }
}

export async function adminFetchCategories() {
  const { data, error } = await supabase
    .from('MenuCategory')
    .select('*')
    .order('display_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminFetchTables(restaurantId) {
  let query = supabase
    .from('Table')
    .select('*')
    .order('number', { ascending: true });
    
  if (restaurantId) query = query.eq('restaurant_id', restaurantId);
  
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function adminCreateTable(payload) {
  const { data: result, error } = await supabase
    .from('Table')
    .insert({ ...payload, created_at: now(), updated_at: now() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function adminUpdateTable(id, payload) {
  const { data: result, error } = await supabase
    .from('Table')
    .update({ ...payload, updated_at: now() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function adminDeleteTable(id, restaurantId) {
  const { error } = await supabase
    .from('Table')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', restaurantId);
  if (error) throw new Error(error.message);
  return true;
}

export async function adminClearTable(tableId) {
  // 1. Mark table as available
  const { error: tErr } = await supabase
    .from('Table')
    .update({ status: 'available', updated_at: now() })
    .eq('id', tableId);
  if (tErr) throw new Error(tErr.message);

  // 2. Mark all active orders for this table as completed
  const { error: oErr } = await supabase
    .from('Order')
    .update({ status: 'completed', updated_at: now() })
    .eq('table_id', tableId)
    .in('status', ['pending', 'accepted', 'preparing', 'ready', 'served']);
  if (oErr) throw new Error(oErr.message);
  
  return true;
}

export async function adminUpdateRestaurant(id, payload) {
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
