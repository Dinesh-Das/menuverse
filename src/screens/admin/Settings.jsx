import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { fetchMenu, adminUpdateRestaurant } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';

export default function Settings() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [restaurantName, setRestaurantName] = useState('');
  const [description, setDescription] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#B8860B');
  const [fontFamily, setFontFamily] = useState('serif');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem]';
  const inputClass = `w-full px-4 py-3 rounded-xl border focus:outline-none focus:border-primary transition-colors bg-surface-container-low border-outline-variant text-on-surface placeholder-secondary/50`;

  const loadData = () => {
    setLoading(true);
    fetchMenu()
      .then(data => {
        if (data.restaurant) {
          setRestaurantName(data.restaurant.name || '');
          setDescription(data.restaurant.description || '');
          setPrimaryColor(data.restaurant.primary_color || '#B8860B');
          setFontFamily(data.restaurant.font_family || 'serif');
        }
        setLoading(false);
      })
      .catch(err => { console.error(err); setLoading(false); });
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async () => {
    if (!restaurantName.trim()) return;
    setSaving(true);
    try {
      await adminUpdateRestaurant(user.restaurantId, { 
        name: restaurantName,
        description,
        primary_color: primaryColor,
        font_family: fontFamily
      });
      addToast('Settings saved successfully!', 'success');
    } catch (err) {
      addToast(`Save failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    loadData();
  };

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12">
        <AdminTopNav
          title="Brand Settings"
          subtitle="Configure your digital restaurant's identity and aesthetic."
        />

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
          </div>
        ) : (
          <div className="max-w-3xl">
            <div className={`p-10 mb-8 ${cardBg}`}>
              <h3 className="font-headline text-xl font-bold mb-6 text-on-surface">General Identity</h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-2 text-on-surface-variant">
                    Restaurant Name
                  </label>
                  <input
                    type="text"
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-2 text-on-surface-variant">
                    Tagline / Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className={`${inputClass} resize-none h-24`}
                    placeholder="e.g. Fine Dining & Culinary Art"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-2 text-on-surface-variant">
                    Logo Upload
                  </label>
                  <div className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors border-outline-variant hover:bg-surface-container/50 hover:border-primary/50">
                    <span className="material-symbols-outlined text-4xl mb-3 text-on-surface-variant">cloud_upload</span>
                    <p className="font-bold text-sm text-on-surface">Drop SVG or high-res PNG here</p>
                    <p className="text-[10px] mt-1 text-on-surface-variant">Max size: 5MB</p>
                  </div>
                </div>
              </div>
            </div>

            <div className={`p-10 mb-8 ${cardBg}`}>
              <h3 className="font-headline text-xl font-bold mb-6 text-on-surface">Theme Palette</h3>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-4 text-on-surface-variant">
                    Primary Accent Color
                  </label>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full border-4 border-white shadow-luxury flex-shrink-0" style={{ backgroundColor: primaryColor }} />
                    <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-4 text-on-surface-variant">
                    Typography Profile
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setFontFamily('serif')}
                      className={`py-3 px-4 rounded-xl border text-center cursor-pointer transition-colors ${fontFamily === 'serif' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/30 text-on-surface-variant'}`}
                    >
                      <span className="block font-headline font-bold text-lg mb-1">Serif</span>
                      <span className="text-[9px] uppercase tracking-widest">Editorial</span>
                    </button>
                    <button 
                      onClick={() => setFontFamily('sans')}
                      className={`py-3 px-4 rounded-xl border text-center cursor-pointer transition-colors ${fontFamily === 'sans' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/30 text-on-surface-variant'}`}
                    >
                      <span className="block font-body font-bold text-lg mb-1">Sans</span>
                      <span className="text-[9px] uppercase tracking-widest">Modern</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-4">
              <button
                onClick={handleDiscard}
                className="px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer border border-outline-variant/30 text-on-surface hover:bg-surface-container"
              >
                Discard Changes
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer shadow-md active:scale-95 disabled:opacity-60 bg-primary text-on-primary hover:bg-primary-container flex items-center gap-2"
              >
                {saving && <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>}
                {saving ? 'Saving…' : 'Save Configuration'}
              </button>
            </div>
          </div>
        )}
      </main>
    </AdminLayout>
  );
}
