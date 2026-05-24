import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { adminRemoveStaffMember, adminUpdateRestaurant } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { INTEGRATION_READINESS } from '../../lib/integrations';

const TABS = ['Brand', 'Operations', 'Team'];
const LOGO_SIGNATURES = {
  jpg: { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  jpeg: { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  png: { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  webp: { type: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
};

async function logoMagicBytesMatch(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const expected = LOGO_SIGNATURES[ext];
  if (!expected || expected.type !== file.type) return false;

  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return expected.bytes.every((byte, index) => bytes[index] === byte);
}

export default function Settings() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState('Brand');

  // ── Brand state ──────────────────────────────────────────────────
  const [restaurantName, setRestaurantName] = useState('');
  const [description, setDescription] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#B8860B');
  const [fontFamily, setFontFamily] = useState('serif');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPreview, setLogoPreview] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  // ── Operations state ─────────────────────────────────────────────
  const [gstRate, setGstRate] = useState('5');
  const [serviceChargeRate, setServiceChargeRate] = useState('0');
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState('razorpay');

  // ── Team state ────────────────────────────────────────────────────
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [inviting, setInviting] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  // ── Shared ────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] transition-theme';
  const inputClass = `w-full px-4 py-3 rounded-xl border focus:outline-none focus:border-primary transition-all bg-surface-container-low border-outline-variant text-on-surface placeholder-secondary/50`;

  const loadData = () => {
    if (!user?.restaurantId) return;
    setLoading(true);
    supabase
      .from('Restaurant')
      .select('*')
      .eq('id', user.restaurantId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          setRestaurantName(data.name || '');
          setDescription(data.description || '');
          setPrimaryColor(data.primary_color || '#B8860B');
          setFontFamily(data.font_family || 'serif');
          setLogoUrl(data.logo_url || '');
          if (data.gst_rate !== undefined && data.gst_rate !== null) {
            setGstRate(String(data.gst_rate * 100));
            localStorage.setItem('mv_gst_rate', String(data.gst_rate));
          } else {
            const local = localStorage.getItem('mv_gst_rate');
            setGstRate(local ? String(parseFloat(local) * 100) : '5');
          }
          setServiceChargeRate(String((data.service_charge_rate || 0) * 100));
          setPaymentEnabled(Boolean(data.payment_enabled));
          setPaymentProvider(data.payment_provider || 'razorpay');
        }
        setLoading(false);
      })
      .catch(err => { console.error(err); setLoading(false); });
  };

  const loadTeam = () => {
    if (!user?.restaurantId) return;
    setTeamLoading(true);
    supabase
      .from('User')
      .select('id, email, role, created_at')
      .eq('restaurant_id', user.restaurantId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setTeamMembers(data);
        setTeamLoading(false);
      });
  };

  useEffect(() => {
    loadData();
    loadTeam();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.restaurantId]);

  // ── A27: Logo upload via Supabase Storage ─────────────────────────
  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast('File too large — max 5MB.', 'error');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      addToast('Unsupported format - use PNG, JPEG or WebP.', 'error');
      return;
    }
    if (!(await logoMagicBytesMatch(file))) {
      addToast('File signature does not match the selected image type.', 'error');
      return;
    }

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);

    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `logos/${user.restaurantId}/logo.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('restaurant-assets')
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadErr) throw new Error(uploadErr.message);

      const { data: { publicUrl } } = supabase.storage
        .from('restaurant-assets')
        .getPublicUrl(path);

      setLogoUrl(publicUrl);
      addToast('Logo uploaded! Save to apply.', 'success');
    } catch (err) {
      addToast(`Upload failed: ${err.message}`, 'error');
      setLogoPreview(null);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    if (!restaurantName.trim()) return;
    setSaving(true);
    try {
      const rate = parseFloat(gstRate);
      const serviceRate = parseFloat(serviceChargeRate);
      await adminUpdateRestaurant(user.restaurantId, {
        name: restaurantName,
        description,
        primary_color: primaryColor,
        font_family: fontFamily,
        ...(logoUrl ? { logo_url: logoUrl } : {}),
        ...(!isNaN(rate) && rate >= 0 && rate <= 30 ? { gst_rate: rate / 100 } : {}),
        ...(!isNaN(serviceRate) && serviceRate >= 0 && serviceRate <= 30 ? { service_charge_rate: serviceRate / 100 } : {}),
        payment_enabled: paymentEnabled,
        payment_provider: paymentProvider,
      });
      if (!isNaN(rate) && rate >= 0 && rate <= 30) {
        localStorage.setItem('mv_gst_rate', String(rate / 100));
      }
      addToast('Settings saved successfully!', 'success');
    } catch (err) {
      addToast(`Save failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── MF-02: Team management ─────────────────────────────────────────
  const handleInvite = async () => {
    if (!newEmail.trim()) return;
    setInviting(true);
    try {
      const { error } = await supabase.functions.invoke('invite-staff', {
        body: { email: newEmail, role: newRole, restaurant_id: user.restaurantId }
      });
      if (error) throw new Error(error.message);
      addToast(`Invite sent to ${newEmail}`, 'success');
      setNewEmail('');
      loadTeam();
    } catch {
      setShowInviteModal(true);
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (memberId === user.id) { addToast("You can't remove yourself.", 'error'); return; }
    try {
      await adminRemoveStaffMember(memberId, user.restaurantId);
      setTeamMembers(prev => prev.filter(m => m.id !== memberId));
      addToast('Member removed.', 'success');
    } catch (err) {
      addToast(`Failed: ${err.message}`, 'error');
    }
  };

  const ROLE_BADGES = {
    owner:   'bg-primary/10 text-primary',
    manager: 'bg-secondary/10 text-secondary',
    staff:   'bg-surface-container-highest text-on-surface-variant',
  };

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav
          title="Settings"
          subtitle="Configure your restaurant's identity, operations, and team."
        />

        {/* Tab Bar */}
        <div className="flex gap-2 mb-10">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all cursor-pointer ${
                activeTab === tab
                  ? 'bg-primary text-on-primary shadow-md'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
          </div>
        ) : (
          <div className="max-w-3xl">

            {/* ── Brand Tab ──────────────────────────────────────── */}
            {activeTab === 'Brand' && (
              <>
                <div className={`p-10 mb-8 ${cardBg}`}>
                  <h3 className="font-headline text-xl font-bold mb-6 text-on-surface">General Identity</h3>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-2 text-on-surface-variant">
                        Restaurant Name
                      </label>
                      <input type="text" value={restaurantName} onChange={e => setRestaurantName(e.target.value)} className={inputClass} />
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-2 text-on-surface-variant">
                        Tagline / Description
                      </label>
                      <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        className={`${inputClass} resize-none h-24`}
                        placeholder="e.g. Fine Dining & Culinary Art"
                      />
                    </div>

                    {/* A27: Logo upload with Supabase Storage */}
                    <div>
                      <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-2 text-on-surface-variant">
                        Restaurant Logo
                      </label>
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleLogoChange}
                      />
                      <div
                        onClick={() => !uploadingLogo && logoInputRef.current?.click()}
                        className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors border-outline-variant hover:bg-surface-container/50 hover:border-primary/50 relative"
                      >
                        {uploadingLogo ? (
                          <span className="material-symbols-outlined text-4xl mb-3 text-primary animate-spin block">progress_activity</span>
                        ) : (logoPreview || logoUrl) ? (
                          <div className="flex flex-col items-center gap-3">
                            <img src={logoPreview || logoUrl} alt="Logo preview" className="h-20 w-20 object-contain rounded-xl border border-outline-variant/20 shadow-sm" />
                            <p className="text-xs text-primary font-bold">Click to replace</p>
                          </div>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-4xl mb-3 text-on-surface-variant block">cloud_upload</span>
                            <p className="font-bold text-sm text-on-surface">Drop a high-res logo here</p>
                            <p className="text-[10px] mt-1 text-on-surface-variant">Max size: 5MB · PNG, JPEG, WebP</p>
                          </>
                        )}
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
                        <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className={inputClass} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-4 text-on-surface-variant">
                        Typography Profile
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => setFontFamily('serif')} className={`py-3 px-4 rounded-xl border text-center cursor-pointer transition-colors ${fontFamily === 'serif' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/30 text-on-surface-variant'}`}>
                          <span className="block font-headline font-bold text-lg mb-1">Serif</span>
                          <span className="text-[9px] uppercase tracking-widest">Editorial</span>
                        </button>
                        <button onClick={() => setFontFamily('sans')} className={`py-3 px-4 rounded-xl border text-center cursor-pointer transition-colors ${fontFamily === 'sans' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/30 text-on-surface-variant'}`}>
                          <span className="block font-body font-bold text-lg mb-1">Sans</span>
                          <span className="text-[9px] uppercase tracking-widest">Modern</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── Operations Tab ─────────────────────────────────── */}
            {activeTab === 'Operations' && (
              <div className={`p-10 mb-8 ${cardBg}`}>
                <h3 className="font-headline text-xl font-bold mb-2 text-on-surface">Tax Configuration</h3>
                <p className="text-sm text-on-surface-variant mb-8">
                  Configure the GST/VAT rate applied to all orders. This is used to calculate tax on the customer's bill.
                </p>
                <div className="max-w-xs">
                  <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-2 text-on-surface-variant">
                    GST Rate (%)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      max="30"
                      step="0.5"
                      value={gstRate}
                      onChange={e => setGstRate(e.target.value)}
                      className={`${inputClass} w-32 text-center font-bold text-xl`}
                    />
                    <span className="text-on-surface-variant font-bold text-xl">%</span>
                  </div>
                  <label className="block text-[10px] uppercase font-bold tracking-[0.15em] mb-2 mt-6 text-on-surface-variant">
                    Service Charge (%)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      max="30"
                      step="0.5"
                      value={serviceChargeRate}
                      onChange={e => setServiceChargeRate(e.target.value)}
                      className={`${inputClass} w-32 text-center font-bold text-xl`}
                    />
                    <span className="text-on-surface-variant font-bold text-xl">%</span>
                  </div>
                  <p className="text-[10px] text-on-surface-variant/60 mt-3">
                    Standard CGST+SGST for restaurants in India is 5%. Fine dining may apply 12% or 18%.
                  </p>
                  {/* Live preview */}
                  <div className="mt-6 p-4 bg-surface-container rounded-xl border border-outline-variant/10">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-3">Preview on ₹500 order</p>
                    <div className="flex justify-between text-sm text-on-surface-variant">
                      <span>Subtotal</span><span className="font-bold text-on-surface">₹500.00</span>
                    </div>
                    <div className="flex justify-between text-sm text-on-surface-variant">
                      <span>GST ({gstRate}%)</span>
                      <span className="font-bold text-on-surface">₹{(500 * parseFloat(gstRate || 0) / 100).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold pt-2 mt-2 border-t border-outline-variant/10">
                      <span>Total</span>
                      <span className="text-primary">₹{(500 + 500 * parseFloat(gstRate || 0) / 100).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Team Tab ───────────────────────────────────────── */}
            {activeTab === 'Operations' && (
              <div className={`p-10 mb-8 ${cardBg}`}>
                <h3 className="font-headline text-xl font-bold mb-2 text-on-surface">Integrations</h3>
                <p className="text-sm text-on-surface-variant mb-6">
                  Keep credentials server-side. These controls show readiness and prevent fake client-side integrations.
                </p>
                <div className="grid md:grid-cols-2 gap-4 mb-8">
                  <label className="flex items-center justify-between gap-4 p-4 rounded-xl bg-surface-container border border-outline-variant/10">
                    <span className="text-sm font-bold text-on-surface">Enable Digital Payment Button</span>
                    <input type="checkbox" checked={paymentEnabled} onChange={e => setPaymentEnabled(e.target.checked)} className="w-5 h-5 accent-primary" />
                  </label>
                  <select value={paymentProvider} onChange={e => setPaymentProvider(e.target.value)} className={inputClass}>
                    <option value="razorpay">Razorpay</option>
                    <option value="manual">Manual payment link</option>
                  </select>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {INTEGRATION_READINESS.map(item => (
                    <div key={item.key} className="p-4 rounded-xl bg-surface-container border border-outline-variant/10">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="material-symbols-outlined text-primary">{item.icon}</span>
                        <div>
                          <p className="text-sm font-bold text-on-surface">{item.label}</p>
                          <p className="text-[9px] uppercase tracking-widest text-primary font-bold">{item.status.replace(/_/g, ' ')}</p>
                        </div>
                      </div>
                      <p className="text-xs text-on-surface-variant leading-relaxed">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'Team' && (
              <>
                {/* Invite form */}
                <div className={`p-10 mb-8 ${cardBg}`}>
                  <h3 className="font-headline text-xl font-bold mb-2 text-on-surface">Invite Team Member</h3>
                  <p className="text-sm text-on-surface-variant mb-6">
                    Send an email invite. The recipient will receive a link to set their password.
                  </p>
                  <div className="flex gap-4 flex-wrap">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      placeholder="staff@restaurant.com"
                      className={`${inputClass} flex-1 min-w-48`}
                    />
                    <select
                      value={newRole}
                      onChange={e => setNewRole(e.target.value)}
                      className={`${inputClass} w-36`}
                    >
                      <option value="staff">Staff</option>
                      <option value="manager">Manager</option>
                    </select>
                    <button
                      onClick={handleInvite}
                      disabled={inviting || !newEmail.trim()}
                      className="px-6 py-3 rounded-xl bg-primary text-on-primary font-bold text-xs uppercase tracking-widest transition-all cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-2 shadow-md"
                    >
                      {inviting
                        ? <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                        : <span className="material-symbols-outlined text-sm">send</span>
                      }
                      Invite
                    </button>
                  </div>
                </div>

                {/* Member list */}
                <div className={`p-10 mb-8 ${cardBg}`}>
                  <h3 className="font-headline text-xl font-bold mb-6 text-on-surface">Team Members</h3>
                  {teamLoading ? (
                    <div className="flex justify-center py-6">
                      <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                    </div>
                  ) : teamMembers.length === 0 ? (
                    <p className="text-on-surface-variant text-sm text-center py-6">No team members found.</p>
                  ) : (
                    <div className="space-y-3">
                      {teamMembers.map(member => (
                        <div key={member.id} className="flex items-center justify-between p-4 rounded-xl bg-surface-container border border-outline-variant/10">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <span className="material-symbols-outlined text-primary text-xl">person</span>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-on-surface">{member.email}</p>
                              <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-0.5">
                                Since {new Date(member.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${ROLE_BADGES[member.role] || 'bg-surface-container-highest text-on-surface-variant'}`}>
                              {member.role}
                            </span>
                            {member.id !== user?.id && (
                              <button
                                onClick={() => handleRemoveMember(member.id)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                                title="Remove member"
                              >
                                <span className="material-symbols-outlined text-sm">person_remove</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {showInviteModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-dim/80 backdrop-blur-sm">
                <div className="bg-surface-container border border-outline-variant/20 rounded-2xl shadow-2xl p-8 max-w-md w-full">
                  <h2 className="font-headline text-xl font-bold text-on-surface mb-4">Manual Setup Required</h2>
                  <p className="text-sm text-on-surface-variant mb-6">
                    The Supabase Edge Function to invite staff is not deployed. Please configure your edge function (`invite-staff`) or deploy the project manually as per DEPLOY.md instructions.
                  </p>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setShowInviteModal(false)} className="px-6 py-2.5 rounded-xl font-bold text-sm bg-primary text-on-primary hover:brightness-110 shadow-md transition-all cursor-pointer">
                      Got it
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Save / Discard — hide on Team tab (no DB save needed, actions are immediate) */}
            {activeTab !== 'Team' && (
              <div className="flex justify-end gap-4">
                <button
                  onClick={loadData}
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
            )}
          </div>
        )}
      </main>
    </AdminLayout>
  );
}
