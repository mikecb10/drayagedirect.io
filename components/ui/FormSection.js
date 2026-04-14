/**
 * Form section wrapper — renders as a visually distinct card with a header
 * bar and padded content area. Makes long forms scannable by breaking them
 * into labeled blocks.
 *
 * Usage:
 *   <FormSection title="Company" description="Physical address and contact info">
 *     <Input ... />
 *     <Input ... />
 *   </FormSection>
 */
export default function FormSection({
  title,
  description,
  children,
  className = '',
  columns = 2,
}) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[columns] || 'grid-cols-1 sm:grid-cols-2';

  return (
    <section className={`rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 ${className}`}>
      {(title || description) && (
        <div className="px-5 py-3 bg-gray-50/70 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-800 rounded-t-xl">
          {title && (
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
          )}
          {description && (
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{description}</p>
          )}
        </div>
      )}
      <div className={`grid ${gridCols} gap-4 p-5`}>{children}</div>
    </section>
  );
}
