import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const CartContext = createContext(null);
const STORAGE_KEY = 'mv_cart';
const TABLE_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const MAX_ITEM_QTY = 20;

function makeCartKey(dishId, modifiers = [], notes = '') {
  const modKey = modifiers.length > 0
    ? JSON.stringify(modifiers.map(m => m.id || m.name).sort())
    : '';
  const noteKey = notes.trim().toLowerCase();
  return `${dishId}::${modKey}::${noteKey}`;
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadFromStorage);
  const [remoteCarts, setRemoteCarts] = useState({});
  const [tableId, setTableId] = useState(localStorage.getItem('mv_table_id') || null);
  const [tableNumber, setTableNumber] = useState(localStorage.getItem('mv_table_num') || null);
  const [restaurantId, setRestaurantId] = useState(localStorage.getItem('mv_restaurant_id') || null);
  const [restaurantSlug, setRestaurantSlug] = useState(localStorage.getItem('mv_restaurant_slug') || null);
  const [tableSessionToken, setTableSessionToken] = useState(localStorage.getItem('mv_table_session_token') || null);
  const [tableSessionId, setTableSessionId] = useState(localStorage.getItem('mv_table_session_id') || null);
  const [gstRateState, setGstRateState] = useState(localStorage.getItem('mv_gst_rate') || '0.05');
  const [paymentEnabled, setPaymentEnabled] = useState(localStorage.getItem('mv_payment_enabled') === 'true');
  const [paymentProvider, setPaymentProvider] = useState(localStorage.getItem('mv_payment_provider') || 'razorpay');

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
        channel.send({
          type: 'broadcast',
          event: 'cart_sync',
          payload: { deviceId: deviceIdRef.current, items: itemsRef.current }
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Ask for others' carts
          channel.send({ type: 'broadcast', event: 'request_sync' });
          // Send our cart initially
          channel.send({
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
    channelRef.current.send({
      type: 'broadcast',
      event: 'cart_sync',
      payload: { deviceId: deviceIdRef.current, items }
    });
  }, [items, tableId]);

  const setSession = useCallback((sessionData) => {
    const { tableId: tid, tableNumber: tnum, restaurantId: rid, restaurantSlug: slug } = sessionData;
    
    if (tid !== undefined) {
      setTableId(tid);
      if (tid) localStorage.setItem('mv_table_id', tid);
      else localStorage.removeItem('mv_table_id');
    }
    if (tnum !== undefined) {
      setTableNumber(tnum);
      if (tnum) localStorage.setItem('mv_table_num', tnum);
      else localStorage.removeItem('mv_table_num');
    }
    if (rid !== undefined) {
      setRestaurantId(rid);
      if (rid) localStorage.setItem('mv_restaurant_id', rid);
      else localStorage.removeItem('mv_restaurant_id');
    }
    if (slug !== undefined) {
      setRestaurantSlug(slug);
      if (slug) localStorage.setItem('mv_restaurant_slug', slug);
      else localStorage.removeItem('mv_restaurant_slug');
    }
    if (sessionData.tableSessionToken !== undefined) {
      setTableSessionToken(sessionData.tableSessionToken);
      if (sessionData.tableSessionToken) {
        localStorage.setItem('mv_table_session_token', sessionData.tableSessionToken);
        localStorage.setItem('mv_table_session_expires', String(Date.now() + TABLE_SESSION_TTL_MS));
      } else {
        localStorage.removeItem('mv_table_session_token');
        localStorage.removeItem('mv_table_session_expires');
      }
    }
    if (sessionData.tableSessionId !== undefined) {
      setTableSessionId(sessionData.tableSessionId);
      if (sessionData.tableSessionId) localStorage.setItem('mv_table_session_id', sessionData.tableSessionId);
      else localStorage.removeItem('mv_table_session_id');
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
  }, []);

  const addItem = useCallback((dish, qty = 1, selectedModifiers = [], notes = '') => {
    setItems(prev => {
      const normalizedNotes = String(notes || '').trim().slice(0, 200);
      const cartKey = makeCartKey(dish.id, selectedModifiers, normalizedNotes);
      const existing = prev.find(i => i._cartKey === cartKey);
      if (existing) {
        return prev.map(i => i._cartKey === cartKey ? { ...i, qty: Math.min(MAX_ITEM_QTY, i.qty + qty) } : i);
      }
      return [...prev, { ...dish, qty: Math.min(MAX_ITEM_QTY, qty), selectedModifiers, notes: normalizedNotes, _cartKey: cartKey }];
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

  const updateItemNote = useCallback((cartKey, notes) => {
    const normalizedNotes = String(notes || '').slice(0, 200);
    setItems(prev => prev.map(i => i._cartKey === cartKey ? { ...i, notes: normalizedNotes } : i));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
    if (channelRef.current) {
      channelRef.current.send({
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
      paymentEnabled, paymentProvider,
      addItem, removeItem, updateQty, updateItemNote, clearCart, setSession
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
