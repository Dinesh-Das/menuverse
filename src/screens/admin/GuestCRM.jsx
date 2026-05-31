import React, { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import {
  adminFetchGuestOrders,
  adminFetchGuests,
  adminFindPossibleGuestDuplicates,
  adminMergeGuestProfiles,
  adminUpdateGuestProfile,
} from '../../lib/api';

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function tagsToArray(tags) {
  return Array.isArray(tags) ? tags : [];
}

export default function GuestCRM() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [guests, setGuests] = useState([]);
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [orders, setOrders] = useState([]);
  const [notes, setNotes] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [duplicates, setDuplicates] = useState([]);

  const selectedTags = useMemo(() => tagsToArray(selectedGuest?.tags), [selectedGuest]);

  const loadGuests = async () => {
    if (!user?.restaurantId) return;
    setLoading(true);
    try {
      const data = await adminFetchGuests(user.restaurantId);
      setGuests(data);
      setDuplicates(await adminFindPossibleGuestDuplicates(user.restaurantId));
    } catch (err) {
      addToast(`Failed to load guests: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGuests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.restaurantId]);

  const openGuest = async (guest) => {
    setSelectedGuest(guest);
    setNotes(guest.notes || '');
    setOrders([]);
    try {
      const data = await adminFetchGuestOrders(user.restaurantId, guest.id);
      setOrders(data);
    } catch (err) {
      addToast(`Failed to load guest orders: ${err.message}`, 'error');
    }
  };

  const saveProfile = async (patch) => {
    if (!selectedGuest) return;
    try {
      const updated = await adminUpdateGuestProfile(selectedGuest.id, user.restaurantId, patch);
      setSelectedGuest(updated);
      setGuests(prev => prev.map(guest => guest.id === updated.id ? updated : guest));
      addToast('Guest profile updated.', 'success');
    } catch (err) {
      addToast(`Guest update failed: ${err.message}`, 'error');
    }
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || selectedTags.includes(tag)) return;
    setTagInput('');
    saveProfile({ tags: [...selectedTags, tag] });
  };

  const removeTag = (tag) => {
    saveProfile({ tags: selectedTags.filter(item => item !== tag) });
  };

  const mergeDuplicate = async (duplicateId) => {
    if (!selectedGuest || !window.confirm('Merge this duplicate profile into the selected guest? This keeps linked orders and loyalty history together.')) return;
    try {
      const updated = await adminMergeGuestProfiles(selectedGuest.id, duplicateId);
      setSelectedGuest(updated);
      await loadGuests();
      addToast('Guest profiles merged.', 'success');
    } catch (err) {
      addToast(`Guest merge failed: ${err.message}`, 'error');
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Name', 'Phone', 'Email', 'Visits', 'Total Spend', 'Loyalty Points', 'Last Visit', 'Marketing Consent'],
      ...guests.map(guest => [
        guest.name || '',
        guest.phone || '',
        guest.email || '',
        guest.visit_count || 0,
        guest.total_spend || 0,
        guest.loyalty_points || 0,
        guest.last_visit_at || '',
        guest.marketing_consent ? 'yes' : 'no',
      ]),
    ];
    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `menuverse-guests-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav title="Guests" subtitle="Cross-session guest profiles, loyalty, notes, and order history." />

        <div className="flex justify-end mb-6">
          <button
            onClick={exportCsv}
            className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest"
          >
            Export CSV
          </button>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="bg-surface-container-low border border-outline-variant/10 rounded-[2rem] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-container text-[10px] uppercase tracking-widest text-on-surface-variant">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Visits</th>
                    <th className="px-4 py-3">Spend</th>
                    <th className="px-4 py-3">Points</th>
                    <th className="px-4 py-3">Last Visit</th>
                    <th className="px-4 py-3">Consent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {loading ? (
                    <tr><td colSpan="8" className="px-4 py-10 text-center text-on-surface-variant">Loading guests...</td></tr>
                  ) : guests.length === 0 ? (
                    <tr><td colSpan="8" className="px-4 py-10 text-center text-on-surface-variant">No guest profiles yet.</td></tr>
                  ) : guests.map(guest => (
                    <tr
                      key={guest.id}
                      onClick={() => openGuest(guest)}
                      className="cursor-pointer hover:bg-surface-container transition-colors"
                    >
                      <td className="px-4 py-3 font-bold text-on-surface">{guest.name || 'Guest'}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{guest.phone || '-'}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{guest.email || '-'}</td>
                      <td className="px-4 py-3 text-on-surface">{guest.visit_count || 0}</td>
                      <td className="px-4 py-3 text-primary font-bold">{formatCurrency(guest.total_spend)}</td>
                      <td className="px-4 py-3 text-on-surface">{guest.loyalty_points || 0}</td>
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                        {guest.last_visit_at ? new Date(guest.last_visit_at).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${guest.marketing_consent ? 'bg-green-500/10 text-green-500' : 'bg-surface-container-high text-on-surface-variant'}`}>
                          {guest.marketing_consent ? 'Yes' : 'No'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="bg-surface-container-low border border-outline-variant/10 rounded-[2rem] p-6 h-max">
            {!selectedGuest ? (
              <p className="text-sm text-on-surface-variant">Select a guest to view order history, notes, and tags.</p>
            ) : (
              <div>
                <h3 className="font-headline text-2xl font-bold text-on-surface">{selectedGuest.name || 'Guest'}</h3>
                <p className="text-sm text-on-surface-variant mb-6">{selectedGuest.phone || selectedGuest.email || 'No contact saved'}</p>

                {duplicates.filter(item => item.keep_id === selectedGuest.id || item.duplicate_id === selectedGuest.id).map(item => {
                  const duplicateId = item.keep_id === selectedGuest.id ? item.duplicate_id : item.keep_id;
                  const duplicate = guests.find(guest => guest.id === duplicateId);
                  return (
                    <div key={duplicateId} className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                      <p className="text-xs font-bold uppercase tracking-widest text-amber-500">Possible duplicate</p>
                      <p className="mt-1 text-xs text-on-surface-variant">{duplicate?.name || 'Guest'} - {item.reason}</p>
                      <button onClick={() => mergeDuplicate(duplicateId)} className="mt-3 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-on-primary">
                        Merge profiles
                      </button>
                    </div>
                  );
                })}

                <label className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  onBlur={() => saveProfile({ notes })}
                  className="mt-2 mb-5 w-full min-h-28 rounded-xl bg-surface-container-high border border-outline-variant/20 p-3 text-sm text-on-surface focus:outline-none focus:border-primary"
                />

                <label className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Tags</label>
                <div className="flex gap-2 mt-2 mb-3">
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
                    className="flex-1 rounded-xl bg-surface-container-high border border-outline-variant/20 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
                    placeholder="vip, spicy..."
                  />
                  <button onClick={addTag} className="px-3 rounded-xl bg-primary text-on-primary text-xs font-bold">Add</button>
                </div>
                <div className="flex flex-wrap gap-2 mb-6">
                  {selectedTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => removeTag(tag)}
                      className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold"
                    >
                      {tag} x
                    </button>
                  ))}
                </div>

                <h4 className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-3">Recent Orders</h4>
                <div className="space-y-3">
                  {orders.length === 0 ? (
                    <p className="text-sm text-on-surface-variant">No linked orders yet.</p>
                  ) : orders.map(order => (
                    <div key={order.id} className="rounded-xl bg-surface-container border border-outline-variant/10 p-3">
                      <div className="flex justify-between gap-3 mb-2">
                        <p className="text-xs font-bold text-on-surface">{order.id}</p>
                        <p className="text-xs text-primary font-bold">{formatCurrency(order.total_amount)}</p>
                      </div>
                      <p className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-2">{order.status} / {new Date(order.created_at).toLocaleString()}</p>
                      <p className="text-xs text-on-surface-variant">
                        {(order.items || []).map(item => `${item.quantity}x ${item.name}`).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>
    </AdminLayout>
  );
}
