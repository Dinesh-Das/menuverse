import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCart } from '../context/CartContext';

const TABS = [
  { id: 'menu',   label: 'Discover', icon: 'explore',       pathKey: 'menu'     },
  { id: 'ar',     label: 'AR View',  icon: 'view_in_ar',    pathKey: 'dish'     },
  { id: 'cart',   label: 'Cart',     icon: 'shopping_bag',  pathKey: 'checkout' },
  { id: 'status', label: 'Orders',   icon: 'receipt_long', pathKey: 'table'    },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { count, restaurantSlug } = useCart();

  // Build slug-scoped paths if we have context, otherwise fall back to legacy
  const base = restaurantSlug ? `/r/${restaurantSlug}` : '';
  const paths = {
    menu:     `${base}/menu`,
    dish:     `${base}/dish`,
    checkout: `${base}/checkout`,
    table:    `${base}/table`,
  };

  const currentTab = TABS.find(t => location.pathname.includes(`/${t.pathKey}`))?.id || 'menu';

  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 glass-bottom-dark rounded-t-3xl">
      <div className="flex justify-around items-end px-4 pb-6 pt-2 max-w-7xl mx-auto">
        {TABS.map(tab => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => navigate(paths[tab.pathKey])}
              className={`flex flex-col items-center justify-center transition-all duration-200 cursor-pointer relative ${
                isActive
                  ? 'bg-amber-500 text-[#131313] rounded-full p-3 mb-2 scale-110 shadow-lg shadow-amber-500/20'
                  : 'text-on-surface-variant p-2 active:scale-90 hover:text-amber-200'
              }`}
            >
              <span
                className={`material-symbols-outlined ${isActive ? 'filled' : ''}`}
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
              >
                {tab.icon}
              </span>
              <span className="font-manrope text-[10px] font-bold uppercase tracking-[0.1em] mt-1">
                {tab.label}
              </span>
              {/* Cart badge */}
              {tab.id === 'cart' && count > 0 && !isActive && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
