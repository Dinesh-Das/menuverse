import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import BottomNav from '../components/BottomNav';
import {
  fetchMenu,
  fetchRecommendations,
  getGuestProfileForSession,
  placeOrder,
  resolveOrCreateGuestProfile,
  saveGuestContact,
  createStaffRequest,
} from '../lib/api';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import { sortRecommendedItems } from '../lib/recommendations';
import { supabase } from '../lib/supabase';

export default function Checkout() {
  const { restaurantSlug } = useParams();
  const {
    allItems, subtotal, tax, total, removeItem, updateQty, updateItemNote, clearCart, addItem,
    tableId, tableNumber, restaurantId, restaurantSlug: sessionSlug, tableSessionToken, tableSessionId,
    paymentEnabled,
  } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [upsellItems, setUpsellItems] = useState([]);
  const [upsellCategories, setUpsellCategories] = useState([]);
  const [celebration, setCelebration] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [guestProfile, setGuestProfile] = useState(null);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [serverUpsells, setServerUpsells] = useState([]);
  const [splitCount, setSplitCount] = useState(1);
  const [billRequested, setBillRequested] = useState(false);
  const [billRequesting, setBillRequesting] = useState(false);

  const currentSlug = restaurantSlug || sessionSlug || null;

  const gstPct = subtotal > 0
    ? Math.round((tax / subtotal) * 100)
    : Math.round(parseFloat(localStorage.getItem('mv_gst_rate') || '0.05') * 100);

  React.useEffect(() => {
    if (!currentSlug) {
      if (!restaurantId) setError('Restaurant context is required. Please scan a valid QR code.');
      return;
    }
    fetchMenu(currentSlug).then(data => {
      const candidates = data.categories.flatMap(cat => cat.items || []).filter(item => item.available);
      setUpsellCategories(data.categories || []);
      setUpsellItems(candidates);
    }).catch(err => {
      console.error("Upsell fetch error:", err);
      addToast(`Failed to load meal suggestions: ${err.message}`, 'error');
    });
  }, [currentSlug, restaurantId, addToast]);

  React.useEffect(() => {
    if (!tableSessionToken) return;
    getGuestProfileForSession(tableSessionToken)
      .then(profile => setGuestProfile(profile))
      .catch(err => console.warn('[Menuverse] Guest profile lookup skipped:', err.message));
  }, [tableSessionToken]);

  const maxRedeemablePoints = guestProfile?.loyalty_points >= 100
    ? Math.min(
      Math.floor(guestProfile.loyalty_points / 100) * 100,
      Math.max(0, Math.floor(((total * 10) - 1) / 100) * 100)
    )
    : 0;
  const loyaltyDiscount = pointsToRedeem / 10;
  const checkoutTotal = Math.max(0, total - loyaltyDiscount);

  React.useEffect(() => {
    if (pointsToRedeem > maxRedeemablePoints) setPointsToRedeem(maxRedeemablePoints);
  }, [pointsToRedeem, maxRedeemablePoints]);

  const cartItemIdsKey = allItems.map(item => item.id).join(',');

  React.useEffect(() => {
    if (!restaurantId || upsellItems.length === 0) return;
    fetchRecommendations({
      restaurantId,
      cartItemIds: cartItemIdsKey ? cartItemIdsKey.split(',') : [],
      guestProfileId: guestProfile?.id || null,
      limit: 5,
    })
      .then(setServerUpsells)
      .catch(() => setServerUpsells([]));
  }, [restaurantId, upsellItems.length, cartItemIdsKey, guestProfile?.id]);

  const fallbackUpsells = React.useMemo(
    () => sortRecommendedItems(upsellItems, allItems, upsellCategories),
    [upsellItems, allItems, upsellCategories]
  );
  const recommendedUpsells = serverUpsells.length > 0 ? serverUpsells : fallbackUpsells;

  React.useEffect(() => {
    if (!tableSessionId) return;
    setBillRequested(localStorage.getItem(`mv_bill_requested_${tableSessionId}`) === 'true');
  }, [tableSessionId]);

  const updateSplitCount = (nextCount) => {
    setSplitCount(Math.max(1, Math.min(10, nextCount)));
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
    } catch (err) {
      console.error(err);
      addToast(err.message || 'Failed to request bill. Try again.', 'error');
    } finally {
      setBillRequesting(false);
    }
  };

  const handleCheckout = async () => {
    if (allItems.length === 0) return;
    
    // Anti-spam: 10-second cooldown (prevents double-tap; server-side 5-pending check handles real protection)
    const lastOrderTime = localStorage.getItem('mv_last_order_time');
    if (lastOrderTime) {
      const diff = Date.now() - parseInt(lastOrderTime, 10);
      if (diff < 10000) {
        setError(`Please wait ${Math.ceil((10000 - diff) / 1000)} seconds before placing another order.`);
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const idempotencyKey = `${tableId}-${Date.now()}`;
      const payload = {
        restaurant_id: restaurantId,
        table_id: tableId,
        table_session_id: tableSessionId,
        table_session_token: tableSessionToken,
        special_instructions: note,
        idempotency_key: idempotencyKey,
        points_redeemed: pointsToRedeem,
        items: allItems.map(item => ({
          menu_item_id: item.id,
          name: item.name,
          quantity: item.qty,
          price: item.price,
          modifiers: item.selectedModifiers || [],
          item_note: item.itemNote || item.notes || null,
        })),
      };

      const result = await placeOrder(payload);
      const hasContact = guestName.trim() || guestPhone.trim() || guestEmail.trim();
      if (hasContact && !localStorage.getItem('mv_contact_saved')) {
        saveGuestContact({
          restaurantId,
          tableSessionToken,
          name: guestName,
          phone: guestPhone,
          email: guestEmail,
          marketingConsent,
        })
          .then(() => resolveOrCreateGuestProfile({
            restaurantId,
            tableSessionId,
            name: guestName,
            phone: guestPhone,
            email: guestEmail,
            marketingConsent,
          }))
          .then(() => localStorage.setItem('mv_contact_saved', 'true'))
          .catch(contactErr => console.warn('[Menuverse] Checkout contact capture skipped:', contactErr.message));
      }
      localStorage.setItem('mv_last_order_time', Date.now().toString());
      clearCart();

      setCelebration(true);
      setTimeout(() => {
        setCelebration(false);
        const basePath = restaurantSlug ? `/r/${restaurantSlug}` : '';
        navigate(`${basePath}/order/${result.order_ref}`);
      }, 2500);
    } catch (err) {
      setError(err.message);
      addToast(`Failed to place order: ${err.message}`, 'error');
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
              {(restaurantSlug || sessionSlug || '').replace(/-/g, ' ') || 'Menuverse'}
            </p>
            <p className="text-primary font-bold text-xs uppercase tracking-widest mt-0.5">Table {tableNumber || '?'}</p>
          </div>
        </div>
      </header>

      <main className="pt-24 px-6 max-w-lg md:max-w-6xl mx-auto">
        {allItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center md:py-32">
            {/* Animated illustration */}
            <div className="relative w-32 h-32 mb-8">
              <div className="w-32 h-32 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-6xl text-primary/30">shopping_bag</span>
              </div>
              <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-primary/10 animate-ping" />
            </div>
            <h3 className="font-headline text-2xl font-bold text-on-surface mb-2">Your cart is empty</h3>
            <p className="text-on-surface-variant text-sm mb-8 max-w-xs mx-auto">
              Explore our menu and add something delicious to get started.
            </p>
            <button onClick={() => navigate(menuPath)} className="bg-primary text-on-primary px-8 py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury flex items-center gap-2 transition-transform hover:scale-105 active:scale-95 cursor-pointer mx-auto">
              <span className="material-symbols-outlined">restaurant_menu</span>
              Explore Menu
            </button>
          </div>
        ) : (
          <div className="md:grid md:grid-cols-3 md:gap-12">
            
            {/* Left Column: Items & Instructions */}
            <div className="md:col-span-2">
              {/* Order Items */}
              <div className="space-y-4 mb-8">
                {allItems.map((item, idx) => {
                  const modsPrice = (item.selectedModifiers || []).reduce((sum, mod) => sum + (mod.price_delta || 0), 0);
                  const itemTotal = (item.price + modsPrice) * item.qty;

                  return (
                  <div key={`${item.id}-${idx}`} className="bg-surface-container-low p-4 rounded-xl flex gap-4 border border-outline-variant/10 hover:shadow-md transition-shadow">
                    <div className="w-20 h-20 md:w-28 md:h-28 rounded-lg overflow-hidden shrink-0 bg-surface-container">
                      {item.image_url && <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex-1 flex flex-col justify-center">
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex flex-col">
                          <h3 className="font-headline font-bold text-on-surface text-base md:text-lg">{item.name}</h3>
                          {item.isRemote && <span className="text-[9px] text-amber-500 uppercase tracking-widest font-bold mt-0.5">Added by table</span>}
                        </div>
                        {!item.isRemote && (
                          <button onClick={() => removeItem(item._cartKey || item.id)} className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors text-sm cursor-pointer p-1">close</button>
                        )}
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

                      {!item.isRemote ? (
                        <textarea
                          value={item.itemNote || item.notes || ''}
                          onChange={e => updateItemNote(item._cartKey || item.id, e.target.value)}
                          maxLength={200}
                          placeholder="Item note..."
                          className="w-full bg-surface-container-high border border-outline-variant/20 rounded-lg p-2 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50 transition-colors resize-none h-14 mb-3"
                        />
                      ) : (item.itemNote || item.notes) ? (
                        <p className="text-[10px] text-on-surface-variant mb-3 bg-surface-container-high rounded-lg px-2 py-1">
                          Note: {item.itemNote || item.notes}
                        </p>
                      ) : null}

                      {!item.isRemote ? (
                        <div className="flex items-center gap-3 bg-surface-container rounded-full px-2 py-1 w-max border border-outline-variant/20 mt-auto">
                          <button onClick={() => updateQty(item._cartKey || item.id, item.qty - 1)} className="w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer">
                            <span className="material-symbols-outlined text-sm">remove</span>
                          </button>
                          <span className="font-bold text-sm md:text-base text-on-surface w-4 md:w-6 text-center">{item.qty}</span>
                          <button onClick={() => updateQty(item._cartKey || item.id, item.qty + 1)} className="w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer">
                            <span className="material-symbols-outlined text-sm">add</span>
                          </button>
                        </div>
                      ) : (
                        <div className="mt-auto text-xs text-on-surface-variant/50 font-medium">Qty: {item.qty}</div>
                      )}
                    </div>
                  </div>
                )})}
              </div>

              {/* Upselling Carousel */}
              {recommendedUpsells.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-[10px] md:text-xs uppercase font-bold tracking-[0.2em] text-on-surface-variant mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-primary">auto_awesome</span>
                    Recommended For This Table
                  </h3>
                  <div className="flex overflow-x-auto pb-4 gap-4 snap-x hide-scrollbar">
                    {recommendedUpsells.slice(0, 5).map(item => (
                      <div key={item.id} className="snap-start shrink-0 w-36 md:w-44 bg-surface-container border border-outline-variant/10 rounded-2xl overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                        <div className="h-24 md:h-28 bg-surface-container-high relative">
                          {item.image_url ? (
                            <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-on-surface-variant/30 material-symbols-outlined text-3xl">restaurant</div>
                          )}
                        </div>
                        <div className="p-3 flex flex-col flex-1">
                          <h4 className="font-headline font-bold text-xs md:text-sm text-on-surface line-clamp-1 mb-1">{item.name}</h4>
                          <div className="text-primary font-bold text-xs mb-3">₹{item.price}</div>
                          <button
                            onClick={() => addItem(item, 1, [])}
                            className="mt-auto w-full py-1.5 rounded-lg bg-primary/10 text-primary font-bold text-[10px] uppercase tracking-widest hover:bg-primary hover:text-on-primary transition-colors cursor-pointer"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                    <span>GST ({gstPct}%)</span>
                    <span className="font-headline font-bold text-on-surface">₹{tax.toFixed(2)}</span>
                  </div>
                  {pointsToRedeem > 0 && (
                    <div className="flex justify-between text-sm md:text-base text-green-500">
                      <span>Loyalty discount</span>
                      <span className="font-headline font-bold">-₹{loyaltyDiscount.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div className="pt-4 md:pt-6 border-t border-outline-variant/20 flex justify-between items-center">
                  <span className="font-bold text-on-surface md:text-lg">Total</span>
                  <span className="font-headline text-2xl md:text-3xl font-bold text-primary">₹{checkoutTotal.toFixed(2)}</span>
                </div>
                <div className="mt-5 pt-5 border-t border-outline-variant/20">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-on-surface">Split this bill.</p>
                    <div className="flex items-center gap-3 rounded-full bg-surface-container border border-outline-variant/20 p-1">
                      <button
                        type="button"
                        onClick={() => updateSplitCount(splitCount - 1)}
                        className="min-w-[40px] min-h-[40px] rounded-full bg-surface-container-high text-on-surface font-bold flex items-center justify-center disabled:opacity-40"
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
                        className="min-w-[40px] min-h-[40px] rounded-full bg-surface-container-high text-on-surface font-bold flex items-center justify-center disabled:opacity-40"
                        disabled={splitCount >= 10}
                        aria-label="Increase split count"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {splitCount > 1 && (
                    <p className="mt-3 text-sm text-on-surface-variant">
                      Your share: &#8377;{(checkoutTotal / splitCount).toFixed(2)} of &#8377;{checkoutTotal.toFixed(2)} total
                    </p>
                  )}
                </div>
              </div>

              {maxRedeemablePoints >= 100 && (
                <div className="mb-6 bg-surface-container-low p-5 rounded-2xl border border-outline-variant/10">
                  <p className="text-xs font-bold uppercase tracking-widest text-on-surface mb-2">
                    Loyalty Points
                  </p>
                  <p className="text-sm text-on-surface-variant mb-4">
                    You have {guestProfile.loyalty_points} points. Use 100 points for ₹10 off.
                  </p>
                  <input
                    type="number"
                    min={0}
                    max={maxRedeemablePoints}
                    step={100}
                    value={pointsToRedeem}
                    onChange={e => setPointsToRedeem(Math.min(maxRedeemablePoints, Math.max(0, Number(e.target.value))))}
                    className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50"
                  />
                  <p className="text-xs text-primary mt-2">Discount: ₹{loyaltyDiscount.toFixed(2)}</p>
                </div>
              )}

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

              {!localStorage.getItem('mv_contact_saved') && (
                <div className="mb-6 bg-surface-container-low p-5 rounded-2xl border border-outline-variant/10">
                  <button
                    type="button"
                    onClick={() => setContactOpen(value => !value)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="text-xs font-bold uppercase tracking-widest text-on-surface">Save your session</span>
                    <span className="material-symbols-outlined text-primary">{contactOpen ? 'expand_less' : 'expand_more'}</span>
                  </button>
                  {contactOpen && (
                    <div className="mt-4 space-y-3">
                      <input value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Name for receipt" className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50" />
                      <input type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} placeholder="Phone for WhatsApp receipt" className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50" />
                      <input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} placeholder="Email receipt" className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50" />
                      <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                        <input type="checkbox" checked={marketingConsent} onChange={e => setMarketingConsent(e.target.checked)} className="w-4 h-4 accent-primary" />
                        Offers and loyalty updates
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* CTA */}
              <button
                onClick={() => handleCheckout()}
                disabled={loading || !tableId}
                className="w-full bg-primary text-on-primary py-4 md:py-5 rounded-xl font-bold uppercase tracking-widest text-sm md:text-base shadow-luxury transition-transform hover:bg-primary-fixed-dim active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer mb-4"
              >
                {loading ? 'Placing Order...' : `Place Order · ₹${checkoutTotal.toFixed(2)}`}
                <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
              </button>
              <div className="flex items-center justify-center gap-3 text-on-surface-variant/40 mt-2 mb-8">
                <span className="material-symbols-outlined text-sm">lock</span>
                <span className="text-[10px] uppercase tracking-widest font-bold">Secure Order</span>
                <span className="material-symbols-outlined text-sm">verified_user</span>
              </div>
              {!paymentEnabled && tableSessionId && (
                <button
                  type="button"
                  onClick={handleRequestBill}
                  disabled={billRequested || billRequesting}
                  className="w-full bg-primary text-on-primary py-4 md:py-5 rounded-xl font-bold uppercase tracking-widest text-sm md:text-base shadow-luxury transition-transform hover:bg-primary-fixed-dim active:scale-95 disabled:opacity-60 flex justify-center items-center gap-2 cursor-pointer"
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
            </div>

          </div>
        )}
      </main>

      {/* Celebration Overlay */}
      {celebration && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-6 bg-primary text-on-primary animate-in fade-in duration-500">
          <div className="w-32 h-32 mb-8 relative">
            <div className="absolute inset-0 bg-white/20 rounded-full animate-ping" />
            <div className="relative w-full h-full bg-white text-primary rounded-full flex items-center justify-center shadow-2xl">
              <span className="material-symbols-outlined text-6xl">restaurant</span>
            </div>
          </div>
          <h2 className="font-headline text-4xl font-bold mb-4 text-center">Order Received!</h2>
          <p className="text-on-primary/80 text-lg font-medium text-center">The kitchen is preparing your masterpiece.</p>
        </div>
      )}

      <BottomNav activeTab="cart" />
    </div>
  );
}
