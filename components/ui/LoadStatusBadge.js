const STATUS_CONFIG = {
  pending: { label: 'Pending', classes: 'bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-300 ring-gray-500/20 dark:ring-slate-600/40' },
  available: { label: 'Available', classes: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-600/20 dark:ring-sky-500/30' },
  dispatched: { label: 'Dispatched', classes: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-600/20 dark:ring-blue-500/30' },
  in_transit: { label: 'In Transit', classes: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-amber-600/20 dark:ring-amber-500/30' },
  dropped: { label: 'Dropped', classes: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-600/20 dark:ring-violet-500/30' },
  delivered: { label: 'Delivered', classes: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 ring-green-600/20 dark:ring-green-500/30' },
  completed: { label: 'Completed', classes: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-600/20 dark:ring-emerald-500/30' },
  cancelled: { label: 'Cancelled', classes: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 ring-red-600/20 dark:ring-red-500/30' },
};

export default function LoadStatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  );
}
