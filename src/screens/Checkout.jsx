import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import BottomNav from '../components/BottomNav';
import { placeOrder } from '../lib/api';
import { useTheme } from '../context/ThemeContext';

export default function Checkout() {
  const { restaurantSlug } = useParams();
  const { items, subtotal, tax, total, removeItem, updateQty, clearCart, tableId, tableNumber, restaurantId, restaurantSlug: sessionSlug } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleCheckout = async () => {
    if (items.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const idempotencyKey = `${tableId}-${Date.now()}`;
      const payload = {
        restaurant_id: restaurantId,
        table_id: tableId,
        total_amount: total,
        special_instructions: note,
        idempotency_key: idempotencyKey,
        items: items.map(item => ({
          menu_item_id: item.id,
          name: item.name,
          quantity: item.qty,
          price: item.price,
          modifiers: item.selectedModifiers || [],
        })),
      };

      const result = await placeOrder(payload);
      clearCart();

      const basePath = restaurantSlug ? `/r/${restaurantSlug}` : '';
      navigate(`${basePath}/order/${result.order_ref}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const menuPath = restaurantSlug ? `/r/${restaurantSlug}/menu` : '/menu';

  return (
    <div className="min-h-dvh bg-background text-on-surface pb-32">
      {/* Header */}
      <header className="fixed top-0 w-full px-6 py-5 z-50 glass-nav-dark flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="material-symbols-outlined text-on-surface hover:text-primary transition-colors cursor-pointer">
            arrow_back
          </button>
          <h1 className="font-headline text-xl font-bold tracking-tight text-on-surface">Your Selection</h1>
        </div>
        <div className="flex items-center gap-4">
          <button aria-label="Toggle Theme" onClick={toggleTheme} className="cursor-pointer flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant hover:text-amber-200 transition-colors duration-300">
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <div className="text-right">
            <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
              {(restaurantSlug || sessionSlug || '').replace(/-/g, ' ') || 'Zaika Zindagi'}
            </p>
            <p className="text-primary font-bold text-xs uppercase tracking-widest mt-0.5">Table {tableNumber || '?'}</p>
          </div>
        </div>
      </header>

      <main className="pt-24 px-6 max-w-lg md:max-w-6xl mx-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center md:py-32">
            <span className="material-symbols-outlined text-6xl text-surface-container-highest mb-4">restaurant</span>
            <p className="text-on-surface-variant font-medium">Your selection is empty.</p>
            <button onClick={() => navigate(menuPath)} className="mt-6 text-primary font-bold uppercase tracking-widest border-b border-primary/30 pb-1 cursor-pointer hover:border-primary transition-colors">
              Return to Menu
            </button>
          </div>
        ) : (
          <div className="md:grid md:grid-cols-3 md:gap-12">
            
            {/* Left Column: Items & Instructions */}
            <div className="md:col-span-2">
              {/* Order Items */}
              <div className="space-y-4 mb-8">
                {items.map((item) => {
                  const modsPrice = (item.selectedModifiers || []).reduce((sum, mod) => sum + (mod.price_delta || 0), 0);
                  const itemTotal = (item.price + modsPrice) * item.qty;

                  return (
                  <div key={item.id} className="bg-surface-container-low p-4 rounded-xl flex gap-4 border border-outline-variant/10 hover:shadow-md transition-shadow">
                    <div className="w-20 h-20 md:w-28 md:h-28 rounded-lg overflow-hidden shrink-0 bg-surface-container">
                      {item.image_url && <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex-1 flex flex-col justify-center">
                      <div className="flex justify-between items-start mb-1">
                        <h3 className="font-headline font-bold text-on-surface text-base md:text-lg">{item.name}</h3>
                        <button onClick={() => removeItem(item.id)} className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors text-sm cursor-pointer p-1">close</button>
                      </div>
                      <div className="text-primary font-headline font-bold mb-1 md:mb-2">₹{itemTotal.toFixed(2)}</div>
                      {(item.selectedModifiers || []).length > 0 && (
                        <div className="text-xs text-on-surface-variant mb-3 flex flex-wrap gap-x-2">
                          {item.selectedModifiers.map((mod, i) => (
                            <span key={i} className="inline-flex items-center">
                              <span className="w-1 h-1 rounded-full bg-primary/50 mr-1"></span>
                              {mod.name} {mod.price_delta ? `(+₹${mod.price_delta})` : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-3 bg-surface-container rounded-full px-2 py-1 w-max border border-outline-variant/20 mt-auto">
                        <button onClick={() => updateQty(item.id, item.qty - 1)} className="w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer">
                          <span className="material-symbols-outlined text-sm">remove</span>
                        </button>
                        <span className="font-bold text-sm md:text-base text-on-surface w-4 md:w-6 text-center">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, item.qty + 1)} className="w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer">
                          <span className="material-symbols-outlined text-sm">add</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )})}
              </div>

              {/* Special Instructions */}
              <div className="mb-8">
                <h3 className="text-[10px] md:text-xs uppercase font-bold tracking-[0.2em] text-on-surface-variant mb-3">Special Instructions</h3>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Any dietary requirements or preparation requests?"
                  className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl p-4 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50 transition-colors resize-none h-24 md:h-32 shadow-inner"
                />
              </div>
            </div>

            {/* Right Column: Summary & Checkout */}
            <div className="md:col-span-1 md:sticky md:top-24 md:h-max">
              {/* Order Summary */}
              <div className="bg-surface-container-low p-6 md:p-8 rounded-2xl border border-outline-variant/10 mb-8 shadow-sm">
                <h3 className="text-[10px] md:text-xs uppercase font-bold tracking-[0.2em] text-on-surface-variant mb-5 md:mb-6">Order Summary</h3>
                <div className="space-y-3 md:space-y-4 mb-4 md:mb-6">
                  <div className="flex justify-between text-sm md:text-base text-on-surface-variant">
                    <span>Subtotal</span>
                    <span className="font-headline font-bold text-on-surface">₹{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm md:text-base text-on-surface-variant">
                    <span>GST (5%)</span>
                    <span className="font-headline font-bold text-on-surface">₹{tax.toFixed(2)}</span>
                  </div>
                </div>
                <div className="pt-4 md:pt-6 border-t border-outline-variant/20 flex justify-between items-center">
                  <span className="font-bold text-on-surface md:text-lg">Total</span>
                  <span className="font-headline text-2xl md:text-3xl font-bold text-primary">₹{total.toFixed(2)}</span>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-xl text-error text-sm font-medium">
                  {error}
                </div>
              )}

              {!tableId && (
                <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 text-sm font-medium flex gap-3">
                  <span className="material-symbols-outlined">qr_code_scanner</span>
                  <p>Please scan a QR code at your table to place an order.</p>
                </div>
              )}

              {/* CTA */}
              <button
                onClick={handleCheckout}
                disabled={loading || !tableId}
                className="w-full bg-primary text-on-primary py-4 md:py-5 rounded-xl font-bold uppercase tracking-widest text-sm md:text-base shadow-luxury transition-transform hover:bg-primary-fixed-dim active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer mb-8"
              >
                {loading ? 'Placing Order...' : `Place Order · ₹${total.toFixed(2)}`}
                <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
              </button>
            </div>

          </div>
        )}
      </main>

      <BottomNav activeTab="cart" />
    </div>
  );
}
