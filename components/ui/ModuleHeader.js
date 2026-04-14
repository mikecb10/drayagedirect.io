/**
 * Standard page header: title, description, and right-side action slot.
 *
 * Usage:
 *   <ModuleHeader
 *     title="Organizations"
 *     description="Customers, terminals, warehouses, and yards"
 *     actions={<Button>+ Add New Organization</Button>}
 *   />
 */
export default function ModuleHeader({ title, description, actions, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{title}</h1>
        {description && (
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0 flex gap-2">{actions}</div>}
    </div>
  );
}
