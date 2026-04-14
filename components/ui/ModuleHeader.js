/**
 * This file provides two exports for DrayageDirect's page header primitive:
 *
 *   • `ModuleHeader` (DEFAULT) — backward-compatibility wrapper that forces
 *     `variant="plain"`. Existing consumers using default imports get
 *     their pre-evolution look (no padding, no bottom border).
 *
 *   • `PageHeader` (NAMED) — the new primitive with a `variant` prop.
 *     Defaults to `variant="chrome"` (padding + bottom border). Use this
 *     in new code and choose the variant explicitly.
 *
 * Plan C migrates the existing ModuleHeader call sites to PageHeader
 * and selects a variant per page.
 *
 * Design-system tokens consumed (from styles/globals.css):
 *   - Padding (chrome variant): space-page-x, space-page-y
 *   - Title: text-page-title + text-strong
 *   - Description: text-helper + text-muted
 *   - Gaps: space-inline, space-field-label
 *
 * Title truncation: when `status` is present alongside a long `title`,
 * the title truncates to preserve the status badge (status is `shrink-0`).
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  status,
  actions,
  variant = 'chrome',
  className = '',
}) {
  const chromeClasses =
    variant === 'chrome'
      ? 'px-[var(--space-page-x)] py-[var(--space-page-y)] border-b border-gray-200 dark:border-slate-800'
      : '';

  return (
    <header className={`${chromeClasses} ${className}`.trim()}>
      {breadcrumb && (
        <div className="mb-[var(--space-field-label)]">{breadcrumb}</div>
      )}
      <div className="flex items-start justify-between gap-[var(--space-inline)]">
        <div className="min-w-0">
          <div className="flex items-center gap-[var(--space-inline)]">
            <h1 className="text-page-title text-strong truncate">{title}</h1>
            {status && <div className="shrink-0">{status}</div>}
          </div>
          {description && (
            <p className="text-helper text-muted mt-[var(--space-field-label)]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="shrink-0 flex gap-[var(--space-inline)]">{actions}</div>
        )}
      </div>
    </header>
  );
}

/**
 * Backward-compat default export. Forces `variant="plain"` so the
 * seven existing consumer pages keep their pre-evolution look.
 */
export default function ModuleHeader(props) {
  return <PageHeader {...props} variant="plain" />;
}
