import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Plus } from 'lucide-react';

function formatCents(n) {
  if (!Number.isFinite(n)) return '$0.00';
  return '$' + (n / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default function DryRunList({ runs = [], onAdd, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const totalAr = runs.reduce((s, r) => s + (r.ar_amount_cents || 0), 0);
  const totalAp = runs.reduce((s, r) => s + (r.ap_amount_cents || 0), 0);

  return (
    <div className="mt-2">
      {runs.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-dashed border-amber-400/60 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-950/20 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/40"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {runs.length} dry run{runs.length !== 1 ? 's' : ''} · {formatCents(totalAr)} AR · {formatCents(totalAp)} AP
            </span>
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {expanded && (
            <ul className="mt-1 space-y-1 pl-2 border-l-2 border-amber-200 dark:border-amber-900/60">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onEdit?.(r)}
                    className="w-full text-left px-3 py-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30 text-[11px] text-gray-700 dark:text-slate-300 flex items-center justify-between"
                  >
                    <span className="truncate">
                      {r.driver?.name || 'Driver'} · {new Date(r.occurred_at).toLocaleDateString()} · {r.miles ? `${r.miles} mi` : 'fixed'}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-slate-400 whitespace-nowrap ml-2">
                      {formatCents(r.ar_amount_cents)} / {formatCents(r.ap_amount_cents)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-amber-400/60 dark:border-amber-600/40 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Dry Run
      </button>
    </div>
  );
}
