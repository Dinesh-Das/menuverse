import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';

/**
 * CustomerTopNav — fixed glass header for all customer-facing screens.
 * Props:
 *   showBack  {bool}   — show arrow_back button on left
 *   title     {string} — override brand with a page title
 */
export function CustomerTopNav({ showBack = false, title, logo }) {
  const { count, restaurantSlug }  = useCart();
  const { isDark, toggleTheme } = useTheme();
  const navigate   = useNavigate();

  const cartPath = restaurantSlug ? `/r/${restaurantSlug}/checkout` : '/checkout';
  const homePath = restaurantSlug ? `/r/${restaurantSlug}/menu` : '/';

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
              Zaika Zindagi
            </span>
            <span className="text-[9px] uppercase tracking-[0.4em] text-primary font-bold mt-1.5 opacity-80">
              Taste of Life
            </span>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-4">
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
  const { isDark, toggleTheme } = useTheme();

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
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

        {/* Notification bell */}
        <button
          className="w-12 h-12 flex items-center justify-center rounded-full border transition-all relative cursor-pointer border-outline-variant/30 bg-surface-container-low hover:bg-surface-container-high text-on-surface"
          aria-label="Notifications"
        >
          <span className="material-symbols-outlined">notifications</span>
          <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary animate-pulse" />
        </button>
      </div>
    </div>
  );
}
