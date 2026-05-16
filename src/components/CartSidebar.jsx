import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { placeOrder } from '../lib/api';

const COOLDOWN_MS = 10_000; // 10 seconds — same as Checkout.jsx (LF-10/LF-14)

/**
 * CartSidebar — Desktop-only sticky right-hand cart panel.
 * Hidden on mobile (handled by Checkout.jsx full-screen route).
 *
 * Fixes applied:
 *  - BUG-06: Uses `allItems` (includes remote cart) so displayed total matches submitted total
 *  - LF-10:  10-second cooldown prevents double-tap spam (previously absent from sidebar)
 *  - LF-14:  idempotency_key now uses crypto.randomUUID() instead of Date.now()
 */
export default function CartSidebar() {
  const { restaurantSlug } = useParams();
  const {
    items, allItems, subtotal, tax, total,
    removeItem, updateQty, clearCart,
    tableId, tableNumber, restaurantId, tableSessionToken, tableSessionId,
  } = useCart();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleCheckout = async () => {
    if (allItems.length === 0 || !tableId) return;

    // LF-10: 10-second anti-double-tap cooldown (same key as Checkout.jsx)
    const lastOrderTime = localStorage.getItem('mv_last_order_time');
    if (lastOrderTime && Date.now() - parseInt(lastOrderTime) < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - parseInt(lastOrderTime))) / 1000);
      setError(`Please wait ${remaining}s before placing another order.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // LF-14: Use randomUUID — Date.now() has millisecond collisions on rapid taps
      const idempotencyKey = crypto.randomUUID();

      // BUG-06: Use allItems (includes remote cart items from other devices at same table)
      const payload = {
        restaurant_id: restaurantId,
        table_id: tableId,
        table_session_id: tableSessionId,
        table_session_token: tableSessionToken,
        special_instructions: note,
        idempotency_key: idempotencyKey,
        items: allItems.map(item => ({
          menu_item_id: item.id,
          name: item.name,
          quantity: item.qty,
          price: item.price,
          modifiers: item.selectedModifiers || [],
        })),
      };
      const result = await placeOrder(payload);
      localStorage.setItem('mv_last_order_time', String(Date.now()));
      clearCart();
      const basePath = restaurantSlug ? `/r/${restaurantSlug}` : '';
      navigate(`${basePath}/order/${result.order_ref}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside
      className="hidden lg:flex flex-col sticky top-0 h-screen overflow-y-auto border-l border-outline-variant/20 bg-surface-container-low/80 backdrop-blur-xl no-scrollbar"
      style={{ width: 'var(--cart-sidebar-width)', minWidth: 'var(--cart-sidebar-width)', flexShrink: 0 }}
    >
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-outline-variant/20">
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-xl font-bold text-on-surface">Your Order</h2>
          {tableNumber && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-full">
              Table {tableNumber}
            </span>
          )}
        </div>
      </div>

      {/* Items — show local items only in the interactive list; allItems drives the total */}
      <div className="flex-1 px-6 py-4 space-y-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">restaurant</span>
            <p className="text-sm text-on-surface-variant/60">Add items to begin your order</p>
          </div>
        ) : (
          items.map(item => (
            <div key={item._cartKey || item.id} className="flex gap-3 bg-surface-container rounded-xl p-3 border border-outline-variant/10">
              {item.image_url && (
                <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0">
                  <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-bold text-on-surface leading-tight truncate">{item.name}</h4>
                  <button
                    onClick={() => removeItem(item._cartKey || item.id)}
                    className="material-symbols-outlined text-xs text-on-surface-variant hover:text-error transition-colors shrink-0 cursor-pointer"
                    style={{ fontSize: '16px' }}
                  >
                    close
                  </button>
                </div>
                {item.selectedModifiers?.length > 0 && (
                  <p className="text-[10px] text-on-surface-variant mt-0.5 truncate">
                    {item.selectedModifiers.map(m => m.name).join(', ')}
                  </p>
                )}
                <p className="text-primary font-bold text-sm mt-0.5">₹{(item.price * item.qty).toFixed(2)}</p>
                <div className="flex items-center gap-2 mt-2 bg-surface-container-high rounded-full px-1.5 py-0.5 w-max border border-outline-variant/20">
                  <button
                    onClick={() => updateQty(item._cartKey || item.id, item.qty - 1)}
                    className="flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                    style={{ width: 'var(--tap-target)', height: '28px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>remove</span>
                  </button>
                  <span className="text-sm font-bold text-on-surface w-4 text-center">{item.qty}</span>
                  <button
                    onClick={() => updateQty(item._cartKey || item.id, item.qty + 1)}
                    className="flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                    style={{ width: 'var(--tap-target)', height: '28px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Special instructions */}
      {items.length > 0 && (
        <div className="px-6 pb-2">
          <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant mb-2">Notes</p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Dietary needs or requests…"
            className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl p-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50 transition-colors resize-none h-16"
          />
        </div>
      )}

      {/* Summary + CTA */}
      {items.length > 0 && (
        <div className="px-6 pb-8 pt-2 border-t border-outline-variant/20 mt-2 space-y-3">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-on-surface-variant">
              <span>Subtotal</span>
              <span className="font-bold text-on-surface">₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>GST (5%)</span>
              <span className="font-bold text-on-surface">₹{tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-outline-variant/20">
              <span className="font-bold text-on-surface">Total</span>
              <span className="font-headline text-xl font-bold text-primary">₹{total.toFixed(2)}</span>
            </div>
          </div>

          {error && (
            <p className="text-error text-xs font-medium bg-error/10 border border-error/20 rounded-lg p-2">{error}</p>
          )}

          {!tableId && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 text-xs font-medium flex gap-2 items-start">
              <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">qr_code_scanner</span>
              <p>Scan a QR code at your table to place an order.</p>
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={loading || !tableId}
            className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-all hover:bg-primary-fixed-dim active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer"
          >
            {loading ? 'Placing…' : `Place Order · ₹${total.toFixed(2)}`}
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </div>
      )}
    </aside>
  );
}
