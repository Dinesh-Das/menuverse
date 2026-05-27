import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { fetchTableOrders, createPayment, createStripePaymentIntent, createStaffRequest } from '../lib/api';
import BottomNav from '../components/BottomNav';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import CallWaiterFAB from '../components/CallWaiterFAB';
import { safeParseModifiers } from '../lib/businessRules';
import { getWalletPaymentLabel, openRazorpayCheckout, openStripeCheckout } from '../lib/payments';
import { supabase } from '../lib/supabase';

export default function TableSession() {
  const { restaurantSlug } = useParams();
  const { tableId, tableNumber, clearCart, addItem, tableSessionToken, tableSessionId, restaurantId, paymentEnabled, paymentProvider } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentState, setPaymentState] = useState({ isOpen: false, status: 'idle', message: '' });
  // LF-06: "Pay at Counter" informational dialog state
  const [payAtCounterOpen, setPayAtCounterOpen] = useState(false);
  const [sessionTab, setSessionTab] = useState('active'); // 'active', 'history'
  const [splitCount, setSplitCount] = useState(1);
  const [billRequested, setBillRequested] = useState(false);
  const [billRequesting, setBillRequesting] = useState(false);
  const walletPayment = paymentProvider === 'stripe'
    ? { headline: 'Pay by Card or Wallet', detail: 'Apple Pay, Google Pay and cards through Stripe' }
    : getWalletPaymentLabel();

  useEffect(() => {
    if (!tableId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let refreshTimer = null;

    const loadOrders = async () => {
      try {
        const data = await fetchTableOrders(tableId);
        if (cancelled) return;
        setOrders(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const scheduleRefreshFallback = () => {
      refreshTimer = window.setTimeout(async () => {
        await loadOrders();
        if (!cancelled) scheduleRefreshFallback();
      }, 5000);
    };

    loadOrders();
    scheduleRefreshFallback();

    const channelName = `table_orders:${tableId}:${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'Order', filter: `table_id=eq.${tableId}` },
        () => loadOrders()
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [tableId]);

  useEffect(() => {
    if (!tableSessionId) return;
    setBillRequested(localStorage.getItem(`mv_bill_requested_${tableSessionId}`) === 'true');
  }, [tableSessionId]);

  const activeOrders = orders.filter(o => !['completed', 'cancelled'].includes(o.status));
  const historyOrders = orders.filter(o => ['completed', 'cancelled'].includes(o.status));

  const billableOrders = orders.filter(order => order.status !== 'cancelled');
  const totalBill = billableOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
  const menuPath = restaurantSlug ? `/r/${restaurantSlug}/menu` : '/menu';
  const shareAmount = splitCount > 1 ? totalBill / splitCount : totalBill;

  const updateSplitCount = (nextCount) => {
    setSplitCount(Math.max(1, Math.min(10, nextCount)));
  };

  const handleReorder = (order) => {
    order.items.forEach(item => {
      if (item.menu_item) {
        const modifiers = safeParseModifiers(item.modifiers_json);
        addItem(item.menu_item, item.quantity, modifiers, item.item_note || '');
      }
    });
    navigate(restaurantSlug ? `/r/${restaurantSlug}/checkout` : '/checkout');
  };

  const handleRequestBill = async () => {
    if (billRequested || billRequesting) return;
    if (!restaurantId || !tableId || !tableSessionToken || !tableSessionId) {
      addToast('Please scan your table QR before requesting the bill.', 'error');
      return;
    }

    setBillRequesting(true);
    setError(null);
    try {
      await createStaffRequest({
        restaurantId,
        tableId,
        tableSessionToken,
        requestType: 'bill',
        message: 'Customer has requested the bill.',
      });

      const { error: sessionError } = await supabase
        .from('TableSession')
        .update({ status: 'billing' })
        .eq('id', tableSessionId);

      if (sessionError) throw new Error(sessionError.message);

      localStorage.setItem(`mv_bill_requested_${tableSessionId}`, 'true');
      setBillRequested(true);
      addToast('Bill requested. Your server is on the way.', 'success');
    } catch (e) {
      console.error(e);
      addToast(e.message || 'Failed to request bill. Try again.', 'error');
    } finally {
      setBillRequesting(false);
    }
  };

  const requestPaymentLink = async () => {
    if (!paymentEnabled) {
      await handleRequestBill();
      return;
    }

    const providerName = paymentProvider === 'stripe' ? 'Stripe' : 'Razorpay';
    const checkoutMessage = splitCount > 1
      ? `Creating a secure ${providerName} checkout for your share...`
      : `Creating a secure ${providerName} checkout...`;
    setPaymentState({ isOpen: true, status: 'processing', message: checkoutMessage });
    try {
      if (paymentProvider === 'stripe') {
        const paymentIntent = await createStripePaymentIntent({
          table_session_token: tableSessionToken,
          amount: shareAmount,
          split_count: splitCount,
          split_index: 0,
        });

        setPaymentState({ isOpen: false, status: 'idle', message: '' });
        await openStripeCheckout({
          clientSecret: paymentIntent.client_secret,
          publishableKey: paymentIntent.publishable_key,
          onSuccess: () => {
            setPaymentState({
              isOpen: true,
              status: 'submitted',
              message: splitCount > 1
                ? 'Your split payment was submitted. We will update the bill as each share is confirmed.'
                : 'Payment submitted. Stripe webhook verification will update your bill automatically.',
            });
          },
          onDismiss: () => {
            setPaymentState({
              isOpen: true,
              status: 'dismissed',
              message: splitCount > 1
                ? 'Split payment was not completed. You can try again or pay at the counter.'
                : 'Payment was not completed. You can try again or pay at the counter.',
            });
          },
        });
        return;
      }

      const paymentOrder = await createPayment({
        table_session_token: tableSessionToken,
        amount: shareAmount,
        split_count: splitCount,
        split_index: 0,
      });

      setPaymentState({ isOpen: false, status: 'idle', message: '' });
      await openRazorpayCheckout({
        paymentOrder,
        restaurantName: localStorage.getItem('mv_restaurant_name') || 'Menuverse',
        tableNumber,
        onSuccess: () => {
          setPaymentState({
            isOpen: true,
            status: 'submitted',
            message: splitCount > 1
              ? 'Your split payment was submitted. We will update the bill as each share is confirmed.'
              : 'Payment submitted. Razorpay webhook verification will update your bill automatically.',
          });
        },
        onDismiss: () => {
          setPaymentState({
            isOpen: true,
            status: 'dismissed',
            message: splitCount > 1
              ? 'Split payment was not completed. You can try again or pay at the counter.'
              : 'Payment was not completed. You can try again or pay at the counter.',
          });
        },
      });
    } catch (e) {
      console.error(e);
      setPaymentState({
        isOpen: true,
        status: 'fallback',
        message: 'Digital checkout is not available yet. Please pay at the counter or ask staff for help.',
      });
    }
  };

  return (
    <div className="min-h-dvh bg-background text-on-surface pb-32">
      {/* Header */}
      <header className="fixed top-0 w-full px-6 py-5 z-50 glass-nav-dark flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="material-symbols-outlined text-on-surface hover:text-primary transition-colors cursor-pointer">
            arrow_back
          </button>
          <h1 className="font-headline text-xl font-bold tracking-tight text-on-surface">Your Bill</h1>
        </div>
        <div className="flex items-center gap-4">
          <button aria-label="Toggle Theme" onClick={toggleTheme} className="cursor-pointer flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant hover:text-amber-200 transition-colors duration-300">
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <div className="text-right">
            <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Table</p>
            <p className="text-primary font-bold text-xs uppercase tracking-widest mt-0.5">{tableNumber || '?'}</p>
          </div>
        </div>
      </header>

      <main className="pt-24 px-6 max-w-lg mx-auto">
        {loading ? (
          <div className="flex justify-center py-20">
            <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
          </div>
        ) : !tableId ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="material-symbols-outlined text-6xl text-surface-container-highest mb-4">qr_code_scanner</span>
            <p className="text-on-surface-variant font-medium">Please scan a QR code to view your session.</p>
            <button onClick={() => navigate('/')} className="mt-6 text-primary font-bold uppercase tracking-widest border-b border-primary/30 pb-1 cursor-pointer">
              Go to Directory
            </button>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="material-symbols-outlined text-6xl text-error mb-4">error</span>
            <p className="text-error font-medium">{error}</p>
            <button onClick={() => navigate(menuPath)} className="mt-6 text-primary font-bold uppercase tracking-widest border-b border-primary/30 pb-1 cursor-pointer">
              Back to Menu
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="material-symbols-outlined text-6xl text-surface-container-highest mb-4">restaurant</span>
            <p className="text-on-surface-variant font-medium">No orders found for this session yet.</p>
            <button onClick={() => navigate(menuPath)} className="mt-6 text-primary font-bold uppercase tracking-widest border-b border-primary/30 pb-1 cursor-pointer">
              Start Ordering
            </button>
          </div>
        ) : (
          <div>
            {error && (
              <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-xl text-error text-sm font-medium">
                {error}
              </div>
            )}
            {/* Cumulative Summary */}
            <div className="bg-surface-container-low p-6 rounded-2xl border border-outline-variant/10 mb-8 shadow-luxury text-center">
              <p className="text-[10px] uppercase font-bold tracking-[0.25em] text-on-surface-variant mb-2">Total Amount to Pay</p>
              <h2 className="font-headline text-4xl font-bold text-primary tracking-tight mb-6">₹{totalBill.toFixed(2)}</h2>
              
              <div className="mb-4 p-4 bg-surface-container rounded-2xl border border-outline-variant/20 text-left">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-on-surface">Split this bill.</p>
                  <div className="flex items-center gap-3 rounded-full bg-surface-container-low border border-outline-variant/20 p-1">
                    <button
                      type="button"
                      onClick={() => updateSplitCount(splitCount - 1)}
                      className="min-w-[40px] min-h-[40px] rounded-full bg-surface-container-highest flex items-center justify-center text-lg font-bold text-on-surface disabled:opacity-40"
                      disabled={splitCount <= 1}
                      aria-label="Decrease split count"
                    >
                      -
                    </button>
                    <span className="min-w-[72px] text-center text-sm font-bold text-on-surface">
                      {splitCount} {splitCount === 1 ? 'person' : 'people'}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateSplitCount(splitCount + 1)}
                      className="min-w-[40px] min-h-[40px] rounded-full bg-surface-container-highest flex items-center justify-center text-lg font-bold text-on-surface disabled:opacity-40"
                      disabled={splitCount >= 10}
                      aria-label="Increase split count"
                    >
                      +
                    </button>
                  </div>
                </div>
                {splitCount > 1 && (
                  <p className="mt-3 text-sm text-on-surface-variant">
                    Your share: &#8377;{shareAmount.toFixed(2)} of &#8377;{totalBill.toFixed(2)} total
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {paymentEnabled ? (
                  <>
                    <button
                      onClick={requestPaymentLink}
                      className="w-full bg-primary text-on-primary px-3 py-4 rounded-xl font-bold uppercase tracking-widest text-sm leading-tight shadow-luxury transition-transform hover:bg-primary-fixed-dim active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
                    >
                      {splitCount > 1 ? (
                        <>Pay My Share (&#8377;{shareAmount.toFixed(2)})</>
                      ) : (
                        walletPayment.headline
                      )}
                      <span className="material-symbols-outlined text-lg ml-1">credit_card</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleRequestBill}
                    disabled={billRequested || billRequesting}
                    className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-transform hover:bg-primary-fixed-dim active:scale-95 disabled:opacity-60 flex justify-center items-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-lg">receipt_long</span>
                    {billRequested ? (
                      <>Bill requested &#8212; your server is on the way &#10003;</>
                    ) : billRequesting ? (
                      'Requesting Bill...'
                    ) : (
                      'Request Bill'
                    )}
                  </button>
                )}
                {/* LF-06: Pay at Counter — opens informational dialog instead of doing nothing */}
                <button
                  onClick={() => setPayAtCounterOpen(true)}
                  className="w-full bg-surface-container-high border border-outline-variant/20 text-on-surface py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-transform hover:bg-surface-container-highest active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">storefront</span>
                  Pay at Counter
                </button>
                {paymentEnabled && (
                  <div className="flex items-center justify-center gap-2 text-on-surface-variant/50">
                    <span className="material-symbols-outlined text-sm">verified_user</span>
                    <span className="text-[10px] uppercase tracking-widest font-bold">{walletPayment.detail}</span>
                  </div>
                )}
              </div>

            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-outline-variant/10 pb-2">
              <button
                onClick={() => setSessionTab('active')}
                className={`text-xs font-bold uppercase tracking-widest pb-2 px-2 transition-colors ${
                  sessionTab === 'active' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Active Orders ({activeOrders.length})
              </button>
              <button
                onClick={() => setSessionTab('history')}
                className={`text-xs font-bold uppercase tracking-widest pb-2 px-2 transition-colors ${
                  sessionTab === 'history' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                History ({historyOrders.length})
              </button>
            </div>

            {/* Order List */}
            <div className="space-y-4">
              {(sessionTab === 'active' ? activeOrders : historyOrders).length === 0 ? (
                <div className="text-center py-8 text-on-surface-variant text-sm">
                  No {sessionTab} orders.
                </div>
              ) : (
                (sessionTab === 'active' ? activeOrders : historyOrders).map((order) => (
                  <div key={order.id} className="bg-surface-container-low rounded-xl border border-outline-variant/5 overflow-hidden">
                    <div className="p-4 flex justify-between items-center bg-surface-container/30">
                      <div>
                        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
                          {new Date(order.created_at + (order.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className="text-xs font-bold text-on-surface">Ref: {order.id.slice(0, 8)}</p>
                      </div>
                      <div className="text-right">
                        <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                          order.status === 'served' || order.status === 'completed' ? 'bg-green-500/10 text-green-500' : 
                          order.status === 'cancelled' ? 'bg-error/10 text-error' : 
                          'bg-primary/10 text-primary'
                        }`}>
                          {order.status}
                        </span>
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      {order.items.map((item, idx) => {
                        const modifiers = safeParseModifiers(item.modifiers_json);
                        const modifierTotal = modifiers.reduce((sum, mod) => sum + Number(mod.price_delta || 0), 0);
                        const lineTotal = (Number(item.price || 0) + modifierTotal) * Number(item.quantity || 0);
                        return (
                          <div key={idx} className="flex justify-between text-sm gap-4">
                            <span className="text-on-surface-variant">
                              <span className="font-bold text-on-surface mr-2">{item.quantity}x</span>
                              {item.name}
                              {modifiers.length > 0 && (
                                <span className="block text-[10px] mt-0.5">{modifiers.map(mod => mod.name).filter(Boolean).join(', ')}</span>
                              )}
                              {item.item_note && (
                                <span className="block text-[10px] mt-0.5 text-primary">Note: {item.item_note}</span>
                              )}
                            </span>
                            <span className="font-medium text-on-surface whitespace-nowrap">₹{lineTotal.toFixed(2)}</span>
                          </div>
                        );
                      })}
                      <div className="pt-2 mt-2 border-t border-outline-variant/10 flex justify-between items-center">
                        <span className="text-xs font-bold text-on-surface-variant">Order Total</span>
                        <span className="font-bold text-primary">₹{order.total_amount.toFixed(2)}</span>
                      </div>
                    </div>
                    {sessionTab === 'history' && order.status === 'completed' && (
                      <div className="p-3 border-t border-outline-variant/5 bg-surface-container/10">
                        <button
                          onClick={() => handleReorder(order)}
                          className="w-full py-2 bg-primary/10 text-primary rounded-lg font-bold uppercase tracking-widest text-[10px] hover:bg-primary/20 transition-colors flex justify-center items-center gap-2 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">replay</span>
                          Reorder Items
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* CTA */}
            <div className="mt-10 p-6 bg-surface-container-high rounded-2xl border border-outline-variant/10 text-center">
              <p className="text-sm text-on-surface-variant mb-4">
                {paymentEnabled
                  ? 'Ready to wrap up? You can settle your bill at the counter or request a verified digital payment link from our staff.'
                  : 'Ready to wrap up? Ask our staff for the available payment options for this table.'}
              </p>
              <button 
                onClick={() => { clearCart(); navigate(menuPath); }}
                className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-transform active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined">add_shopping_cart</span>
                Order More
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Payment Request Modal */}
      {paymentState.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm p-10 bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] flex flex-col items-center text-center animate-in zoom-in duration-300">
            {paymentState.status === 'processing' ? (
              <>
                <span className="material-symbols-outlined text-primary text-6xl animate-spin mb-4">progress_activity</span>
                <h3 className="font-headline text-xl font-bold text-on-surface">Preparing Payment</h3>
                <p className="text-sm text-on-surface-variant mt-2">{paymentState.message}</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-4xl">verified_user</span>
                </div>
                <h3 className="font-headline text-xl font-bold text-on-surface">Payment Verification Required</h3>
                <p className="text-sm text-on-surface-variant mt-2">{paymentState.message}</p>
                <button
                  onClick={() => setPaymentState({ isOpen: false, status: 'idle', message: '' })}
                  className="mt-6 w-full bg-primary text-on-primary py-3 rounded-xl font-bold uppercase tracking-widest text-xs"
                >
                  Got it
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <CallWaiterFAB />

      <BottomNav activeTab="status" />

      {/* LF-06: Pay at Counter dialog */}
      {payAtCounterOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setPayAtCounterOpen(false)} />
          <div className="relative w-full max-w-sm p-10 bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-3xl">storefront</span>
            </div>
            <h3 className="font-headline text-xl font-bold text-on-surface mb-3">Pay at Counter</h3>
            <p className="text-sm text-on-surface-variant leading-relaxed mb-2">
              A member of our staff will come to your table shortly to process your payment.
            </p>
            <p className="text-[10px] uppercase font-bold tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-full mb-8">
              Table {tableNumber}
            </p>
            <button
              onClick={() => setPayAtCounterOpen(false)}
              className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-transform active:scale-95 cursor-pointer"
            >
              Got it, thanks!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
