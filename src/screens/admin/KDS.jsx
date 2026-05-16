import React, { useState, useEffect, useRef, useCallback } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { adminFetchOrders, adminUpdateOrderStatus } from '../../lib/api';
import { getSocket, joinRestaurantRoom } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { pendingOrdersBus } from '../../components/TopNav';

const formatTime = (ms) => {
  const isNegative = ms < 0;
  const absS = Math.floor(Math.abs(ms) / 1000);
  const sign = isNegative ? '-' : '';
  return `${sign}${Math.floor(absS / 60)}:${String(absS % 60).padStart(2, '0')}`;
};

export default function KDS() {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [orders, setOrders] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [updatingIds, setUpdatingIds] = useState(new Set());
  const audioRef = useRef(null);

  // MF-3: Initialize audio for new order alerts
  useEffect(() => {
    audioRef.current = new Audio('/sounds/new-order.mp3');
    audioRef.current.volume = 0.7;
  }, []);

  const playAlert = useCallback(() => {
    if (!muted && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {}); // Ignore autoplay errors
    }
  }, [muted]);

  useEffect(() => {
    if (!user?.restaurantId) return;
    async function load() {
      try {
        const data = await adminFetchOrders(null, user.restaurantId);
        setOrders(data.filter(o => !['served', 'completed', 'cancelled'].includes(o.status)));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  useEffect(() => {
    if (!user?.restaurantId) return;
    const socket = getSocket();
    joinRestaurantRoom(user.restaurantId);

    const handleNew = (order) => {
      setOrders(prev => {
        const next = [order, ...prev];
        // A17: emit pending count to notification bell
        pendingOrdersBus.emit(next.filter(o => o.status === 'pending').length);
        return next;
      });
      playAlert();
    };
    const handleUpdated = (updated) => {
      if (['served', 'completed', 'cancelled'].includes(updated.status)) {
        setOrders(prev => {
          const next = prev.filter(o => o.id !== updated.id);
          pendingOrdersBus.emit(next.filter(o => o.status === 'pending').length);
          return next;
        });
      } else {
        setOrders(prev => {
          const next = prev.map(o => o.id === updated.id ? updated : o);
          pendingOrdersBus.emit(next.filter(o => o.status === 'pending').length);
          return next;
        });
      }
    };

    socket.on('order:new', handleNew);
    socket.on('order:updated', handleUpdated);
    return () => {
      socket.off('order:new', handleNew);
      socket.off('order:updated', handleUpdated);
    };
  }, [user, playAlert]);

  // Tick every second for the elapsed timers
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleStatusUpdate = async (id, newStatus) => {
    const prev = orders.find(o => o.id === id);
    if (!prev) return;
    // AQ-6: Disable button during async operation
    setUpdatingIds(s => new Set(s).add(id));
    // Optimistic update
    setOrders(prevOrders => prevOrders.map(o => o.id === id ? { ...o, status: newStatus } : o));
    try {
      await adminUpdateOrderStatus(id, newStatus);
    } catch (err) {
      console.error('KDS status rollback:', err.message);
      // Rollback
      setOrders(prevOrders => prevOrders.map(o => o.id === id ? { ...o, status: prev.status } : o));
    } finally {
      setUpdatingIds(s => { const next = new Set(s); next.delete(id); return next; });
    }
  };

  const handleReject = async (id) => {
    const prev = orders.find(o => o.id === id);
    if (!prev) return;
    setUpdatingIds(s => new Set(s).add(`reject-${id}`));
    try {
      // LF-12: Allow kitchen to reject/cancel unavailable or invalid orders
      await adminUpdateOrderStatus(id, 'cancelled');
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch (err) {
      console.error('KDS reject failed:', err.message);
    } finally {
      setUpdatingIds(s => { const next = new Set(s); next.delete(`reject-${id}`); return next; });
    }
  };

  // KDS action buttons per status — includes Accept for pending orders
  const getActions = (status) => {
    const map = {
      pending:   [{ label: 'Accept',     next: 'accepted',  cls: 'bg-secondary text-on-secondary' }],
      accepted:  [{ label: 'Start Prep', next: 'preparing', cls: 'bg-primary text-on-primary' }],
      preparing: [{ label: 'Ready',      next: 'ready',     cls: 'bg-tertiary text-on-tertiary' }],
      ready:     [{ label: 'Served',     next: 'served',    cls: 'bg-surface-container-highest text-on-surface' }],
    };
    return map[status] || [];
  };

  return (
    <AdminLayout>
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-surface text-on-surface transition-theme">
        {/* Header */}
        <header className="flex justify-between items-center px-6 md:px-12 py-5 bg-surface-container-low border-b border-outline-variant/20 shrink-0 transition-theme">
          <div>
            <h1 className="font-headline font-bold text-on-surface tracking-tight flex items-center gap-4" style={{ fontSize: 'var(--text-3xl)' }}>
              Kitchen Display
              <span className="kds-label-text bg-primary/20 text-primary px-3 py-1 rounded-full border border-primary/30">Live</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 md:gap-8">
            {/* MF-3: Audio mute/unmute toggle */}
            <button 
              aria-label={muted ? 'Unmute Alerts' : 'Mute Alerts'} 
              onClick={() => setMuted(m => !m)} 
              className={`cursor-pointer flex items-center justify-center h-10 w-10 rounded-full border transition-colors ${
                muted 
                  ? 'border-error/30 bg-error/10 hover:bg-error/20' 
                  : 'border-outline-variant/30 hover:bg-surface-container'
              }`}
            >
              <span className={`material-symbols-outlined ${muted ? 'text-error' : 'text-on-surface-variant'}`}>
                {muted ? 'volume_off' : 'volume_up'}
              </span>
            </button>
            <button aria-label="Toggle Theme" onClick={toggleTheme} className="cursor-pointer flex items-center justify-center h-10 w-10 rounded-full border border-outline-variant/30 hover:bg-surface-container transition-colors">
              <span className="material-symbols-outlined text-on-surface-variant">
                {isDark ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
            <div className="text-right">
              <p className="kds-label-text text-primary tracking-[0.2em] mb-1">Active Tickets</p>
              <p className="kds-table-num text-on-surface">{orders.length}</p>
            </div>
            <div className="text-right hidden md:block">
              <p className="kds-label-text text-on-surface-variant tracking-[0.2em] mb-1">Local Time</p>
              {/* K4: Use `now` state so the clock ticks every second */}
              <p className="font-headline font-bold text-on-surface" style={{ fontSize: 'var(--text-xl)' }}>
                {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 overflow-auto p-4 md:p-8 bg-surface transition-theme">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="material-symbols-outlined animate-spin text-primary" style={{ fontSize: '48px' }}>progress_activity</span>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-50">
              <span className="material-symbols-outlined mb-4" style={{ fontSize: '64px' }}>outdoor_grill</span>
              <p className="font-headline font-bold" style={{ fontSize: 'var(--text-2xl)' }}>No active orders</p>
              <p className="kds-body-text text-on-surface-variant mt-2">Waiting for incoming tickets…</p>
            </div>
          ) : (
            <div className="kds-grid">
              {orders.map(order => {
                const targetTime = new Date(order.created_at + (order.created_at.endsWith('Z') ? '' : 'Z')).getTime() + (30 * 60 * 1000);
                const remainingMs = targetTime - now;
                const isUrgent = remainingMs < 600000; // Less than 10 mins remaining
                let borderClass = 'order-card-border-new';
                if (order.status === 'accepted')  borderClass = 'order-card-border-new';
                if (order.status === 'preparing') borderClass = 'order-card-border-prep';
                if (order.status === 'ready')     borderClass = 'order-card-border-ready';
                if (isUrgent)                     borderClass = 'order-card-border-urgent';

                const actions = getActions(order.status);

                return (
                  <div key={order.id} className={`bg-surface-container rounded-xl flex flex-col shadow-luxury border ${borderClass}`}>
                    {/* Card Header */}
                    <div className="p-5 flex justify-between items-start border-b border-outline-variant/30">
                      <div>
                        <h3 className="kds-table-num text-on-surface">T-{order.table?.number || order.table_id?.slice(-4)}</h3>
                        <p className="kds-label-text text-on-surface-variant mt-1">{order.order_ref || order.id.slice(0, 8)}</p>
                      </div>
                      <div className="text-right">
                        <div className={`font-headline font-bold mb-1 ${isUrgent ? 'text-error animate-pulse' : 'text-primary'}`}
                          style={{ fontSize: 'var(--font-kds-table)' }}>
                          {formatTime(remainingMs)}
                        </div>
                        <span className={`kds-label-text px-2 py-1 rounded ${
                          order.status === 'pending'   ? 'bg-secondary/20 text-secondary' :
                          order.status === 'accepted'  ? 'bg-primary/20 text-primary' :
                          order.status === 'preparing' ? 'bg-primary/20 text-primary' :
                          'bg-tertiary/20 text-tertiary'
                        }`}>
                          {order.status}
                        </span>
                      </div>
                    </div>

                    {/* Items */}
                    <div className="p-5 flex-1 space-y-4">
                      {order.items?.map((item, idx) => {
                        const mods = item.modifiers_json ? JSON.parse(item.modifiers_json) : [];
                        return (
                          <div key={idx} className="flex gap-4 items-start">
                            <div className="kds-table-num w-12 h-12 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface shrink-0"
                              style={{ fontSize: 'var(--font-kds-body)', fontWeight: 800 }}>
                              {item.quantity}
                            </div>
                            <div>
                              <p className="kds-body-text font-bold text-on-surface leading-tight">{item.name}</p>
                              {mods.length > 0 && (
                                <ul className="space-y-1 mt-2">
                                  {mods.map((mod, i) => (
                                    <li key={i} className="kds-body-text text-error font-medium flex items-start gap-2">
                                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-error shrink-0" />
                                      {mod.name || mod}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {order.special_instructions && (
                        <div className="mt-4 p-3 bg-surface-container-high rounded-lg border border-outline-variant/20">
                          <strong className="kds-label-text text-on-surface-variant block mb-1">Note:</strong>
                          <span className="kds-body-text text-on-surface">{order.special_instructions}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions — includes Accept + Reject for pending, K3 fix */}
                    <div className="p-3 bg-surface-container-low rounded-b-xl border-t border-outline-variant/30 flex gap-2">
                      {actions.map(({ label, next, cls }) => {
                        const isUpdating = updatingIds.has(order.id);
                        return (
                          <button
                            key={next}
                            onClick={() => handleStatusUpdate(order.id, next)}
                            disabled={isUpdating}
                            className={`flex-1 rounded-lg kds-body-text font-bold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}
                            style={{ minHeight: 'var(--tap-target)', fontSize: 'var(--font-kds-label)' }}
                          >
                            {isUpdating ? (
                              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                            ) : label}
                          </button>
                        );
                      })}
                      {/* LF-12: Reject button only for pending orders */}
                      {order.status === 'pending' && (
                        <button
                          onClick={() => handleReject(order.id)}
                          disabled={updatingIds.has(`reject-${order.id}`)}
                          className="px-3 rounded-lg kds-body-text font-bold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-error/10 text-error border border-error/30 hover:bg-error/20"
                          title="Reject — cancel this order (e.g. item unavailable)"
                          style={{ minHeight: 'var(--tap-target)', fontSize: 'var(--font-kds-label)' }}
                        >
                          {updatingIds.has(`reject-${order.id}`) ? (
                            <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                          ) : (
                            <span className="material-symbols-outlined text-sm">close</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </AdminLayout>
  );
}
