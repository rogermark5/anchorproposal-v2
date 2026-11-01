'use client';
import { useTimeZone } from '@/components/time-zone-settings';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { MultiSelect } from '@/components/multi-select';
import {
  FileText,
  CheckCircle,
  MessageSquare,
  Award,
  AlertTriangle,
  Plus,
  Sparkles,
  UserPlus,
  RotateCcw,
  Inbox,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/loading-spinner';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { cn, formatDate, APPLICATION_STATUSES, formatStatus } from '@/lib/utils';

const DEFAULT_STATUSES = ['APPLIED', 'INTERVIEW', 'OFFER'];

const CHART_COLORS: Record<string, string> = {
  saved: '#94a3b8',
  applied: '#0d7377',
  assessment: '#14919b',
  interview: '#0ea5a8',
  offer: '#059669',
  rejected: '#ef4444',
  withdrawn: '#78716c',
  closed: '#64748b',
};

const KPI_ACCENTS = [
  'border-l-primary',
  'border-l-emerald-500',
  'border-l-teal-400',
  'border-l-cyan-600',
  'border-l-amber-500',
];

type MetricsData = Awaited<ReturnType<typeof api.getDashboardMetrics>>;

function humanizeStatus(status: string): string {
  return formatStatus(status);
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 shadow-md text-sm">
      <p className="font-medium text-slate-800 mb-1.5">{label}</p>
      <ul className="space-y-1">
        {payload.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2 text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span>{entry.name}</span>
            <span className="ml-auto font-semibold text-slate-800 tabular-nums">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DashboardPage() {
  useTimeZone();
  const { canBid, isMaster, isAdmin } = useAuth();
  const [data, setData] = useState<MetricsData | null>(null);
  const [analyticsTab, setAnalyticsTab] = useState<'admin' | 'bidder'>('admin');
  const [adminIds, setAdminIds] = useState<string[]>([]);
  const [bidderIds, setBidderIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([...DEFAULT_STATUSES]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const metricsRequest = useRef(0);

  const loadMetrics = useCallback(async () => {
    const request = ++metricsRequest.current;
    setLoading(true);
    try {
      const params = isAdmin
        ? {
            adminIds: isMaster && adminIds.length ? adminIds : undefined,
            bidderIds: bidderIds.length ? bidderIds : undefined,
            statuses: statuses.length ? statuses : undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          }
        : undefined;
      const metrics = await api.getDashboardMetrics(params);
      if (request === metricsRequest.current) setData(metrics);
    } catch (err) {
      console.error(err);
    } finally {
      if (request === metricsRequest.current) setLoading(false);
    }
  }, [isAdmin, isMaster, adminIds, bidderIds, statuses, startDate, endDate]);

  useEffect(() => {
    void loadMetrics();
    const refresh = () => { void loadMetrics(); };
    window.addEventListener('focus', refresh);
    const off = (window as any).anchor?.onEvent((event: any) => {
      if (event.type === 'data-changed' && /^\/(applications|generations)/.test(event.route) || event.type === 'job' && event.job?.stage === 'completed') refresh();
    });
    return () => { metricsRequest.current++; window.removeEventListener('focus', refresh); off?.(); };
  }, [loadMetrics]);

  const filterOptions = data?.filterOptions;
  const bidderOptions = useMemo(() => {
    const all = filterOptions?.bidders ?? [];
    if (!isMaster || !adminIds.length) return all;
    return all.filter((b) => b.adminId && adminIds.includes(b.adminId));
  }, [filterOptions, adminIds, isMaster]);

  useEffect(() => {
    if (!isMaster || !adminIds.length) return;
    const allowed = new Set(bidderOptions.map((b) => b.id));
    setBidderIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [isMaster, adminIds, bidderOptions]);

  const chartStatuses = statuses.length ? statuses : DEFAULT_STATUSES;

  const chartHasData = useMemo(() => {
    const trend = data?.trend ?? [];
    return trend.some((point) =>
      chartStatuses.some((s) => Number(point[s.toLowerCase()] ?? 0) > 0),
    );
  }, [data?.trend, chartStatuses]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (isMaster && adminIds.length) {
      parts.push(`${adminIds.length} admin${adminIds.length > 1 ? 's' : ''}`);
    }
    if (bidderIds.length) parts.push(`${bidderIds.length} bidder${bidderIds.length > 1 ? 's' : ''}`);
    if (statuses.length) parts.push(`${statuses.length} status${statuses.length > 1 ? 'es' : ''}`);
    if (startDate || endDate) {
      parts.push([startDate || '…', endDate || '…'].join(' → '));
    } else {
      parts.push('Last 7 days');
    }
    return parts.join(' · ');
  }, [isMaster, adminIds, bidderIds, statuses, startDate, endDate]);

  const resetFilters = () => {
    setAdminIds([]);
    setBidderIds([]);
    setStatuses([...DEFAULT_STATUSES]);
    setStartDate('');
    setEndDate('');
  };

  const toggleStatus = (status: string) => {
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  };

  const kpis = [
    { label: 'Total Applications', value: data?.kpis.total ?? 0, icon: FileText, color: 'text-primary bg-primary/10' },
    {
      label: 'Applied',
      value: data?.kpis.applied ?? data?.kpis.readyToApply ?? 0,
      icon: CheckCircle,
      color: 'text-emerald-700 bg-emerald-50',
    },
    { label: 'Interviews', value: data?.kpis.interviews ?? 0, icon: MessageSquare, color: 'text-teal-700 bg-teal-50' },
    { label: 'Offers', value: data?.kpis.offers ?? 0, icon: Award, color: 'text-cyan-800 bg-cyan-50' },
    { label: 'Warnings', value: data?.kpis.warnings ?? 0, icon: AlertTriangle, color: 'text-amber-700 bg-amber-50' },
  ];

  const thClass = 'pb-2.5 font-medium text-xs uppercase tracking-wide text-slate-400';

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-800 tracking-tight">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          {isMaster
            ? 'Platform-wide analytics across admins and bidders'
            : isAdmin
              ? 'Overview for you and your managed bidders'
              : 'Overview of your application activity'}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={cn(
                'bg-white border border-[var(--border)] rounded-xl p-5 border-l-4 shadow-sm',
                KPI_ACCENTS[i],
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {kpi.label}
                </span>
                <div className={cn('p-2 rounded-lg', kpi.color)}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-bold text-slate-800 tabular-nums">{kpi.value}</p>
            </div>
          );
        })}
      </div>

      {isMaster && (
        <div className="bg-white border border-[var(--border)] rounded-xl p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-slate-800">Analytics</h2>
            <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-sm shadow-sm">
              <button
                type="button"
                onClick={() => setAnalyticsTab('admin')}
                className={cn(
                  'px-3.5 py-1.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]/30',
                  analyticsTab === 'admin'
                    ? 'bg-primary text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                By Admin
              </button>
              <button
                type="button"
                onClick={() => setAnalyticsTab('bidder')}
                className={cn(
                  'px-3.5 py-1.5 font-medium border-l border-[var(--border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]/30',
                  analyticsTab === 'bidder'
                    ? 'bg-primary text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                By Bidder
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            {analyticsTab === 'admin' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-[var(--border)]">
                    <th className={thClass}>Admin</th>
                    <th className={thClass}>Bidders</th>
                    <th className={thClass}>Applications</th>
                    <th className={thClass}>Interviews</th>
                    <th className={thClass}>Offers</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.byAdmin?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-slate-400 text-center">
                        No data
                      </td>
                    </tr>
                  ) : (
                    data?.byAdmin?.map((row) => (
                      <tr key={row.adminId} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="py-3 font-medium text-slate-800">{row.name}</td>
                        <td className="py-3 tabular-nums">{row.bidderCount}</td>
                        <td className="py-3 tabular-nums">{row.total}</td>
                        <td className="py-3 tabular-nums">{row.interviews}</td>
                        <td className="py-3 tabular-nums">{row.offers}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-[var(--border)]">
                    <th className={thClass}>Bidder</th>
                    <th className={thClass}>Admin</th>
                    <th className={thClass}>Applications</th>
                    <th className={thClass}>Interviews</th>
                    <th className={thClass}>Offers</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.byBidder?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-slate-400 text-center">
                        No data
                      </td>
                    </tr>
                  ) : (
                    data?.byBidder?.map((row) => (
                      <tr key={row.bidderId} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="py-3 font-medium text-slate-800">{row.name}</td>
                        <td className="py-3 text-slate-600">{row.adminName}</td>
                        <td className="py-3 tabular-nums">{row.total}</td>
                        <td className="py-3 tabular-nums">{row.interviews}</td>
                        <td className="py-3 tabular-nums">{row.offers}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {isAdmin && !isMaster && (
        <div className="bg-white border border-[var(--border)] rounded-xl p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-slate-800">Analytics</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-[var(--border)]">
                  <th className={thClass}>Bidder</th>
                  <th className={thClass}>Applications</th>
                  <th className={thClass}>Interviews</th>
                  <th className={thClass}>Offers</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byBidder?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-slate-400 text-center">
                      No data
                    </td>
                  </tr>
                ) : (
                  data?.byBidder?.map((row) => (
                    <tr key={row.bidderId} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="py-3 font-medium text-slate-800">{row.name}</td>
                      <td className="py-3 tabular-nums">{row.total}</td>
                      <td className="py-3 tabular-nums">{row.interviews}</td>
                      <td className="py-3 tabular-nums">{row.offers}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white border border-[var(--border)] rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">Application Overview</h2>
            {loading && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <LoadingSpinner size="sm" className="text-primary" />
                Updating
              </span>
            )}
          </div>

          {isAdmin && (
            <div className="mb-5 rounded-xl border border-[var(--border)] bg-slate-50/80 p-4 space-y-4">
              <div
                className={cn(
                  'grid grid-cols-1 sm:grid-cols-2 gap-4 items-end',
                  isMaster ? 'lg:grid-cols-5' : 'lg:grid-cols-4',
                )}
              >
                {isMaster && (
                  <MultiSelect
                    label="Admin"
                    placeholder="All admins"
                    emptyText="No admins"
                    options={filterOptions?.admins ?? []}
                    value={adminIds}
                    onChange={setAdminIds}
                  />
                )}
                <MultiSelect
                  label="Bidder"
                  placeholder="All bidders"
                  emptyText="No bidders"
                  options={bidderOptions}
                  value={bidderIds}
                  onChange={setBidderIds}
                />
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Start</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full h-10 text-sm border border-[var(--border)] rounded-lg px-3 bg-white text-slate-800 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary-light)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">End</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full h-10 text-sm border border-[var(--border)] rounded-lg px-3 bg-white text-slate-800 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary-light)]"
                  />
                </div>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-500">Status</label>
                  <button
                    type="button"
                    onClick={() => setStatuses([...DEFAULT_STATUSES])}
                    className="text-[11px] font-medium text-[var(--primary-light)] hover:underline"
                  >
                    Select defaults
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {APPLICATION_STATUSES.map((s) => {
                    const selected = statuses.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleStatus(s)}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                          selected
                            ? 'bg-[var(--primary)] border-[var(--primary)] text-white shadow-sm'
                            : 'bg-white border-[var(--border)] text-slate-600 hover:border-slate-300',
                        )}
                      >
                        {humanizeStatus(s)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-slate-400 border-t border-[var(--border)]/80 pt-3">
                Filtering · {filterSummary}
              </p>
            </div>
          )}

          <div className="relative">
            {!chartHasData && (
              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-slate-400 bg-white/80 px-3 py-1.5 rounded-lg border border-slate-100">
                  No applications in this range
                </p>
              </div>
            )}
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data?.trend || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  tickFormatter={(d) => String(d).slice(5)}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {chartStatuses.map((status) => {
                  const key = status.toLowerCase();
                  return (
                    <Line
                      key={status}
                      type="monotone"
                      dataKey={key}
                      stroke={CHART_COLORS[key] || '#64748b'}
                      strokeWidth={2.5}
                      name={humanizeStatus(status)}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-[var(--border)] rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Recent Generation Activity</h2>
          <div className="space-y-3">
            {(data?.recentGenerations || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-3 rounded-full bg-slate-50 p-3 border border-slate-100">
                  <Inbox className="w-5 h-5 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-500">No recent generations</p>
                <p className="text-xs text-slate-400 mt-1 max-w-[14rem]">
                  Completed resume runs will show up here.
                </p>
              </div>
            ) : (
              data?.recentGenerations.map((g) => (
                <div key={g.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <Sparkles className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{g.jobTitle}</p>
                    <p className="text-xs text-slate-500">
                      {g.company} — {g.creator}
                    </p>
                    {g.completedAt && (
                      <p className="text-xs text-slate-400 mt-0.5">{formatDate(g.completedAt)}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          {canBid && (
            <>
              <Link
                href="/applications/new"
                className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light"
              >
                <Plus className="w-4 h-4" /> New Application
              </Link>
              <Link
                href="/applications"
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Sparkles className="w-4 h-4" /> Generate Resume
              </Link>
              <Link
                href="/job-pool"
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <FileText className="w-4 h-4" /> Browse Job Pool
              </Link>
            </>
          )}
          {isAdmin && (
            <Link
              href="/profiles"
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <UserPlus className="w-4 h-4" /> Manage Profiles
            </Link>
          )}
          {isMaster && (
            <Link
              href="/users"
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <UserPlus className="w-4 h-4" /> Manage Users
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
