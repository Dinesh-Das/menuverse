import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import AdminLayout from '../../components/AdminLayout';
import { adminFetchOrders, adminUpdateOrderStatus } from '../../lib/api';
import { getSocket, joinRestaurantRoom } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { pendingOrdersBus } from '../../components/TopNav';
import { useToast } from '../../components/Toast';
import { canTransitionOrderStatus, safeParseModifiers } from '../../lib/businessRules';
import { requestKitchenPrint } from '../../lib/integrations';

const formatTime = (ms) => {
  const isNegative = ms < 0;
  const absS = Math.floor(Math.abs(ms) / 1000);
  const sign = isNegative ? '-' : '';
  return `${sign}${Math.floor(absS / 60)}:${String(absS % 60).padStart(2, '0')}`;
};

const KDS_SWIPE_HINT_KEY = 'mv_kds_swipe_hint_dismissed';
const ACTIVE_STATUSES = new Set(['pending', 'accepted', 'preparing', 'ready']);
const STATUS_PRIORITY = { pending: 1, accepted: 2, preparing: 3, ready: 4 };
const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'ready', label: 'Ready' },
];

function normalizeCreatedAt(value) {
  if (!value) return Date.now();
  const text = String(value);
  return new Date(text + (text.endsWith('Z') ? '' : 'Z')).getTime();
}

function formatOrderType(value) {
  return String(value || 'Order')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function getOrderItems(order) {
  return order.items || order.order_items || [];
}

function getOrderGroupKey(order) {
  if (order.table_id) return order.table_id;
  if (order.table_number) return `${order.order_type || 'order'}:${order.table_number}`;
  return order.order_type || 'order';
}

function groupOrdersByTable(orders) {
  const grouped = new Map();
  orders.forEach(order => {
    const key = getOrderGroupKey(order);
    const bucket = grouped.get(key) || [];
    bucket.push(order);
    grouped.set(key, bucket);
  });

  grouped.forEach(group => {
    group.sort((a, b) => normalizeCreatedAt(a.created_at) - normalizeCreatedAt(b.created_at));
  });

  return grouped;
}

function groupLabel(orders) {
  const first = orders[0] || {};
  if (first.table_id) {
    return {
      title: `T-${first.table?.number || first.table_number || String(first.table_id).slice(-4)}`,
      badge: 'Table',
    };
  }
  const type = formatOrderType(first.order_type || 'order');
  const suffix = first.table_number ? ` ${first.table_number}` : '';
  return { title: `${type}${suffix}`, badge: type };
}

function getGroupStatus(orders) {
  return orders.reduce((oldest, order) => {
    if (!oldest) return order.status;
    return (STATUS_PRIORITY[order.status] || 99) < (STATUS_PRIORITY[oldest] || 99) ? order.status : oldest;
  }, null) || 'pending';
}

function aggregateGroupItems(orders, now) {
  const itemsByMenuItem = new Map();

  orders.forEach(order => {
    const isNewOrder = now - normalizeCreatedAt(order.created_at) <= 90000;
    const shortId = String(order.id || '').slice(-6).toUpperCase();

    getOrderItems(order).forEach((item, index) => {
      const key = item.menu_item_id || item.id || `${item.name}-${index}`;
      const existing = itemsByMenuItem.get(key) || {
        key,
        name: item.name || item.menu_item?.name || 'Menu item',
        quantity: 0,
        sources: [],
        modifiers: [],
        isNew: false,
      };
      const modifiers = safeParseModifiers(item.modifiers_json);
      existing.quantity += Number(item.quantity || 1);
      existing.isNew = existing.isNew || isNewOrder;
      existing.sources.push({
        orderId: order.id,
        shortId,
        quantity: Number(item.quantity || 1),
        note: item.item_note || null,
        isNew: isNewOrder,
      });
      modifiers.forEach(mod => {
        const label = mod.name || mod;
        if (label && !existing.modifiers.includes(label)) existing.modifiers.push(label);
      });
      itemsByMenuItem.set(key, existing);
    });
  });

  return [...itemsByMenuItem.values()];
}

function buildTableTickets(groupedOrders, now) {
  return [...groupedOrders.entries()].map(([key, group]) => {
    const label = groupLabel(group);
    const createdAt = group[0]?.created_at;
    const status = getGroupStatus(group);
    return {
      key,
      orders: group,
      items: aggregateGroupItems(group, now),
      createdAt,
      createdAtMs: normalizeCreatedAt(createdAt),
      status,
      title: label.title,
      badge: label.badge,
    };
  }).sort((a, b) => {
    const statusDiff = (STATUS_PRIORITY[a.status] || 99) - (STATUS_PRIORITY[b.status] || 99);
    return statusDiff || a.createdAtMs - b.createdAtMs;
  });
}

function groupMatchesFilter(ticket, filter) {
  if (filter === 'all') return true;
  if (filter === 'preparing') {
    return ticket.orders.some(order => order.status === 'accepted' || order.status === 'preparing');
  }
  return ticket.orders.some(order => order.status === filter);
}

function statusClass(status, isUrgent) {
  if (isUrgent) return 'order-card-border-urgent';
  if (status === 'ready') return 'order-card-border-ready';
  if (status === 'preparing') return 'order-card-border-prep';
  return 'order-card-border-new';
}

function statusBadgeClass(status) {
  if (status === 'pending') return 'bg-secondary/20 text-secondary';
  if (status === 'ready') return 'bg-tertiary/20 text-tertiary';
  return 'bg-primary/20 text-primary';
}

function nextSequentialStatus(status, direction = 'right') {
  if (direction === 'left') {
    if (status === 'preparing') return 'ready';
    if (status === 'ready') return 'served';
  }
  const map = {
    pending: 'accepted',
    accepted: 'preparing',
    preparing: 'ready',
    ready: 'served',
  };
  return map[status] || null;
}

export default function KDS() {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [updatingIds, setUpdatingIds] = useState(new Set());
  const [activeFilter, setActiveFilter] = useState('all');
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [swipeHintDismissed, setSwipeHintDismissed] = useState(() => localStorage.getItem(KDS_SWIPE_HINT_KEY) === 'true');
  const audioRef = useRef(null);

  const groupedOrders = React.useMemo(() => groupOrdersByTable(orders), [orders]);
  const tableTickets = React.useMemo(() => buildTableTickets(groupedOrders, now), [groupedOrders, now]);
  const filteredTickets = React.useMemo(
    () => tableTickets.filter(ticket => groupMatchesFilter(ticket, activeFilter)),
    [tableTickets, activeFilter]
  );

  useEffect(() => {
    audioRef.current = new Audio('/sounds/new-order.mp3');
    audioRef.current.volume = 0.7;
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const playFallbackBeep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.warn('Audio alert unavailable:', e);
    }
  };

  const playAlert = useCallback(() => {
    if (muted) return;
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => playFallbackBeep());
    } else {
      playFallbackBeep();
    }
  }, [muted]);

  const syncPendingCount = useCallback((nextOrders) => {
    pendingOrdersBus.emit(nextOrders.filter(o => o.status === 'pending').length);
  }, []);

  useEffect(() => {
    if (!user?.restaurantId) return;
    async function load() {
      try {
        const { data } = await adminFetchOrders(null, user.restaurantId);
        const activeOrders = data.filter(o => ACTIVE_STATUSES.has(o.status));
        setOrders(activeOrders);
        syncPendingCount(activeOrders);
      } catch (err) {
        console.error(err);
        addToast(`Failed to load kitchen orders: ${err.message}`, 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user, addToast, syncPendingCount]);

  useEffect(() => {
    if (!user?.restaurantId) return;
    const socket = getSocket();
    joinRestaurantRoom(user.restaurantId);

    const handleNew = (order) => {
      if (!ACTIVE_STATUSES.has(order.status)) return;
      setOrders(prev => {
        const next = prev.some(o => o.id === order.id) ? prev : [order, ...prev];
        syncPendingCount(next);
        return next;
      });
      playAlert();
    };
    const handleUpdated = (updated) => {
      setOrders(prev => {
        const next = ACTIVE_STATUSES.has(updated.status)
          ? (prev.some(o => o.id === updated.id)
            ? prev.map(o => o.id === updated.id ? updated : o)
            : [updated, ...prev])
          : prev.filter(o => o.id !== updated.id);
        syncPendingCount(next);
        return next;
      });
    };
    const handleStaffRequest = (req) => {
      addToast(`Table ${req.table?.number || req.table_id.slice(-4)} is requesting assistance!`, 'success');
      playAlert();
    };

    socket.on('order:new', handleNew);
    socket.on('order:updated', handleUpdated);
    socket.on('staff_request:new', handleStaffRequest);

    return () => {
      socket.off('order:new', handleNew);
      socket.off('order:updated', handleUpdated);
      socket.off('staff_request:new', handleStaffRequest);
    };
  }, [user, playAlert, addToast, syncPendingCount]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const requestPrintForOrder = useCallback((order) => {
    requestKitchenPrint({
      restaurant_id: user.restaurantId,
      order_id: order.id,
      ticket: {
        order_ref: order.order_ref || order.id,
        table: order.table?.number || order.table_number || order.table_id?.slice(-4),
        special_instructions: order.special_instructions || null,
        created_at: order.created_at,
        items: getOrderItems(order).map(item => ({
          name: item.name,
          quantity: item.quantity,
          modifiers: safeParseModifiers(item.modifiers_json).map(mod => mod.name || mod),
          note: item.item_note || null,
        })),
      },
    }).then(result => {
      if (result?.status === 'pending_configuration') {
        addToast('KOT printer is not configured; ticket is queued for manual handling.', 'error');
      }
    }).catch(error => {
      console.warn('KOT print request skipped:', error.message);
    });
  }, [user?.restaurantId, addToast]);

  const updateManyOrders = useCallback(async (targetOrders, nextStatus) => {
    const eligible = targetOrders.filter(order => canTransitionOrderStatus(order.status, nextStatus));
    if (eligible.length === 0) {
      addToast(`No orders can move to ${nextStatus} yet.`, 'error');
      return;
    }

    const previousById = new Map(eligible.map(order => [order.id, order]));
    const eligibleIds = new Set(eligible.map(order => order.id));
    setUpdatingIds(s => {
      const next = new Set(s);
      eligibleIds.forEach(id => next.add(id));
      return next;
    });
    setOrders(prevOrders => prevOrders.map(order => eligibleIds.has(order.id) ? { ...order, status: nextStatus } : order));

    const results = await Promise.allSettled(
      eligible.map(order => adminUpdateOrderStatus(order.id, nextStatus, undefined, user.restaurantId))
    );

    const failedIds = eligible
      .filter((_, index) => results[index].status === 'rejected')
      .map(order => order.id);

    if (failedIds.length) {
      const failedSet = new Set(failedIds);
      setOrders(prevOrders => prevOrders.map(order => failedSet.has(order.id) ? previousById.get(order.id) : order));
      const reason = results.find(result => result.status === 'rejected')?.reason;
      addToast(`Failed to update ${failedIds.length} order${failedIds.length > 1 ? 's' : ''}: ${reason?.message || 'Unknown error'}`, 'error');
    } else if (nextStatus === 'accepted') {
      eligible.forEach(requestPrintForOrder);
    }

    setUpdatingIds(s => {
      const next = new Set(s);
      eligibleIds.forEach(id => next.delete(id));
      return next;
    });
  }, [addToast, requestPrintForOrder, user?.restaurantId]);

  const handleStatusUpdate = async (id, newStatus) => {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    await updateManyOrders([order], newStatus);
  };

  const handleReject = async (id) => {
    const prev = orders.find(o => o.id === id);
    if (!prev) return;
    setUpdatingIds(s => new Set(s).add(`reject-${id}`));
    try {
      await adminUpdateOrderStatus(id, 'cancelled', 'Item unavailable - rejected by kitchen', user.restaurantId);
      setOrders(prevOrders => {
        const next = prevOrders.filter(o => o.id !== id);
        syncPendingCount(next);
        return next;
      });
    } catch (err) {
      console.error('KDS reject failed:', err.message);
      addToast(`Failed to reject order: ${err.message}`, 'error');
    } finally {
      setUpdatingIds(s => { const next = new Set(s); next.delete(`reject-${id}`); return next; });
    }
  };

  const getActions = (status) => {
    const map = {
      pending: [{ label: 'Accept', next: 'accepted', cls: 'bg-secondary text-on-secondary' }],
      accepted: [{ label: 'Start Prep', next: 'preparing', cls: 'bg-primary text-on-primary' }],
      preparing: [{ label: 'Ready', next: 'ready', cls: 'bg-tertiary text-on-tertiary' }],
      ready: [{ label: 'Served', next: 'served', cls: 'bg-surface-container-highest text-on-surface' }],
    };
    return map[status] || [];
  };

  const getGroupButton = (ticket) => {
    const hasReady = ticket.orders.some(order => order.status === 'ready');
    const next = hasReady ? 'served' : 'ready';
    const eligible = ticket.orders.filter(order => canTransitionOrderStatus(order.status, next));
    return {
      label: hasReady ? 'Mark all served' : 'Mark all ready',
      next,
      eligibleCount: eligible.length,
    };
  };

  const dismissSwipeHint = useCallback(() => {
    if (swipeHintDismissed) return;
    localStorage.setItem(KDS_SWIPE_HINT_KEY, 'true');
    setSwipeHintDismissed(true);
  }, [swipeHintDismissed]);

  const handleGroupSwipe = (ticket, offsetX) => {
    dismissSwipeHint();
    if (Math.abs(offsetX) < 96) return;
    const direction = offsetX > 0 ? 'right' : 'left';
    const nextStatus = nextSequentialStatus(ticket.status, direction);
    if (nextStatus) updateManyOrders(ticket.orders, nextStatus);
  };

  const toggleGroupOrders = (groupKey) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  return (
    <AdminLayout>
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-surface text-on-surface transition-theme">
        <header className="flex justify-between items-center px-6 md:px-12 py-5 bg-surface-container-low border-b border-outline-variant/20 shrink-0 transition-theme">
          <div>
            <h1 className="font-headline font-bold text-on-surface tracking-tight flex items-center gap-4" style={{ fontSize: 'var(--text-3xl)' }}>
              Kitchen Display
              <span className="kds-label-text bg-primary/20 text-primary px-3 py-1 rounded-full border border-primary/30">Live</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 md:gap-8">
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
              <p className="kds-table-num text-on-surface">{tableTickets.length}</p>
            </div>
            <div className="text-right hidden md:block">
              <p className="kds-label-text text-on-surface-variant tracking-[0.2em] mb-1">Local Time</p>
              <p className="font-headline font-bold text-on-surface" style={{ fontSize: 'var(--text-xl)' }}>
                {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 md:p-8 bg-surface transition-theme">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="material-symbols-outlined animate-spin text-primary" style={{ fontSize: '48px' }}>progress_activity</span>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-50">
              <span className="material-symbols-outlined mb-4" style={{ fontSize: '64px' }}>outdoor_grill</span>
              <p className="font-headline font-bold" style={{ fontSize: 'var(--text-2xl)' }}>No active orders</p>
              <p className="kds-body-text text-on-surface-variant mt-2">Waiting for incoming tickets...</p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {FILTER_TABS.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveFilter(tab.id)}
                    className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-widest border transition-colors ${
                      activeFilter === tab.id
                        ? 'bg-primary text-on-primary border-primary'
                        : 'bg-surface-container border-outline-variant/20 text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {isMobile && !swipeHintDismissed && (
                <div className="md:hidden mb-4 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-primary flex items-center justify-between gap-3">
                  <span className="material-symbols-outlined">keyboard_double_arrow_right</span>
                  <p className="text-xs font-bold uppercase tracking-widest text-center leading-relaxed">
                    Swipe right to advance. Swipe left to mark ready or served.
                  </p>
                  <span className="material-symbols-outlined">keyboard_double_arrow_left</span>
                </div>
              )}

              {filteredTickets.length === 0 ? (
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-8 text-center text-on-surface-variant">
                  No tickets match this filter.
                </div>
              ) : (
                <div className="kds-grid">
                  {filteredTickets.map(ticket => {
                    const targetTime = ticket.createdAtMs + (30 * 60 * 1000);
                    const remainingMs = targetTime - now;
                    const isUrgent = remainingMs < 600000;
                    const groupButton = getGroupButton(ticket);
                    const isGroupUpdating = ticket.orders.some(order => updatingIds.has(order.id));
                    const isExpanded = expandedGroups.has(ticket.key);

                    return (
                      <motion.div
                        key={ticket.key}
                        drag={isMobile ? 'x' : false}
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.18}
                        onDragEnd={(_, info) => handleGroupSwipe(ticket, info.offset.x)}
                        whileDrag={isMobile ? { scale: 1.02 } : undefined}
                        className={`bg-surface-container rounded-xl flex flex-col shadow-luxury border ${statusClass(ticket.status, isUrgent)}`}
                      >
                        <div className="p-5 flex justify-between items-start border-b border-outline-variant/30">
                          <div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <h3 className="kds-table-num text-on-surface">{ticket.title}</h3>
                              <span className="kds-label-text px-2 py-1 rounded bg-surface-container-highest text-on-surface-variant border border-outline-variant/20">
                                {ticket.badge}
                              </span>
                            </div>
                            <p className="kds-label-text text-on-surface-variant mt-1">
                              {ticket.orders.length} order{ticket.orders.length > 1 ? 's' : ''} - oldest #{String(ticket.orders[0]?.id || '').slice(-6).toUpperCase()}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className={`font-headline font-bold mb-1 ${isUrgent ? 'text-error animate-pulse' : 'text-primary'}`}
                              style={{ fontSize: 'var(--font-kds-table)' }}>
                              {formatTime(remainingMs)}
                            </div>
                            <span className={`kds-label-text px-2 py-1 rounded ${statusBadgeClass(ticket.status)}`}>
                              {ticket.status}
                            </span>
                          </div>
                        </div>

                        <div className="p-5 flex-1 space-y-4">
                          {ticket.items.map(item => (
                            <div key={item.key} className="flex gap-4 items-start">
                              <div className="kds-table-num w-12 h-12 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface shrink-0"
                                style={{ fontSize: 'var(--font-kds-body)', fontWeight: 800 }}>
                                {item.quantity}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="kds-body-text font-bold text-on-surface leading-tight">{item.name}</p>
                                  {item.isNew && (
                                    <span className="kds-label-text rounded-full bg-secondary/20 text-secondary px-2 py-0.5">New item</span>
                                  )}
                                </div>
                                {item.modifiers.length > 0 && (
                                  <ul className="space-y-1 mt-2">
                                    {item.modifiers.map((modifier, i) => (
                                      <li key={i} className="kds-body-text text-error font-medium flex items-start gap-2">
                                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-error shrink-0" />
                                        {modifier}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.sources.map(source => (
                                    <span
                                      key={`${source.orderId}-${source.shortId}-${source.quantity}-${source.note || ''}`}
                                      className="rounded-full bg-surface-container-low border border-outline-variant/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant"
                                    >
                                      #{source.shortId} x{source.quantity}{source.note ? ` - ${source.note}` : ''}{source.isNew ? ' - new' : ''}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}

                          {ticket.orders.some(order => order.special_instructions) && (
                            <div className="mt-4 p-3 bg-error/10 rounded-lg border border-error/30">
                              <strong className="kds-label-text text-error block mb-1">SPECIAL NOTES:</strong>
                              <div className="space-y-1">
                                {ticket.orders.filter(order => order.special_instructions).map(order => (
                                  <p key={order.id} className="kds-body-text text-error font-bold">
                                    #{String(order.id).slice(-6).toUpperCase()}: {order.special_instructions}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => toggleGroupOrders(ticket.key)}
                              className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant hover:text-on-surface flex items-center justify-between"
                            >
                              <span>Orders</span>
                              <span className="material-symbols-outlined text-base">{isExpanded ? 'expand_less' : 'expand_more'}</span>
                            </button>
                            {isExpanded && (
                              <div className="mt-3 space-y-3">
                                {ticket.orders.map(order => (
                                  <div key={order.id} className="rounded-lg bg-surface-container-low border border-outline-variant/10 p-3">
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                      <div>
                                        <p className="text-xs font-bold text-on-surface">#{String(order.id).slice(-6).toUpperCase()}</p>
                                        <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">
                                          {new Date(normalizeCreatedAt(order.created_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                      </div>
                                      <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded ${statusBadgeClass(order.status)}`}>
                                        {order.status}
                                      </span>
                                    </div>
                                    <div className="space-y-1 mb-3">
                                      {getOrderItems(order).map((orderItem, idx) => (
                                        <p key={`${order.id}-${idx}`} className="text-xs text-on-surface-variant">
                                          <span className="font-bold text-on-surface">{orderItem.quantity}x</span> {orderItem.name}
                                          {orderItem.item_note ? <span className="text-primary"> - {orderItem.item_note}</span> : null}
                                        </p>
                                      ))}
                                    </div>
                                    <div className="flex gap-2">
                                      {getActions(order.status).map(({ label, next, cls }) => (
                                        <button
                                          key={next}
                                          onClick={() => handleStatusUpdate(order.id, next)}
                                          disabled={updatingIds.has(order.id)}
                                          className={`flex-1 rounded-lg py-2 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}
                                        >
                                          {updatingIds.has(order.id) ? (
                                            <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                                          ) : label}
                                        </button>
                                      ))}
                                      {order.status === 'pending' && (
                                        <button
                                          onClick={() => handleReject(order.id)}
                                          disabled={updatingIds.has(`reject-${order.id}`)}
                                          className="px-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-error/10 text-error border border-error/30 hover:bg-error/20"
                                          title="Reject this order"
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
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="p-3 bg-surface-container-low rounded-b-xl border-t border-outline-variant/30">
                          <button
                            onClick={() => updateManyOrders(ticket.orders, groupButton.next)}
                            disabled={isGroupUpdating || groupButton.eligibleCount === 0}
                            className="w-full rounded-lg kds-body-text font-bold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-on-primary"
                            style={{ minHeight: 'var(--tap-target)', fontSize: 'var(--font-kds-label)' }}
                          >
                            {isGroupUpdating ? (
                              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                            ) : (
                              `${groupButton.label}${groupButton.eligibleCount ? ` (${groupButton.eligibleCount})` : ''}`
                            )}
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </AdminLayout>
  );
}
