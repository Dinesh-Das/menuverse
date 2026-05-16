import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { fetchTableOrders, createPayment } from '../lib/api';
import BottomNav from '../components/BottomNav';
import { useTheme } from '../context/ThemeContext';

export default function TableSession() {
  const { restaurantSlug } = useParams();
  const { tableId, tableNumber, clearCart } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentState, setPaymentState] = useState({ isOpen: false, status: 'idle' }); // idle, processing, success
  // LF-06: "Pay at Counter" informational dialog state
  const [payAtCounterOpen, setPayAtCounterOpen] = useState(false);

  useEffect(() => {
    if (!tableId) {
      setLoading(false);
      return;
    }

    const loadOrders = async () => {
      try {
        const data = await fetchTableOrders(tableId);
        setOrders(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadOrders();
    // Poll for updates every 30s
    const interval = setInterval(loadOrders, 30000);
    return () => clearInterval(interval);
  }, [tableId]);

  const totalBill = orders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
  const menuPath = restaurantSlug ? `/r/${restaurantSlug}/menu` : '/menu';

  const simulatePayment = () => {
    setPaymentState({ isOpen: true, status: 'processing' });
    setTimeout(async () => {
      try {
        if (orders.length > 0) {
          // Record payment against the latest order for the total amount
          await createPayment({ order_id: orders[0].id, amount: totalBill, status: 'success' });
        }
        setPaymentState({ isOpen: true, status: 'success' });
        setTimeout(() => {
          setPaymentState({ isOpen: false, status: 'idle' });
          // Optionally refresh orders here if needed
        }, 2000);
      } catch (e) {
        console.error(e);
        setPaymentState({ isOpen: false, status: 'idle' });
        setError(e.message);
      }
    }, 2000);
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
            {/* Cumulative Summary */}
            <div className="bg-surface-container-low p-6 rounded-2xl border border-outline-variant/10 mb-8 shadow-luxury text-center">
              <p className="text-[10px] uppercase font-bold tracking-[0.25em] text-on-surface-variant mb-2">Total Amount to Pay</p>
              <h2 className="font-headline text-4xl font-bold text-primary tracking-tight mb-6">₹{totalBill.toFixed(2)}</h2>
              
              <div className="flex flex-col gap-3">
                <button
                  onClick={simulatePayment}
                  className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-transform hover:bg-primary-fixed-dim active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
                >
                  Pay Now
                  <span className="material-symbols-outlined text-lg ml-1">credit_card</span>
                </button>
                {/* LF-06: Pay at Counter — opens informational dialog instead of doing nothing */}
                <button
                  onClick={() => setPayAtCounterOpen(true)}
                  className="w-full bg-surface-container-high border border-outline-variant/20 text-on-surface py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-transform hover:bg-surface-container-highest active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">storefront</span>
                  Pay at Counter
                </button>
              </div>
            </div>

            {/* Order History */}
            <h3 className="text-[10px] uppercase font-bold tracking-[0.2em] text-on-surface-variant mb-4 px-1">Order History</h3>
            <div className="space-y-4">
              {orders.map((order) => (
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
                        order.status === 'served' ? 'bg-green-500/10 text-green-500' : 
                        order.status === 'cancelled' ? 'bg-error/10 text-error' : 
                        'bg-primary/10 text-primary'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                  </div>
                  <div className="p-4 space-y-2">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="text-on-surface-variant">
                          <span className="font-bold text-on-surface mr-2">{item.quantity}x</span>
                          {item.name}
                        </span>
                        <span className="font-medium text-on-surface">₹{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="pt-2 mt-2 border-t border-outline-variant/10 flex justify-between items-center">
                      <span className="text-xs font-bold text-on-surface-variant">Order Total</span>
                      <span className="font-bold text-primary">₹{order.total_amount.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="mt-10 p-6 bg-surface-container-high rounded-2xl border border-outline-variant/10 text-center">
              <p className="text-sm text-on-surface-variant mb-4">Ready to wrap up? You can settle your bill at the counter or request a digital payment link from our staff.</p>
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

      {/* Simulated Payment Modal */}
      {paymentState.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm p-10 bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] flex flex-col items-center text-center animate-in zoom-in duration-300">
            {paymentState.status === 'processing' ? (
              <>
                <span className="material-symbols-outlined text-primary text-6xl animate-spin mb-4">progress_activity</span>
                <h3 className="font-headline text-xl font-bold text-on-surface">Processing Payment</h3>
                <p className="text-sm text-on-surface-variant mt-2">Connecting to secure gateway...</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-4xl">check</span>
                </div>
                <h3 className="font-headline text-xl font-bold text-on-surface">Payment Successful!</h3>
                <p className="text-sm text-on-surface-variant mt-2">Your bill has been settled.</p>
              </>
            )}
          </div>
        </div>
      )}

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
