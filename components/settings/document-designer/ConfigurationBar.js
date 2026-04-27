import CustomerDropdown from './CustomerDropdown';
import DocumentTypeDropdown from './DocumentTypeDropdown';

/**
 * Top-of-page bar that hosts Customer + Document Type dropdowns and the
 * accent + text color pickers. Renders a wrap-able horizontal flex row.
 *
 * Below the row, when `showNoOverrideNote` is true, an amber inline note
 * tells the user that selecting an override-less customer + saving will
 * implicitly create a new override row.
 *
 * Props:
 *   selectedDocType:                string
 *   selectedCustomerId:             string | null
 *   customers:                      { id, name }[]
 *   existingOverrideCustomerIds:    Set<string>
 *   colors:                         { accent: string, text: string }
 *   onDocTypeChange:                (newType) => void
 *   onCustomerChange:               (newCustomerId | null) => void
 *   onColorsChange:                 ({ accent, text }) => void
 *   showNoOverrideNote:             boolean
 *   disabled:                       boolean
 */
export default function ConfigurationBar({
  selectedDocType,
  selectedCustomerId,
  customers,
  existingOverrideCustomerIds,
  colors,
  onDocTypeChange,
  onCustomerChange,
  onColorsChange,
  showNoOverrideNote,
  disabled,
}) {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[180px]">
          <CustomerDropdown
            value={selectedCustomerId}
            customers={customers}
            existingOverrideCustomerIds={existingOverrideCustomerIds}
            onChange={onCustomerChange}
            disabled={disabled}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <DocumentTypeDropdown
            value={selectedDocType}
            onChange={onDocTypeChange}
            disabled={disabled}
          />
        </div>
        <ColorPickerField
          label="Accent"
          value={colors.accent}
          onChange={(accent) => onColorsChange({ ...colors, accent })}
          disabled={disabled}
        />
        <ColorPickerField
          label="Text"
          value={colors.text}
          onChange={(text) => onColorsChange({ ...colors, text })}
          disabled={disabled}
        />
      </div>
      {showNoOverrideNote ? (
        <div className="px-3 py-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200 text-xs">
          This customer doesn't have an override yet. Saving creates one.
        </div>
      ) : null}
    </div>
  );
}

function ColorPickerField({ label, value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
        {label}
      </span>
      <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="text-xs font-mono text-gray-600 dark:text-slate-400 uppercase">
          {value}
        </span>
      </div>
    </label>
  );
}
