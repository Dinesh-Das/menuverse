import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const CartContext = createContext(null);
const STORAGE_KEY = 'mv_cart';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const MAX_ITEM_QTY = 20;

function makeCartKey(dishId, modifiers = []) {
  const modKey = modifiers.length > 0
    ? JSON.stringify(modifiers.map(m => m.id || m.name).sort())
    : '';
  return `${dishId}::${modKey}`;
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadFromStorage);
  const [remoteCarts, setRemoteCarts] = useState({});
  const [tableId, setTableId] = useState(localStorage.getItem('mv_table_id') || null);
  const [tableNumber, setTableNumber] = useState(localStorage.getItem('mv_table_num') || null);
  const [restaurantId, setRestaurantId] = useState(localStorage.getItem('mv_restaurant_id') || null);
  const [restaurantSlug, setRestaurantSlug] = useState(localStorage.getItem('mv_restaurant_slug') || null);

  const deviceIdRef = useRef(localStorage.getItem('mv_device_id') || crypto.randomUUID());
  const channelRef = useRef(null);

  // Persist cart and device id
  useEffect(() => {
    localStorage.setItem('mv_device_id', deviceIdRef.current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

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
          payload: { deviceId: deviceIdRef.current, items }
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
            payload: { deviceId: deviceIdRef.current, items }
          });
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tableId, items]);

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
  }, []);

  const addItem = useCallback((dish, qty = 1, selectedModifiers = []) => {
    setItems(prev => {
      const cartKey = makeCartKey(dish.id, selectedModifiers);
      const existing = prev.find(i => i._cartKey === cartKey);
      if (existing) {
        return prev.map(i => i._cartKey === cartKey ? { ...i, qty: Math.min(MAX_ITEM_QTY, i.qty + qty) } : i);
      }
      return [...prev, { ...dish, qty: Math.min(MAX_ITEM_QTY, qty), selectedModifiers, _cartKey: cartKey }];
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
  const tax = +(subtotal * 0.05).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  return (
    <CartContext.Provider value={{
      items, remoteItems, allItems, count, subtotal, tax, total,
      tableId, tableNumber, restaurantId, restaurantSlug,
      addItem, removeItem, updateQty, clearCart, setSession
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
