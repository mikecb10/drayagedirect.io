import useMarginPalette from '../../hooks/useMarginPalette';

/**
 * Shared margin pill rendered across dispatcher board, AR pipeline rows,
 * load detail header, and the load detail Billing tab summary.
 *
 * See docs/superpowers/specs/2026-04-24-load-margin-percent-design.md
 *
 * Palette is per-tenant (FU-036) — the colorblind variant uses
 * orange / yellow / blue (Wong-2011-style) so red-green colorblind users
 * (~5% of men) can distinguish the buckets reliably.
 */

const PALETTES = {
  default: {
    red:     'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900',
    yellow:  'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
    green:   'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
    neutral: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  },
  colorblind: {
    // Orange = bad, yellow = warning, blue = good. Distinguishable for
    // protan/deutan users where red-green confusion is the main issue.
    red:     'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900',
    yellow:  'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
    green:   'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900',
    neutral: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  },
};

const SIZE_CLASS = {
  sm: 'text-xs px-1.5 py-0.5 rounded',
  md: 'text-sm px-2 py-1 rounded-md',
};

export default function MarginBadge({ marginPct, bucket, size = 'sm', tooltip, palette: paletteOverride }) {
  // Hook returns 'default' until tenant settings load; explicit
  // paletteOverride lets the settings page preview both variants.
  const tenantPalette = useMarginPalette();
  const palette = paletteOverride || tenantPalette || 'default';
  const classMap = PALETTES[palette] || PALETTES.default;

  const label = bucket === 'neutral' || marginPct == null
    ? '—'
    : `${marginPct.toFixed(1)}%`;

  return (
    <span
      className={`inline-flex items-center border font-medium ${classMap[bucket] ?? classMap.neutral} ${SIZE_CLASS[size] ?? SIZE_CLASS.sm}`}
      title={tooltip}
      aria-label={tooltip ? `Margin ${label} — ${tooltip}` : `Margin ${label}`}
    >
      {label}
    </span>
  );
}
