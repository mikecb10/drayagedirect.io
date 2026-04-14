import { useRouter } from 'next/router';
import { AlertTriangle, Clock, FileText, Shield } from 'lucide-react';

export default function AlertsFeed({ alerts = {} }) {
  const router = useRouter();
  const items = [];

  // Expiring driver docs
  if (alerts.expiring_docs > 0) {
    items.push({
      icon: Shield, color: 'text-amber-500 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40',
      message: `${alerts.expiring_docs} driver doc${alerts.expiring_docs > 1 ? 's' : ''} expiring within 30 days`,
      action: () => router.push('/settings/team'),
    });
  }

  // Approaching LFD
  if (alerts.approaching_lfd > 0) {
    items.push({
      icon: Clock, color: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40',
      message: `${alerts.approaching_lfd} load${alerts.approaching_lfd > 1 ? 's' : ''} with LFD approaching (within 2 days)`,
      action: () => router.push('/dispatcher'),
    });
  }

  // Past-due invoices
  if (alerts.past_due_invoices > 0) {
    items.push({
      icon: AlertTriangle, color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/40',
      message: `${alerts.past_due_invoices} past-due invoice${alerts.past_due_invoices > 1 ? 's' : ''}`,
      action: () => router.push('/ar'),
    });
  }

  // Pending docs
  if (alerts.pending_docs > 0) {
    items.push({
      icon: FileText, color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40',
      message: `${alerts.pending_docs} document${alerts.pending_docs > 1 ? 's' : ''} awaiting validation`,
      action: () => router.push('/dispatcher'),
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Alerts</h3>
      {items.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400 dark:text-slate-500">All clear — no alerts right now.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <button
              key={idx}
              onClick={item.action}
              className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors text-left"
            >
              <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center shrink-0`}>
                <item.icon className={`w-4 h-4 ${item.color}`} />
              </div>
              <span className="text-sm text-gray-700 dark:text-slate-300">{item.message}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
