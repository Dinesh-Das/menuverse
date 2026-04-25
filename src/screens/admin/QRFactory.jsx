import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { adminFetchTables, adminCreateTable } from '../../lib/api';
import { useToast } from '../../components/Toast';

export default function QRFactory() {
  const { addToast } = useToast();
  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem]';
  const tableCardBg = 'bg-surface-container border border-outline-variant/10 rounded-2xl';
  const inputClass = `w-full px-4 py-3 rounded-xl border focus:outline-none focus:border-primary transition-colors bg-surface-container-low border-outline-variant text-on-surface placeholder-secondary/50`;

  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form State
  const [form, setForm] = useState({ number: '', section: 'Main Hall', capacity: 4 });

  const loadTables = () => {
    setLoading(true);
    adminFetchTables()
      .then(data => {
        setTables(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        addToast('Failed to load tables', 'error');
        setLoading(false);
      });
  };

  useEffect(() => {
    loadTables();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.number) return;
    setSaving(true);
    try {
      await adminCreateTable(form);
      addToast(`Table ${form.number} created successfully!`, 'success');
      setIsModalOpen(false);
      setForm({ number: '', section: 'Main Hall', capacity: 4 });
      loadTables();
    } catch (err) {
      addToast(`Error: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = (table) => {
    if (!table.qr_code_url) return;
    fetch(table.qr_code_url)
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zaika-zindagi-table-${table.number}-qr.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12">
        <AdminTopNav
          title="QR Factory"
          subtitle="Generate and manage physical access points to the Zaika Zindagi."
        />

        <div className={`p-10 mb-8 flex justify-between items-center ${cardBg}`}>
          <div>
            <h2 className="font-headline text-2xl font-bold mb-2 text-on-surface">
              Table Connectivity
            </h2>
            <p className="text-sm text-on-surface-variant">
              Download high-res QR vectors for physical printing.
            </p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer shadow-md active:scale-95 flex items-center gap-2 bg-primary text-on-primary hover:bg-primary-container"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New Table
          </button>
        </div>

        {/* Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
            <div className={`relative w-full max-w-md p-10 ${cardBg} animate-in fade-in zoom-in duration-300`}>
              <h3 className="font-headline text-2xl font-bold mb-6 text-on-surface">Register Table</h3>
              <form onSubmit={handleCreate} className="space-y-6">
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-on-surface-variant">Table Number</label>
                  <input
                    required
                    type="text"
                    value={form.number}
                    onChange={e => setForm({...form, number: e.target.value})}
                    placeholder="e.g. 07"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-on-surface-variant">Section / Area</label>
                  <input
                    type="text"
                    value={form.section}
                    onChange={e => setForm({...form, section: e.target.value})}
                    placeholder="e.g. Main Hall"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-on-surface-variant">Capacity</label>
                  <input
                    type="number"
                    value={form.capacity}
                    onChange={e => setForm({...form, capacity: parseInt(e.target.value)})}
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
                    {saving ? <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span> : null}
                    {saving ? 'Creating...' : 'Register Table'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <span className="material-symbols-outlined text-primary animate-spin text-4xl">progress_activity</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {tables.map(table => (
              <div key={table.id} className={`p-8 flex flex-col items-center text-center ${tableCardBg}`}>
                <div className="w-40 h-40 rounded-xl mb-6 flex items-center justify-center relative bg-white shadow-sm overflow-hidden">
                  {table.qr_code_url ? (
                    <img src={table.qr_code_url} alt={`QR for Table ${table.number}`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="material-symbols-outlined text-[8rem] text-black">qr_code_2</span>
                  )}
                  {/* Center Logo */}
                  <div className="absolute inset-0 m-auto w-8 h-8 bg-white rounded-full flex items-center justify-center border-2 border-black">
                    <span className="font-headline text-[10px] font-bold text-black italic">M</span>
                  </div>
                </div>
                
                <h3 className="font-headline text-xl font-bold mb-1 text-on-surface">Table {table.number}</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-4 text-primary">
                  {table.id.slice(-6)} <span className="mx-2">•</span> {table.section}
                </p>
                <p className="text-xs text-on-surface-variant mb-4">Capacity: {table.capacity}</p>
                
                <div className="w-full grid grid-cols-2 gap-3 mt-auto pt-4">
                  <button className="py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer border flex items-center justify-center gap-2 border-outline-variant/30 hover:bg-surface-container-high text-on-surface">
                    <span className="material-symbols-outlined text-sm">edit</span> Edit
                  </button>
                  <button
                    onClick={() => handleDownload(table)}
                    disabled={!table.qr_code_url}
                    className="py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2 bg-primary text-on-primary hover:bg-primary-container disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-sm">download</span> PNG
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </AdminLayout>
  );
}
