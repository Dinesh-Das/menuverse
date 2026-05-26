import React, { useEffect, useMemo, useState } from 'react';
import '@google/model-viewer';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import {
  adminDeleteARAsset,
  adminFetchARAsset,
  adminFetchMenuItems,
  adminUpdateARAssetStatus,
  adminUploadARAsset,
} from '../../lib/api';

const MAX_GLB_SIZE = 20 * 1024 * 1024;
const MAX_USDZ_SIZE = 20 * 1024 * 1024;
const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024;

const STATUS_STYLES = {
  ready: 'bg-green-500/10 text-green-600 border-green-500/20',
  failed: 'bg-error/10 text-error border-error/20',
  not_uploaded: 'bg-surface-container-highest text-on-surface-variant border-outline-variant/20',
};

function validateFileSize(file, maxBytes, label) {
  if (file && file.size > maxBytes) {
    throw new Error(`${label} must be ${Math.round(maxBytes / 1024 / 1024)}MB or smaller.`);
  }
}

export default function ARStudio() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [asset, setAsset] = useState(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingAsset, setLoadingAsset] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [glbFile, setGlbFile] = useState(null);
  const [usdzFile, setUsdzFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);

  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedItemId) || null,
    [items, selectedItemId]
  );

  const status = asset?.processing_status || 'not_uploaded';
  const badgeClass = STATUS_STYLES[status] || STATUS_STYLES.not_uploaded;

  const loadItems = async () => {
    if (!user?.restaurantId) return;
    setLoadingItems(true);
    try {
      const data = await adminFetchMenuItems(user.restaurantId);
      setItems(data);
      setSelectedItemId(current => current || data[0]?.id || '');
    } catch (err) {
      addToast(`Failed to load menu items: ${err.message}`, 'error');
    } finally {
      setLoadingItems(false);
    }
  };

  const loadAsset = async (itemId) => {
    if (!itemId) return;
    setLoadingAsset(true);
    try {
      const data = await adminFetchARAsset(itemId);
      setAsset(data);
    } catch (err) {
      if (!err.message.toLowerCase().includes('not found')) {
        addToast(`Failed to load AR asset: ${err.message}`, 'error');
      }
      setAsset(null);
    } finally {
      setLoadingAsset(false);
    }
  };

  useEffect(() => {
    loadItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.restaurantId]);

  useEffect(() => {
    loadAsset(selectedItemId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!selectedItemId || !glbFile) return;

    try {
      validateFileSize(glbFile, MAX_GLB_SIZE, 'GLB file');
      validateFileSize(usdzFile, MAX_USDZ_SIZE, 'USDZ file');
      validateFileSize(thumbnailFile, MAX_THUMBNAIL_SIZE, 'Thumbnail');

      const formData = new FormData();
      formData.append('glb_file', glbFile);
      if (usdzFile) formData.append('usdz_file', usdzFile);
      if (thumbnailFile) formData.append('thumbnail', thumbnailFile);

      setUploading(true);
      const uploaded = await adminUploadARAsset(selectedItemId, formData);
      setAsset(uploaded);
      setGlbFile(null);
      setUsdzFile(null);
      setThumbnailFile(null);
      await loadItems();
      addToast('AR asset uploaded.', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleToggle = async (checked) => {
    if (!selectedItemId || !asset) return;
    setSavingStatus(true);
    try {
      const updated = await adminUpdateARAssetStatus(selectedItemId, {
        is_active: checked,
        ar_preview_enabled: checked,
      });
      setAsset(updated);
      setItems(prev => prev.map(item => (
        item.id === selectedItemId
          ? { ...item, ar_preview_enabled: checked, has_ar_preview: true }
          : item
      )));
      addToast(checked ? 'AR preview enabled.' : 'AR preview disabled.', 'success');
    } catch (err) {
      addToast(`Status update failed: ${err.message}`, 'error');
    } finally {
      setSavingStatus(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedItemId || !asset) return;
    if (!window.confirm('Delete this AR asset? This removes the uploaded model files.')) return;
    try {
      await adminDeleteARAsset(selectedItemId);
      setAsset(null);
      setItems(prev => prev.map(item => (
        item.id === selectedItemId
          ? { ...item, has_ar_preview: false, ar_preview_enabled: false }
          : item
      )));
      addToast('AR asset deleted.', 'success');
    } catch (err) {
      addToast(`Delete failed: ${err.message}`, 'error');
    }
  };

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav
          title="AR Studio"
          subtitle="Upload and publish interactive 3D previews for menu items."
        />

        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-8">
          <section className="space-y-6">
            <div className="rounded-2xl bg-surface-container-low border border-outline-variant/10 p-6 shadow-luxury">
              <label className="block text-[10px] uppercase font-bold tracking-[0.18em] text-on-surface-variant mb-3">
                Menu Item
              </label>
              <select
                value={selectedItemId}
                disabled={loadingItems || items.length === 0}
                onChange={event => setSelectedItemId(event.target.value)}
                className="w-full rounded-xl bg-surface-container border border-outline-variant/20 px-4 py-3 text-sm font-bold text-on-surface focus:outline-none focus:border-primary"
              >
                {items.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <form onSubmit={handleUpload} className="rounded-2xl bg-surface-container-low border border-outline-variant/10 p-6 shadow-luxury space-y-5">
              <div>
                <h3 className="font-headline text-xl font-bold text-on-surface">Upload Model</h3>
                <p className="text-xs text-on-surface-variant mt-1">GLB is required. USDZ and thumbnail are optional.</p>
                <ul className="mt-3 space-y-1 text-xs text-on-surface-variant">
                  <li>GLB and USDZ files must be 20MB or smaller.</li>
                  <li>Thumbnails must be JPG, PNG, or WebP and 2MB or smaller.</li>
                  <li>Video-to-3D generation is planned for a future pipeline service.</li>
                </ul>
              </div>

              <label className="block">
                <span className="block text-[10px] uppercase font-bold tracking-[0.18em] text-on-surface-variant mb-2">
                  GLB Model
                </span>
                <input
                  type="file"
                  accept=".glb,model/gltf-binary"
                  onChange={event => setGlbFile(event.target.files?.[0] || null)}
                  className="block w-full text-xs text-on-surface-variant file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-xs file:font-bold file:uppercase file:tracking-widest file:text-on-primary"
                />
              </label>

              <label className="block">
                <span className="block text-[10px] uppercase font-bold tracking-[0.18em] text-on-surface-variant mb-2">
                  USDZ Model
                </span>
                <input
                  type="file"
                  accept=".usdz,model/vnd.usdz+zip"
                  onChange={event => setUsdzFile(event.target.files?.[0] || null)}
                  className="block w-full text-xs text-on-surface-variant file:mr-4 file:rounded-full file:border-0 file:bg-surface-container-highest file:px-4 file:py-2 file:text-xs file:font-bold file:uppercase file:tracking-widest file:text-on-surface"
                />
              </label>

              <label className="block">
                <span className="block text-[10px] uppercase font-bold tracking-[0.18em] text-on-surface-variant mb-2">
                  Thumbnail
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={event => setThumbnailFile(event.target.files?.[0] || null)}
                  className="block w-full text-xs text-on-surface-variant file:mr-4 file:rounded-full file:border-0 file:bg-surface-container-highest file:px-4 file:py-2 file:text-xs file:font-bold file:uppercase file:tracking-widest file:text-on-surface"
                />
              </label>

              <button
                type="submit"
                disabled={uploading || !selectedItemId || !glbFile}
                className="w-full rounded-xl bg-primary text-on-primary px-5 py-3 text-xs font-bold uppercase tracking-widest shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {uploading && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                Upload Asset
              </button>
            </form>
          </section>

          <section className="rounded-2xl bg-surface-container-low border border-outline-variant/10 shadow-luxury overflow-hidden">
            <div className="p-6 md:p-8 border-b border-outline-variant/10 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
              <div>
                <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-primary mb-2">
                  {selectedItem?.category?.name || 'Selected Dish'}
                </p>
                <h2 className="font-headline text-2xl md:text-3xl font-bold text-on-surface">
                  {selectedItem?.name || 'No menu item selected'}
                </h2>
              </div>

              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest ${badgeClass}`}>
                  {status.replace(/_/g, ' ')}
                </span>
                <label className="flex items-center gap-3 rounded-full bg-surface-container px-4 py-2 border border-outline-variant/10">
                  <span className="text-xs font-bold text-on-surface">Enabled</span>
                  <input
                    type="checkbox"
                    disabled={!asset || savingStatus || status !== 'ready'}
                    checked={Boolean(asset?.is_active && selectedItem?.ar_preview_enabled)}
                    onChange={event => handleToggle(event.target.checked)}
                    className="w-5 h-5 accent-primary"
                  />
                </label>
              </div>
            </div>

            <div className="p-6 md:p-8">
              {status === 'failed' && asset?.processing_error && (
                <div className="mb-6 rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
                  <span className="font-bold">Generation failed:</span> {asset.processing_error}
                </div>
              )}

              {loadingAsset ? (
                <div className="h-[300px] flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
                </div>
              ) : asset?.model_glb_url ? (
                <model-viewer
                  src={asset.model_glb_url}
                  camera-controls=""
                  auto-rotate=""
                  style={{ width: '100%', height: '300px', background: 'transparent' }}
                />
              ) : (
                <div className="h-[300px] rounded-xl border border-dashed border-outline-variant/30 bg-surface-container flex flex-col items-center justify-center text-center px-6">
                  <span className="material-symbols-outlined text-5xl text-on-surface-variant mb-3">view_in_ar</span>
                  <p className="font-bold text-on-surface">No AR asset uploaded</p>
                  <p className="text-xs text-on-surface-variant mt-1">Select a GLB file and upload it to create the preview.</p>
                </div>
              )}

              <div className="grid md:grid-cols-3 gap-4 mt-6">
                <div className="rounded-xl bg-surface-container p-4 border border-outline-variant/10">
                  <p className="text-[9px] uppercase font-bold tracking-widest text-on-surface-variant mb-1">GLB URL</p>
                  <p className="text-xs text-on-surface truncate">{asset?.model_glb_url || 'Not uploaded'}</p>
                </div>
                <div className="rounded-xl bg-surface-container p-4 border border-outline-variant/10">
                  <p className="text-[9px] uppercase font-bold tracking-widest text-on-surface-variant mb-1">USDZ URL</p>
                  <p className="text-xs text-on-surface truncate">{asset?.model_usdz_url || 'Not uploaded'}</p>
                </div>
                <div className="rounded-xl bg-surface-container p-4 border border-outline-variant/10">
                  <p className="text-[9px] uppercase font-bold tracking-widest text-on-surface-variant mb-1">Thumbnail</p>
                  <p className="text-xs text-on-surface truncate">{asset?.thumbnail_url || 'Not uploaded'}</p>
                </div>
              </div>

              <div className="flex justify-end mt-8">
                <button
                  onClick={handleDelete}
                  disabled={!asset}
                  className="rounded-xl border border-error/20 text-error px-5 py-3 text-xs font-bold uppercase tracking-widest hover:bg-error/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  Delete AR Asset
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
