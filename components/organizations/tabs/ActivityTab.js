import { Clock } from 'lucide-react';

/**
 * Activity tab — shows tenant_audit_log entries for this organization.
 * Phase 5a: simple placeholder that reads audit log entries.
 * Phase 5b+: will fetch real audit data via new API endpoint.
 */
export default function ActivityTab({ organization }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 mx-auto mb-4 flex items-center justify-center">
        <Clock className="w-7 h-7" strokeWidth={1.75} />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Activity Log</h3>
      <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
        Audit trail of changes to this organization
      </p>
      <p className="text-sm text-gray-600 dark:text-slate-400 mt-3 max-w-md mx-auto">
        Every edit, contact added, group created, and order placed for{' '}
        <strong className="text-gray-900 dark:text-slate-200">{organization.name}</strong> will appear here. Full audit log view coming
        in a future update — the data is already being captured.
      </p>
    </div>
  );
}
