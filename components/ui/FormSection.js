/**
 * This file provides two exports for DrayageDirect's section card primitive:
 *
 *   • `FormSection` (DEFAULT) — backward-compatibility name. Existing
 *     `import FormSection from '...'` callers keep working unchanged.
 *
 *   • `SectionCard` (NAMED) — the new name with two additive features:
 *     - `actions` slot: React node rendered on the right of the header bar
 *     - `columns={0}`: render children unwrapped (no internal grid),
 *       so a FieldGroup (or any child) can own layout
 *
 * Both names point at the same implementation. New `actions` slot and
 * `columns={0}` are purely additive — existing callers passing only
 * `title`, `description`, `children`, `className`, `columns` (1-4) get
 * identical rendering to the pre-evolution FormSection.
 *
 * Plan C migrates call sites to `SectionCard` and adopts the new slots.
 *
 * Design-system tokens consumed (from styles/globals.css):
 *   - Header bar padding: --space-section-head-x, --space-section-head-y
 *   - Body padding: --space-section-pad
 *   - Grid gap: --space-field
 *   - Inline gap (header actions): --space-inline
 *   - Title: text-section-title + text-strong
 *   - Description: text-helper + text-muted
 *
 * Per spec §3.2, there is intentionally no `collapsible` prop.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className = '',
  columns = 2,
}) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[columns];

  return (
    <section
      className={`rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 ${className}`}
    >
      {(title || description || actions) && (
        <div
          className="flex items-start justify-between gap-[var(--space-inline)] px-[var(--space-section-head-x)] py-[var(--space-section-head-y)] bg-gray-50/70 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-800 rounded-t-xl"
        >
          <div className="min-w-0">
            {title && (
              <h3 className="text-section-title text-strong">{title}</h3>
            )}
            {description && (
              <p className="text-helper text-muted mt-0.5">{description}</p>
            )}
          </div>
          {actions && (
            <div className="shrink-0 flex gap-[var(--space-inline)]">{actions}</div>
          )}
        </div>
      )}
      {gridCols ? (
        <div className={`grid ${gridCols} gap-[var(--space-field)] p-[var(--space-section-pad)]`}>
          {children}
        </div>
      ) : (
        <div className="p-[var(--space-section-pad)]">{children}</div>
      )}
    </section>
  );
}

// Backward-compat default export. Existing `import FormSection from '...'`
// call sites keep rendering identically.
export default SectionCard;
