import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Truck, Package, RotateCcw, Activity,
  TrendingUp, TrendingDown, DollarSign, AlertTriangle,
  Users as UsersIcon,
} from 'lucide-react';
import TenantLayout from '../components/tenant/TenantLayout';
import LoadVolumeTrend from '../components/dashboard/LoadVolumeTrend';
import AlertsFeed from '../components/dashboard/AlertsFeed';
import QuickActions from '../components/dashboard/QuickActions';
import RecentActivity from '../components/dashboard/RecentActivity';
import { formatCents } from '../lib/ar-utils';

function StatCard({ label, value, subtext, icon: Icon, color, onClick }) {
  const colorMap = {
    blue: 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900/60',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/60',
    amber: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/60',
    red: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/60',
    purple: 'bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900/60',
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-all hover:shadow-sm ${c}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-5 h-5 opacity-70" />
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <div className="text-xs font-semibold opacity-80">{label}</div>
      {subtext && <div className="text-[10px] opacity-60 mt-0.5">{subtext}</div>}
    </button>
  );
}

function RevenueCard({ label, current, previous, prefix = '$' }) {
  const currentF = prefix === '$' ? formatCents(current) : current;
  const delta = previous > 0 ? ((current - previous) / previous * 100).toFixed(0) : '—';
  const isUp = current >= previous;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">{currentF}</div>
      <div className={`flex items-center gap-1 mt-1 text-xs font-semibold ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
        {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {delta !== '—' ? `${isUp ? '+' : ''}${delta}% vs last` : 'No prior data'}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tenant/dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const ops = data?.todaysOps || {};
  const rev = data?.revenue || {};
  const ar = data?.openAR || {};
  const alerts = data?.alerts || {};
  const driverUtil = data?.driverUtil || {};

  return (
    <TenantLayout title="Dashboard">
      <div className="space-y-5">
        {/* Row 1: Today's Ops */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            Today's Operations
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Picking Up" value={loading ? '—' : ops.picking_up || 0}
              icon={Package} color="blue" onClick={() => router.push('/dispatcher')} />
            <StatCard label="Delivering" value={loading ? '—' : ops.delivering || 0}
              icon={Truck} color="emerald" onClick={() => router.push('/dispatcher')} />
            <StatCard label="Returning" value={loading ? '—' : ops.returning || 0}
              icon={RotateCcw} color="amber" onClick={() => router.push('/dispatcher')} />
            <StatCard label="Total Active" value={loading ? '—' : ops.total_active || 0}
              icon={Activity} color="purple" onClick={() => router.push('/dispatcher')} />
          </div>
        </div>

        {/* Row 2: Revenue + AR + Alerts count */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <RevenueCard label="This Week" current={rev.thisWeek || 0} previous={rev.lastWeek || 0} />
          <RevenueCard label="This Month" current={rev.thisMonth || 0} previous={rev.lastMonth || 0} />
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Open AR</div>
            <div className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">{formatCents(ar.totalOutstanding || 0)}</div>
            {ar.totalOverdue > 0 && (
              <div className="text-xs text-red-500 dark:text-red-400 font-semibold mt-1">
                {formatCents(ar.totalOverdue)} overdue
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Drivers</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{driverUtil.active || 0}</span>
              <span className="text-xs text-gray-400 dark:text-slate-500">active</span>
            </div>
            <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
              {driverUtil.on_leave || 0} on leave · {driverUtil.inactive || 0} inactive
            </div>
          </div>
        </div>

        {/* Row 3: Chart + Alerts + Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <LoadVolumeTrend data={data?.loadVolume || []} />
          </div>
          <QuickActions />
        </div>

        {/* Row 4: Alerts + Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <AlertsFeed alerts={alerts} />
          <RecentActivity activity={data?.recentActivity || []} />
        </div>
      </div>
    </TenantLayout>
  );
}
