import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Overview',    icon: 'dashboard',       path: '/admin/dashboard' },
  { id: 'menu',      label: 'Menu Assets', icon: 'restaurant_menu', path: '/admin/menu'      },
  { id: 'orders',    label: 'Live Orders', icon: 'list_alt',        path: '/admin/orders'    },
  { id: 'kds',       label: 'Kitchen',     icon: 'receipt_long',    path: '/admin/kds'       },
  { id: 'ar',        label: 'AR Pipeline', icon: 'view_in_ar',      path: '/admin/ar'        },
  { id: 'qr',        label: 'QR Factory',  icon: 'qr_code_2',       path: '/admin/qr'        },
  { id: 'settings',  label: 'Settings',    icon: 'settings',        path: '/admin/settings'  },
];

/**
 * AdminSidebar — receives `isOpen` and `onClose` props from the parent layout.
 * On desktop (lg+), the sidebar is always visible via CSS.
 * On mobile/tablet it slides in as an off-canvas drawer.
 */
export default function AdminSidebar({ isOpen = false, onClose = () => {} }) {
  const { isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const activeId = NAV_ITEMS.find(n => location.pathname.startsWith(n.path))?.id || 'dashboard';

  const handleNav = (path) => {
    navigate(path);
    onClose(); // close drawer on mobile after navigation
  };

  return (
    <>
      {/* Off-canvas overlay (mobile/tablet only) */}
      <div
        className={`admin-overlay ${isOpen ? 'open' : ''} lg:hidden`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`admin-sidebar flex flex-col transition-theme bg-surface-container-low border-r border-outline-variant/10 ${isOpen ? 'open' : ''}`}
        aria-label="Admin navigation"
      >
        {/* ── Brand ───────────────────────────────────────────── */}
        <div className="px-8 pt-10 pb-8 flex items-center justify-between">
          <div
            className="cursor-pointer"
            onClick={() => handleNav('/admin/dashboard')}
          >
            {user?.restaurant?.logo_url ? (
              <img 
                src={user.restaurant.logo_url} 
                alt="Brand Logo" 
                className="h-10 w-auto mb-2"
              />
            ) : (
              <h1 className="text-xl font-headline font-bold tracking-tight text-on-surface">
                Kitchen Command
              </h1>
            )}
            <p className="text-[9px] tracking-[0.2em] uppercase font-bold mt-0.5 text-primary">
              {user?.restaurant?.name || 'Studio Mode'}
            </p>
          </div>
          {/* Close button — visible only on mobile/tablet */}
          <button
            onClick={onClose}
            className="lg:hidden material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer"
            aria-label="Close navigation"
            style={{ minWidth: 'var(--tap-target)', minHeight: 'var(--tap-target)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            close
          </button>
        </div>

        {/* ── Nav ─────────────────────────────────────────────── */}
        <nav className="flex-1 flex flex-col space-y-1 px-0" role="navigation">
          {NAV_ITEMS.map(item => {
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.path)}
                className={`w-full flex items-center px-8 text-left transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'text-on-surface font-bold border-r-2 border-primary bg-primary/5'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }`}
                style={{ minHeight: 'var(--tap-target)' }}
                aria-current={isActive ? 'page' : undefined}
              >
                <span
                  className={`material-symbols-outlined mr-4 ${isActive ? 'text-primary' : ''}`}
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
                >
                  {item.icon}
                </span>
                <span className="text-xs tracking-widest uppercase">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ── Bottom Section ───────────────────────────────────── */}
        <div className="px-6 pb-10 space-y-3">
          <button
            onClick={() => handleNav('/admin/ar')}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-bold text-xs tracking-widest uppercase transition-all luxury-shadow bg-on-surface text-background hover:bg-primary hover:text-on-primary cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            Generate 3D
          </button>

          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer text-on-surface-variant hover:text-on-surface"
            style={{ minHeight: 'var(--tap-target)' }}
          >
            <span className="material-symbols-outlined text-sm">
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
            {isDark ? 'Light Mode' : 'Dark Mode'}
          </button>

          <div className="flex items-center gap-3 pt-4 mt-2 border-t border-outline-variant/20">
            <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
              {user?.email?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate text-on-surface">
                {user?.email?.split('@')[0] || 'Admin'}
              </p>
              <p className="text-[10px] uppercase tracking-wider truncate text-on-surface-variant">
                {user?.role === 'owner' ? 'Owner' : user?.role === 'manager' ? 'Manager' : user?.role === 'staff' ? 'Kitchen Staff' : 'Admin'}
              </p>
            </div>
            <button
              onClick={() => { logout(); navigate('/admin/login'); }}
              className="material-symbols-outlined transition-colors cursor-pointer text-on-surface-variant hover:text-error"
              style={{ minWidth: 'var(--tap-target)', minHeight: 'var(--tap-target)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}
              title="Sign out"
            >
              logout
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
