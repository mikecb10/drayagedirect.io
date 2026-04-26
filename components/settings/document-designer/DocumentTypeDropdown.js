import { DOCUMENT_TYPES } from '../../../lib/constants/document-types';

/**
 * Native <select> for document type. Reads entries from DOCUMENT_TYPES
 * registry — adding new types (Invoice, RateCon, POD, etc., from FU-035-H1+)
 * just adds dropdown entries with no other changes here.
 *
 * Props:
 *   value:    string                   (matches a DOCUMENT_TYPES.value)
 *   onChange: (newType: string) => void
 *   disabled: boolean
 */
export default function DocumentTypeDropdown({ value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
        Document Type
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {DOCUMENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
