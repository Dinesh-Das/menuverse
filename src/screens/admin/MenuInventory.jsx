import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { adminFetchMenuItems, adminFetchCategories, adminCreateMenuItem, adminUpdateMenuItem } from '../../lib/api';

import { useAuth } from '../../context/AuthContext';
export default function MenuInventory() {
  const { user } = useAuth();
  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem]';
  const rowBg = 'hover:bg-surface-container border-outline-variant/10';

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal State
  const [editingItem, setEditingItem] = useState(null); // null = closed, {} = new, {id...} = existing
  const [formData, setFormData] = useState({
    name: '', description: '', price: '', category_id: '', image_url: '', dietary_flag: 'none', available: true
  });
  const [saving, setSaving] = useState(false);

  const loadData = () => {
    setLoading(true);
    Promise.all([adminFetchMenuItems(), adminFetchCategories()])
      .then(([itemsData, catsData]) => {
        setItems(itemsData);
        setCategories(catsData);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData();
  }, []);

  const openNewModal = () => {
    setFormData({ name: '', description: '', price: '', category_id: categories[0]?.id || '', image_url: '', dietary_flag: 'none', available: true });
    setEditingItem({});
  };

  const openEditModal = (item) => {
    setFormData({
      name: item.name,
      description: item.description || '',
      price: item.price,
      category_id: item.category_id,
      image_url: item.image_url || '',
      dietary_flag: item.dietary_flag || 'none',
      available: item.available
    });
    setEditingItem(item);
  };

  const closeModal = () => setEditingItem(null);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        price: parseFloat(formData.price),
        dietary_flag: formData.dietary_flag === 'none' ? null : formData.dietary_flag
      };
      
      if (editingItem.id) {
        await adminUpdateMenuItem(editingItem.id, { ...payload, restaurant_id: user.restaurantId });
      } else {
        await adminCreateMenuItem({ ...payload, restaurant_id: user.restaurantId });
      }
      closeModal();
      loadData();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12">
        <AdminTopNav
          title="Menu Assets"
          subtitle="Manage digital catalog and 3D AR pipelines."
        />

        <div className={`p-8 ${cardBg}`}>
          <div className="flex justify-between items-center mb-8 px-4">
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border w-96 transition-colors bg-surface-container border-outline-variant/20 focus-within:border-primary">
              <span className="material-symbols-outlined text-lg text-on-surface-variant">search</span>
              <input 
                type="text" 
                placeholder="Search catalog..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-transparent focus:outline-none text-sm font-medium text-on-surface placeholder-on-surface-variant"
              />
            </div>
            
            <button onClick={openNewModal} className="px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer shadow-md active:scale-95 flex items-center gap-2 bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary">
              <span className="material-symbols-outlined text-sm">add</span>
              New Item
            </button>
          </div>

          <div className="w-full overflow-x-auto">
            {/* Table Header */}
            <div className="min-w-[800px] grid grid-cols-12 gap-4 px-8 pb-4 text-[10px] uppercase font-bold tracking-[0.2em] border-b text-on-surface-variant border-outline-variant/20">
              <div className="col-span-5">Item</div>
              <div className="col-span-3">Category</div>
              <div className="col-span-2">Price</div>
              <div className="col-span-2 text-right">AR Status</div>
            </div>

            {/* Table Rows */}
            {loading ? (
              <div className="p-8 text-center text-on-surface-variant">Loading items...</div>
            ) : (
              <div className="flex flex-col min-w-[800px]">
                {filtered.map(item => (
                  <div key={item.id} onClick={() => openEditModal(item)} className={`grid grid-cols-12 gap-4 px-8 py-5 items-center border-b last:border-0 transition-colors cursor-pointer ${rowBg}`}>
                    <div className="col-span-5 flex items-center gap-4">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-12 h-12 rounded-lg object-cover shadow-sm" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface-variant">
                          <span className="material-symbols-outlined">restaurant</span>
                        </div>
                      )}
                      <div>
                        <h4 className="font-headline font-bold text-base text-on-surface">{item.name}</h4>
                        <p className="text-[10px] uppercase tracking-widest mt-1 text-on-surface-variant">{item.id.slice(-6)}</p>
                      </div>
                    </div>
                    
                    <div className="col-span-3 text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">
                      {item.category?.name || 'Uncategorized'}
                    </div>
                    
                    <div className="col-span-2 font-headline font-bold text-lg text-primary">
                      ₹{item.price.toFixed(2)}
                    </div>
                    
                    <div className="col-span-2 text-right">
                      {/* For now, just show None since AR is out of scope */}
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] uppercase font-bold tracking-widest border bg-surface-container text-on-surface-variant border-outline-variant/30">
                        <span className="material-symbols-outlined text-[12px]">block</span> None
                      </span>
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className="p-8 text-center text-on-surface-variant">No menu items found.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── MODAL ──────────────────────────────────────────────────────────── */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-dim/80 backdrop-blur-sm">
          <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container">
              <h2 className="font-headline text-xl font-bold text-on-surface">
                {editingItem.id ? 'Edit Menu Item' : 'New Menu Item'}
              </h2>
              <button onClick={closeModal} className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors cursor-pointer">
                close
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto no-scrollbar flex-1">
              <form id="item-form" onSubmit={handleSave} className="space-y-5">
                
                <div className="grid grid-cols-2 gap-5">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Item Name</label>
                    <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary" placeholder="e.g. Truffle Fries" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Price (₹)</label>
                    <input required type="number" step="0.01" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary" placeholder="0.00" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Category</label>
                    <select required value={formData.category_id} onChange={e => setFormData({...formData, category_id: e.target.value})} className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary">
                      <option value="" disabled>Select Category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Description</label>
                    <textarea rows="3" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary resize-none" placeholder="Short description of the dish..." />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Image URL</label>
                    <input type="url" value={formData.image_url} onChange={e => setFormData({...formData, image_url: e.target.value})} className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary" placeholder="https://..." />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Dietary Flag</label>
                    <select value={formData.dietary_flag} onChange={e => setFormData({...formData, dietary_flag: e.target.value})} className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary">
                      <option value="none">None</option>
                      <option value="veg">Vegetarian</option>
                      <option value="non-veg">Non-Vegetarian</option>
                      <option value="vegan">Vegan</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-3 pt-6">
                    <input type="checkbox" id="available" checked={formData.available} onChange={e => setFormData({...formData, available: e.target.checked})} className="w-5 h-5 accent-primary cursor-pointer" />
                    <label htmlFor="available" className="text-sm font-bold text-on-surface cursor-pointer">Available in Menu</label>
                  </div>
                </div>

              </form>
            </div>
            
            <div className="p-6 border-t border-outline-variant/20 bg-surface-container flex justify-end gap-3">
              <button onClick={closeModal} className="px-6 py-2.5 rounded-xl font-bold text-sm text-on-surface-variant hover:bg-surface-container-highest transition-colors cursor-pointer">
                Cancel
              </button>
              <button form="item-form" disabled={saving} type="submit" className="px-8 py-2.5 rounded-xl font-bold text-sm bg-primary text-on-primary hover:brightness-110 shadow-md transition-all cursor-pointer disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
