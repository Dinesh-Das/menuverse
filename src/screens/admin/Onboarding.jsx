import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { useNavigate } from 'react-router-dom';
import {
  adminCreateCategory,
  adminCreateMenuItem,
  adminCreateTable,
  adminFetchCategories,
  adminFetchTables,
  adminSeedSampleMenu,
  adminUpdateRestaurant,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';

const STEP_LABELS = ['Profile', 'Menu', 'Tables', 'Payments', 'Ready'];
const cardClass = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-2xl';
const inputClass = 'w-full rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary';

function tableQrUrl(table, restaurant) {
  const slug = restaurant?.slug || restaurant?.id || '';
  return `${window.location.origin}/r/${slug}/t/${table.id}`;
}

async function buildQrPdf(tables, restaurant) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    if (index > 0 && index % 6 === 0) pdf.addPage();
    const slot = index % 6;
    const col = slot % 2;
    const row = Math.floor(slot / 2);
    const x = 18 + col * 96;
    const y = 18 + row * 90;
    const qr = await QRCode.toDataURL(tableQrUrl(table, restaurant), {
      width: 420,
      margin: 2,
      errorCorrectionLevel: 'H',
    });

    pdf.setDrawColor(210);
    pdf.roundedRect(x, y, 78, 78, 5, 5);
    pdf.addImage(qr, 'PNG', x + 9, y + 8, 60, 60);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text(`Table ${table.number}`, x + 39, y + 72, { align: 'center' });
  }
  pdf.save(`${restaurant?.slug || 'menuverse'}-onboarding-qrs.pdf`);
}

export default function Onboarding() {
  const { user, refreshUserProfile } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const restaurant = user?.restaurant || null;
  const restaurantId = user?.restaurantId;
  const restaurantSlug = restaurant?.slug || '';
  const restaurantRowId = restaurant?.id || restaurantId || '';
  const startingStep = Math.min(Math.max(Number(restaurant?.onboarding_step || 0) + 1, 1), 5);

  const [step, setStep] = useState(startingStep);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [generatedTables, setGeneratedTables] = useState([]);
  const [firstQr, setFirstQr] = useState('');
  const [profile, setProfile] = useState({
    name: restaurant?.name || '',
    address: restaurant?.address || '',
    phone: restaurant?.phone || '',
    gstin: restaurant?.gstin || '',
    currency: restaurant?.currency || 'inr',
    logo_url: restaurant?.logo_url || '',
  });
  const [quickItems, setQuickItems] = useState([
    { name: '', price: '', category: 'Mains' },
  ]);
  const [tableCount, setTableCount] = useState(8);
  const [payments, setPayments] = useState({
    enabled: Boolean(restaurant.payment_enabled),
    razorpay_key_id: '',
    razorpay_key_secret: '',
  });

  useEffect(() => {
    if (!restaurantId) return;
    Promise.all([
      adminFetchCategories(restaurantId).catch(() => []),
      adminFetchTables(restaurantId).catch(() => []),
    ]).then(([categoryRows, tableRows]) => {
      setCategories(categoryRows);
      setGeneratedTables(tableRows);
      if (tableRows[0]) {
        QRCode.toDataURL(tableQrUrl(tableRows[0], { slug: restaurantSlug, id: restaurantRowId }), { width: 220, margin: 2 })
          .then(setFirstQr)
          .catch(() => setFirstQr(''));
      }
    });
  }, [restaurantId, restaurantRowId, restaurantSlug]);

  const liveUrl = useMemo(() => {
    if (!restaurantSlug) return 'menuverse.app/r/your-restaurant';
    return `menuverse.app/r/${restaurantSlug}`;
  }, [restaurantSlug]);

  const updateProfileField = (field, value) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const saveProgress = async (nextStep, patch = {}) => {
    await adminUpdateRestaurant(restaurantId, {
      onboarding_step: nextStep,
      ...patch,
    });
  };

  const uploadLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !restaurantId) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      addToast('Use a PNG, JPEG, or WebP logo.', 'error');
      return;
    }

    setSaving(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `logos/${restaurantId}/onboarding-logo.${ext}`;
      const { error } = await supabase.storage
        .from('restaurant-assets')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw new Error(error.message);
      const { data: { publicUrl } } = supabase.storage.from('restaurant-assets').getPublicUrl(path);
      updateProfileField('logo_url', publicUrl);
      addToast('Logo uploaded.', 'success');
    } catch (err) {
      addToast(`Logo upload failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    if (!profile.name.trim()) {
      addToast('Restaurant name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveProgress(1, {
        name: profile.name.trim(),
        address: profile.address || null,
        phone: profile.phone || null,
        gstin: profile.gstin || null,
        currency: profile.currency,
        ...(profile.logo_url ? { logo_url: profile.logo_url } : {}),
      });
      setStep(2);
    } catch (err) {
      addToast(`Profile save failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const seedSampleMenu = async () => {
    setSaving(true);
    try {
      await adminSeedSampleMenu(restaurantId);
      const nextCategories = await adminFetchCategories(restaurantId);
      setCategories(nextCategories);
      addToast('Sample menu added.', 'success');
    } catch (err) {
      addToast(`Sample menu failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const ensureCategory = async (name) => {
    const cleanName = (name || 'Mains').trim() || 'Mains';
    const existing = categories.find(cat => cat.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) return existing;
    const created = await adminCreateCategory({
      restaurantId,
      name: cleanName,
      display_order: categories.length + 1,
    });
    setCategories(prev => [...prev, created]);
    return created;
  };

  const saveMenuStep = async () => {
    setSaving(true);
    try {
      const filledItems = quickItems.filter(item => item.name.trim() && Number(item.price) > 0);
      for (const item of filledItems) {
        const category = await ensureCategory(item.category);
        await adminCreateMenuItem({
          restaurant_id: restaurantId,
          category_id: category.id,
          name: item.name.trim(),
          price: Number(item.price),
          available: true,
        });
      }
      await saveProgress(2);
      setStep(3);
    } catch (err) {
      addToast(`Menu setup failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const generateTables = async () => {
    const count = Math.max(1, Math.min(200, Number(tableCount || 1)));
    setSaving(true);
    try {
      const created = [];
      for (let index = 1; index <= count; index += 1) {
        const table = await adminCreateTable({
          restaurantId,
          tableNumber: String(index),
          surface_type: 'table',
        });
        created.push(table);
      }
      setGeneratedTables(created);
      const qrRestaurant = { slug: restaurantSlug, id: restaurantRowId };
      await buildQrPdf(created, qrRestaurant);
      const qr = await QRCode.toDataURL(tableQrUrl(created[0], qrRestaurant), { width: 220, margin: 2 });
      setFirstQr(qr);
      await saveProgress(3);
      addToast('Table QRs generated.', 'success');
    } catch (err) {
      addToast(`QR generation failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePaymentStep = async () => {
    setSaving(true);
    try {
      await saveProgress(4, {
        payment_enabled: payments.enabled,
        payment_provider: payments.enabled ? 'razorpay' : 'manual',
        currency: profile.currency,
      });
      setStep(5);
    } catch (err) {
      addToast(`Payment setup failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const completeOnboarding = async () => {
    setSaving(true);
    try {
      await adminUpdateRestaurant(restaurantId, {
        onboarding_complete: true,
        onboarding_step: 5,
      });
      await refreshUserProfile?.();
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      addToast(`Could not complete onboarding: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addQuickItem = () => {
    if (quickItems.length >= 3) return;
    setQuickItems(prev => [...prev, { name: '', price: '', category: 'Mains' }]);
  };

  const updateQuickItem = (index, field, value) => {
    setQuickItems(prev => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  return (
    <main className="min-h-dvh bg-surface text-on-surface px-6 py-8 md:px-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-primary">Menuverse setup</p>
          <h1 className="mt-3 font-headline text-4xl font-bold">Launch your restaurant</h1>
        </div>

        <div className="mb-8 grid grid-cols-5 gap-2">
          {STEP_LABELS.map((label, index) => {
            const number = index + 1;
            return (
              <div key={label} className={`rounded-xl px-3 py-3 text-center text-xs font-bold uppercase tracking-widest ${number <= step ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                {label}
              </div>
            );
          })}
        </div>

        <section className={`p-6 md:p-8 ${cardClass}`}>
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-headline text-2xl font-bold">Restaurant profile</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <input className={inputClass} value={profile.name} onChange={e => updateProfileField('name', e.target.value)} placeholder="Restaurant name" />
                <input className={inputClass} value={profile.phone} onChange={e => updateProfileField('phone', e.target.value)} placeholder="Phone" />
                <input className={`${inputClass} md:col-span-2`} value={profile.address} onChange={e => updateProfileField('address', e.target.value)} placeholder="Address" />
                <input className={inputClass} value={profile.gstin} onChange={e => updateProfileField('gstin', e.target.value)} placeholder="GST number (optional)" />
                <select className={inputClass} value={profile.currency} onChange={e => updateProfileField('currency', e.target.value)}>
                  <option value="inr">INR</option>
                  <option value="usd">USD</option>
                </select>
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-3">
                <span className="text-sm font-bold">{profile.logo_url ? 'Logo uploaded' : 'Upload logo'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} className="hidden" />
                <span className="material-symbols-outlined text-primary">upload</span>
              </label>
              <div className="flex justify-end">
                <button onClick={saveProfile} disabled={saving} className="rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-on-primary disabled:opacity-50">
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h2 className="font-headline text-2xl font-bold">Menu setup</h2>
                  <p className="text-sm text-on-surface-variant">Start with samples or add a few dishes now.</p>
                </div>
                <button onClick={seedSampleMenu} disabled={saving} className="rounded-xl border border-outline-variant/30 px-5 py-3 text-xs font-bold uppercase tracking-widest text-on-surface disabled:opacity-50">
                  Start with sample menu
                </button>
              </div>
              <div className="space-y-3">
                {quickItems.map((item, index) => (
                  <div key={index} className="grid gap-3 md:grid-cols-[1fr_120px_180px]">
                    <input className={inputClass} value={item.name} onChange={e => updateQuickItem(index, 'name', e.target.value)} placeholder="Item name" />
                    <input className={inputClass} type="number" min="0" step="1" value={item.price} onChange={e => updateQuickItem(index, 'price', e.target.value)} placeholder="Price" />
                    <input className={inputClass} value={item.category} onChange={e => updateQuickItem(index, 'category', e.target.value)} placeholder="Category" />
                  </div>
                ))}
                <button onClick={addQuickItem} disabled={quickItems.length >= 3} className="rounded-xl bg-surface-container px-4 py-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant disabled:opacity-50">
                  Add another item
                </button>
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="rounded-xl px-5 py-3 text-sm font-bold text-on-surface-variant">Back</button>
                <button onClick={saveMenuStep} disabled={saving} className="rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-on-primary disabled:opacity-50">
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h2 className="font-headline text-2xl font-bold">Tables</h2>
              <div className="max-w-sm">
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-on-surface-variant">How many tables do you have?</label>
                <input className={inputClass} type="number" min="1" max="200" value={tableCount} onChange={e => setTableCount(e.target.value)} />
              </div>
              <button onClick={generateTables} disabled={saving} className="rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-on-primary disabled:opacity-50">
                Generate QR codes
              </button>
              {generatedTables.length > 0 && (
                <p className="text-sm text-green-500">{generatedTables.length} table QR codes are ready.</p>
              )}
              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="rounded-xl px-5 py-3 text-sm font-bold text-on-surface-variant">Back</button>
                <button
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await saveProgress(3);
                      setStep(4);
                    } catch (err) {
                      addToast(`Table setup failed: ${err.message}`, 'error');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving || generatedTables.length === 0}
                  className="rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-on-primary disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <h2 className="font-headline text-2xl font-bold">Payments</h2>
              <label className="flex items-center justify-between rounded-xl bg-surface-container px-4 py-3">
                <span className="text-sm font-bold">Enable payments in the app</span>
                <input type="checkbox" checked={payments.enabled} onChange={e => setPayments(prev => ({ ...prev, enabled: e.target.checked }))} className="h-5 w-5 accent-primary" />
              </label>
              {payments.enabled && (
                <div className="grid gap-4 md:grid-cols-2">
                  <input className={inputClass} value={payments.razorpay_key_id} onChange={e => setPayments(prev => ({ ...prev, razorpay_key_id: e.target.value }))} placeholder="Razorpay Key ID" />
                  <input className={inputClass} type="password" value={payments.razorpay_key_secret} onChange={e => setPayments(prev => ({ ...prev, razorpay_key_secret: e.target.value }))} placeholder="Razorpay Key Secret" />
                  <p className="md:col-span-2 text-xs text-on-surface-variant">
                    Add live payment secrets to Supabase Edge Function settings before accepting real payments.
                  </p>
                </div>
              )}
              <div className="flex justify-between">
                <button onClick={() => setStep(3)} className="rounded-xl px-5 py-3 text-sm font-bold text-on-surface-variant">Back</button>
                <button onClick={savePaymentStep} disabled={saving} className="rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-on-primary disabled:opacity-50">
                  {payments.enabled ? 'Save payments' : 'Skip for now'}
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="grid gap-8 md:grid-cols-[1fr_220px] md:items-center">
              <div>
                <h2 className="font-headline text-3xl font-bold">You are ready</h2>
                <p className="mt-3 text-on-surface-variant">Your restaurant is live at <span className="font-bold text-primary">{liveUrl}</span></p>
                <div className="mt-6 flex gap-3">
                  <button onClick={() => setStep(4)} className="rounded-xl px-5 py-3 text-sm font-bold text-on-surface-variant">Back</button>
                  <button onClick={completeOnboarding} disabled={saving} className="rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-on-primary disabled:opacity-50">
                    Open my dashboard
                  </button>
                </div>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center text-neutral-900">
                {firstQr ? <img src={firstQr} alt="First table QR" className="mx-auto h-44 w-44" /> : <div className="h-44 w-44" />}
                <p className="text-xs font-bold uppercase tracking-widest">First table QR</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
