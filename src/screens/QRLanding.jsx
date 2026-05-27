import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchTableInfo, resolveOrCreateGuestProfile, saveGuestContact, startOrResumeTableSession } from '../lib/api';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';

function getStoredTableSessionToken() {
  const token = localStorage.getItem('mv_table_session_token');
  const expiresAt = Number(localStorage.getItem('mv_table_session_expires') || 0);
  if (!token) return null;
  if (!expiresAt || Date.now() > expiresAt) {
    localStorage.removeItem('mv_table_session_token');
    localStorage.removeItem('mv_table_session_id');
    localStorage.removeItem('mv_table_session_expires');
    return null;
  }
  return token;
}

export default function QRLanding() {
  const { restaurantSlug, tableId } = useParams();
  const navigate = useNavigate();
  const { setSession } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const [table, setTable] = useState(null);
  const [activeSessionToken, setActiveSessionToken] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
          setActiveSessionId(sessionPayload.tableSessionId || null);
          setActiveSessionToken(sessionPayload.tableSessionToken);
        } catch (sessionErr) {
          console.warn('[Menuverse] Table session RPC unavailable:', sessionErr.message);
        }

        setSession(sessionPayload);

        if (storedSessionToken && sessionPayload.tableSessionToken) {
          navigate(`/r/${restaurantSlug}/menu`, { replace: true });
          return;
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, tableId, restaurantSlug, setSession]);

  const handleExploreMenu = async () => {
    const hasContact = guestName.trim() || guestPhone.trim() || guestEmail.trim();
    if (hasContact && table?.restaurant_id && activeSessionToken) {
      setSavingContact(true);
      try {
        await saveGuestContact({
          restaurantId: table.restaurant_id,
          tableSessionToken: activeSessionToken,
          name: guestName,
          phone: guestPhone,
          email: guestEmail,
          marketingConsent,
        });
        await resolveOrCreateGuestProfile({
          restaurantId: table.restaurant_id,
          tableSessionId: activeSessionId,
          name: guestName,
          phone: guestPhone,
          email: guestEmail,
          marketingConsent,
        });
        localStorage.setItem('mv_contact_saved', 'true');
      } catch (contactErr) {
        console.warn('[Menuverse] Guest contact capture skipped:', contactErr.message);
      } finally {
        setSavingContact(false);
      }
    }
    navigate(`/r/${restaurantSlug}/menu`);
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
          <p className="text-on-surface-variant text-sm uppercase tracking-widest">Loading your table...</p>
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
        </div>

        <p className="text-on-surface-variant font-body text-[10px] uppercase tracking-[0.2em] text-center mb-12 opacity-70">
          Table {table?.number} <span className="mx-2">-</span> {table?.section}
        </p>

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
          disabled={savingContact}
          className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-all active:scale-95 hover:shadow-primary/20 hover:-translate-y-0.5 flex justify-center items-center gap-2 cursor-pointer disabled:opacity-60"
        >
          {savingContact ? 'Saving...' : 'Browse Menu'}
          <span className={`material-symbols-outlined text-lg ${savingContact ? 'animate-spin' : ''}`}>{savingContact ? 'progress_activity' : 'arrow_forward'}</span>
        </button>

        <button
          type="button"
          onClick={() => setShowContactForm(value => !value)}
          className="mt-4 text-[10px] uppercase tracking-[0.22em] font-bold text-on-surface-variant hover:text-primary transition-colors"
        >
          {showContactForm ? 'Hide session details' : 'Save your session (optional)'}
        </button>

        {showContactForm && (
          <div className="w-full mt-5 space-y-3">
            <input
              type="text"
              value={guestName}
              onChange={event => setGuestName(event.target.value)}
              placeholder="Name for receipt"
              className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50"
            />
            <input
              type="tel"
              value={guestPhone}
              onChange={event => setGuestPhone(event.target.value)}
              placeholder="Phone for WhatsApp receipt"
              className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50"
            />
            <input
              type="email"
              value={guestEmail}
              onChange={event => setGuestEmail(event.target.value)}
              placeholder="Email receipt"
              className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50"
            />
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={event => setMarketingConsent(event.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              Offers and loyalty updates
            </label>
          </div>
        )}

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
