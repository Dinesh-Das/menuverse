import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import {
  adminFetchIntegrationJobs,
  adminFetchIntegrationSettings,
  adminRemoveStaffMember,
  adminRetryIntegrationJob,
  adminSyncPosCatalog,
  adminStartSquareOAuth,
  adminTestPosConnection,
  adminUpdateIntegrationChannel,
  adminUpdatePosSettings,
  adminUpdateRestaurant,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { INTEGRATION_READINESS } from '../../lib/integrations';

const TABS = ['Brand', 'Operations', 'Integrations', 'Team'];
const SERVICE_MODES = [
  { value: 'dine_only', label: 'Dine-in only', takeaway: false, delivery: false },
  { value: 'dine_takeaway', label: 'Dine-in + Takeaway', takeaway: true, delivery: false },
  { value: 'dine_delivery', label: 'Dine-in + Delivery', takeaway: false, delivery: true },
  { value: 'dine_both', label: 'Dine-in + Takeaway + Delivery', takeaway: true, delivery: true },
];
const CHANNEL_OPTIONS = [
  ['whatsapp', 'WhatsApp', 'chat'],
  ['swiggy', 'Swiggy', 'delivery_dining'],
  ['zomato', 'Zomato', 'delivery_dining'],
  ['ubereats', 'Uber Eats', 'delivery_dining'],
  ['doordash', 'DoorDash', 'delivery_dining'],
  ['instagram', 'Instagram', 'photo_camera'],
  ['facebook', 'Facebook', 'forum'],
  ['google_food', 'Google Food', 'language'],
  ['custom', 'Custom Webhook', 'webhook'],
];
const POS_BRIDGE_PROVIDERS = new Set(['webhook', 'toast', 'lightspeed', 'revel', 'ncr_aloha']);
const LOGO_SIGNATURES = {
  jpg: { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  jpeg: { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  png: { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  webp: { type: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
};

function buildInboundWebhookUrl(restaurantId, channelType) {
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (!baseUrl || !restaurantId) return '';
  const functionName = channelType === 'instagram' || channelType === 'facebook'
    ? 'meta-order-webhook'
    : 'aggregator-order-webhook';
  return `${baseUrl}/functions/v1/${functionName}?restaurant_id=${encodeURIComponent(restaurantId)}&channel=${encodeURIComponent(channelType)}`;
}

function buildPosInboundWebhookUrl(restaurantId, provider) {
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (!baseUrl || !restaurantId || !provider || provider === 'none') return '';
  return `${baseUrl}/functions/v1/pos-status-webhook?restaurant_id=${encodeURIComponent(restaurantId)}&provider=${encodeURIComponent(provider)}`;
}

function serviceModeFromFlags(takeaway, delivery) {
  return SERVICE_MODES.find(mode => mode.takeaway === Boolean(takeaway) && mode.delivery === Boolean(delivery))?.value || 'dine_only';
}

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
  const [currency, setCurrency] = useState('inr');
  const [upiVpa, setUpiVpa] = useState('');
  const [serviceMode, setServiceMode] = useState('dine_only');

  // ── Team state ────────────────────────────────────────────────────
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [inviting, setInviting] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [integrationJobs, setIntegrationJobs] = useState([]);
  const [integrationSummary, setIntegrationSummary] = useState({ delivered: 0, failed: 0 });
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [posProvider, setPosProvider] = useState('none');
  const [posEnabled, setPosEnabled] = useState(false);
  const [posSettings, setPosSettings] = useState({});
  const [posConfiguredSecrets, setPosConfiguredSecrets] = useState([]);
  const [posSaving, setPosSaving] = useState(false);
  const [posTesting, setPosTesting] = useState(false);
  const [posCatalogSyncing, setPosCatalogSyncing] = useState(false);
  const [squareOAuthStarting, setSquareOAuthStarting] = useState(false);
  const [channels, setChannels] = useState({});
  const [channelSaving, setChannelSaving] = useState(null);

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
          setCurrency(data.currency || 'inr');
          setUpiVpa(data.upi_vpa || '');
          setServiceMode(serviceModeFromFlags(data.takeaway_enabled, data.delivery_enabled));
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

  const loadIntegrationJobs = async () => {
    if (!user?.restaurantId) return;
    setIntegrationLoading(true);
    try {
      const result = await adminFetchIntegrationJobs(user.restaurantId);
      setIntegrationJobs(result.jobs);
      setIntegrationSummary(result.summary);
    } catch (err) {
      addToast(`Failed to load integration jobs: ${err.message}`, 'error');
    } finally {
      setIntegrationLoading(false);
    }
  };

  const loadIntegrationSettings = async () => {
    if (!user?.restaurantId) return;
    try {
      const data = await adminFetchIntegrationSettings(user.restaurantId);
      const nextChannels = {};
      data.forEach(channel => {
        if (channel.channel_type === 'pos') {
          setPosProvider(channel.provider || 'none');
          setPosEnabled(Boolean(channel.enabled));
          setPosSettings({
            location_id: channel.config?.square_location_id || '',
            environment: channel.config?.square_environment || 'production',
            currency: channel.config?.square_currency || 'USD',
            webhook_url: channel.config?.square_webhook_url || channel.config?.status_webhook_url || '',
            availability_sync_enabled: Boolean(channel.config?.availability_sync_enabled),
            restaurant_id: channel.config?.petpooja_restaurant_id || '',
            endpoint: channel.config?.petpooja_webhook_url || channel.config?.webhook_url || '',
            inventory_url: channel.config?.petpooja_inventory_url || '',
          });
          setPosConfiguredSecrets(channel.configured_secret_keys || []);
          return;
        }
        nextChannels[channel.channel_type] = {
          enabled: Boolean(channel.enabled),
          provider: channel.provider || channel.channel_type,
          settings: channel.config || {},
          configuredSecrets: channel.configured_secret_keys || [],
          status: channel.status,
          lastSyncAt: channel.last_sync_at,
          lastError: channel.last_error,
        };
      });
      setChannels(nextChannels);
    } catch (err) {
      addToast(`Failed to load integration settings: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    loadData();
    loadTeam();
    loadIntegrationJobs();
    loadIntegrationSettings();
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
      const selectedServiceMode = SERVICE_MODES.find(mode => mode.value === serviceMode) || SERVICE_MODES[0];
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
        currency,
        upi_vpa: upiVpa.trim() || null,
        takeaway_enabled: selectedServiceMode.takeaway,
        delivery_enabled: selectedServiceMode.delivery,
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
    } catch (err) {
      addToast(`Invite failed: ${err.message}`, 'error');
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

  const handleRetryIntegrationJob = async (jobId) => {
    try {
      await adminRetryIntegrationJob(jobId, user.restaurantId);
      addToast('Integration job queued for retry.', 'success');
      loadIntegrationJobs();
    } catch (err) {
      addToast(`Retry failed: ${err.message}`, 'error');
    }
  };

  const updatePosSetting = (key, value) => {
    setPosSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSavePos = async () => {
    setPosSaving(true);
    try {
      const inboundWebhookUrl = buildPosInboundWebhookUrl(user.restaurantId, posProvider);
      await adminUpdatePosSettings(user.restaurantId, {
        provider: posProvider,
        enabled: posEnabled,
        settings: {
          ...posSettings,
          ...(inboundWebhookUrl ? { webhook_url: inboundWebhookUrl } : {}),
        },
      });
      await loadIntegrationSettings();
      addToast('POS settings saved.', 'success');
    } catch (err) {
      addToast(`POS save failed: ${err.message}`, 'error');
    } finally {
      setPosSaving(false);
    }
  };

  const handleTestPos = async () => {
    setPosTesting(true);
    try {
      const result = await adminTestPosConnection(user.restaurantId);
      addToast(result.message || 'POS connection is ready.', 'success');
    } catch (err) {
      addToast(`POS test failed: ${err.message}`, 'error');
    } finally {
      setPosTesting(false);
    }
  };

  const handleSyncPosCatalog = async () => {
    setPosCatalogSyncing(true);
    try {
      const result = await adminSyncPosCatalog(user.restaurantId);
      addToast(`Square catalog synced. ${result.updated_item_count || 0} mapped items updated.`, 'success');
      await loadIntegrationSettings();
    } catch (err) {
      addToast(`Catalog sync failed: ${err.message}`, 'error');
    } finally {
      setPosCatalogSyncing(false);
    }
  };

  const handleConnectSquare = async () => {
    setSquareOAuthStarting(true);
    try {
      const authorizeUrl = await adminStartSquareOAuth(user.restaurantId, posSettings.environment || 'production');
      window.location.assign(authorizeUrl);
    } catch (err) {
      addToast(`Square connection failed: ${err.message}`, 'error');
      setSquareOAuthStarting(false);
    }
  };

  const updateChannel = (channelType, patch) => {
    setChannels(prev => ({
      ...prev,
      [channelType]: {
        enabled: false,
        settings: {},
        ...(prev[channelType] || {}),
        ...patch,
      },
    }));
  };

  const updateChannelSetting = (channelType, key, value) => {
    updateChannel(channelType, {
      settings: { ...(channels[channelType]?.settings || {}), [key]: value },
    });
  };

  const copyToClipboard = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      addToast(`${label} copied.`, 'success');
    } catch {
      addToast(`Could not copy ${label.toLowerCase()}.`, 'error');
    }
  };

  const handleSaveChannel = async (channelType) => {
    const channel = channels[channelType] || {};
    setChannelSaving(channelType);
    try {
      await adminUpdateIntegrationChannel(user.restaurantId, {
        channel_type: channelType,
        provider: channel.provider || channelType,
        enabled: Boolean(channel.enabled),
        settings: channel.settings || {},
      });
      await loadIntegrationSettings();
      addToast(`${channelType.replace(/_/g, ' ')} settings saved.`, 'success');
    } catch (err) {
      addToast(`Channel save failed: ${err.message}`, 'error');
    } finally {
      setChannelSaving(null);
    }
  };

  const ROLE_BADGES = {
    owner:   'bg-primary/10 text-primary',
    manager: 'bg-secondary/10 text-secondary',
    staff:   'bg-surface-container-highest text-on-surface-variant',
  };
  const posInboundWebhookUrl = buildPosInboundWebhookUrl(user?.restaurantId, posProvider);
  const isBridgePosProvider = POS_BRIDGE_PROVIDERS.has(posProvider);

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav
          title="Settings"
          subtitle="Configure your restaurant's identity, operations, and team."
        />
        {!loading && !paymentEnabled && (
          <button
            type="button"
            onClick={() => setActiveTab('Operations')}
            className="mb-8 flex w-full items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-left text-sm text-amber-500"
          >
            <span className="material-symbols-outlined">warning</span>
            <span><strong>Digital payments are disabled.</strong> Enable the payment button before sharing customer QR codes.</span>
          </button>
        )}

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

            {activeTab === 'Operations' && (
              <div className={`p-10 mb-8 ${cardBg}`}>
                <h3 className="font-headline text-xl font-bold mb-2 text-on-surface">Order Types Offered</h3>
                <p className="text-sm text-on-surface-variant mb-6">
                  Keep the customer menu focused on the fulfillment modes this restaurant supports.
                </p>
                <fieldset className="grid gap-3 md:grid-cols-2">
                  {SERVICE_MODES.map(mode => (
                    <label
                      key={mode.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border p-4 text-sm ${
                        serviceMode === mode.value
                          ? 'border-primary bg-primary/10 font-bold text-primary'
                          : 'border-outline-variant/20 bg-surface-container text-on-surface'
                      }`}
                    >
                      <input
                        type="radio"
                        name="serviceMode"
                        value={mode.value}
                        checked={serviceMode === mode.value}
                        onChange={() => setServiceMode(mode.value)}
                        className="sr-only"
                      />
                      {mode.label}
                    </label>
                  ))}
                </fieldset>
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
                    <option value="stripe">Stripe</option>
                    <option value="manual">Manual payment link</option>
                  </select>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputClass}>
                    <option value="inr">INR - Indian Rupee</option>
                    <option value="usd">USD - US Dollar</option>
                    <option value="eur">EUR - Euro</option>
                    <option value="gbp">GBP - British Pound</option>
                    <option value="aud">AUD - Australian Dollar</option>
                    <option value="cad">CAD - Canadian Dollar</option>
                  </select>
                  {paymentProvider === 'razorpay' && (
                    <input
                      value={upiVpa}
                      onChange={e => setUpiVpa(e.target.value)}
                      placeholder="UPI VPA for direct QR payments, e.g. restaurant@bank"
                      className={`${inputClass} md:col-span-2`}
                    />
                  )}
                </div>
                {paymentProvider === 'razorpay' && !upiVpa.trim() && (
                  <p className="text-xs text-amber-500 mb-4">
                    Add your UPI VPA to enable direct QR payments at checkout.
                  </p>
                )}
                <p className="text-xs text-on-surface-variant mb-8">
                  {paymentProvider === 'stripe'
                    ? 'Stripe can offer browser-native Apple Pay and Google Pay when the device, browser, domain, and account are eligible.'
                    : paymentProvider === 'razorpay'
                      ? 'Razorpay Standard Checkout exposes payment methods enabled on your Razorpay account, including eligible UPI apps, wallets, and Apple Pay after provider setup.'
                      : 'Manual links depend on the payment page you send to the guest.'}
                </p>
                {paymentProvider === 'stripe' && (
                  <div className="mb-8 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-on-surface-variant">
                    <p className="font-bold text-on-surface">Apple Pay domain setup</p>
                    <p className="mt-1">
                      Register every live customer-ordering domain in Stripe before launch, including restaurant custom domains. Test the wallet button on Safari after DNS and HTTPS are live.
                    </p>
                  </div>
                )}
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

            {activeTab === 'Integrations' && (
              <>
              <div className={`p-8 mb-8 ${cardBg}`}>
                <div className="mb-6">
                  <h3 className="font-headline text-xl font-bold text-on-surface">POS Settings</h3>
                  <p className="text-sm text-on-surface-variant mt-1">
                    Configure per-restaurant order sync. Saved secrets stay server-side and are never returned to this browser.
                  </p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <select value={posProvider} onChange={e => setPosProvider(e.target.value)} className={inputClass}>
                    <option value="none">No POS provider</option>
                    <option value="square">Square</option>
                    <option value="petpooja">Petpooja</option>
                    <option value="webhook">Custom webhook</option>
                    <option value="toast">Toast bridge</option>
                    <option value="lightspeed">Lightspeed bridge</option>
                    <option value="revel">Revel bridge</option>
                    <option value="ncr_aloha">NCR Aloha bridge</option>
                  </select>
                  <label className="flex items-center justify-between gap-4 p-4 rounded-xl bg-surface-container border border-outline-variant/10">
                    <span className="text-sm font-bold text-on-surface">Enable POS sync</span>
                    <input type="checkbox" checked={posEnabled} onChange={e => setPosEnabled(e.target.checked)} className="w-5 h-5 accent-primary" />
                  </label>
                  {posProvider === 'square' && (
                    <>
                      <button
                        type="button"
                        onClick={handleConnectSquare}
                        disabled={squareOAuthStarting}
                        className="md:col-span-2 rounded-xl bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-on-primary disabled:opacity-50"
                      >
                        {squareOAuthStarting ? 'Opening Square...' : 'Connect Square Account'}
                      </button>
                      <p className="md:col-span-2 text-xs text-on-surface-variant">
                        OAuth is recommended. The manual token field below remains available for controlled fallback setups.
                      </p>
                      <input value={posSettings.location_id || ''} onChange={e => updatePosSetting('location_id', e.target.value)} placeholder="Square location ID" className={inputClass} />
                      <select value={posSettings.environment || 'production'} onChange={e => updatePosSetting('environment', e.target.value)} className={inputClass}>
                        <option value="sandbox">Square sandbox</option>
                        <option value="production">Square production</option>
                      </select>
                      <input type="password" value={posSettings.access_token || ''} onChange={e => updatePosSetting('access_token', e.target.value)} placeholder={posConfiguredSecrets.includes('square_access_token') ? 'Access token saved - enter to replace' : 'Square access token'} className={inputClass} />
                      <input type="password" value={posSettings.webhook_signing_secret || ''} onChange={e => updatePosSetting('webhook_signing_secret', e.target.value)} placeholder={posConfiguredSecrets.includes('square_webhook_signature_key') ? 'Webhook signature key saved - enter to replace' : 'Square webhook signature key'} className={inputClass} />
                      <label className="md:col-span-2 flex items-center justify-between gap-4 p-4 rounded-xl bg-surface-container border border-outline-variant/10">
                        <span className="text-sm font-bold text-on-surface">Sync mapped item availability from Square</span>
                        <input type="checkbox" checked={Boolean(posSettings.availability_sync_enabled)} onChange={e => updatePosSetting('availability_sync_enabled', e.target.checked)} className="w-5 h-5 accent-primary" />
                      </label>
                    </>
                  )}
                  {posProvider === 'petpooja' && (
                    <>
                      <input value={posSettings.restaurant_id || ''} onChange={e => updatePosSetting('restaurant_id', e.target.value)} placeholder="Petpooja restaurant ID" className={inputClass} />
                      <input value={posSettings.endpoint || ''} onChange={e => updatePosSetting('endpoint', e.target.value)} placeholder="Petpooja API endpoint" className={inputClass} />
                      <input value={posSettings.inventory_url || ''} onChange={e => updatePosSetting('inventory_url', e.target.value)} placeholder="Optional Petpooja getitems endpoint" className={`${inputClass} md:col-span-2`} />
                      <input type="password" value={posSettings.api_key || ''} onChange={e => updatePosSetting('api_key', e.target.value)} placeholder={posConfiguredSecrets.includes('petpooja_api_key') ? 'API key saved - enter to replace' : 'Petpooja API key'} className={inputClass} />
                      <input type="password" value={posSettings.app_key || ''} onChange={e => updatePosSetting('app_key', e.target.value)} placeholder={posConfiguredSecrets.includes('petpooja_app_key') ? 'App key saved - enter to replace' : 'Petpooja app key'} className={inputClass} />
                      <input type="password" value={posSettings.webhook_signing_secret || ''} onChange={e => updatePosSetting('webhook_signing_secret', e.target.value)} placeholder={posConfiguredSecrets.includes('petpooja_webhook_secret') ? 'Webhook secret saved - enter to replace' : 'Petpooja webhook shared secret'} className={`${inputClass} md:col-span-2`} />
                    </>
                  )}
                  {isBridgePosProvider && (
                    <>
                      <input value={posSettings.endpoint || ''} onChange={e => updatePosSetting('endpoint', e.target.value)} placeholder={`${posProvider === 'webhook' ? 'Custom POS' : posProvider.replace(/_/g, ' ')} outbound bridge endpoint`} className={`${inputClass} md:col-span-2`} />
                      <input type="password" value={posSettings.webhook_signing_secret || ''} onChange={e => updatePosSetting('webhook_signing_secret', e.target.value)} placeholder={posConfiguredSecrets.includes('webhook_secret') ? 'Signing secret saved - enter to replace' : 'Webhook signing secret'} className={`${inputClass} md:col-span-2`} />
                    </>
                  )}
                  {posProvider !== 'none' && (
                    <div className="md:col-span-2 rounded-xl border border-outline-variant/10 bg-surface-container p-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-on-surface">Inbound status webhook</p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        Register this callback with your POS provider to receive real-time kitchen status updates.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 md:flex-row">
                        <input readOnly value={posInboundWebhookUrl} aria-label="POS inbound webhook URL" className={`${inputClass} font-mono text-xs`} />
                        <button
                          type="button"
                          onClick={() => copyToClipboard(posInboundWebhookUrl, 'POS webhook URL')}
                          className="rounded-xl bg-surface-container-high px-4 py-3 text-xs font-bold uppercase tracking-widest text-on-surface"
                        >
                          Copy
                        </button>
                      </div>
                      {posProvider === 'square' && (
                        <p className="mt-3 text-xs text-on-surface-variant">
                          Subscribe to order fulfillment updates and <code>catalog.version.updated</code>. The exact callback URL is saved automatically for Square signature validation.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 mt-6">
                  <button onClick={handleSavePos} disabled={posSaving} className="px-5 py-3 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest disabled:opacity-50">
                    {posSaving ? 'Saving...' : 'Save POS settings'}
                  </button>
                  <button onClick={handleTestPos} disabled={posTesting || posProvider === 'none'} className="px-5 py-3 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold uppercase tracking-widest disabled:opacity-50">
                    {posTesting ? 'Testing...' : 'Test connection'}
                  </button>
                  {posProvider === 'square' && (
                    <button onClick={handleSyncPosCatalog} disabled={posCatalogSyncing || !posSettings.availability_sync_enabled} className="px-5 py-3 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold uppercase tracking-widest disabled:opacity-50">
                      {posCatalogSyncing ? 'Syncing...' : 'Sync Square availability'}
                    </button>
                  )}
                </div>
              </div>

              <div className={`p-8 mb-8 ${cardBg}`}>
                <h3 className="font-headline text-xl font-bold text-on-surface">Omnichannel Ordering</h3>
                <p className="text-sm text-on-surface-variant mt-1 mb-6">
                  Activate delivery aggregators, WhatsApp, social ordering, Google ordering links, or a signed custom webhook.
                </p>
                <div className="space-y-4">
                  {CHANNEL_OPTIONS.map(([channelType, label, icon]) => {
                    const channel = channels[channelType] || { enabled: false, settings: {}, configuredSecrets: [] };
                    return (
                      <div key={channelType} className="rounded-2xl bg-surface-container border border-outline-variant/10 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-primary">{icon}</span>
                            <div>
                              <p className="text-sm font-bold text-on-surface">{label}</p>
                              <p className="text-[10px] uppercase tracking-widest text-on-surface-variant">{channel.status || 'not configured'}</p>
                            </div>
                          </div>
                          <input type="checkbox" checked={Boolean(channel.enabled)} onChange={e => updateChannel(channelType, { enabled: e.target.checked })} className="w-5 h-5 accent-primary" />
                        </div>
                        {channel.enabled && (
                          <div className="grid md:grid-cols-2 gap-3 mt-4">
                            <input value={channel.settings.endpoint || ''} onChange={e => updateChannelSetting(channelType, 'endpoint', e.target.value)} placeholder="Provider or inbound endpoint" className={inputClass} />
                            <input value={channel.settings.menu_sync_url || ''} onChange={e => updateChannelSetting(channelType, 'menu_sync_url', e.target.value)} placeholder="Optional menu sync endpoint" className={inputClass} />
                            {(channelType === 'instagram' || channelType === 'facebook') && (
                              <>
                                <input value={channel.settings.publish_url || ''} onChange={e => updateChannelSetting(channelType, 'publish_url', e.target.value)} placeholder="Social publishing bridge endpoint" className={`${inputClass} md:col-span-2`} />
                                <div className="md:col-span-2 space-y-1 rounded-lg bg-surface-container-high p-3 text-xs text-on-surface-variant">
                                  <p className="font-bold text-on-surface">How to connect your Meta page</p>
                                  <p>
                                    This bridge URL receives a <code>POST</code> with <code>{'{restaurant_id, channel, message, image_url, ordering_link}'}</code>.
                                    Menuverse does not call Meta directly.
                                  </p>
                                  <p>
                                    Use <a href="https://www.make.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">Make</a>,{' '}
                                    <a href="https://zapier.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">Zapier</a>, or the{' '}
                                    <a href="https://developers.facebook.com/docs/instagram-platform/content-publishing" target="_blank" rel="noopener noreferrer" className="text-primary underline">Meta content publishing API</a>.
                                  </p>
                                  <p>See <code>docs/webhooks.md</code>: Social publishing bridges for the exact payload.</p>
                                </div>
                              </>
                            )}
                            <input value={channel.settings.account_id || ''} onChange={e => updateChannelSetting(channelType, 'account_id', e.target.value)} placeholder={channelType === 'whatsapp' ? 'WhatsApp phone number ID' : 'Account, page, or store ID'} className={inputClass} />
                            <input value={channel.settings.ordering_link || ''} onChange={e => updateChannelSetting(channelType, 'ordering_link', e.target.value)} placeholder="Optional public ordering link" className={inputClass} />
                            <input readOnly value={buildInboundWebhookUrl(user.restaurantId, channelType)} aria-label={`${label} inbound webhook URL`} className={`${inputClass} md:col-span-2 font-mono text-xs`} />
                            <input type="password" value={channel.settings.access_token || ''} onChange={e => updateChannelSetting(channelType, 'access_token', e.target.value)} placeholder={channel.configuredSecrets?.includes('access_token') ? 'Access token saved - enter to replace' : 'Access token'} className={inputClass} />
                            <input type="password" value={channel.settings.webhook_secret || ''} onChange={e => updateChannelSetting(channelType, 'webhook_secret', e.target.value)} placeholder={channel.configuredSecrets?.includes('webhook_secret') ? 'Webhook secret saved - enter to replace' : 'Webhook signing secret'} className={inputClass} />
                            {(channelType === 'whatsapp' || channelType === 'instagram' || channelType === 'facebook') && (
                              <input type="password" value={channel.settings.verify_token || ''} onChange={e => updateChannelSetting(channelType, 'verify_token', e.target.value)} placeholder={channel.configuredSecrets?.includes('verify_token') ? 'Verify token saved - enter to replace' : 'Webhook verify token'} className={inputClass} />
                            )}
                            {(channelType === 'instagram' || channelType === 'facebook') && (
                              <input type="password" value={channel.settings.app_secret || ''} onChange={e => updateChannelSetting(channelType, 'app_secret', e.target.value)} placeholder={channel.configuredSecrets?.includes('app_secret') ? 'Meta app secret saved - enter to replace' : 'Meta app secret'} className={inputClass} />
                            )}
                            <button onClick={() => handleSaveChannel(channelType)} disabled={channelSaving === channelType} className="md:col-span-2 px-4 py-3 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest disabled:opacity-50">
                              {channelSaving === channelType ? 'Saving...' : `Save ${label}`}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={`p-8 mb-8 ${cardBg}`}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                  <div>
                    <h3 className="font-headline text-xl font-bold text-on-surface">Integration Jobs</h3>
                    <p className="text-sm text-on-surface-variant">Recent POS, printer, and notification delivery attempts.</p>
                  </div>
                  <button
                    onClick={loadIntegrationJobs}
                    className="px-4 py-2 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold uppercase tracking-widest"
                  >
                    Refresh
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-6">
                  <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/10">
                    <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Delivered last 24h</p>
                    <p className="text-3xl font-headline text-primary mt-1">{integrationSummary.delivered}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/10">
                    <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Failed last 24h</p>
                    <p className="text-3xl font-headline text-error mt-1">{integrationSummary.failed}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-outline-variant/10">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface-container text-[10px] uppercase tracking-widest text-on-surface-variant">
                      <tr>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Provider</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Created</th>
                        <th className="px-4 py-3">Retries</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {integrationLoading ? (
                        <tr><td colSpan="6" className="px-4 py-8 text-center text-on-surface-variant">Loading jobs...</td></tr>
                      ) : integrationJobs.length === 0 ? (
                        <tr><td colSpan="6" className="px-4 py-8 text-center text-on-surface-variant">No integration jobs yet.</td></tr>
                      ) : integrationJobs.map(job => (
                        <tr key={job.id} className="bg-surface-container-low">
                          <td className="px-4 py-3">
                            <span className="px-2 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
                              {job.job_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-on-surface">{job.provider || 'webhook'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                              job.status === 'delivered' ? 'bg-green-500/10 text-green-500' :
                              job.status === 'failed' ? 'bg-error/10 text-error' :
                              'bg-primary/10 text-primary'
                            }`}>
                              {job.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                            {new Date(job.created_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-on-surface-variant">{job.retry_count || 0}</td>
                          <td className="px-4 py-3 text-right">
                            {job.status === 'failed' && (
                              <button
                                onClick={() => handleRetryIntegrationJob(job.id)}
                                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[10px] font-bold uppercase tracking-widest"
                              >
                                Retry
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              </>
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
                    The staff invite could not be completed. Confirm the `invite-staff` Edge Function is deployed and Supabase email invites are enabled.
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
