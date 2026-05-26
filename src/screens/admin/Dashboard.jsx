import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import { adminFetchFeedbackInsights, adminFetchOrders } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';

const STATUS_COLORS = {
  'preparing': 'bg-primary/10 text-primary border border-primary/20',
  'ready':     'bg-tertiary/10 text-tertiary border border-tertiary/20',
  'served':    'bg-green-600/10 text-green-600 dark:text-green-400 border border-green-600/20',
  'completed': 'bg-green-600/10 text-green-600 dark:text-green-400 border border-green-600/20',
  'cancelled': 'bg-error/10 text-error border border-error/20',
};

export default function Dashboard() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const cardBg = 'bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] transition-theme';

  useEffect(() => {
    if (!user?.restaurantId) return;
    
    let channel = null;
    let cancelled = false;

    const refreshOrders = () => {
      adminFetchOrders(null, user.restaurantId)
        .then(res => {
          if (!cancelled) setOrders(res.data);
        })
        .catch(err => {
          if (cancelled) return;
          console.error(err);
          addToast(`Failed to refresh dashboard orders: ${err.message}`, 'error');
        });
    };

    const fetchAndSubscribe = async () => {
      try {
        const [{ data }, feedbackInsights] = await Promise.all([
          adminFetchOrders(null, user.restaurantId),
          adminFetchFeedbackInsights(user.restaurantId).catch(() => null),
        ]);
        if (cancelled) return;
        setOrders(data);
        setInsights(feedbackInsights);
        setLoading(false);

        const channelName = `dashboard_orders:${user.restaurantId}:${crypto.randomUUID()}`;
        channel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'Order', filter: `restaurant_id=eq.${user.restaurantId}` },
            refreshOrders
          );

        channel.subscribe();
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        addToast(`Failed to load dashboard orders: ${err.message}`, 'error');
        setLoading(false);
      }
    };

    fetchAndSubscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user, addToast]);

  // Simple aggregations
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayOrders = orders.filter(o => new Date(o.created_at + (o.created_at.endsWith('Z') ? '' : 'Z')) >= today);
  const netRevenue = todayOrders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.total_amount : 0), 0);

  // Week-over-week delta calculations (LF-4)
  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
  thisWeekStart.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const thisWeekOrders = orders.filter(o => new Date(o.created_at + (o.created_at.endsWith('Z') ? '' : 'Z')) >= thisWeekStart);
  const lastWeekOrders = orders.filter(o => {
    const d = new Date(o.created_at + (o.created_at.endsWith('Z') ? '' : 'Z'));
    return d >= lastWeekStart && d < thisWeekStart;
  });

  const thisWeekCount = thisWeekOrders.length;
  const lastWeekCount = lastWeekOrders.length;
  const thisWeekRev = thisWeekOrders.reduce((s, o) => s + (o.status !== 'cancelled' ? o.total_amount : 0), 0);
  const lastWeekRev = lastWeekOrders.reduce((s, o) => s + (o.status !== 'cancelled' ? o.total_amount : 0), 0);

  const calcDelta = (curr, prev) => {
    if (prev === 0) return curr > 0 ? '+100%' : 'N/A';
    const pct = ((curr - prev) / prev) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
  };

  const ordersDelta = calcDelta(thisWeekCount, lastWeekCount);
  const revenueDelta = calcDelta(thisWeekRev, lastWeekRev);
  const sentimentPct = Math.round(Number(insights?.avg_sentiment_score ?? 0.5) * 100);

  // Group by day for the chart (last 7 days)
  const last7Days = Array.from({length: 7}).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });

  const chartData = last7Days.map(date => {
    const dayStr = date.toLocaleDateString('en-US', { weekday: 'short' });
    const dayOrders = orders.filter(o => {
      const oDate = new Date(o.created_at + (o.created_at.endsWith('Z') ? '' : 'Z'));
      return oDate.toDateString() === date.toDateString();
    });
    const rev = dayOrders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.total_amount : 0), 0);
    return { day: dayStr, value: rev };
  });

  const maxVal = Math.max(...chartData.map(d => d.value), 100);
  const recentOrdersList = orders.slice(0, 8);

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav
          title="Daily Summary"
          subtitle="Refining the digital experience, one plate at a time."
        />

        {/* ── KPI Cards ──────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {[
            { label: "TODAY'S ORDERS", value: loading ? '-' : todayOrders.length, delta: loading ? '—' : ordersDelta, icon: 'shopping_cart', isUp: ordersDelta.startsWith('+') },
            { label: 'NET REVENUE',    value: loading ? '-' : `₹${netRevenue.toFixed(0)}`,  delta: loading ? '—' : revenueDelta, icon: 'attach_money', isUp: revenueDelta.startsWith('+') },
            { label: 'AVG SENTIMENT',  value: loading ? '-' : `${sentimentPct}%`, delta: loading ? '—' : `${insights?.feedback_count || 0} reviews`, icon: 'psychology', isUp: sentimentPct >= 70 },
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
              <div className={`text-xs font-bold flex items-center gap-1 ${kpi.isUp ? 'text-green-600' : kpi.delta.startsWith('-') ? 'text-error' : 'text-on-surface-variant'}`}>
                <span className="material-symbols-outlined text-sm">{kpi.isUp ? 'trending_up' : kpi.delta.startsWith('-') ? 'trending_down' : 'trending_flat'}</span>
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
