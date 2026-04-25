import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

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

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadFromStorage);
  const [tableId, setTableId] = useState(localStorage.getItem('mv_table_id') || null);
  const [tableNumber, setTableNumber] = useState(localStorage.getItem('mv_table_num') || null);
  const [restaurantId, setRestaurantId] = useState(localStorage.getItem('mv_restaurant_id') || null);
  const [restaurantSlug, setRestaurantSlug] = useState(localStorage.getItem('mv_restaurant_slug') || null);

  // Persist cart to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

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
      const existing = prev.find(i => i.id === dish.id);
      if (existing) {
        return prev.map(i => i.id === dish.id ? { ...i, qty: i.qty + qty } : i);
      }
      return [...prev, { ...dish, qty, selectedModifiers }];
    });
  }, []);

  const removeItem = useCallback((dishId) => {
    setItems(prev => prev.filter(i => i.id !== dishId));
  }, []);

  const updateQty = useCallback((dishId, qty) => {
    if (qty <= 0) {
      setItems(prev => prev.filter(i => i.id !== dishId));
    } else {
      setItems(prev => prev.map(i => i.id === dishId ? { ...i, qty } : i));
    }
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const count = items.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = items.reduce((sum, i) => {
    const modsPrice = (i.selectedModifiers || []).reduce((mSum, mod) => mSum + (mod.price_delta || 0), 0);
    return sum + (i.price + modsPrice) * i.qty;
  }, 0);
  const tax = +(subtotal * 0.05).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  return (
    <CartContext.Provider value={{
      items, count, subtotal, tax, total,
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
