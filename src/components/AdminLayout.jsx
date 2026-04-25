import React, { useState } from 'react';
import AdminSidebar from './AdminSidebar';

/**
 * AdminLayout — wraps every admin screen.
 * Manages hamburger open/close state so no screen needs local sidebar state.
 * Usage:
 *   <AdminLayout>
 *     <div className="admin-content p-8">…</div>
 *   </AdminLayout>
 */
export default function AdminLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="admin-layout">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area */}
      <div className="admin-content flex flex-col min-h-dvh">
        {/* Mobile topbar with hamburger */}
        <div className="lg:hidden flex items-center gap-4 px-4 py-3 border-b border-outline-variant/20 bg-surface-container-low sticky top-0 z-50">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center justify-center rounded-lg text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
            style={{ minWidth: 'var(--tap-target)', minHeight: 'var(--tap-target)' }}
            aria-label="Open navigation"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <span className="font-headline font-bold text-on-surface">Kitchen Command</span>
        </div>

        {children}
      </div>
    </div>
  );
}
