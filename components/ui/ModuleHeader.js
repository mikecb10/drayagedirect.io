/**
 * PageHeader — standard page header with title, optional description,
 * breadcrumb, status badge, and right-side action slot.
 *
 * Uses design-system tokens from styles/globals.css:
 *   - Padding: space-page-x, space-page-y
 *   - Title: text-page-title + text-strong
 *   - Description: text-helper + text-muted
 *
 * Evolved from the older ModuleHeader — the prior API (title,
 * description, actions, className) is preserved. New optional slots:
 *   - breadcrumb: React node rendered above the title
 *   - status:     React node rendered inline next to the title
 *
 * A `ModuleHeader` named export is also provided as a backward-compat
 * alias. Existing imports keep working until Plan C migrates them.
 *
 * Usage:
 *   <PageHeader
 *     title="Load #ABCD-1234"
 *     description="DRAYFRT • 40' HC • Pickup 4/15"
 *     breadcrumb={<Breadcrumb items={[...]} />}
 *     status={<LoadStatusBadge status="pending" />}
 *     actions={<><Button>Edit</Button><Button>Print</Button></>}
 *   />
 */
export default function PageHeader({
  title,
  description,
  breadcrumb,
  status,
  actions,
  className = '',
}) {
  return (
    <header
      className={`px-[var(--space-page-x)] py-[var(--space-page-y)] border-b border-gray-200 dark:border-slate-800 ${className}`}
    >
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

// Backward-compat alias. Plan C will migrate call sites to PageHeader.
export { PageHeader as ModuleHeader };
