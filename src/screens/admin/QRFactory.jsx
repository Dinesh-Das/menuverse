import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { adminFetchTables, adminCreateTable, adminClearTable, adminDeleteTable, adminUpdateTable } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';

// ── Build the URL a customer will land on when they scan ───────
function buildQrUrl(table, restaurant) {
  const base = import.meta.env.VITE_CUSTOMER_APP_URL || window.location.origin;
  const slug = restaurant?.slug || 'menuverse';
  return `${base}/r/${slug}/t/${table.id}`;
}

function safeFilePart(value, fallback = 'menuverse') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function getRestaurantInitial(restaurant) {
  const name = restaurant?.name || restaurant?.slug || 'Menuverse';
  return name.trim().charAt(0).toUpperCase() || 'M';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadLogoImage(url) {
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const image = document.createElement('img');
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function drawInitialsFallback(ctx, restaurant, cx, cy, logoR) {
  ctx.beginPath();
  ctx.arc(cx, cy, logoR, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${logoR * 0.9}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(getRestaurantInitial(restaurant), cx, cy + 1);
}

async function drawQrLogo(ctx, restaurant, cx, cy, logoR) {
  ctx.beginPath();
  ctx.arc(cx, cy, logoR + 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  const logo = await loadLogoImage(restaurant?.logo_url);
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, logoR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, cx - logoR, cy - logoR, logoR * 2, logoR * 2);
    ctx.restore();
    return;
  }

  drawInitialsFallback(ctx, restaurant, cx, cy, logoR);
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

// ── Download QR as PNG with a restaurant logo overlay ───────
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

  // 2. Stamp the restaurant logo or initials in the centre.
  const ctx = canvas.getContext('2d');
  const logoR = SIZE * 0.09;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  await drawQrLogo(ctx, restaurant, cx, cy, logoR);

  // 3. Trigger download
  canvas.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeFilePart(restaurant?.slug)}-table-${safeFilePart(table.number, table.id)}-qr.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

async function downloadStickerPng(table, restaurant) {
  const url = buildQrUrl(table, restaurant);
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#171717';
  ctx.fillRect(48, 48, canvas.width - 96, canvas.height - 96);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(78, 78, canvas.width - 156, canvas.height - 156);

  ctx.fillStyle = '#171717';
  ctx.textAlign = 'center';
  ctx.font = 'bold 54px serif';
  ctx.fillText(restaurant?.name || 'Menuverse', 450, 180);
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(`Table ${table.number}`, 450, 250);

  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, {
    width: 560,
    margin: 2,
    color: { dark: '#171717', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  });
  await drawQrLogo(qrCanvas.getContext('2d'), restaurant, 280, 280, 54);
  ctx.drawImage(qrCanvas, 170, 320, 560, 560);

  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Scan to order', 450, 940);
  ctx.font = '22px monospace';
  ctx.fillStyle = '#555555';
  ctx.fillText(url.replace(/^https?:\/\//, ''), 450, 1000);

  canvas.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeFilePart(restaurant?.slug)}-table-${safeFilePart(table.number, table.id)}-sticker.png`;
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
  const [tableActionId, setTableActionId] = useState(null);
  const [form, setForm] = useState({ number: '', section: 'Main Hall', capacity: 4, status: 'available' });
  const [bulkPdfState, setBulkPdfState] = useState({ generating: false, processed: 0, total: 0 });

  const restaurant = user?.restaurant;

  const loadTables = useCallback(() => {
    setLoading(true);
    adminFetchTables(user?.restaurantId)
      .then(data => { setTables(data || []); setLoading(false); })
      .catch(err => {
        console.error(err);
        addToast('Failed to load tables', 'error');
        setLoading(false);
      });
  }, [addToast, user?.restaurantId]);

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
    setTableActionId(`clear-${tableId}`);
    try {
      await adminClearTable(tableId, user.restaurantId);
      addToast(`Table ${number} cleared!`, 'success');
      loadTables();
    } catch (err) {
      addToast(`Error clearing table: ${err.message}`, 'error');
    } finally {
      setTableActionId(null);
    }
  };

  const handleDeleteTable = async (tableId, number, isTableActive) => {
    if (isTableActive) {
      addToast(`Cannot delete Table ${number} while it is active. Please clear it first.`, 'error');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete Table ${number}? This action cannot be undone.`)) return;
    
    setTableActionId(`delete-${tableId}`);
    try {
      await adminDeleteTable(tableId, user.restaurantId);
      addToast(`Table ${number} deleted!`, 'success');
      loadTables();
    } catch (err) {
      addToast(`Error deleting table: ${err.message}`, 'error');
    } finally {
      setTableActionId(null);
    }
  };

  const handleToggleQr = async (table) => {
    const enabled = table.qr_enabled !== false;
    setTableActionId(`qr-${table.id}`);
    try {
      await adminUpdateTable(table.id, { qr_enabled: !enabled }, user.restaurantId);
      addToast(`QR ${enabled ? 'disabled' : 'enabled'} for Table ${table.number}.`, 'success');
      loadTables();
    } catch (err) {
      addToast(`QR update failed: ${err.message}`, 'error');
    } finally {
      setTableActionId(null);
    }
  };

  const handleDownloadAllPdf = async () => {
    if (!tables.length || bulkPdfState.generating) return;

    setBulkPdfState({ generating: true, processed: 0, total: tables.length });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pages = [];
    for (let i = 0; i < tables.length; i += 6) pages.push(tables.slice(i, i + 6));

    try {
      let processed = 0;
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const pageTables = pages[pageIndex];
        const page = document.createElement('div');
        page.style.cssText = [
          'position:fixed',
          'left:-10000px',
          'top:0',
          'width:794px',
          'height:1123px',
          'padding:42px',
          'background:#ffffff',
          'color:#171717',
          'display:grid',
          'grid-template-columns:1fr 1fr',
          'grid-template-rows:1fr 1fr 1fr',
          'gap:24px',
          'font-family:Arial,sans-serif',
        ].join(';');

        const cells = [];
        for (const table of pageTables) {
          const qrDataUrl = await QRCode.toDataURL(buildQrUrl(table, restaurant), {
            width: 360,
            margin: 2,
            color: { dark: '#171717', light: '#ffffff' },
            errorCorrectionLevel: 'H',
          });
          processed += 1;
          setBulkPdfState({ generating: true, processed, total: tables.length });

          const logo = restaurant?.logo_url
            ? `<img src="${escapeHtml(restaurant.logo_url)}" crossorigin="anonymous" style="width:42px;height:42px;border-radius:999px;object-fit:cover;border:2px solid #171717;" />`
            : `<div style="width:42px;height:42px;border-radius:999px;background:#171717;color:#ffffff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;">${escapeHtml(getRestaurantInitial(restaurant))}</div>`;

          cells.push(`
            <div style="border:2px solid #171717;border-radius:18px;padding:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
              <div style="display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:14px;">
                ${logo}
                <div style="text-align:left;">
                  <div style="font-size:16px;line-height:1.1;font-weight:800;">${escapeHtml(restaurant?.name || 'Menuverse')}</div>
                  <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#666;margin-top:4px;">Scan to order</div>
                </div>
              </div>
              <img src="${qrDataUrl}" style="width:230px;height:230px;display:block;" />
              <div style="font-size:30px;font-weight:800;margin-top:10px;">Table ${escapeHtml(table.number)}</div>
              <div style="font-size:12px;color:#666;margin-top:4px;">${escapeHtml(table.section || '')}</div>
            </div>
          `);
        }

        page.innerHTML = cells.join('');
        document.body.appendChild(page);
        const canvas = await html2canvas(page, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        document.body.removeChild(page);

        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297);
      }

      pdf.save(`${safeFilePart(restaurant?.slug)}-all-table-qrs.pdf`);
      addToast('All table QR codes exported as PDF.', 'success');
    } catch (err) {
      console.error(err);
      addToast(`PDF export failed: ${err.message}`, 'error');
    } finally {
      setBulkPdfState({ generating: false, processed: 0, total: 0 });
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
          <div className="shrink-0 flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleDownloadAllPdf}
              disabled={bulkPdfState.generating || tables.length === 0}
              className="px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer shadow-md active:scale-95 flex items-center justify-center gap-2 border border-outline-variant/30 text-on-surface hover:bg-surface-container-high disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-sm ${bulkPdfState.generating ? 'animate-spin' : ''}`}>{bulkPdfState.generating ? 'progress_activity' : 'picture_as_pdf'}</span>
              {bulkPdfState.generating
                ? `${bulkPdfState.processed}/${bulkPdfState.total} tables`
                : 'Download All Tables as PDF'}
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer shadow-md active:scale-95 flex items-center justify-center gap-2 bg-primary text-on-primary hover:bg-primary-container"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              New Table
            </button>
          </div>
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
                      <div className="w-9 h-9 bg-black rounded-full flex items-center justify-center border-2 border-white shadow overflow-hidden">
                        {restaurant?.logo_url ? (
                          <img src={restaurant.logo_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="font-headline text-[10px] font-bold text-white">
                            {getRestaurantInitial(restaurant)}
                          </span>
                        )}
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
                    table.qr_enabled === false ? 'bg-error/10 text-error' :
                    table.status === 'available'  ? 'bg-green-500/10 text-green-500' :
                    table.status === 'occupied'   ? 'bg-amber-500/10 text-amber-500' :
                    'bg-surface-container-high text-on-surface-variant'
                  }`}>
                    {table.qr_enabled === false ? 'qr disabled' : table.status}
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

                  <div className="w-full grid grid-cols-2 gap-3 mb-3">
                    <button
                      onClick={() => downloadStickerPng(table, restaurant)}
                      className="py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer border flex items-center justify-center gap-2 border-outline-variant/30 hover:bg-surface-container-high text-on-surface"
                    >
                      <span className="material-symbols-outlined text-sm">article</span> Sticker
                    </button>
                    <button
                      onClick={() => handleToggleQr(table)}
                      disabled={tableActionId === `qr-${table.id}`}
                      className={`py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer border flex items-center justify-center gap-2 disabled:opacity-50 ${
                        table.qr_enabled === false
                          ? 'border-green-500/30 text-green-500 hover:bg-green-500/10'
                          : 'border-error/30 text-error hover:bg-error/10'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">
                        {table.qr_enabled === false ? 'qr_code' : 'block'}
                      </span>
                      {table.qr_enabled === false ? 'Enable QR' : 'Disable QR'}
                    </button>
                  </div>
                  
                  {table.status !== 'available' && (
                    <button
                      onClick={() => handleClearTable(table.id, table.number)}
                      disabled={tableActionId === `clear-${table.id}`}
                      className="w-full py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2 border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 active:scale-95 mt-auto mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className={`material-symbols-outlined text-sm ${tableActionId === `clear-${table.id}` ? 'animate-spin' : ''}`}>
                        {tableActionId === `clear-${table.id}` ? 'progress_activity' : 'cleaning_services'}
                      </span>
                      {tableActionId === `clear-${table.id}` ? 'Clearing...' : 'Clear Table'}
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleDeleteTable(table.id, table.number, table.status !== 'available')}
                    disabled={tableActionId === `delete-${table.id}`}
                    className="w-full py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2 border border-error/30 text-error hover:bg-error/10 active:scale-95 mt-auto disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className={`material-symbols-outlined text-sm ${tableActionId === `delete-${table.id}` ? 'animate-spin' : ''}`}>
                      {tableActionId === `delete-${table.id}` ? 'progress_activity' : 'delete'}
                    </span>
                    {tableActionId === `delete-${table.id}` ? 'Deleting...' : 'Delete Table'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </AdminLayout>
  );
}
