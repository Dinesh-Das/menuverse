import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Directory() {
  const navigate = useNavigate();

  const customerScreens = [
    { name: 'QR Landing', path: '/r/zaika-zindagi/t/table-01', desc: 'Entry point (requires /api/seed)' },
    { name: 'Menu Home', path: '/r/zaika-zindagi/menu', desc: 'Main category and dish grid' },
    { name: 'Checkout', path: '/r/zaika-zindagi/checkout', desc: 'Cart and payment summary' },
    { name: 'Order Status', path: '/order/SF-EXAMPLE-1234', desc: 'Live tracker (requires active orderId)' },
  ];

  const adminScreens = [
    { name: 'Admin Login', path: '/admin/login', desc: '12-col split authentication screen' },
    { name: 'Dashboard', path: '/admin/dashboard', desc: 'High-level metrics and system intelligence' },
    { name: 'Menu Assets', path: '/admin/menu', desc: 'Inventory table with AR status' },
    { name: 'AR Pipeline', path: '/admin/ar', desc: 'Photogrammetry studio and 3D viewer' },
    { name: 'QR Factory', path: '/admin/qr', desc: 'Table code generation and zones' },
    { name: 'Kitchen (KDS)', path: '/admin/kds', desc: 'Live ticket tracking with urgency alerts' },
    { name: 'Settings', path: '/admin/settings', desc: 'Brand identity and aesthetic config' },
  ];

  return (
    <div className="dark min-h-dvh bg-background text-on-surface p-6 md:p-12 relative overflow-hidden">
      {/* Ambient Glow */}
      <div className="ambient-orb-gold"></div>
      <div className="ambient-orb-blue" style={{ bottom: '10%', right: '10%', left: 'auto' }}></div>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[100px] pointer-events-none z-0"></div>

      <div className="relative z-10 max-w-5xl mx-auto pt-10">
        <header className="mb-16 text-center">
          <h1 className="font-headline text-5xl font-bold tracking-tight text-on-surface mb-4">
            Zaika Zindagi
          </h1>
          <p className="text-[12px] uppercase font-bold tracking-[0.2em] text-primary">
            Prototype Directory
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {/* Customer App Group */}
          <div>
            <div className="flex items-center gap-3 mb-6 border-b border-outline-variant/20 pb-4">
              <span className="material-symbols-outlined text-primary text-2xl">smartphone</span>
              <h2 className="font-headline text-2xl font-bold text-on-surface">Customer Experience</h2>
            </div>
            <div className="space-y-4">
              {customerScreens.map((screen, idx) => (
                <div 
                  key={idx}
                  onClick={() => navigate(screen.path)}
                  className="bg-surface-container-low/60 backdrop-blur-md p-5 rounded-2xl border border-outline-variant/15 hover:border-primary/50 cursor-pointer transition-all hover:bg-surface-container group shadow-luxury-dark"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-lg text-on-surface group-hover:text-primary transition-colors">{screen.name}</h3>
                      <p className="text-[11px] text-on-surface-variant mt-1 tracking-wide">{screen.desc}</p>
                    </div>
                    <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors group-hover:translate-x-1">
                      arrow_forward
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Admin App Group */}
          <div>
            <div className="flex items-center gap-3 mb-6 border-b border-outline-variant/20 pb-4">
              <span className="material-symbols-outlined text-primary text-2xl">desktop_windows</span>
              <h2 className="font-headline text-2xl font-bold text-on-surface">Kitchen Command</h2>
            </div>
            <div className="space-y-4">
              {adminScreens.map((screen, idx) => (
                <div 
                  key={idx}
                  onClick={() => navigate(screen.path)}
                  className="bg-surface-container-low/60 backdrop-blur-md p-5 rounded-2xl border border-outline-variant/15 hover:border-primary/50 cursor-pointer transition-all hover:bg-surface-container group shadow-luxury-dark"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-lg text-on-surface group-hover:text-primary transition-colors">{screen.name}</h3>
                      <p className="text-[11px] text-on-surface-variant mt-1 tracking-wide">{screen.desc}</p>
                    </div>
                    <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors group-hover:translate-x-1">
                      arrow_forward
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
