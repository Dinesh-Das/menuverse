import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOrderStatus, getGuestProfileForSession, resolveOrCreateGuestProfile, saveGuestContact, submitOrderFeedback } from '../lib/api';
import { getSocket, joinOrderRoom } from '../lib/socket';
import { useToast } from '../components/Toast';
import { useTheme } from '../context/ThemeContext';
import CallWaiterFAB from '../components/CallWaiterFAB';
import { safeParseModifiers } from '../lib/businessRules';
import { sendWhatsAppNotification } from '../lib/integrations';
import { downloadOrderReceipt } from '../lib/receipt';
import { getStoredTableSessionToken } from '../lib/tableSessionStorage';

const STATUS_STEPS = ['pending', 'accepted', 'preparing', 'ready', 'served'];
const STATUS_LABELS = {
  pending:   'Order Received',
  accepted:  'Accepted',
  preparing: 'Preparing',
  ready:     'Ready for Pickup',
  served:    'Served',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const STATUS_ICONS = {
  pending:   'receipt_long',
  accepted:  'check_circle',
  preparing: 'outdoor_grill',
  ready:     'lunch_dining',
  served:    'check_circle',
  completed: 'check_circle',
  cancelled: 'cancel',
};
const STATUS_MESSAGES = {
  pending:   'Your order has been received and is awaiting confirmation.',
  accepted:  'Great! The kitchen has accepted your order.',
  preparing: 'Our chefs are crafting your meal right now.',
  ready:     'Your food is ready! A waiter will bring it to your table shortly.',
  served:    'Enjoy your meal! Let us know if you need anything.',
  completed: 'Thanks for dining with us. Your receipt is ready.',
  cancelled: 'This order was cancelled. Please contact your server.',
};
const MAX_FEEDBACK_COMMENT_LENGTH = 200;
const READY_FEEDBACK_DELAY_MS = 3 * 60 * 1000;
const COMPLETED_FEEDBACK_DELAY_MS = 3 * 60 * 1000;
const RATE_CTA_DELAY_MS = 2 * 60 * 1000;
const CONTACT_CAPTURE_STATUSES = new Set(['accepted', 'preparing', 'ready', 'served', 'completed']);

export default function OrderStatus() {
  const { orderId, restaurantSlug } = useParams();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(true); // Supabase Realtime is always connected
  const [rating, setRating] = useState(0);
  const [foodRating, setFoodRating] = useState(0);
  const [serviceRating, setServiceRating] = useState(0);
  const [valueRating, setValueRating] = useState(0);
  const [itemRatings, setItemRatings] = useState({});
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [readyFeedbackVisible, setReadyFeedbackVisible] = useState(false);
  const [showRateCTA, setShowRateCTA] = useState(false);
  const [guestPhone, setGuestPhone] = useState('');
  const [receiptContactOpen, setReceiptContactOpen] = useState(false);
  const [receiptName, setReceiptName] = useState('');
  const [receiptPhone, setReceiptPhone] = useState('');
  const [receiptEmail, setReceiptEmail] = useState('');
  const [receiptMarketingConsent, setReceiptMarketingConsent] = useState(false);
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [receiptSaved, setReceiptSaved] = useState(localStorage.getItem('mv_contact_saved') === 'true');
  const refreshTimerRef = useRef(null);
  const orderRef = useRef(null);
  const feedbackNudgeSentRef = useRef(false);
  const readyFeedbackTimerRef = useRef(null);
  const completedFeedbackTimerRef = useRef(null);
  const rateCtaTimerRef = useRef(null);

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

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    const token = getStoredTableSessionToken();
    if (!token) return;
    getGuestProfileForSession(token)
      .then(profile => setGuestPhone(profile?.phone || ''))
      .catch(err => console.warn('[Menuverse] Guest phone lookup skipped:', err.message));
  }, []);

  const triggerServedFeedbackNudge = useCallback((servedOrder) => {
    if (feedbackGiven) return;
    const nudgeKey = `mv_feedback_${orderId}_nudged`;
    if (window.sessionStorage.getItem(nudgeKey)) return;
    window.sessionStorage.setItem(nudgeKey, '1');
    setShowFeedbackModal(true);

    if (feedbackNudgeSentRef.current) return;
    feedbackNudgeSentRef.current = true;

    Promise.resolve().then(async () => {
      const token = getStoredTableSessionToken();
      const profile = guestPhone
        ? { phone: guestPhone }
        : token
          ? await getGuestProfileForSession(token).catch(() => null)
          : null;
      const phone = profile?.phone;
      const restaurantId = servedOrder?.restaurant_id || orderRef.current?.restaurant_id;
      if (!phone || !restaurantId) return;

      const result = await sendWhatsAppNotification({
        restaurant_id: restaurantId,
        phone,
        template: 'feedback_nudge',
        variables: {
          restaurant_name: localStorage.getItem('mv_restaurant_name') || 'Menuverse',
          order_url: window.location.href,
        },
      });
      if (result?.status === 'disabled') return;
    }).catch(err => console.warn('[Menuverse] Feedback WhatsApp nudge skipped:', err.message));
  }, [feedbackGiven, guestPhone, orderId]);

  useEffect(() => {
    if (completedFeedbackTimerRef.current) {
      window.clearTimeout(completedFeedbackTimerRef.current);
      completedFeedbackTimerRef.current = null;
    }
    if (feedbackGiven) return undefined;
    if (order?.status === 'served') {
      triggerServedFeedbackNudge(orderRef.current);
    }
    if (order?.status === 'completed') {
      completedFeedbackTimerRef.current = window.setTimeout(() => {
        triggerServedFeedbackNudge(orderRef.current);
        completedFeedbackTimerRef.current = null;
      }, COMPLETED_FEEDBACK_DELAY_MS);
    }

    return () => {
      if (completedFeedbackTimerRef.current) {
        window.clearTimeout(completedFeedbackTimerRef.current);
        completedFeedbackTimerRef.current = null;
      }
    };
  }, [feedbackGiven, order?.status, triggerServedFeedbackNudge]);

  useEffect(() => {
    if (readyFeedbackTimerRef.current) {
      window.clearTimeout(readyFeedbackTimerRef.current);
      readyFeedbackTimerRef.current = null;
    }
    if (order?.status !== 'ready' || feedbackGiven) {
      setReadyFeedbackVisible(false);
      return undefined;
    }

    readyFeedbackTimerRef.current = window.setTimeout(() => {
      setReadyFeedbackVisible(true);
      readyFeedbackTimerRef.current = null;
    }, READY_FEEDBACK_DELAY_MS);

    return () => {
      if (readyFeedbackTimerRef.current) {
        window.clearTimeout(readyFeedbackTimerRef.current);
        readyFeedbackTimerRef.current = null;
      }
    };
  }, [feedbackGiven, order?.status]);

  useEffect(() => {
    if (rateCtaTimerRef.current) {
      window.clearTimeout(rateCtaTimerRef.current);
      rateCtaTimerRef.current = null;
    }

    if (feedbackGiven || !['served', 'completed'].includes(order?.status)) {
      setShowRateCTA(false);
      return undefined;
    }

    rateCtaTimerRef.current = window.setTimeout(() => {
      setShowRateCTA(true);
      rateCtaTimerRef.current = null;
    }, RATE_CTA_DELAY_MS);

    return () => {
      if (rateCtaTimerRef.current) {
        window.clearTimeout(rateCtaTimerRef.current);
        rateCtaTimerRef.current = null;
      }
    };
  }, [feedbackGiven, order?.status]);

  // Supabase Realtime updates via socket.js, with token-based refresh as a fallback.
  useEffect(() => {
    if (!orderId) return;
    const socket = getSocket();
    let cancelled = false;
    joinOrderRoom(orderId);

    const scheduleRefresh = () => {
      refreshTimerRef.current = window.setTimeout(async () => {
        await loadOrder();
        if (!cancelled) scheduleRefresh();
      }, 5000);
    };

    const handleStatusUpdate = ({ orderId: id, status }) => {
      if (id === orderId) {
        setOrder(prev => prev ? { ...prev, status } : prev);
        setSocketConnected(true);
        loadOrder();
      }
    };
    const handleOrderUpdated = (updatedOrder) => {
      if (updatedOrder?.id !== orderId) return;
      setOrder(prev => prev ? { ...prev, ...updatedOrder } : updatedOrder);
    };
    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);

    socket.on('order:status_update', handleStatusUpdate);
    socket.on('order:updated', handleOrderUpdated);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    setSocketConnected(socket.connected);
    scheduleRefresh();

    return () => {
      cancelled = true;
      socket.off('order:status_update', handleStatusUpdate);
      socket.off('order:updated', handleOrderUpdated);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [orderId, loadOrder, triggerServedFeedbackNudge]);

  const handleRating = (val) => {
    if (feedbackSaving || feedbackGiven) return;
    setRating(val);
  };

  const handleItemRating = (itemId, val) => {
    if (feedbackSaving || feedbackGiven) return;
    setItemRatings(prev => ({ ...prev, [itemId]: val }));
  };

  const handleFeedbackSubmit = async ({ ratingOverride = rating, allowUpdate = false } = {}) => {
    if (feedbackSaving || (feedbackGiven && !allowUpdate) || !ratingOverride) return;
    setFeedbackSaving(true);
    try {
      await submitOrderFeedback({
        orderId: order.id,
        tableSessionToken: getStoredTableSessionToken(),
        rating: ratingOverride,
        comment: feedbackComment.trim(),
        foodRating: foodRating || null,
        serviceRating: serviceRating || null,
        valueRating: valueRating || null,
        itemRatings: (order.items || []).map(item => ({
          order_item_id: item.id,
          menu_item_id: item.menu_item_id,
          name: item.name,
          rating: itemRatings[item.id] || ratingOverride,
        })),
      });
      setFeedbackGiven(true);
      setShowFeedbackModal(false);
      addToast('Thanks for your feedback.', 'success');
    } catch(e) {
      addToast(`Failed to save feedback: ${e.message}`, 'error');
    } finally {
      setFeedbackSaving(false);
    }
  };

  const handleQuickRating = (nextRating) => {
    if (feedbackSaving || feedbackGiven) return;
    setRating(nextRating);
    if (nextRating <= 2) {
      setShowFeedbackModal(true);
      return;
    }
    handleFeedbackSubmit({ ratingOverride: nextRating });
  };

  const handleReceiptContactSubmit = async () => {
    if (receiptSaving || receiptSaved || !order?.restaurant_id) return;
    const hasContact = receiptName.trim() || receiptPhone.trim() || receiptEmail.trim();
    if (!hasContact) {
      addToast('Add a phone number or email for your receipt.', 'error');
      return;
    }

    setReceiptSaving(true);
    try {
      await saveGuestContact({
        restaurantId: order.restaurant_id,
        tableSessionToken: getStoredTableSessionToken(),
        name: receiptName,
        phone: receiptPhone,
        email: receiptEmail,
        marketingConsent: receiptMarketingConsent,
      });
      await resolveOrCreateGuestProfile({
        restaurantId: order.restaurant_id,
        tableSessionId: order.table_session_id,
        name: receiptName,
        phone: receiptPhone,
        email: receiptEmail,
        marketingConsent: receiptMarketingConsent,
      });
      localStorage.setItem('mv_contact_saved', 'true');
      setReceiptSaved(true);
      setReceiptContactOpen(false);
      addToast('Receipt details saved.', 'success');
    } catch (e) {
      addToast(`Failed to save receipt details: ${e.message}`, 'error');
    } finally {
      setReceiptSaving(false);
    }
  };

  const handleDownloadReceipt = () => {
    downloadOrderReceipt(order, order.restaurant);
  };

  const handleShareReceipt = async () => {
    if (!navigator.share) return;
    const restaurantName = order.restaurant?.name || localStorage.getItem('mv_restaurant_name') || 'Menuverse';
    await navigator.share({
      title: `${restaurantName} receipt`,
      text: `Receipt for order #${String(order.id || '').slice(-8).toUpperCase()} at ${restaurantName}. Total: Rs. ${Number(order.total_amount || 0).toFixed(2)}.`,
    }).catch(() => {});
  };

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
  const ratingOptions = [1, 2, 3, 4, 5];
  const canShowReceiptActions = order.status === 'served' || order.status === 'completed' || feedbackGiven;

  const RatingScale = ({ value, onChange, compact = false, label = 'rating' }) => (
    <div className={`flex ${compact ? 'gap-1' : 'justify-center gap-2'}`}>
      {ratingOptions.map(option => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          disabled={feedbackSaving}
          aria-label={`${option} star ${label}`}
          className={`${compact ? 'w-8 h-8' : 'w-11 h-11'} rounded-full border transition-all flex items-center justify-center ${
            value >= option
              ? 'bg-primary text-on-primary border-primary shadow-md'
              : 'bg-surface-container border-outline-variant/20 text-on-surface-variant hover:border-primary/50'
          } disabled:opacity-60`}
        >
          <span className={`material-symbols-outlined ${compact ? 'text-base' : 'text-xl'}`} style={{ fontVariationSettings: value >= option ? "'FILL' 1" : "'FILL' 0" }}>
            star
          </span>
        </button>
      ))}
    </div>
  );

  const renderFeedbackForm = (submitLabel = 'Send Feedback', allowUpdate = false) => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Overall</p>
          <span className="text-[10px] text-on-surface-variant">1 poor - 5 excellent</span>
        </div>
        <RatingScale value={rating} onChange={handleRating} label="overall rating" />
      </div>

      {rating > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3">
            {[
              ['Food', foodRating, setFoodRating],
              ['Service', serviceRating, setServiceRating],
              ['Value', valueRating, setValueRating],
            ].map(([label, value, setter]) => (
              <div key={label} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-surface-container border border-outline-variant/10">
                <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
                <RatingScale value={value} onChange={setter} compact label={`${label.toLowerCase()} rating`} />
              </div>
            ))}
          </div>

          {order.items?.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-3">Dish Ratings</p>
              <div className="space-y-2">
                {order.items.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container border border-outline-variant/10">
                    <span className="text-xs font-bold text-on-surface line-clamp-1">{item.name}</span>
                    <RatingScale value={itemRatings[item.id] || 0} onChange={val => handleItemRating(item.id, val)} compact label={`${item.name} rating`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <textarea
            value={feedbackComment}
            onChange={e => setFeedbackComment(e.target.value.slice(0, MAX_FEEDBACK_COMMENT_LENGTH))}
            placeholder="What stood out today?"
            maxLength={MAX_FEEDBACK_COMMENT_LENGTH}
            className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl p-4 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50 transition-colors resize-none h-24"
          />
          <p className="text-right text-[10px] text-on-surface-variant">
            {feedbackComment.length}/{MAX_FEEDBACK_COMMENT_LENGTH}
          </p>
        </>
      )}
      <button
        onClick={() => handleFeedbackSubmit({ allowUpdate })}
        disabled={feedbackSaving || !rating}
        className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-transform active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2"
      >
        {feedbackSaving ? (
          <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
        ) : (
          <span className="material-symbols-outlined text-lg">send</span>
        )}
        {feedbackSaving ? 'Saving Feedback' : submitLabel}
      </button>
    </div>
  );

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

        {order.status === 'ready' && readyFeedbackVisible && !feedbackGiven && (
          <div className="mb-8 flex items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5">
            <div>
              <h3 className="font-headline text-lg font-bold text-on-surface">How is your food?</h3>
              <p className="mt-1 text-sm text-on-surface-variant">A quick rating helps the kitchen improve while your visit is fresh.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowFeedbackModal(true)}
              className="flex-none rounded-xl bg-primary px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-on-primary"
            >
              Rate now
            </button>
          </div>
        )}

        {(order.status === 'served' || order.status === 'completed') && !feedbackGiven && (
          <div className="mb-8 p-6 bg-surface-container-low border border-outline-variant/10 rounded-2xl text-center">
            <h3 className="font-headline text-lg font-bold text-on-surface mb-2">How was your meal?</h3>
            <p className="text-sm text-on-surface-variant mb-4">Tap once to rate. Add details only if you want to.</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => handleQuickRating(star)}
                  disabled={feedbackSaving}
                  aria-label={`${star} star quick rating`}
                  className="w-11 h-11 rounded-full bg-primary/10 text-primary border border-primary/20 transition-transform hover:scale-110 active:scale-95 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {(order.status === 'served' || order.status === 'completed') && feedbackGiven && (
          <div className="mb-8 p-6 bg-green-500/10 border border-green-500/20 rounded-2xl text-center animate-in fade-in zoom-in duration-300">
            <span className="material-symbols-outlined text-4xl mb-2 block text-green-500" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <h3 className="font-headline text-lg font-bold text-green-500 mb-1">Thank you!</h3>
            <p className="text-xs text-green-600/80 uppercase tracking-widest font-bold">Your feedback is appreciated</p>
            <button type="button" onClick={() => setShowFeedbackModal(true)} className="mt-4 text-[10px] font-bold uppercase tracking-widest text-primary">
              Add optional details
            </button>
          </div>
        )}

        {CONTACT_CAPTURE_STATUSES.has(order.status) && (
          <div className="mb-8 p-5 rounded-2xl bg-surface-container-low border border-outline-variant/10">
            {receiptSaved ? (
              <div className="flex items-center gap-3 text-green-500">
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                <p className="text-sm font-bold">Receipt details saved</p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setReceiptContactOpen(value => !value)}
                  className="w-full flex items-center justify-between gap-4 text-left"
                >
                  <span className="text-xs font-bold uppercase tracking-widest text-on-surface">Get your receipt by WhatsApp or email</span>
                  <span className="material-symbols-outlined text-primary">{receiptContactOpen ? 'expand_less' : 'expand_more'}</span>
                </button>
                {receiptContactOpen && (
                  <div className="mt-4 space-y-3">
                    <input value={receiptName} onChange={e => setReceiptName(e.target.value)} placeholder="Name for receipt" className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50" />
                    <input type="tel" value={receiptPhone} onChange={e => setReceiptPhone(e.target.value)} placeholder="WhatsApp phone" className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50" />
                    <input type="email" value={receiptEmail} onChange={e => setReceiptEmail(e.target.value)} placeholder="Email address" className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50" />
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                      <input type="checkbox" checked={receiptMarketingConsent} onChange={e => setReceiptMarketingConsent(e.target.checked)} className="w-4 h-4 accent-primary" />
                      Offers and loyalty updates
                    </label>
                    <button
                      type="button"
                      onClick={handleReceiptContactSubmit}
                      disabled={receiptSaving}
                      className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {receiptSaving && <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>}
                      Save receipt details
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Order Items */}
        {order.items && order.items.length > 0 && (
          <div className="mb-8">
            <h3 className="text-[10px] uppercase font-bold tracking-[0.2em] text-on-surface-variant mb-4">Items Ordered</h3>
            <div className="space-y-3">
              {order.items.map((item, i) => {
                // LF-04: Include modifier price deltas in line-item total
                const mods = safeParseModifiers(item.modifiers_json);
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
                      {item.item_note && (
                        <span className="text-primary text-[10px] mt-0.5">Note: {item.item_note}</span>
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

        {canShowReceiptActions && (
          <div className="mt-3 grid grid-cols-1 gap-3">
            <button
              onClick={handleDownloadReceipt}
              className="btn-outline flex items-center justify-center gap-2 mt-3"
            >
              <span className="material-symbols-outlined text-base">receipt_long</span>
              Download receipt (PDF)
            </button>
            {navigator.share && (
              <button
                onClick={handleShareReceipt}
                className="btn-outline flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-base">ios_share</span>
                Share receipt
              </button>
            )}
          </div>
        )}

      </main>

      {showRateCTA && !feedbackGiven && (
        <button
          onClick={() => setShowFeedbackModal(true)}
          className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-lg"
        >
          <span className="material-symbols-outlined text-base">star</span>
          Rate your order
        </button>
      )}

      {showFeedbackModal && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-surface-container-low border border-outline-variant/10 shadow-luxury p-6 transition-transform duration-300 ease-out translate-y-0">
            <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-outline-variant/40" />
            <div className="text-center mb-6">
              <h3 className="font-headline text-2xl font-bold text-on-surface mb-2">How was your meal?</h3>
              <p className="text-sm text-on-surface-variant">Your feedback helps the menu improve automatically.</p>
            </div>
            {renderFeedbackForm(feedbackGiven ? 'Update Feedback' : 'Submit Feedback', feedbackGiven)}
            <button
              type="button"
              onClick={() => setShowFeedbackModal(false)}
              className="mt-4 w-full py-3 text-xs font-bold uppercase tracking-widest text-on-surface-variant hover:text-on-surface"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      <CallWaiterFAB />
    </div>
  );
}
