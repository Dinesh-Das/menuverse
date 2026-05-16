import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { adminFetchOrders, adminUpdateOrderStatus } from '../../lib/api';
import { getSocket, joinRestaurantRoom } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import CancelReasonModal from '../../components/CancelReasonModal';
import { useToast } from '../../components/Toast';

const VALID_TRANSITIONS = {
  pending:   ['accepted', 'cancelled'],
  accepted:  ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready:     ['served'],
  served:    ['completed'],
  completed: [],
  cancelled: [],
};

const STATUS_COLORS = {
  pending:   'bg-secondary/10 text-secondary border border-secondary/20',
  accepted:  'bg-primary/10 text-primary border border-primary/20',
  preparing: 'bg-primary/10 text-primary border border-primary/20',
  ready:     'bg-tertiary/10 text-tertiary border border-tertiary/20',
  served:    'bg-green-600/10 text-green-600 dark:text-green-400 border border-green-600/20',
  completed: 'bg-green-600/10 text-green-600 dark:text-green-400 border border-green-600/20',
  cancelled: 'bg-error/10 text-error border border-error/20',
};

const STATUS_BUTTON_LABELS = {
  accepted:  'Accept',
  preparing: 'Start Prep',
  ready:     'Mark Ready',
  served:    'Mark Served',
  completed: 'Complete',
  cancelled: 'Cancel',
};

export default function OrderMonitor() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active');
  const [updatingIds, setUpdatingIds] = useState(new Set());
  const [cancelModal, setCancelModal] = useState({ isOpen: false, orderId: null });
  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] transition-theme';

  useEffect(() => {
    if (!user?.restaurantId) return;
    adminFetchOrders(null, user.restaurantId)
      .then(res => { setOrders(res.data); setLoading(false); })
      .catch(err => {
        console.error(err);
        addToast(`Failed to load orders: ${err.message}`, 'error');
        setLoading(false);
      });
  }, [user, addToast]);

  useEffect(() => {
    if (!user?.restaurantId) return;
    const socket = getSocket();
    joinRestaurantRoom(user.restaurantId);
    const handleNew = (order) => setOrders(prev => [order, ...prev]);
    const handleUpdated = (updated) => setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
    socket.on('order:new', handleNew);
    socket.on('order:updated', handleUpdated);
    return () => {
      socket.off('order:new', handleNew);
      socket.off('order:updated', handleUpdated);
    };
  }, [user]);

  const handleStatusChange = async (orderId, newStatus, cancelReason) => {
    // CB-8: If cancelling, open the modal to collect reason
    if (newStatus === 'cancelled' && !cancelReason) {
      setCancelModal({ isOpen: true, orderId });
      return;
    }

    const prev = orders.find(o => o.id === orderId);
    if (!prev) return;

    // AQ-6: Disable button during async operation
    setUpdatingIds(s => new Set(s).add(orderId));
    setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    
    try {
      await adminUpdateOrderStatus(orderId, newStatus, cancelReason || undefined, user.restaurantId);
    } catch (err) {
      console.error('Rollback:', err.message);
      addToast(`Failed to update order: ${err.message}`, 'error');
      setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? { ...o, status: prev.status } : o));
    } finally {
      setUpdatingIds(s => { const next = new Set(s); next.delete(orderId); return next; });
    }
  };

  const handleCancelConfirm = (reason) => {
    const { orderId } = cancelModal;
    setCancelModal({ isOpen: false, orderId: null });
    handleStatusChange(orderId, 'cancelled', reason);
  };

  const handleCancelDismiss = () => {
    setCancelModal({ isOpen: false, orderId: null });
  };

  const filtered = filter === 'active'
    ? orders.filter(o => !['completed', 'cancelled'].includes(o.status))
    : filter === 'completed'
    ? orders.filter(o => o.status === 'completed')
    : orders.filter(o => o.status === 'cancelled');

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav title="Live Orders" subtitle="Monitor and advance the status of all active tickets." />

        <div className="flex gap-2 mb-8">
          {['active', 'completed', 'cancelled'].map(tab => (
            <button key={tab} onClick={() => setFilter(tab)}
              className={`px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all cursor-pointer ${
                filter === tab ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}>
              {tab}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant/40">
            <span className="material-symbols-outlined text-6xl mb-4">inbox</span>
            <p className="font-headline font-bold text-xl">No {filter} orders</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(order => {
              const validNext = VALID_TRANSITIONS[order.status] || [];
              const isUpdating = updatingIds.has(order.id);
              return (
                <div key={order.id} className={`p-6 md:p-8 ${cardBg}`}>
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-headline text-xl font-bold text-on-surface">{order.id}</h3>
                      <p className="text-[10px] uppercase tracking-widest mt-1 text-on-surface-variant">
                        Table {order.table?.number || order.table_id?.slice(-4)} &nbsp;·&nbsp;
                        {new Date(order.created_at + (order.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-widest ${STATUS_COLORS[order.status] || ''}`}>
                      {order.status}
                    </span>
                  </div>

                  <div className="space-y-2 mb-5 pl-2 border-l-2 border-outline-variant/20">
                    {order.items?.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-on-surface font-medium">
                          <span className="text-primary font-bold mr-2">×{item.quantity}</span>{item.name}
                        </span>
                        <span className="text-primary font-bold">₹{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  {order.special_instructions && (
                    <p className="text-xs text-on-surface-variant bg-surface-container rounded-lg px-3 py-2 mb-5 italic">
                      "{order.special_instructions}"
                    </p>
                  )}

                  {order.cancel_reason && (
                    <p className="text-xs text-error bg-error/10 rounded-lg px-3 py-2 mb-5 flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm">info</span>
                      Cancelled: {order.cancel_reason}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="font-headline text-xl font-bold text-primary">₹{order.total_amount?.toFixed(2)}</span>
                    {validNext.length > 0 && (
                      <div className="flex gap-2 flex-wrap justify-end">
                        {validNext.map(status => (
                          <button key={status} 
                            onClick={() => handleStatusChange(order.id, status)}
                            disabled={isUpdating}
                            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                              status === 'cancelled'
                                ? 'border border-error/30 text-error hover:bg-error/10'
                                : 'bg-primary text-on-primary hover:bg-primary-fixed-dim'
                            }`}>
                            {isUpdating ? (
                              <span className="material-symbols-outlined animate-spin text-xs">progress_activity</span>
                            ) : (
                              STATUS_BUTTON_LABELS[status] || status
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Cancel Reason Modal (CB-8 / LF-5) */}
      <CancelReasonModal
        isOpen={cancelModal.isOpen}
        orderId={cancelModal.orderId}
        onConfirm={handleCancelConfirm}
        onCancel={handleCancelDismiss}
      />
    </AdminLayout>
  );
}
