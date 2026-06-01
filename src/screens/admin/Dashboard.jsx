import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import AdminLayout from '../../components/AdminLayout';
import { AdminTopNav } from '../../components/TopNav';
import {
  adminFetchFeedbackInsights,
  adminFetchAlerts,
  adminFetchFlaggedFeedback,
  adminFetchOrders,
  adminFetchPeakHours,
  adminFetchRevenueForecast,
  adminFetchSentimentTrend,
  adminResolveFeedback,
  adminToggleFeedbackAnalysisLock,
} from '../../lib/api';
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
  const [sentimentTrend, setSentimentTrend] = useState([]);
  const [flaggedFeedback, setFlaggedFeedback] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [peakHours, setPeakHours] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
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

    const refreshFeedback = () => {
      Promise.all([
        adminFetchFeedbackInsights(user.restaurantId).catch(() => null),
        adminFetchSentimentTrend(user.restaurantId).catch(() => []),
        adminFetchFlaggedFeedback(user.restaurantId).catch(() => []),
        adminFetchRevenueForecast(user.restaurantId, 7).catch(() => []),
        adminFetchPeakHours(user.restaurantId).catch(() => []),
        adminFetchAlerts(user.restaurantId).catch(() => []),
      ]).then(([feedbackInsights, trend, flagged, forecastRows, peakRows, alertRows]) => {
        if (cancelled) return;
        setInsights(feedbackInsights);
        setSentimentTrend(trend);
        setFlaggedFeedback(flagged);
        setForecast(forecastRows);
        setPeakHours(peakRows);
        setAlerts(alertRows);
      });
    };

    const fetchAndSubscribe = async () => {
      try {
        const [{ data }, feedbackInsights, trend, flagged, forecastRows, peakRows, alertRows] = await Promise.all([
          adminFetchOrders(null, user.restaurantId),
          adminFetchFeedbackInsights(user.restaurantId).catch(() => null),
          adminFetchSentimentTrend(user.restaurantId).catch(() => []),
          adminFetchFlaggedFeedback(user.restaurantId).catch(() => []),
          adminFetchRevenueForecast(user.restaurantId, 7).catch(() => []),
          adminFetchPeakHours(user.restaurantId).catch(() => []),
          adminFetchAlerts(user.restaurantId).catch(() => []),
        ]);
        if (cancelled) return;
        setOrders(data);
        setInsights(feedbackInsights);
        setSentimentTrend(trend);
        setFlaggedFeedback(flagged);
        setForecast(forecastRows);
        setPeakHours(peakRows);
        setAlerts(alertRows);
        setLoading(false);

        const channelName = `dashboard_orders:${user.restaurantId}:${crypto.randomUUID()}`;
        channel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'Order', filter: `restaurant_id=eq.${user.restaurantId}` },
            refreshOrders
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'OrderFeedback', filter: `restaurant_id=eq.${user.restaurantId}` },
            refreshFeedback
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'AdminAlert', filter: `restaurant_id=eq.${user.restaurantId}` },
            refreshFeedback
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
  const topicData = (insights?.top_topics || []).map(topic => ({
    topic: String(topic.topic || '').replace(/_/g, ' '),
    count: Number(topic.count || 0),
  }));

  const handleResolveFeedback = async (feedbackId) => {
    try {
      await adminResolveFeedback(feedbackId, user.restaurantId);
      setFlaggedFeedback(prev => prev.filter(item => item.id !== feedbackId));
      addToast('Review marked resolved.', 'success');
    } catch (err) {
      addToast(`Failed to resolve review: ${err.message}`, 'error');
    }
  };

  const toggleAnalysisLock = async (feedbackId, currentValue) => {
    try {
      const updated = await adminToggleFeedbackAnalysisLock(feedbackId, user.restaurantId, !currentValue);
      setFlaggedFeedback(prev => prev.map(item => item.id === feedbackId ? { ...item, ...updated } : item));
      addToast(updated.analysis_locked ? 'Review analysis locked.' : 'Review analysis unlocked.', 'success');
    } catch (err) {
      addToast(`Could not update analysis lock: ${err.message}`, 'error');
    }
  };

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
  const distinctOrderDays = new Set(orders.map(order => new Date(order.created_at).toDateString())).size;
  const forecastData = forecast.map(row => ({
    date: new Date(row.forecast_date).toLocaleDateString('en-US', { weekday: 'short' }),
    predicted_revenue: Number(row.predicted_revenue || 0),
    predicted_orders: Number(row.predicted_orders || 0),
    upper: Number(row.predicted_revenue || 0) * 1.15,
    lower: Number(row.predicted_revenue || 0) * 0.85,
    revenueBand: [Number(row.predicted_revenue || 0) * 0.85, Number(row.predicted_revenue || 0) * 1.15],
  }));
  const peakMax = Math.max(...peakHours.map(row => Number(row.order_count || 0)), 1);
  const busiest = [...peakHours].sort((a, b) => Number(b.order_count || 0) - Number(a.order_count || 0))[0];
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <AdminLayout>
      <main className="admin-content px-6 md:px-12 lg:px-16 py-8 md:py-12 transition-theme">
        <AdminTopNav
          title="Daily Summary"
          subtitle="Refining the digital experience, one plate at a time."
        />

        {alerts.length > 0 && (
          <div className="mb-8 space-y-3">
            {alerts.slice(0, 4).map(alert => (
              <div key={alert.id} className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-error">{alert.title}</p>
                {alert.message && <p className="mt-1 text-sm text-on-surface-variant">{alert.message}</p>}
              </div>
            ))}
          </div>
        )}

        {/* ── KPI Cards ──────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {[
            { label: "TODAY'S ORDERS", value: loading ? '-' : todayOrders.length, delta: loading ? '—' : ordersDelta, icon: 'shopping_cart', isUp: ordersDelta.startsWith('+') },
            { label: 'NET REVENUE',    value: loading ? '-' : `Rs. ${netRevenue.toFixed(0)}`,  delta: loading ? '-' : revenueDelta, icon: 'attach_money', isUp: revenueDelta.startsWith('+') },
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
                      Rs. {d.value}
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
                        {order.id.slice(-6)} <span className="mx-1">-</span> Table {order.table?.number || order.table_id.slice(-4)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold font-headline mb-1 text-primary">Rs. {order.total_amount?.toFixed(2)}</div>
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

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-10">
          <div className={`p-8 min-w-0 overflow-hidden ${cardBg}`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-headline text-2xl font-bold text-on-surface">Sentiment Trend</h2>
              <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Last 30 Days</span>
            </div>
            <div className="h-72 min-h-[18rem] w-full min-w-0">
              <ResponsiveContainer width="100%" height={288} minWidth={0} minHeight={240}>
                <LineChart data={sentimentTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="day" tick={{ fill: 'currentColor', fontSize: 11 }} />
                  <YAxis domain={[0, 1]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#16161f', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }}
                    formatter={(value, name, item) => [value, name === 'avg_score' ? `Avg score (${item.payload.review_count} reviews)` : name]}
                  />
                  <ReferenceLine y={0.7} stroke="#22c55e" strokeDasharray="4 4" />
                  <ReferenceLine y={0.45} stroke="#ef4444" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="avg_score" stroke="#B8860B" strokeWidth={3} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`p-8 min-w-0 overflow-hidden ${cardBg}`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-headline text-2xl font-bold text-on-surface">Topic Breakdown</h2>
              <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Feedback Topics</span>
            </div>
            <div className="h-72 min-h-[18rem] w-full min-w-0">
              <ResponsiveContainer width="100%" height={288} minWidth={0} minHeight={240}>
                <BarChart data={topicData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="topic" tick={{ fill: 'currentColor', fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: 'currentColor', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#16161f', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    {topicData.map((entry, index) => (
                      <Cell key={entry.topic} fill={['#B8860B', '#5c9ee8', '#22c55e', '#f59e0b', '#9b6cdb'][index % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className={`p-8 mb-10 ${cardBg}`}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-headline text-2xl font-bold text-on-surface">Forecast</h2>
            {forecast[0]?.confidence && (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                {forecast[0].confidence} data confidence
              </span>
            )}
          </div>
          {distinctOrderDays < 7 ? (
            <p className="text-sm text-on-surface-variant">Not enough data yet - check back after your first week.</p>
          ) : (
            <div className="grid xl:grid-cols-[1.2fr_1fr] gap-8">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={forecastData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="date" tick={{ fill: 'currentColor', fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fill: 'currentColor', fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: 'currentColor', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#16161f', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} />
                    <Area yAxisId="left" type="monotone" dataKey="revenueBand" stroke="none" fill="#B8860B" fillOpacity={0.12} activeDot={false} />
                    <Line yAxisId="left" type="monotone" dataKey="predicted_revenue" stroke="#B8860B" strokeWidth={3} />
                    <Line yAxisId="right" type="monotone" dataKey="predicted_orders" stroke="#5c9ee8" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4">Staffing heatmap</p>
                <div className="grid grid-cols-[48px_repeat(16,minmax(0,1fr))] gap-1 text-[9px]">
                  <div />
                  {Array.from({ length: 16 }, (_, i) => i + 8).map(hour => <div key={hour} className="text-center text-on-surface-variant">{hour}</div>)}
                  {dayNames.map((day, dayIndex) => (
                    <React.Fragment key={day}>
                      <div className="text-on-surface-variant">{day}</div>
                      {Array.from({ length: 16 }, (_, i) => i + 8).map(hour => {
                        const row = peakHours.find(item => Number(item.day_of_week) === dayIndex + 1 && Number(item.hour_of_day) === hour);
                        const intensity = Number(row?.order_count || 0) / peakMax;
                        return <div key={`${day}-${hour}`} className="h-5 rounded bg-primary" style={{ opacity: 0.08 + intensity * 0.75 }} />;
                      })}
                    </React.Fragment>
                  ))}
                </div>
                {busiest && (
                  <div className="mt-5 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
                    Tip: Your busiest hour this week is predicted to be {dayNames[Number(busiest.day_of_week || 1) - 1]} {busiest.hour_of_day}:00 - consider adding extra staff.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={`p-8 ${cardBg}`}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-headline text-2xl font-bold text-on-surface">Flagged Reviews</h2>
            <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">{flaggedFeedback.length} open</span>
          </div>
          <div className="space-y-4">
            {flaggedFeedback.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No flagged low-rating reviews need attention.</p>
            ) : flaggedFeedback.map(item => (
              <div key={item.id} className="p-4 rounded-2xl bg-surface-container border border-outline-variant/10 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-primary">{item.order_id}</span>
                    <span className="text-xs text-on-surface-variant">{'★'.repeat(item.rating)}</span>
                    <span className="px-2 py-0.5 rounded-full bg-error/10 text-error text-[10px] uppercase tracking-widest font-bold">
                      {item.sentiment_label || 'review'}
                    </span>
                  </div>
                  <p className="text-sm text-on-surface-variant line-clamp-2">{item.comment || 'No written comment.'}</p>
                  <p className="text-[10px] uppercase tracking-widest text-on-surface-variant mt-2">{new Date(item.created_at).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => toggleAnalysisLock(item.id, item.analysis_locked)}
                    title={item.analysis_locked ? 'Unlock for re-analysis' : 'Lock analysis'}
                    className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-widest ${
                      item.analysis_locked
                        ? 'border-amber-500/40 text-amber-500'
                        : 'border-outline-variant/30 text-on-surface-variant'
                    }`}
                  >
                    {item.analysis_locked ? 'Locked' : 'Lock analysis'}
                  </button>
                  <button
                    onClick={() => handleResolveFeedback(item.id)}
                    className="rounded-xl bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-on-primary"
                  >
                    Resolved
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
