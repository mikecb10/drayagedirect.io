/**
 * Styled checkbox with optional label and description.
 *
 * Usage:
 *   <Checkbox
 *     checked={enabled}
 *     onChange={setEnabled}
 *     label="Hazmat endorsement"
 *     description="Driver is certified to haul hazardous materials"
 *   />
 */
export default function Checkbox({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  className = '',
}) {
  return (
    <label
      className={`flex items-start gap-3 cursor-pointer ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 w-4 h-4 rounded text-blue-600 border-gray-300 dark:border-slate-600 dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
      />
      {(label || description) && (
        <div className="flex-1 min-w-0">
          {label && (
            <div className="text-sm font-medium text-gray-900 dark:text-slate-100 leading-tight">
              {label}
            </div>
          )}
          {description && (
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 leading-snug">
              {description}
            </div>
          )}
        </div>
      )}
    </label>
  );
}
