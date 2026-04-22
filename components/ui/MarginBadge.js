/**
 * Shared margin pill rendered across dispatcher board, AR pipeline rows,
 * load detail header, and the load detail Billing tab summary.
 *
 * See docs/superpowers/specs/2026-04-24-load-margin-percent-design.md
 */

const BUCKET_CLASS = {
  red:     'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900',
  yellow:  'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  green:   'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  neutral: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
};

const SIZE_CLASS = {
  sm: 'text-xs px-1.5 py-0.5 rounded',
  md: 'text-sm px-2 py-1 rounded-md',
};

export default function MarginBadge({ marginPct, bucket, size = 'sm', tooltip }) {
  const label = bucket === 'neutral' || marginPct == null
    ? '—'
    : `${marginPct.toFixed(1)}%`;

  return (
    <span
      className={`inline-flex items-center border font-medium ${BUCKET_CLASS[bucket] ?? BUCKET_CLASS.neutral} ${SIZE_CLASS[size] ?? SIZE_CLASS.sm}`}
      title={tooltip}
      aria-label={tooltip ? `Margin ${label} — ${tooltip}` : `Margin ${label}`}
    >
      {label}
    </span>
  );
}
