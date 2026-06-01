import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchTableInfo, getGuestProfileForSession, startOrResumeTableSession } from '../lib/api';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import { getStoredTableSessionToken } from '../lib/tableSessionStorage';

function surfaceWelcome(table) {
  const identifier = table?.surface_label || table?.number || '';
  if (table?.surface_type === 'counter') return { label: `Order at Counter ${identifier}`, heading: 'Welcome' };
  if (table?.surface_type === 'parking') return { label: `Parking Spot ${identifier}`, heading: 'Order from' };
  if (table?.surface_type === 'delivery_zone') return { label: 'Delivery Zone', heading: 'Welcome to' };
  if (table?.surface_type === 'room') return { label: `Room ${identifier}`, heading: 'Welcome to' };
  return { label: identifier, heading: 'Your Table' };
}

export default function QRLanding() {
  const { restaurantSlug, tableId } = useParams();
  const navigate = useNavigate();
  const { setSession, count } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const [table, setTable] = useState(null);
  const [activeSessionToken, setActiveSessionToken] = useState(null);
  const [returningGuest, setReturningGuest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const [deliveryAddress, setDeliveryAddress] = useState(localStorage.getItem('mv_delivery_address') || '');
  const cachedRestaurantName = localStorage.getItem('mv_restaurant_name') || restaurantSlug?.replace(/-/g, ' ') || 'Menuverse';

  useEffect(() => {
    async function init() {
      try {
        if (!restaurantSlug) {
          throw new Error('Invalid QR code');
        }
        const storedSessionToken = getStoredTableSessionToken();
        const tableData = await fetchTableInfo(tableId);
        setTable(tableData);

        // AQ-09: Persist restaurant name so CustomerTopNav can read it dynamically
        if (tableData.restaurant?.name) {
          localStorage.setItem('mv_restaurant_name', tableData.restaurant.name);
        }

        const sessionPayload = {
          tableId,
          tableNumber: tableData.number,
          restaurantId: tableData.restaurant_id,
          restaurantSlug,
          gstRate: tableData.restaurant?.gst_rate,
          paymentEnabled: Boolean(tableData.restaurant?.payment_enabled),
          paymentProvider: tableData.restaurant?.payment_provider || 'razorpay',
          currency: tableData.restaurant?.currency || 'inr',
        };

        try {
          const tableSession = await startOrResumeTableSession({
            restaurantId: tableData.restaurant_id,
            tableId,
            existingToken: storedSessionToken,
          });
          sessionPayload.tableSessionId = tableSession?.id;
          sessionPayload.tableSessionToken = tableSession?.token || tableSession?.session_code;
          setActiveSessionToken(sessionPayload.tableSessionToken);
        } catch (sessionErr) {
          console.warn('[Menuverse] Table session RPC unavailable:', sessionErr.message);
          if (/already has an active session/i.test(sessionErr.message)) {
            setSessionError(sessionErr.message);
          }
        }

        setSession(sessionPayload);
        if (sessionPayload.tableSessionToken) {
          getGuestProfileForSession(sessionPayload.tableSessionToken)
            .then(profile => setReturningGuest(profile))
            .catch(() => setReturningGuest(null));
        }

      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, restaurantSlug, setSession]);

  const handleExploreMenu = () => {
    if (table?.surface_type === 'delivery_zone' && deliveryAddress.trim()) {
      localStorage.setItem('mv_delivery_address', deliveryAddress.trim());
    }
    navigate(`/r/${restaurantSlug}/menu`);
  };

  const handleRescan = () => {
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="w-full max-w-sm px-6 text-center animate-pulse">
          <p className="text-primary font-bold text-[10px] uppercase tracking-[0.3em] mb-4">Welcome to</p>
          <h1 className="font-headline text-4xl font-bold capitalize text-on-surface">{cachedRestaurantName}</h1>
          <div className="mt-10 rounded-2xl border border-outline-variant/10 bg-surface-container-low p-5">
            <div className="mx-auto h-3 w-24 rounded-full bg-surface-container-highest" />
            <div className="mx-auto mt-4 h-10 w-40 rounded-xl bg-primary/20" />
          </div>
          <div className="mx-auto mt-10 h-44 w-44 rounded-full bg-surface-container-high border border-outline-variant/10" />
          <div className="mt-12 h-14 w-full rounded-xl bg-primary/30" />
          <p className="mt-5 text-on-surface-variant text-xs uppercase tracking-widest">Preparing your table...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-background text-on-surface flex flex-col items-center justify-center p-6 gap-6">
        <span className="material-symbols-outlined text-error text-5xl">qr_code_scanner</span>
        <h1 className="font-headline text-2xl font-bold text-center">Invalid QR Code</h1>
        <p className="text-on-surface-variant text-sm text-center max-w-xs">This QR code is not valid or has expired. Please ask your server for a new one.</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-on-surface flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Theme Toggle */}
      <button 
        aria-label="Toggle Theme" 
        onClick={toggleTheme} 
        className="absolute top-6 right-6 z-50 cursor-pointer flex items-center justify-center p-2 rounded-full glass-dark border border-outline-variant/20 hover:bg-surface-container transition-colors"
      >
        <span className="material-symbols-outlined text-on-surface">
          {isDark ? 'light_mode' : 'dark_mode'}
        </span>
      </button>

      {/* Ambient Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] aspect-square opacity-20 bg-primary blur-[160px] pointer-events-none rounded-full" />

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center">
        <p className="text-primary font-bold text-[10px] uppercase tracking-[0.3em] mb-4">Welcome to</p>
        
        <div className="mb-10 text-center">
          <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface leading-tight">
            {table?.restaurant?.name?.split(' - ')[0] || 'Menuverse'}
          </h1>
          {table?.restaurant?.name?.includes(' - ') && (
            <p className="text-primary italic font-serif text-lg mt-1 opacity-90">
              {table.restaurant.name.split(' - ')[1]}
            </p>
          )}
          {returningGuest?.loyalty_tier && (
            <p className="mt-4 inline-flex items-center rounded-full bg-primary-container px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-on-primary-container">
              Welcome back, {returningGuest.loyalty_tier.charAt(0).toUpperCase() + returningGuest.loyalty_tier.slice(1)} member &#127942;
            </p>
          )}
        </div>

        <div className="w-full mb-10 rounded-2xl border border-outline-variant/10 bg-surface-container-low px-5 py-4 text-center shadow-sm">
          <p className="text-[10px] uppercase tracking-[0.25em] font-bold text-on-surface-variant">{surfaceWelcome(table).heading}</p>
          <p className="font-headline text-4xl font-bold text-primary mt-1">{surfaceWelcome(table).label}</p>
          {table?.section && (
            <p className="text-xs uppercase tracking-widest text-on-surface-variant mt-1">{table.section}</p>
          )}
          {table?.surface_type === 'delivery_zone' && (
            <textarea
              value={deliveryAddress}
              onChange={e => setDeliveryAddress(e.target.value)}
              placeholder="Delivery address"
              className="mt-4 w-full rounded-xl bg-surface-container-high border border-outline-variant/20 px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50"
            />
          )}
          {activeSessionToken && count > 0 && (
            <button
              type="button"
              onClick={() => navigate(`/r/${restaurantSlug}/checkout`)}
              className="mt-4 w-full rounded-xl bg-primary-container px-4 py-3 text-xs font-bold uppercase tracking-widest text-on-primary-container flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">shopping_bag</span>
              Your session has {count} {count === 1 ? 'item' : 'items'} · Resume order
            </button>
          )}
          {sessionError && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-left">
              <p className="text-sm font-bold text-amber-500">Another device is using this table.</p>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                Ask staff to share the table link or scan the QR on your table again.
              </p>
              <button
                type="button"
                onClick={handleRescan}
                className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-on-primary"
              >
                Scan the table QR again
              </button>
            </div>
          )}
        </div>

        <div className="w-52 h-52 rounded-full bg-[#0F0F0F] border border-outline-variant/10 flex items-center justify-center mb-14 relative shadow-2xl overflow-hidden group">
          {table?.restaurant?.logo_url ? (
            <img 
              src={table.restaurant.logo_url} 
              alt={table.restaurant.name} 
              className="w-full h-full object-cover z-10 transition-transform duration-700 group-hover:scale-110"
            />
          ) : (
            <span className="material-symbols-outlined text-primary text-6xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              restaurant
            </span>
          )}
          <div className="absolute inset-0 rounded-full border border-primary/10 animate-pulse opacity-50" />
        </div>

        <button
          onClick={handleExploreMenu}
          className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-all active:scale-95 hover:shadow-primary/20 hover:-translate-y-0.5 flex justify-center items-center gap-2 cursor-pointer"
        >
          Browse Menu
          <span className="material-symbols-outlined text-lg">arrow_forward</span>
        </button>

        <div className="mt-12 flex flex-col items-center gap-2">
          <p className="text-on-surface-variant/40 text-[9px] text-center uppercase tracking-[0.3em]">
            Powered by Menuverse
          </p>
          <div className="w-1 h-1 rounded-full bg-primary/30" />
        </div>
      </div>
    </div>
  );
}
