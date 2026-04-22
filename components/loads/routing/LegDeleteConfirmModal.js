import { AlertTriangle, X } from 'lucide-react';

function formatCents(n) {
  return '$' + ((n || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default function LegDeleteConfirmModal({ open, onClose, onDetach, onDeleteAll, runs = [] }) {
  if (!open) return null;
  const totalAr = runs.reduce((s, r) => s + (r.ar_amount_cents || 0), 0);
  const totalAp = runs.reduce((s, r) => s + (r.ap_amount_cents || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xl p-6 w-[460px] max-w-[92vw]">
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold mb-2">
          <AlertTriangle className="w-5 h-5" />
          Delete leg with dry runs?
        </div>
        <p className="text-sm text-gray-700 dark:text-slate-300 mb-4">
          This leg has <strong>{runs.length} dry run{runs.length !== 1 ? 's' : ''}</strong> ({formatCents(totalAr)} AR pending, {formatCents(totalAp)} AP pending). What should happen to them?
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={onDetach} className="w-full px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white">
            Detach — keep as load-level charges
          </button>
          <button onClick={onDeleteAll} className="w-full px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white">
            Delete leg + all {runs.length} dry run{runs.length !== 1 ? 's' : ''}
          </button>
          <button onClick={onClose} className="w-full px-4 py-2 rounded-lg text-sm text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
