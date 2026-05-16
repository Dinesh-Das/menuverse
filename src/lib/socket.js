import { supabase } from './supabase';

// ── Event Registry ─────────────────────────────────────────────
// Maps event names → array of callback functions
const listeners = {};

function dispatch(event, data) {
  (listeners[event] || []).forEach(cb => {
    try { cb(data); } catch (e) { console.error('[socket] callback error:', e); }
  });
}

// ── Active Channels ────────────────────────────────────────────
const activeChannels = {};

// ── Connection state tracking ──────────────────────────────────
let _realtimeConnected = false;

// ── Socket-compatible object (drop-in for old socket.io code) ──
export const socket = {
  get connected() { return _realtimeConnected; },
  on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    if (!listeners[event].includes(cb)) listeners[event].push(cb);
  },
  off(event, cb) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter(f => f !== cb);
    }
  },
  emit() {}, // no-op: reads are via Realtime, writes via api.js
};

export const getSocket = () => socket;
export const io = socket; // legacy alias

// ── Fetch a full order with items and table ────────────────────
async function fetchFullOrder(orderId) {
  const { data, error } = await supabase
    .from('Order')
    .select(`
      *,
      items:OrderItem(*, menu_item:MenuItem(*)),
      table:Table(*)
    `)
    .eq('id', orderId)
    .single();
  if (error) {
    console.warn('[socket] fetchFullOrder error:', error.message);
    return null;
  }
  return data;
}

// ── Subscribe to a single order (for OrderStatus page) ─────────
export function joinOrderRoom(orderId) {
  if (!orderId) return;
  const key = `order_${orderId}`;
  if (activeChannels[key]) return; // already subscribed

  activeChannels[key] = supabase
    .channel(key)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'Order', filter: `id=eq.${orderId}` },
      payload => {
        const updated = payload.new;
        dispatch('order:status_update', { orderId: updated.id, status: updated.status });
        dispatch('order:updated', updated);
      }
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        _realtimeConnected = true;
        dispatch('connect', {});
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        _realtimeConnected = false;
        dispatch('disconnect', {});
      }
    });
}

// ── Subscribe to all orders for a restaurant (KDS/OrderMonitor) ─
export function joinRestaurantRoom(restaurantId) {
  if (!restaurantId) return;
  const key = `restaurant_${restaurantId}`;
  if (activeChannels[key]) return; // already subscribed

  activeChannels[key] = supabase
    .channel(key)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'Order', filter: `restaurant_id=eq.${restaurantId}` },
      async payload => {
        const fullOrder = await fetchFullOrder(payload.new.id);
        if (fullOrder) dispatch('order:new', fullOrder);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'Order', filter: `restaurant_id=eq.${restaurantId}` },
      async payload => {
        const fullOrder = await fetchFullOrder(payload.new.id);
        if (fullOrder) dispatch('order:updated', fullOrder);
      }
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        _realtimeConnected = true;
        dispatch('connect', {});
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        _realtimeConnected = false;
        dispatch('disconnect', {});
      }
    });
}

// ── Cleanup a channel (call on component unmount) ─────────────
export function leaveRoom(key) {
  if (activeChannels[key]) {
    activeChannels[key].unsubscribe();
    delete activeChannels[key];
  }
}
