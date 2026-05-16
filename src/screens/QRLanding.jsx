import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchTableInfo, startOrResumeTableSession } from '../lib/api';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';

export default function QRLanding() {
  const { restaurantSlug, tableId } = useParams();
  const navigate = useNavigate();
  const { setSession } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function init() {
      try {
        const tableData = await fetchTableInfo(tableId);
        setTable(tableData);

        // AQ-09: Persist restaurant name so CustomerTopNav can read it dynamically
        if (tableData.restaurant?.name) {
          localStorage.setItem('mv_restaurant_name', tableData.restaurant.name.split(' - ')[0]);
        }

        const sessionPayload = {
          tableId,
          tableNumber: tableData.number,
          restaurantId: tableData.restaurant_id,
          restaurantSlug,
          gstRate: tableData.restaurant?.gst_rate,
          paymentEnabled: Boolean(tableData.restaurant?.payment_enabled),
          paymentProvider: tableData.restaurant?.payment_provider || 'razorpay',
        };

        try {
          const tableSession = await startOrResumeTableSession({
            restaurantId: tableData.restaurant_id,
            tableId,
            existingToken: localStorage.getItem('mv_table_session_token'),
          });
          sessionPayload.tableSessionId = tableSession?.id;
          sessionPayload.tableSessionToken = tableSession?.token || tableSession?.session_code;
        } catch (sessionErr) {
          console.warn('[Menuverse] Table session RPC unavailable:', sessionErr.message);
        }

        setSession(sessionPayload);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, restaurantSlug, setSession]);

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
            {table?.restaurant?.name?.split(' - ')[0] || 'Zaika Zindagi'}
          </h1>
          {table?.restaurant?.name?.includes(' - ') && (
            <p className="text-primary italic font-serif text-lg mt-1 opacity-90">
              {table.restaurant.name.split(' - ')[1]}
            </p>
          )}
        </div>

        <p className="text-on-surface-variant font-body text-[10px] uppercase tracking-[0.2em] text-center mb-12 opacity-70">
          Table {table?.number} <span className="mx-2">·</span> {table?.section}
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
          onClick={() => navigate(`/r/${restaurantSlug}/menu`)}
          className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-all active:scale-95 hover:shadow-primary/20 hover:-translate-y-0.5 flex justify-center items-center gap-2 cursor-pointer"
        >
          Explore Menu
          <span className="material-symbols-outlined text-lg">arrow_forward</span>
        </button>

        <div className="mt-12 flex flex-col items-center gap-2">
          <p className="text-on-surface-variant/40 text-[9px] text-center uppercase tracking-[0.3em]">
            Powered by Zaika Zindagi OS
          </p>
          <div className="w-1 h-1 rounded-full bg-primary/30" />
        </div>
      </div>
    </div>
  );
}
