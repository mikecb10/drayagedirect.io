/**
 * Native <select> dropdown listing "All Customers" + every customer org.
 * Customers with an existing override row are prefixed with a Unicode bullet
 * (●) for visual distinction; customers without one have leading spaces for
 * alignment.
 *
 * Future upgrade: replace with a search-enabled OrgPicker if customer lists
 * grow large (>50 entries). Filed as out-of-scope follow-up.
 *
 * Props:
 *   value:                          string | null   (null = All Customers)
 *   customers:                      { id, name }[]
 *   existingOverrideCustomerIds:    Set<string>
 *   onChange:                       (newId: string | null) => void
 *   disabled:                       boolean
 */
export default function CustomerDropdown({
  value,
  customers,
  existingOverrideCustomerIds,
  onChange,
  disabled,
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
        Customer
      </span>
      <select
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">All Customers</option>
        {customers.map((c) => {
          const hasOverride = existingOverrideCustomerIds.has(c.id);
          return (
            <option key={c.id} value={c.id}>
              {hasOverride ? '● ' : '   '}
              {c.name}
            </option>
          );
        })}
      </select>
    </label>
  );
}
