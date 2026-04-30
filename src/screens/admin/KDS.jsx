import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { adminFetchOrders, adminUpdateOrderStatus } from '../../lib/api';
import { getSocket, joinRestaurantRoom } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

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

  useEffect(() => {
    async function load() {
      try {
        const data = await adminFetchOrders();
        setOrders(data.filter(o => !['served', 'completed', 'cancelled'].includes(o.status)));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!user?.restaurantId) return;
    const socket = getSocket();
    joinRestaurantRoom(user.restaurantId);

    const handleNew = (order) => setOrders(prev => [order, ...prev]);
    const handleUpdated = (updated) => {
      if (['served', 'completed', 'cancelled'].includes(updated.status)) {
        setOrders(prev => prev.filter(o => o.id !== updated.id));
      } else {
        setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
      }
    };

    socket.on('order:new', handleNew);
    socket.on('order:updated', handleUpdated);
    return () => {
      socket.off('order:new', handleNew);
      socket.off('order:updated', handleUpdated);
    };
  }, [user]);

  // Tick every second for the elapsed timers
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleStatusUpdate = async (id, newStatus) => {
    const prev = orders.find(o => o.id === id);
    if (!prev) return;
    // Optimistic update
    setOrders(prevOrders => prevOrders.map(o => o.id === id ? { ...o, status: newStatus } : o));
    try {
      await adminUpdateOrderStatus(id, newStatus);
    } catch (err) {
      console.error('KDS status rollback:', err.message);
      // Rollback
      setOrders(prevOrders => prevOrders.map(o => o.id === id ? { ...o, status: prev.status } : o));
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
          <div className="flex items-center gap-8">
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

                    {/* Actions — includes Accept for pending, K3 fix */}
                    <div className="p-3 bg-surface-container-low rounded-b-xl border-t border-outline-variant/30 flex gap-2">
                      {actions.map(({ label, next, cls }) => (
                        <button
                          key={next}
                          onClick={() => handleStatusUpdate(order.id, next)}
                          className={`flex-1 rounded-lg kds-body-text font-bold uppercase tracking-wide transition-colors cursor-pointer ${cls}`}
                          style={{ minHeight: 'var(--tap-target)', fontSize: 'var(--font-kds-label)' }}
                        >
                          {label}
                        </button>
                      ))}
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
