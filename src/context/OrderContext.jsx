import React, { createContext, useContext, useState, useCallback } from 'react';

const OrderContext = createContext(null);

export function OrderProvider({ children }) {
  const [activeOrder, setActiveOrder] = useState(null);
  const [orderStatus, setOrderStatus] = useState('RECEIVED');

  const placeOrder = useCallback((cartItems, paymentMethod, instructions) => {
    const orderId = `GT-${Math.floor(8000 + Math.random() * 1000)}`;
    const order = {
      id: orderId,
      items: cartItems,
      paymentMethod,
      instructions,
      status: 'RECEIVED',
      placedAt: new Date(),
      estimatedMinutes: 12,
      tableId: localStorage.getItem('mv_table') || '14',
      restaurantName: 'The Grand Brasserie',
    };
    setActiveOrder(order);
    setOrderStatus('RECEIVED');
    return orderId;
  }, []);

  const advanceStatus = useCallback(() => {
    const states = ['RECEIVED', 'PREPARING', 'READY', 'SERVED'];
    setOrderStatus(prev => {
      const idx = states.indexOf(prev);
      return idx < states.length - 1 ? states[idx + 1] : prev;
    });
  }, []);

  return (
    <OrderContext.Provider value={{ activeOrder, orderStatus, placeOrder, advanceStatus }}>
      {children}
    </OrderContext.Provider>
  );
}

export function useOrder() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error('useOrder must be used inside OrderProvider');
  return ctx;
}
