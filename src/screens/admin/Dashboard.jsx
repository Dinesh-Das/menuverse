import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { adminFetchOrders } from '../../lib/api';

const STATUS_COLORS = {
  'preparing': 'bg-primary/10 text-primary border border-primary/20',
  'ready': 'bg-tertiary/10 text-tertiary border border-tertiary/20',
  'served': 'bg-green-800/10 text-green-700 border border-green-800/20',
  'completed': 'bg-green-800/10 text-green-700 border border-green-800/20',
  'cancelled': 'bg-error/10 text-error border border-error/20',
};

export default function Dashboard() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem]';

  useEffect(() => {
    adminFetchOrders()
      .then(data => {
        setOrders(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  // Simple aggregations
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayOrders = orders.filter(o => new Date(o.created_at) >= today);
  const netRevenue = todayOrders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.total_amount : 0), 0);

  // Group by day for the chart (last 7 days)
  const last7Days = Array.from({length: 7}).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });

  const chartData = last7Days.map(date => {
    const dayStr = date.toLocaleDateString('en-US', { weekday: 'short' });
    const dayOrders = orders.filter(o => {
      const oDate = new Date(o.created_at);
      return oDate.getDate() === date.getDate() && oDate.getMonth() === date.getMonth();
    });
    const rev = dayOrders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.total_amount : 0), 0);
    return { day: dayStr, value: rev };
  });

  const maxVal = Math.max(...chartData.map(d => d.value), 100);
  const recentOrdersList = orders.slice(0, 8);

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12">
        <AdminTopNav
          title="Daily Summary"
          subtitle="Refining the digital experience, one plate at a time."
        />

        {/* ── KPI Cards ──────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {[
            { label: "TODAY'S ORDERS", value: loading ? '-' : todayOrders.length, delta: '+12%', icon: 'shopping_cart' },
            { label: 'NET REVENUE',    value: loading ? '-' : `₹${netRevenue.toFixed(0)}`,  delta: '+8%', icon: 'attach_money' },
            { label: 'AR ENGAGEMENT',  value: '—', delta: 'Coming Soon', icon: 'view_in_ar' },
          ].map(kpi => (
            <div key={kpi.label} className={`relative overflow-hidden p-8 ${cardBg}`}>
              <span className="material-symbols-outlined absolute -right-6 -bottom-6 text-[8rem] pointer-events-none select-none text-on-surface opacity-[0.03]">
                {kpi.icon}
              </span>
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold mb-4 text-on-surface-variant">
                {kpi.label}
              </div>
              <div className="text-5xl font-bold mb-3 font-headline text-on-surface">
                {kpi.value}
              </div>
              <div className="text-xs font-bold text-green-600 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">trending_up</span>
                {kpi.delta} this week
              </div>
            </div>
          ))}
        </div>

        {/* ── Charts + Recent Orders ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 mb-10">
          
          {/* Revenue Chart */}
          <div className={`lg:col-span-3 p-10 flex flex-col ${cardBg}`}>
            <div className="flex items-center justify-between mb-10">
              <h2 className="font-headline text-2xl font-bold text-on-surface">
                Revenue Trends
              </h2>
              <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Last 7 Days</span>
            </div>
            
            {/* Bar Chart */}
            <div className="flex items-end gap-4 h-56 mt-auto">
              {chartData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-3">
                  <div
                    className="w-full rounded-t-lg bar-chart-bar hover:opacity-80 cursor-pointer transition-all bg-primary/20 relative group"
                    style={{ height: `${Math.max((d.value / maxVal) * 100, 2)}%` }}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-surface-container-highest text-on-surface text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      ₹{d.value}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    {d.day}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Orders */}
          <div className={`lg:col-span-2 p-8 flex flex-col ${cardBg}`}>
            <div className="flex items-center justify-between mb-8">
              <h2 className="font-headline text-2xl font-bold text-on-surface">
                Recent Orders
              </h2>
              <span className="material-symbols-outlined cursor-pointer text-on-surface-variant">
                more_vert
              </span>
            </div>
            <div className="space-y-5 flex-1 max-h-[440px] overflow-y-auto hide-scrollbar">
              {loading ? (
                <div className="text-center py-10 text-on-surface-variant">Loading...</div>
              ) : recentOrdersList.length === 0 ? (
                <div className="text-center py-10 text-on-surface-variant">No recent orders</div>
              ) : (
                recentOrdersList.map(order => (
                  <div key={order.id} className="flex items-center gap-4 hover:bg-surface-container-high p-4 rounded-2xl transition-all cursor-pointer">
                    <div className="w-12 h-12 rounded-xl bg-surface-container-highest flex items-center justify-center text-on-surface-variant flex-shrink-0 shadow-sm">
                       <span className="material-symbols-outlined">receipt_long</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate text-on-surface">
                        {order.items?.map(i => i.name).join(', ') || 'Custom Order'}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest mt-1 text-on-surface-variant">
                        {order.id.slice(-6)} <span className="mx-1">•</span> Table {order.table?.number || order.table_id.slice(-4)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold font-headline mb-1 text-primary">₹{order.total_amount?.toFixed(2)}</div>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${STATUS_COLORS[order.status] || 'bg-surface-container text-on-surface-variant'}`}>
                        {order.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <Link to="/admin/orders" className="w-full block text-center text-[10px] font-bold uppercase tracking-[0.2em] mt-6 pt-6 border-t transition-colors cursor-pointer border-outline-variant/10 text-primary hover:text-primary-fixed">
              View All Orders
            </Link>
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
