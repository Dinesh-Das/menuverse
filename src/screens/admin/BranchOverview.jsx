import React, { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { adminFetchBranchOverview } from '../../lib/api';

export default function BranchOverview() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const groupOwnerId = user?.restaurant?.group_owner_id || user?.id;
    if (!groupOwnerId || user?.role !== 'owner') return;
    setLoading(true);
    adminFetchBranchOverview(groupOwnerId)
      .then(setBranches)
      .catch(err => addToast(`Failed to load branches: ${err.message}`, 'error'))
      .finally(() => setLoading(false));
  }, [user, addToast]);

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav title="Branches" subtitle="Compare revenue, sentiment, active tables, and top dishes across locations." />

        <div className="bg-surface-container-low border border-outline-variant/10 rounded-[2rem] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-container text-[10px] uppercase tracking-widest text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Orders Today</th>
                  <th className="px-4 py-3">Revenue Today</th>
                  <th className="px-4 py-3">Avg Sentiment</th>
                  <th className="px-4 py-3">Active Tables</th>
                  <th className="px-4 py-3">Top Dish</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {loading ? (
                  <tr><td colSpan="6" className="px-4 py-10 text-center text-on-surface-variant">Loading branches...</td></tr>
                ) : branches.length === 0 ? (
                  <tr><td colSpan="6" className="px-4 py-10 text-center text-on-surface-variant">No branch group is configured yet.</td></tr>
                ) : branches.map(branch => (
                  <tr key={branch.restaurant_id}>
                    <td className="px-4 py-3 font-bold text-on-surface">{branch.restaurant_name}</td>
                    <td className="px-4 py-3 text-on-surface">{branch.orders_today}</td>
                    <td className="px-4 py-3 text-primary font-bold">Rs. {Number(branch.revenue_today || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-on-surface">{Math.round(Number(branch.avg_sentiment || 0.5) * 100)}%</td>
                    <td className="px-4 py-3 text-on-surface">{branch.active_tables}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{branch.top_dish || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
