import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import {
  adminCreateMenuItem,
  adminFetchCategories,
  adminFetchMenuItems,
  adminTranslateMenuItem,
  adminUpdateItemModifiers,
  adminUpdateMenuItem,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';

import { useAuth } from '../../context/AuthContext';

const TRANSLATION_LOCALES = [
  { value: 'hi', label: 'Hindi' },
  { value: 'ta', label: 'Tamil' },
  { value: 'bn', label: 'Bengali' },
  { value: 'mr', label: 'Marathi' },
  { value: 'te', label: 'Telugu' },
];

export default function MenuInventory() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] transition-theme';
  const rowBg = 'hover:bg-surface-container border-outline-variant/10';

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal State
  const [editingItem, setEditingItem] = useState(null); // null = closed, {} = new, {id...} = existing
  const [formData, setFormData] = useState({
    name: '', description: '', price: '', category_id: '', image_url: '', dietary_flag: 'none', available: true, pos_catalog_variation_id: '', modifiers: []
  });
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [translatingItemId, setTranslatingItemId] = useState(null);
  const imageInputRef = React.useRef(null);

  const loadData = useCallback(() => {
    if (!user?.restaurantId) return;
    setLoading(true);
    Promise.all([adminFetchMenuItems(user.restaurantId), adminFetchCategories(user.restaurantId)])
      .then(([itemsData, catsData]) => {
        setItems(itemsData);
        setCategories(catsData);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [user?.restaurantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openNewModal = () => {
    setFormData({ name: '', description: '', price: '', category_id: categories[0]?.id || '', image_url: '', dietary_flag: 'none', available: true, pos_catalog_variation_id: '', modifiers: [] });
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
      available: item.available,
      pos_catalog_variation_id: item.pos_catalog_variation_id || '',
      modifiers: item.modifier_groups || []
    });
    setEditingItem(item);
  };

  const closeModal = () => setEditingItem(null);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        category_id: formData.category_id,
        image_url: formData.image_url,
        available: formData.available,
        price: parseFloat(formData.price),
        dietary_flag: formData.dietary_flag === 'none' ? null : formData.dietary_flag,
        pos_catalog_variation_id: formData.pos_catalog_variation_id.trim() || null
      };
      
      if (editingItem.id) {
        await adminUpdateMenuItem(editingItem.id, payload, user.restaurantId);
        await adminUpdateItemModifiers(editingItem.id, user.restaurantId, formData.modifiers);
      } else {
        const newItem = await adminCreateMenuItem({ ...payload, restaurant_id: user.restaurantId });
        await adminUpdateItemModifiers(newItem.id, user.restaurantId, formData.modifiers);
      }
      closeModal();
      loadData();
    } catch (err) {
      addToast('Failed to save: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast('File too large — max 5MB.', 'error');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      addToast('Unsupported format — use PNG, JPEG or WebP.', 'error');
      return;
    }

    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop();
      const filename = `${crypto.randomUUID()}.${ext}`;
      const path = `${user.restaurantId}/menu-items/${filename}`;
      const { error: uploadErr } = await supabase.storage
        .from('menu-images')
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadErr) throw new Error(uploadErr.message);

      const { data: { publicUrl } } = supabase.storage
        .from('menu-images')
        .getPublicUrl(path);

      setFormData(prev => ({ ...prev, image_url: publicUrl }));
      addToast('Image uploaded successfully!', 'success');
    } catch (err) {
      addToast(`Upload failed: ${err.message}`, 'error');
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleTranslate = async (itemId, locale) => {
    if (!locale || translatingItemId) return;
    const language = TRANSLATION_LOCALES.find(item => item.value === locale)?.label || locale;
    setTranslatingItemId(itemId);
    try {
      await adminTranslateMenuItem(itemId, locale);
      addToast(`${language} translation saved.`, 'success');
    } catch (err) {
      addToast(`Translation failed: ${err.message}`, 'error');
    } finally {
      setTranslatingItemId(null);
    }
  };

  const filtered = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
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
              <div className="col-span-4">Item</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-2">Price</div>
              <div className="col-span-2 text-right">Status</div>
              <div className="col-span-2 text-right">Translate</div>
            </div>

            {/* Table Rows */}
            {loading ? (
              <div className="p-8 text-center text-on-surface-variant">Loading items...</div>
            ) : (
              <div className="flex flex-col min-w-[800px]">
                {filtered.map(item => (
                  <div key={item.id} onClick={() => openEditModal(item)} className={`grid grid-cols-12 gap-4 px-8 py-5 items-center border-b last:border-0 transition-colors cursor-pointer ${rowBg} ${!item.available ? 'opacity-60 grayscale' : ''}`}>
                    <div className="col-span-4 flex items-center gap-4">
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
                    
                    <div className="col-span-2 text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">
                      {item.category?.name || 'Uncategorized'}
                    </div>
                    
                    <div className="col-span-2 font-headline font-bold text-lg text-primary">
                      ₹{item.price.toFixed(2)}
                    </div>
                    
                    <div className="col-span-2 text-right">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] uppercase font-bold tracking-widest border ${
                        item.available
                          ? 'bg-green-500/10 text-green-500 border-green-500/20'
                          : 'bg-surface-container text-on-surface-variant border-outline-variant/30'
                      }`}>
                        <span className="material-symbols-outlined text-[12px]">{item.available ? 'check_circle' : 'block'}</span>
                        {item.available ? 'Available' : 'Unavailable'}
                      </span>
                    </div>

                    <div className="col-span-2 text-right">
                      <select
                        value=""
                        disabled={translatingItemId === item.id}
                        onClick={event => event.stopPropagation()}
                        onChange={event => {
                          event.stopPropagation();
                          handleTranslate(item.id, event.target.value);
                        }}
                        className="max-w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary disabled:opacity-50"
                      >
                        <option value="">{translatingItemId === item.id ? 'Translating...' : 'Translate'}</option>
                        {TRANSLATION_LOCALES.map(locale => (
                          <option key={locale.value} value={locale.value}>{locale.label}</option>
                        ))}
                      </select>
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
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Square Variation ID</label>
                    <input type="text" value={formData.pos_catalog_variation_id} onChange={e => setFormData({...formData, pos_catalog_variation_id: e.target.value})} className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary" placeholder="Optional Square catalog variation ID for availability sync" />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Item Image</label>
                    <div className="flex gap-3 items-center">
                      {formData.image_url && (
                        <img src={formData.image_url} alt="Preview" className="w-12 h-12 rounded object-cover shadow-sm" />
                      )}
                      <input 
                        type="url" 
                        value={formData.image_url} 
                        onChange={e => setFormData({...formData, image_url: e.target.value})} 
                        className="flex-1 bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary" 
                        placeholder="https://..." 
                      />
                      <input 
                        type="file" 
                        ref={imageInputRef} 
                        onChange={handleImageUpload} 
                        accept="image/png, image/jpeg, image/webp" 
                        className="hidden" 
                      />
                      <button 
                        type="button" 
                        onClick={() => imageInputRef.current?.click()}
                        disabled={uploadingImage}
                        className="px-4 py-3 rounded-xl border border-outline-variant/30 bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant flex items-center justify-center cursor-pointer"
                      >
                        {uploadingImage ? (
                          <span className="material-symbols-outlined animate-spin">progress_activity</span>
                        ) : (
                          <span className="material-symbols-outlined">upload</span>
                        )}
                      </button>
                    </div>
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
                    <label htmlFor="available" className="text-sm font-bold text-on-surface cursor-pointer">Available to Order</label>
                  </div>
                </div>

                <div className="pt-6 border-t border-outline-variant/20 mt-6">
                  <div className="flex items-center justify-between mb-4">
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest">Modifiers</label>
                    <button 
                      type="button" 
                      onClick={() => setFormData(prev => ({ 
                        ...prev, 
                        modifiers: [...prev.modifiers, { name: '', required: false, options: [] }] 
                      }))}
                      className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer border border-outline-variant/30 hover:bg-surface-container-high text-on-surface flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">add</span> Add Group
                    </button>
                  </div>
                  
                  <div className="space-y-6">
                    {formData.modifiers.map((group, gIdx) => (
                      <div key={gIdx} className="p-4 bg-surface-container border border-outline-variant/20 rounded-xl space-y-4">
                        <div className="flex items-center gap-4">
                          <input 
                            type="text" 
                            placeholder="Group Name (e.g. Size, Spice Level)" 
                            value={group.name} 
                            onChange={e => {
                              const newMods = [...formData.modifiers];
                              newMods[gIdx].name = e.target.value;
                              setFormData({...formData, modifiers: newMods});
                            }}
                            className="flex-1 bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary" 
                          />
                          <label className="flex items-center gap-2 text-sm text-on-surface">
                            <input 
                              type="checkbox" 
                              checked={group.required} 
                              onChange={e => {
                                const newMods = [...formData.modifiers];
                                newMods[gIdx].required = e.target.checked;
                                setFormData({...formData, modifiers: newMods});
                              }}
                              className="accent-primary"
                            /> Required
                          </label>
                          <button 
                            type="button" 
                            onClick={() => {
                              const newMods = [...formData.modifiers];
                              newMods.splice(gIdx, 1);
                              setFormData({...formData, modifiers: newMods});
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-error/10 text-on-surface-variant hover:text-error transition-colors"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                        
                        <div className="pl-6 border-l-2 border-outline-variant/20 space-y-2">
                          {group.options.map((opt, oIdx) => (
                            <div key={oIdx} className="flex items-center gap-3">
                              <input 
                                type="text" 
                                placeholder="Option Name (e.g. Large, Extra Spicy)" 
                                value={opt.name} 
                                onChange={e => {
                                  const newMods = [...formData.modifiers];
                                  newMods[gIdx].options[oIdx].name = e.target.value;
                                  setFormData({...formData, modifiers: newMods});
                                }}
                                className="flex-1 bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary" 
                              />
                              <div className="relative w-24">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant">₹</span>
                                <input 
                                  type="number" 
                                  step="0.01" 
                                  placeholder="0.00" 
                                  value={opt.price_delta} 
                                  onChange={e => {
                                    const newMods = [...formData.modifiers];
                                    newMods[gIdx].options[oIdx].price_delta = e.target.value;
                                    setFormData({...formData, modifiers: newMods});
                                  }}
                                  className="w-full pl-6 pr-2 py-1.5 bg-surface-container-low border border-outline-variant/30 rounded-lg text-sm text-on-surface focus:outline-none focus:border-primary" 
                                />
                              </div>
                              <button 
                                type="button" 
                                onClick={() => {
                                  const newMods = [...formData.modifiers];
                                  newMods[gIdx].options.splice(oIdx, 1);
                                  setFormData({...formData, modifiers: newMods});
                                }}
                                className="w-7 h-7 flex items-center justify-center rounded text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors"
                              >
                                <span className="material-symbols-outlined text-xs">close</span>
                              </button>
                            </div>
                          ))}
                          <button 
                            type="button" 
                            onClick={() => {
                              const newMods = [...formData.modifiers];
                              newMods[gIdx].options.push({ name: '', price_delta: '' });
                              setFormData({...formData, modifiers: newMods});
                            }}
                            className="text-[10px] uppercase font-bold tracking-widest text-primary hover:underline flex items-center gap-1 mt-2 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[10px]">add</span> Add Option
                          </button>
                        </div>
                      </div>
                    ))}
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
