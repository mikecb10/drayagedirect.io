import { Clock } from 'lucide-react';

/**
 * Reusable empty-state tab for features that aren't built yet.
 *
 * <EmptyTab title="Orders" phase="Phase 5b" description="..." />
 */
export default function EmptyTab({ title, phase, description }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 mx-auto mb-4 flex items-center justify-center">
        <Clock className="w-7 h-7" strokeWidth={1.75} />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Coming in {phase}</p>
      {description && (
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-3 max-w-md mx-auto">{description}</p>
      )}
    </div>
  );
}
