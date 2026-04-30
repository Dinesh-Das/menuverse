import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { adminFetchTables, adminCreateTable, adminClearTable } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';

// ── Build the URL a customer will land on when they scan ───────
function buildQrUrl(table, restaurant) {
  const base = import.meta.env.VITE_CUSTOMER_APP_URL || window.location.origin;
  const slug = restaurant?.slug || 'zaika-zindagi';
  return `${base}/r/${slug}/t/${table.id}`;
}

// ── Renders a single QR canvas and returns download helpers ────
function QrCanvas({ url, size = 180 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: size,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
      errorCorrectionLevel: 'H', // High — needed for centre logo overlay
    });
  }, [url, size]);

  return <canvas ref={canvasRef} width={size} height={size} className="rounded-lg" />;
}

// ── Download QR as PNG with a Zaika Zindagi logo overlay ───────
async function downloadQrPng(table, restaurant) {
  const url = buildQrUrl(table, restaurant);
  const SIZE = 512;

  // 1. Generate QR into an off-screen canvas
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  await QRCode.toCanvas(canvas, url, {
    width: SIZE,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  });

  // 2. Stamp a white circle logo in the centre
  const ctx = canvas.getContext('2d');
  const logoR = SIZE * 0.09;
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, logoR + 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, logoR, 0, Math.PI * 2);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${logoR * 0.9}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Z', cx, cy + 1);

  // 3. Trigger download
  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zaika-zindagi-table-${table.number}-qr.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

export default function QRFactory() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] transition-theme';
  const tableCardBg = 'bg-surface-container border border-outline-variant/10 rounded-2xl transition-theme';
  const inputClass = `w-full px-4 py-3 rounded-xl border focus:outline-none focus:border-primary transition-all bg-surface-container-low border-outline-variant text-on-surface placeholder-secondary/50`;

  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ number: '', section: 'Main Hall', capacity: 4, status: 'available' });

  const restaurant = user?.restaurant;

  const loadTables = useCallback(() => {
    setLoading(true);
    adminFetchTables()
      .then(data => { setTables(data || []); setLoading(false); })
      .catch(err => {
        console.error(err);
        addToast('Failed to load tables', 'error');
        setLoading(false);
      });
  }, [addToast]);

  useEffect(() => {
    if (user?.restaurantId) loadTables();
  }, [user, loadTables]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.number || !user?.restaurantId) return;
    setSaving(true);
    try {
      const tableId = crypto.randomUUID();
      const payload = { id: tableId, ...form, restaurant_id: user.restaurantId };
      await adminCreateTable(payload);
      addToast(`Table ${form.number} created!`, 'success');
      setIsModalOpen(false);
      setForm({ number: '', section: 'Main Hall', capacity: 4, status: 'available' });
      loadTables();
    } catch (err) {
      console.error(err);
      addToast(`Error: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClearTable = async (tableId, number) => {
    if (!window.confirm(`Are you sure you want to clear Table ${number}? This will mark all active orders as completed.`)) return;
    try {
      await adminClearTable(tableId);
      addToast(`Table ${number} cleared!`, 'success');
      loadTables();
    } catch (err) {
      addToast(`Error clearing table: ${err.message}`, 'error');
    }
  };

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav
          title="QR Factory"
          subtitle="Generate scannable QR codes for each table. Customers scan to open the menu."
        />

        {/* Hero card */}
        <div className={`p-10 mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${cardBg}`}>
          <div>
            <h2 className="font-headline text-2xl font-bold mb-2 text-on-surface">Table Connectivity</h2>
            <p className="text-sm text-on-surface-variant max-w-md">
              Each QR code encodes a unique table URL. Customers scan → land on the menu → order.
              Download high-res PNGs for physical printing.
            </p>
            {restaurant?.slug && (
              <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-full inline-block">
                Base URL: {window.location.origin}/r/{restaurant.slug}/t/…
              </p>
            )}
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="shrink-0 px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer shadow-md active:scale-95 flex items-center gap-2 bg-primary text-on-primary hover:bg-primary-container"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New Table
          </button>
        </div>

        {/* Create Table Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
            <div className={`relative w-full max-w-md p-10 ${cardBg} animate-in fade-in zoom-in duration-300`}>
              <h3 className="font-headline text-2xl font-bold mb-6 text-on-surface">Register Table</h3>
              <form onSubmit={handleCreate} className="space-y-6">
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-on-surface-variant">Table Number / Name</label>
                  <input
                    required
                    type="text"
                    value={form.number}
                    onChange={e => setForm({ ...form, number: e.target.value })}
                    placeholder="e.g. 07 or Terrace-A"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-on-surface-variant">Section / Area</label>
                  <input
                    type="text"
                    value={form.section}
                    onChange={e => setForm({ ...form, section: e.target.value })}
                    placeholder="e.g. Main Hall"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-on-surface-variant">Seating Capacity</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={form.capacity}
                    onChange={e => setForm({ ...form, capacity: parseInt(e.target.value) || 1 })}
                    className={inputClass}
                  />
                </div>
                <div className="flex justify-end gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-8 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest bg-primary text-on-primary shadow-luxury active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                  >
                    {saving && <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>}
                    {saving ? 'Creating…' : 'Register Table'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Table Grid */}
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <span className="material-symbols-outlined text-primary animate-spin text-4xl">progress_activity</span>
          </div>
        ) : tables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <span className="material-symbols-outlined text-7xl text-on-surface-variant/20 mb-4">qr_code_2</span>
            <p className="text-on-surface-variant font-medium">No tables yet. Click "+ New Table" to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {tables.map(table => {
              const qrUrl = buildQrUrl(table, restaurant);
              return (
                <div key={table.id} className={`p-8 flex flex-col items-center text-center ${tableCardBg}`}>
                  {/* QR Code */}
                  <div className="relative mb-6">
                    <div className="p-3 bg-white rounded-2xl shadow-luxury">
                      <QrCanvas url={qrUrl} size={180} />
                    </div>
                    {/* Branded centre dot */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-9 h-9 bg-black rounded-full flex items-center justify-center border-2 border-white shadow">
                        <span className="font-headline text-[11px] font-bold text-white italic">Z</span>
                      </div>
                    </div>
                  </div>

                  <h3 className="font-headline text-xl font-bold mb-1 text-on-surface">Table {table.number}</h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-primary">
                    {table.id.slice(-6)} <span className="mx-1">•</span> {table.section}
                  </p>
                  <p className="text-xs text-on-surface-variant mb-2">Capacity: {table.capacity}</p>

                  {/* Scannable URL preview */}
                  <p className="text-[9px] text-on-surface-variant/50 break-all mb-6 font-mono px-2">
                    {qrUrl}
                  </p>

                  {/* Status chip */}
                  <span className={`text-[9px] uppercase font-bold px-3 py-1 rounded-full mb-6 ${
                    table.status === 'available'  ? 'bg-green-500/10 text-green-500' :
                    table.status === 'occupied'   ? 'bg-amber-500/10 text-amber-500' :
                    'bg-surface-container-high text-on-surface-variant'
                  }`}>
                    {table.status}
                  </span>

                  {/* Actions */}
                  <div className="w-full grid grid-cols-2 gap-3 mt-auto mb-3">
                    {/* Copy link */}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(qrUrl);
                        addToast('Link copied!', 'success');
                      }}
                      className="py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer border flex items-center justify-center gap-2 border-outline-variant/30 hover:bg-surface-container-high text-on-surface"
                    >
                      <span className="material-symbols-outlined text-sm">link</span> Copy
                    </button>
                    {/* Download PNG */}
                    <button
                      onClick={() => downloadQrPng(table, restaurant)}
                      className="py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2 bg-primary text-on-primary hover:bg-primary-container active:scale-95"
                    >
                      <span className="material-symbols-outlined text-sm">download</span> PNG
                    </button>
                  </div>
                  
                  {table.status !== 'available' && (
                    <button
                      onClick={() => handleClearTable(table.id, table.number)}
                      className="w-full py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2 border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 active:scale-95 mt-auto"
                    >
                      <span className="material-symbols-outlined text-sm">cleaning_services</span>
                      Clear Table
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </AdminLayout>
  );
}
