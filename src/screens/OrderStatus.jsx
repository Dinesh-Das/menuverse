import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOrderStatus } from '../lib/api';
import { getSocket, joinOrderRoom } from '../lib/socket';
import { useTheme } from '../context/ThemeContext';

const STATUS_STEPS = ['pending', 'accepted', 'preparing', 'ready', 'served'];
const STATUS_LABELS = {
  pending:   'Order Received',
  accepted:  'Accepted',
  preparing: 'Preparing',
  ready:     'Ready for Pickup',
  served:    'Served',
  cancelled: 'Cancelled',
};
const STATUS_ICONS = {
  pending:   'receipt_long',
  accepted:  'check_circle',
  preparing: 'outdoor_grill',
  ready:     'lunch_dining',
  served:    'check_circle',
  cancelled: 'cancel',
};
const STATUS_MESSAGES = {
  pending:   'Your order has been received and is awaiting confirmation.',
  accepted:  'Great! The kitchen has accepted your order.',
  preparing: 'Our chefs are crafting your meal right now.',
  ready:     'Your food is ready! A waiter will bring it to your table shortly.',
  served:    'Enjoy your meal! Let us know if you need anything.',
  cancelled: 'This order was cancelled. Please contact your server.',
};

export default function OrderStatus() {
  const { orderId, restaurantSlug } = useParams();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(true); // Supabase Realtime is always connected
  const pollIntervalRef = useRef(null);

  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      const data = await fetchOrderStatus(orderId);
      setOrder(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // Supabase Realtime updates via socket.js
  useEffect(() => {
    if (!orderId) return;
    const socket = getSocket();
    joinOrderRoom(orderId);

    const handleStatusUpdate = ({ orderId: id, status }) => {
      if (id === orderId) {
        setOrder(prev => prev ? { ...prev, status } : prev);
        setSocketConnected(true);
      }
    };
    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => {
      setSocketConnected(false);
      // Start polling fallback every 30s
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(loadOrder, 30000);
      }
    };

    socket.on('order:status_update', handleStatusUpdate);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Supabase Realtime is always connected (no handshake delay like socket.io)
    setSocketConnected(socket.connected);

    return () => {
      socket.off('order:status_update', handleStatusUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [orderId, loadOrder]);

  const menuPath = restaurantSlug ? `/r/${restaurantSlug}/menu` : '/menu';

  if (loading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-dvh bg-background text-on-surface flex flex-col items-center justify-center p-6 gap-6">
        <span className="material-symbols-outlined text-error text-5xl">error</span>
        <h1 className="font-headline text-2xl font-bold">Order Not Found</h1>
        <button onClick={() => navigate(menuPath)} className="text-primary font-bold uppercase tracking-widest border-b border-primary/30 pb-1 cursor-pointer">
          Return to Menu
        </button>
      </div>
    );
  }

  const currentStepIdx = STATUS_STEPS.indexOf(order.status);
  const isCancelled = order.status === 'cancelled';

  return (
    <div className="min-h-dvh bg-background text-on-surface pb-16">
      {/* Header */}
      <header className="fixed top-0 w-full px-6 py-5 z-50 glass-nav-dark flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(menuPath)} className="material-symbols-outlined text-on-surface hover:text-primary transition-colors cursor-pointer">
            arrow_back
          </button>
          <h1 className="font-headline text-xl font-bold tracking-tight text-on-surface">Order Status</h1>
        </div>
        <div className="flex items-center gap-4">
          <button aria-label="Toggle Theme" onClick={toggleTheme} className="cursor-pointer flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant hover:text-amber-200 transition-colors duration-300">
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-green-400' : 'bg-yellow-400'} animate-pulse`} />
            <span className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
              {socketConnected ? 'Live' : 'Polling'}
            </span>
          </div>
        </div>
      </header>

      <main className="pt-28 px-6 max-w-lg mx-auto">
        {/* Order Ref */}
        <div className="text-center mb-10">
          <p className="text-[10px] uppercase font-bold tracking-[0.25em] text-primary mb-1">Order Reference</p>
          <h2 className="font-headline text-3xl font-bold text-on-surface tracking-tight">{order.id}</h2>
          <p className="text-on-surface-variant text-sm mt-2">
            {new Date(order.created_at + (order.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <button 
            onClick={() => navigate(restaurantSlug ? `/r/${restaurantSlug}/table` : '/order')}
            className="mt-4 text-primary font-bold text-[10px] uppercase tracking-widest border border-primary/20 rounded-full px-4 py-1 hover:bg-primary/5 transition-colors cursor-pointer"
          >
            View Cumulative Bill
          </button>
        </div>

        {/* Status Card */}
        <div className={`p-6 rounded-2xl border mb-8 ${isCancelled ? 'bg-error/10 border-error/30' : 'bg-surface-container-low border-outline-variant/10'}`}>
          <div className="flex items-center gap-4 mb-3">
            <span className={`material-symbols-outlined text-3xl ${isCancelled ? 'text-error' : 'text-primary'}`} style={{ fontVariationSettings: "'FILL' 1" }}>
              {STATUS_ICONS[order.status] || 'receipt_long'}
            </span>
            <div>
              <p className="font-headline text-xl font-bold text-on-surface">{STATUS_LABELS[order.status]}</p>
              <p className="text-on-surface-variant text-sm mt-0.5">{STATUS_MESSAGES[order.status]}</p>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        {!isCancelled && (
          <div className="mb-10">
            <div className="flex justify-between relative">
              <div className="absolute top-4 left-0 w-full h-0.5 bg-outline-variant/30" />
              <div
                className="absolute top-4 left-0 h-0.5 bg-primary transition-all duration-700"
                style={{ width: `${(currentStepIdx / (STATUS_STEPS.length - 1)) * 100}%` }}
              />
              {STATUS_STEPS.map((step, idx) => {
                const done = idx <= currentStepIdx;
                const active = idx === currentStepIdx;
                return (
                  <div key={step} className="relative z-10 flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 ${
                      done ? 'bg-primary' : 'bg-surface-container-high border border-outline-variant/30'
                    } ${active ? 'ring-4 ring-primary/20' : ''}`}>
                      {done ? (
                        <span className="material-symbols-outlined text-on-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-outline-variant" />
                      )}
                    </div>
                    <span className={`text-[9px] uppercase font-bold tracking-wider text-center max-w-[56px] leading-tight ${done ? 'text-primary' : 'text-on-surface-variant/40'}`}>
                      {STATUS_LABELS[step]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Order Items */}
        {order.items && order.items.length > 0 && (
          <div className="mb-8">
            <h3 className="text-[10px] uppercase font-bold tracking-[0.2em] text-on-surface-variant mb-4">Items Ordered</h3>
            <div className="space-y-3">
              {order.items.map((item, i) => {
                // LF-04: Include modifier price deltas in line-item total
                const mods = item.modifiers_json ? (() => { try { return JSON.parse(item.modifiers_json); } catch { return []; } })() : [];
                const modTotal = mods.reduce((s, m) => s + (m.price_delta || 0), 0);
                const lineTotal = (item.price + modTotal) * item.quantity;
                return (
                <div key={i} className="flex justify-between items-center py-3 border-b border-outline-variant/10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-surface-container border border-outline-variant/10 shrink-0">
                      {item.menu_item?.image_url ? (
                        <img src={item.menu_item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-primary/5">
                          <span className="material-symbols-outlined text-primary/40 text-sm">restaurant</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-on-surface text-sm font-bold">{item.name}</span>
                      {mods.length > 0 && (
                        <span className="text-on-surface-variant text-[10px] mt-0.5">{mods.map(m => m.name).join(', ')}</span>
                      )}
                      <span className="text-on-surface-variant text-[10px] uppercase tracking-widest font-medium">Qty: {item.quantity}</span>
                    </div>
                  </div>
                  <span className="text-primary font-bold text-sm">₹{lineTotal.toFixed(2)}</span>
                </div>
                );
              })}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-outline-variant/20">
              <span className="font-bold text-on-surface">Total Paid</span>
              <span className="font-headline text-2xl font-bold text-primary">₹{order.total_amount?.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Estimated time — status-based (LF-2) */}
        {['pending', 'accepted', 'preparing'].includes(order.status) && (
          <div className="text-center text-on-surface-variant text-sm mt-4">
            <span className="material-symbols-outlined text-sm align-middle mr-1">schedule</span>
            Estimated time: {
              order.status === 'pending' ? '~20-25 min' :
              order.status === 'accepted' ? '~15-20 min' :
              '~5-10 min'
            }
          </div>
        )}
        {order.status === 'ready' && (
          <div className="text-center text-primary text-sm font-bold mt-4">
            <span className="material-symbols-outlined text-sm align-middle mr-1">restaurant</span>
            Your food is ready! A waiter will bring it shortly.
          </div>
        )}

        {/* Order More CTA */}
        {(order.status === 'served' || order.status === 'completed') && (
          <button
            onClick={() => navigate(menuPath)}
            className="w-full bg-primary-container text-on-primary-container py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-transform active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined">restaurant_menu</span>
            Order More
          </button>
        )}
      </main>
    </div>
  );
}
