import React, { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import {
  adminCreateCampaign,
  adminEstimateCampaignRecipients,
  adminFetchCampaigns,
  adminSendCampaign,
} from '../../lib/api';

const emptyForm = {
  name: '',
  channel: 'whatsapp',
  subject: '',
  message_body: '',
  min_visits: 1,
  last_visit_days: 90,
};

export default function Campaigns() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [recipientEstimate, setRecipientEstimate] = useState(0);
  const [saving, setSaving] = useState(false);

  const audienceFilter = React.useMemo(() => ({
    min_visits: Number(form.min_visits || 0),
    last_visit_days: Number(form.last_visit_days || 0),
    marketing_consent: true,
  }), [form.min_visits, form.last_visit_days]);

  const loadCampaigns = async () => {
    if (!user?.restaurantId) return;
    try {
      const data = await adminFetchCampaigns(user.restaurantId);
      setCampaigns(data);
    } catch (err) {
      addToast(`Failed to load campaigns: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    loadCampaigns();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.restaurantId]);

  useEffect(() => {
    if (!user?.restaurantId || !showForm) return;
    const timeout = setTimeout(() => {
      adminEstimateCampaignRecipients(user.restaurantId, audienceFilter)
        .then(setRecipientEstimate)
        .catch(() => setRecipientEstimate(0));
    }, 250);
    return () => clearTimeout(timeout);
  }, [user?.restaurantId, showForm, audienceFilter]);

  const updateForm = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const saveCampaign = async (sendNow = false) => {
    if (!form.name.trim() || !form.message_body.trim()) {
      addToast('Campaign name and message are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const campaign = await adminCreateCampaign(user.restaurantId, {
        name: form.name.trim(),
        channel: form.channel,
        subject: form.subject.trim(),
        message_body: form.message_body.trim(),
        audience_filter: audienceFilter,
      });
      if (sendNow) await adminSendCampaign(campaign.id);
      addToast(sendNow ? 'Campaign sending started.' : 'Campaign saved as draft.', 'success');
      setForm(emptyForm);
      setShowForm(false);
      loadCampaigns();
    } catch (err) {
      addToast(`Campaign save failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav title="Campaigns" subtitle="Send consent-based WhatsApp and email campaigns to returning guests." />

        <div className="flex justify-end mb-6">
          <button
            onClick={() => setShowForm(value => !value)}
            className="px-5 py-3 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest"
          >
            New Campaign
          </button>
        </div>

        {showForm && (
          <div className="mb-8 bg-surface-container-low border border-outline-variant/10 rounded-[2rem] p-8">
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <input
                value={form.name}
                onChange={e => updateForm('name', e.target.value)}
                className="rounded-xl bg-surface-container-high border border-outline-variant/20 px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary"
                placeholder="Campaign name"
              />
              <select
                value={form.channel}
                onChange={e => updateForm('channel', e.target.value)}
                className="rounded-xl bg-surface-container-high border border-outline-variant/20 px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="both">Both</option>
              </select>
            </div>
            {(form.channel === 'email' || form.channel === 'both') && (
              <input
                value={form.subject}
                onChange={e => updateForm('subject', e.target.value)}
                className="mb-4 w-full rounded-xl bg-surface-container-high border border-outline-variant/20 px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary"
                placeholder="Email subject"
              />
            )}
            <textarea
              value={form.message_body}
              onChange={e => updateForm('message_body', e.target.value)}
              className="w-full min-h-36 rounded-xl bg-surface-container-high border border-outline-variant/20 px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary"
              placeholder="Message body. Merge tags: {{name}}, {{restaurant_name}}"
            />
            <div className="grid md:grid-cols-3 gap-4 mt-4">
              <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                Min visits
                <input
                  type="number"
                  min="1"
                  value={form.min_visits}
                  onChange={e => updateForm('min_visits', e.target.value)}
                  className="mt-2 w-full rounded-xl bg-surface-container-high border border-outline-variant/20 px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                Last visit within days
                <input
                  type="number"
                  min="1"
                  value={form.last_visit_days}
                  onChange={e => updateForm('last_visit_days', e.target.value)}
                  className="mt-2 w-full rounded-xl bg-surface-container-high border border-outline-variant/20 px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </label>
              <div className="rounded-xl bg-surface-container border border-outline-variant/10 p-4">
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Estimated recipients</p>
                <p className="text-3xl font-headline text-primary">{recipientEstimate}</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => saveCampaign(false)}
                disabled={saving}
                className="px-5 py-3 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold uppercase tracking-widest disabled:opacity-50"
              >
                Save Draft
              </button>
              <button
                onClick={() => saveCampaign(true)}
                disabled={saving}
                className="px-5 py-3 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest disabled:opacity-50"
              >
                Send Now
              </button>
            </div>
          </div>
        )}

        <div className="bg-surface-container-low border border-outline-variant/10 rounded-[2rem] overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container text-[10px] uppercase tracking-widest text-on-surface-variant">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recipients</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {campaigns.length === 0 ? (
                <tr><td colSpan="6" className="px-4 py-10 text-center text-on-surface-variant">No campaigns yet.</td></tr>
              ) : campaigns.map(campaign => (
                <tr key={campaign.id}>
                  <td className="px-4 py-3 font-bold text-on-surface">{campaign.name}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{campaign.channel}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
                      {campaign.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-on-surface">{campaign.recipients_count || 0}</td>
                  <td className="px-4 py-3 text-on-surface">{campaign.sent_count || 0}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{new Date(campaign.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </AdminLayout>
  );
}
