import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { adminFetchPendingStaffRequests, adminResolveStaffRequest } from '../lib/api';
import { supabase } from '../lib/supabase';

// A17: Lightweight event bus for pending order count — avoids prop drilling or context overhead
// KDS and OrderMonitor call pendingOrdersBus.emit(count) when they receive order:new events.
const _listeners = new Set();
export const pendingOrdersBus = {
  emit: (count) => _listeners.forEach(fn => fn(count)),
  subscribe: (fn) => { _listeners.add(fn); return () => _listeners.delete(fn); },
};

/**
 * CustomerTopNav — fixed glass header for all customer-facing screens.
 * Props:
 *   showBack  {bool}   — show arrow_back button on left
 *   title     {string} — override brand with a page title
 */
export function CustomerTopNav({
  showBack = false,
  title,
  logo,
  guestProfile = null,
  languageLabel = null,
  onLanguageReset = null,
}) {
  const { count, restaurantSlug }  = useCart();
  const { isDark, toggleTheme } = useTheme();
  const navigate   = useNavigate();

  const cartPath = restaurantSlug ? `/r/${restaurantSlug}/checkout` : '/checkout';
  const homePath = restaurantSlug ? `/r/${restaurantSlug}/menu` : '/';

  // AQ-09: Pull restaurant name dynamically; fallback to stored name or brand default
  const restaurantName = title || localStorage.getItem('mv_restaurant_name') || 'Menuverse';

  return (
    <header className="fixed top-0 w-full z-50 glass-nav-dark h-[72px] flex items-center shadow-sm">
      <div className="max-w-7xl mx-auto w-full relative flex justify-between items-center px-8">
        {/* Left */}
        <div className="flex items-center gap-4">
          {showBack && (
            <button
              onClick={() => navigate(-1)}
              className="material-symbols-outlined text-on-surface hover:text-primary transition-colors cursor-pointer text-2xl"
            >
              arrow_back
            </button>
          )}
        </div>

        {/* Center - Massive Horizontal Brand Mark */}
        <div 
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-4 cursor-pointer group" 
          onClick={() => navigate(homePath)}
        >
          {logo && (
            <div className="h-10 w-10 flex items-center justify-center transition-transform duration-500 group-hover:scale-110 shadow-lg rounded-full overflow-hidden border border-outline-variant/10">
              <img 
                src={logo} 
                alt="Icon" 
                className="w-full h-full object-cover" 
              />
            </div>
          )}
          <div className="flex flex-col">
            <span className="font-headline text-2xl font-bold tracking-tight text-on-surface leading-none">
              {restaurantName}
            </span>
            <span className="text-[9px] uppercase tracking-[0.4em] text-primary font-bold mt-1.5 opacity-80">
              Taste of Life
            </span>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-4">
          {languageLabel && (
            <button
              type="button"
              onClick={onLanguageReset}
              className="hidden sm:flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1 text-xs font-bold text-on-surface-variant hover:text-primary transition-colors"
              title="Show this menu in English"
            >
              <span className="material-symbols-outlined text-sm">language</span>
              {languageLabel}
            </button>
          )}

          <button
            className="relative cursor-pointer w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors"
            onClick={() => navigate(cartPath)}
            aria-label="Cart"
          >
            <span className="material-symbols-outlined text-on-surface-variant">
              shopping_cart
            </span>
            {count > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center text-[9px] font-bold text-on-primary">
                {count}
              </span>
            )}
          </button>

          {Number(guestProfile?.loyalty_points || 0) >= 10 && (
            <div
              className="flex items-center gap-1 bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium"
              title={`= Rs. ${(Number(guestProfile.loyalty_points) / 10).toFixed(0)} off your next order`}
            >
              <span className="material-symbols-outlined text-xs">stars</span>
              {guestProfile.loyalty_points} pts
            </div>
          )}

          <button 
            aria-label="Toggle Theme" 
            onClick={toggleTheme} 
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-on-surface-variant">
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * AdminTopNav — inner page header for admin screens inside the sidebar layout.
 * Props: title {string}, subtitle {string}
 */
export function AdminTopNav({ title, subtitle }) {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const navigate = useNavigate();
  // LF-01: Clock must tick — render at mount time causes a static display
  const [clockNow, setClockNow] = React.useState(Date.now());
  // A17: Live pending order count from event bus
  const [pendingCount, setPendingCount] = React.useState(0);
  const [staffRequests, setStaffRequests] = React.useState([]);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);

  const loadStaffRequests = React.useCallback(async () => {
    if (!user?.restaurantId) return;
    try {
      const requests = await adminFetchPendingStaffRequests(user.restaurantId);
      setStaffRequests(requests);
    } catch (err) {
      console.warn('Failed to load staff requests:', err.message);
    }
  }, [user?.restaurantId]);

  React.useEffect(() => {
    const t = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    return pendingOrdersBus.subscribe(setPendingCount);
  }, []);

  React.useEffect(() => {
    if (!user?.restaurantId) return;
    let ready = false;

    loadStaffRequests();
    const channel = supabase
      .channel(`admin_staff_requests:${user.restaurantId}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'StaffRequest', filter: `restaurant_id=eq.${user.restaurantId}` },
        (payload) => {
          loadStaffRequests();
          if (ready && payload.eventType === 'INSERT') {
            const type = payload.new?.request_type || 'assistance';
            addToast(`New ${type} request from a table.`, 'success');
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ready = true;
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.restaurantId, loadStaffRequests, addToast]);

  const resolveStaffRequest = async (requestId) => {
    try {
      await adminResolveStaffRequest(requestId, user.restaurantId);
      setStaffRequests(prev => prev.filter(req => req.id !== requestId));
      addToast('Staff request resolved.', 'success');
    } catch (err) {
      addToast(`Failed to resolve staff request: ${err.message}`, 'error');
    }
  };

  const notificationCount = pendingCount + staffRequests.length;

  return (
    <div className="flex items-center justify-between mb-16 transition-theme">
      <div>
        <h2 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm mt-3 italic text-on-surface-variant">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-6">
        {/* Clock */}
        <div className="flex flex-col items-end hidden lg:flex transition-theme">
          <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-on-surface-variant">
            Local Time
          </span>
          <span className="text-xl font-headline text-on-surface">
            {new Date(clockNow).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Divider */}
        <div className="h-12 w-px hidden lg:block bg-outline-variant/30" />

        <button
          onClick={toggleTheme}
          className="w-12 h-12 flex items-center justify-center rounded-full border transition-all relative cursor-pointer border-outline-variant/30 bg-surface-container-low hover:bg-surface-container-high text-on-surface"
          aria-label="Toggle Theme"
        >
          <span className="material-symbols-outlined">{isDark ? 'light_mode' : 'dark_mode'}</span>
        </button>

        {/* Notification bell — A17 */}
        <div className="relative">
          <button
            onClick={() => {
              if (staffRequests.length > 0) {
                setNotificationsOpen(open => !open);
              } else {
                navigate('/admin/orders');
              }
            }}
            className="w-12 h-12 flex items-center justify-center rounded-full border transition-all relative cursor-pointer border-outline-variant/30 bg-surface-container-low hover:bg-surface-container-high text-on-surface"
            aria-label={notificationCount > 0 ? `${notificationCount} active notifications` : 'Orders'}
            title="View notifications"
          >
            <span className="material-symbols-outlined">notifications</span>
            {notificationCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[9px] font-extrabold flex items-center justify-center animate-pulse">
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            )}
          </button>

          {notificationsOpen && staffRequests.length > 0 && (
            <div className="absolute right-0 top-14 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-outline-variant/20 bg-surface-container-low shadow-luxury p-3 z-[80]">
              <div className="flex items-center justify-between px-2 pb-3 border-b border-outline-variant/10">
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface">Staff Requests</p>
                <button
                  onClick={() => navigate('/admin/orders')}
                  className="text-[10px] font-bold uppercase tracking-widest text-primary"
                >
                  Orders
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto py-2 space-y-2">
                {staffRequests.map(req => (
                  <div key={req.id} className="rounded-xl bg-surface-container border border-outline-variant/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-on-surface">
                          Table {req.table?.number || req.table_id?.slice(-4)}
                        </p>
                        <p className="text-[10px] uppercase tracking-widest text-primary mt-1">
                          {req.request_type || 'waiter'}
                        </p>
                        {req.message && (
                          <p className="text-xs text-on-surface-variant mt-2 line-clamp-2">{req.message}</p>
                        )}
                      </div>
                      <button
                        onClick={() => resolveStaffRequest(req.id)}
                        className="px-3 py-2 rounded-lg bg-primary text-on-primary text-[10px] font-bold uppercase tracking-widest"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
