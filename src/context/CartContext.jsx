import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  TABLE_SESSION_TTL_MS,
  getStoredTableSessionToken,
  getTableSessionValue,
  setTableSessionValue,
} from '../lib/tableSessionStorage';

const CartContext = createContext(null);
const STORAGE_KEY = 'mv_cart';
const ORDER_TYPES = new Set(['dine_in', 'takeaway', 'delivery']);

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const MAX_ITEM_QTY = 20;

function makeCartKey(dishId, modifiers = [], itemNote = '') {
  const modKey = modifiers.length > 0
    ? JSON.stringify(modifiers.map(m => m.id || m.name).sort())
    : '';
  const noteKey = itemNote.trim().toLowerCase();
  return `${dishId}::${modKey}::${noteKey}`;
}

function sendRealtimeMessage(channel, payload) {
  if (!channel || !payload?.event) return Promise.resolve('error');
  return channel
    .send({ type: 'broadcast', event: payload.event, payload: payload.payload || {} })
    .catch(() => 'error');
}

function loadInitialTableSession() {
  const tableSessionToken = getStoredTableSessionToken();
  return {
    tableId: getTableSessionValue('mv_table_id'),
    tableNumber: getTableSessionValue('mv_table_num'),
    restaurantSlug: getTableSessionValue('mv_restaurant_slug'),
    tableSessionToken,
    tableSessionId: getTableSessionValue('mv_table_session_id'),
    orderType: getTableSessionValue('mv_order_type'),
  };
}

export function CartProvider({ children }) {
  const [initialTableSession] = useState(loadInitialTableSession);
  const [items, setItems] = useState(loadFromStorage);
  const [remoteCarts, setRemoteCarts] = useState({});
  const [tableId, setTableId] = useState(initialTableSession.tableId);
  const [tableNumber, setTableNumber] = useState(initialTableSession.tableNumber);
  const [restaurantId, setRestaurantId] = useState(localStorage.getItem('mv_restaurant_id') || null);
  const [restaurantSlug, setRestaurantSlug] = useState(initialTableSession.restaurantSlug);
  const [tableSessionToken, setTableSessionToken] = useState(initialTableSession.tableSessionToken);
  const [tableSessionId, setTableSessionId] = useState(initialTableSession.tableSessionId);
  const [orderType, setOrderTypeState] = useState(() => {
    const stored = initialTableSession.orderType;
    return ORDER_TYPES.has(stored) ? stored : 'dine_in';
  });
  const [gstRateState, setGstRateState] = useState(localStorage.getItem('mv_gst_rate') || '0.05');
  const [paymentEnabled, setPaymentEnabled] = useState(localStorage.getItem('mv_payment_enabled') === 'true');
  const [paymentProvider, setPaymentProvider] = useState(localStorage.getItem('mv_payment_provider') || 'razorpay');
  const [currency, setCurrency] = useState(localStorage.getItem('mv_currency') || 'inr');

  const deviceIdRef = useRef(localStorage.getItem('mv_device_id') || crypto.randomUUID());
  const channelRef = useRef(null);

  // Persist cart and device id
  useEffect(() => {
    localStorage.setItem('mv_device_id', deviceIdRef.current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Broadcast logic
  useEffect(() => {
    if (!tableId) return;

    const channel = supabase.channel(`cart:${tableId}`, {
      config: { broadcast: { self: false } }
    });

    channel
      .on('broadcast', { event: 'cart_sync' }, ({ payload }) => {
        setRemoteCarts(prev => ({ ...prev, [payload.deviceId]: payload.items }));
      })
      .on('broadcast', { event: 'request_sync' }, () => {
        // Someone joined, send them our current cart
        sendRealtimeMessage(channel, {
          type: 'broadcast',
          event: 'cart_sync',
          payload: { deviceId: deviceIdRef.current, items: itemsRef.current }
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Ask for others' carts
          sendRealtimeMessage(channel, { type: 'broadcast', event: 'request_sync', payload: {} });
          // Send our cart initially
          sendRealtimeMessage(channel, {
            type: 'broadcast',
            event: 'cart_sync',
            payload: { deviceId: deviceIdRef.current, items: itemsRef.current }
          });
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tableId]);

  // Separate effect to broadcast on item changes
  useEffect(() => {
    if (!channelRef.current || !tableId) return;
    sendRealtimeMessage(channelRef.current, {
      type: 'broadcast',
      event: 'cart_sync',
      payload: { deviceId: deviceIdRef.current, items }
    });
  }, [items, tableId]);

  const setSession = useCallback((sessionData) => {
    const { tableId: tid, tableNumber: tnum, restaurantId: rid, restaurantSlug: slug } = sessionData;
    
    if (tid !== undefined) {
      setTableId(tid);
      setTableSessionValue('mv_table_id', tid);
    }
    if (tnum !== undefined) {
      setTableNumber(tnum);
      setTableSessionValue('mv_table_num', tnum);
    }
    if (rid !== undefined) {
      setRestaurantId(rid);
      if (rid) localStorage.setItem('mv_restaurant_id', rid);
      else localStorage.removeItem('mv_restaurant_id');
    }
    if (slug !== undefined) {
      setRestaurantSlug(slug);
      setTableSessionValue('mv_restaurant_slug', slug);
    }
    if (sessionData.tableSessionToken !== undefined) {
      setTableSessionToken(sessionData.tableSessionToken);
      if (sessionData.tableSessionToken) {
        setTableSessionValue('mv_table_session_token', sessionData.tableSessionToken);
        setTableSessionValue('mv_table_session_expires', Date.now() + TABLE_SESSION_TTL_MS);
      } else {
        setTableSessionValue('mv_table_session_token', null);
        setTableSessionValue('mv_table_session_expires', null);
      }
    }
    if (sessionData.tableSessionId !== undefined) {
      setTableSessionId(sessionData.tableSessionId);
      setTableSessionValue('mv_table_session_id', sessionData.tableSessionId);
    }
    if (sessionData.gstRate !== undefined) {
      setGstRateState(sessionData.gstRate);
      if (sessionData.gstRate) localStorage.setItem('mv_gst_rate', sessionData.gstRate);
      else localStorage.removeItem('mv_gst_rate');
    }
    if (sessionData.paymentEnabled !== undefined) {
      setPaymentEnabled(Boolean(sessionData.paymentEnabled));
      localStorage.setItem('mv_payment_enabled', String(Boolean(sessionData.paymentEnabled)));
    }
    if (sessionData.paymentProvider !== undefined) {
      setPaymentProvider(sessionData.paymentProvider || 'razorpay');
      if (sessionData.paymentProvider) localStorage.setItem('mv_payment_provider', sessionData.paymentProvider);
      else localStorage.removeItem('mv_payment_provider');
    }
    if (sessionData.currency !== undefined) {
      setCurrency(sessionData.currency || 'inr');
      if (sessionData.currency) localStorage.setItem('mv_currency', sessionData.currency);
      else localStorage.removeItem('mv_currency');
    }
  }, []);

  const setOrderType = useCallback((nextOrderType) => {
    const normalized = ORDER_TYPES.has(nextOrderType) ? nextOrderType : 'dine_in';
    setOrderTypeState(normalized);
    setTableSessionValue('mv_order_type', normalized);
  }, []);

  const addItem = useCallback((dish, qty = 1, selectedModifiers = [], itemNote = '') => {
    setItems(prev => {
      const normalizedItemNote = String(itemNote || '').trim().slice(0, 200);
      const cartKey = makeCartKey(dish.id, selectedModifiers, normalizedItemNote);
      const existing = prev.find(i => i._cartKey === cartKey);
      if (existing) {
        return prev.map(i => i._cartKey === cartKey ? { ...i, qty: Math.min(MAX_ITEM_QTY, i.qty + qty) } : i);
      }
      return [...prev, { ...dish, qty: Math.min(MAX_ITEM_QTY, qty), selectedModifiers, itemNote: normalizedItemNote, _cartKey: cartKey }];
    });
  }, []);

  const removeItem = useCallback((cartKey) => {
    setItems(prev => prev.filter(i => i._cartKey !== cartKey));
  }, []);

  const updateQty = useCallback((cartKey, qty) => {
    if (qty <= 0) {
      setItems(prev => prev.filter(i => i._cartKey !== cartKey));
    } else {
      setItems(prev => prev.map(i => i._cartKey === cartKey ? { ...i, qty: Math.min(MAX_ITEM_QTY, qty) } : i));
    }
  }, []);

  const updateItemNote = useCallback((cartKey, itemNote) => {
    const normalizedItemNote = String(itemNote || '').slice(0, 200);
    setItems(prev => prev.map(i => i._cartKey === cartKey ? { ...i, itemNote: normalizedItemNote } : i));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
    if (channelRef.current) {
      sendRealtimeMessage(channelRef.current, {
        type: 'broadcast',
        event: 'cart_sync',
        payload: { deviceId: deviceIdRef.current, items: [] }
      });
    }
  }, []);

  const remoteItems = Object.values(remoteCarts).flat().map(i => ({ ...i, isRemote: true }));
  const allItems = [...items, ...remoteItems];

  const count = allItems.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = allItems.reduce((sum, i) => {
    const modsPrice = (i.selectedModifiers || []).reduce((mSum, mod) => mSum + (mod.price_delta || 0), 0);
    return sum + (i.price + modsPrice) * i.qty;
  }, 0);
  // MF-09: GST rate configurable — read from the Restaurant via context or local session
  const gstRate = parseFloat(gstRateState || 0.05);
  const tax = +(subtotal * gstRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  return (
    <CartContext.Provider value={{
      items, remoteItems, allItems, count, subtotal, tax, total,
      tableId, tableNumber, restaurantId, restaurantSlug, tableSessionToken, tableSessionId,
      paymentEnabled, paymentProvider, currency, orderType,
      addItem, removeItem, updateQty, updateItemNote, clearCart, setSession, setOrderType
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
