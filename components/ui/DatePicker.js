import { Calendar } from 'lucide-react';

/**
 * Styled date/datetime picker — forces calendar popup, no manual typing.
 *
 * Props:
 *   showTime  — if true, uses datetime-local (date + HH:MM). Default: false (date only).
 *
 * The input blocks keyboard entry so users must use the native calendar popup.
 * onChange fires exactly once when a date (or datetime) is selected.
 */
export default function DatePicker({
  label,
  value = '',
  onChange,
  required = false,
  error,
  helpText,
  className = '',
  disabled = false,
  min,
  max,
  showTime = false,
  placeholder,
}) {
  const inputType = showTime ? 'datetime-local' : 'date';

  function handleChange(e) {
    const v = e.target.value;
    onChange?.(v || null);
  }

  function handleClick(e) {
    if (!disabled) {
      e.target.showPicker?.();
    }
  }

  // Normalize value for the input type
  // datetime-local expects "YYYY-MM-DDTHH:MM"
  // date expects "YYYY-MM-DD"
  let inputValue = value || '';
  if (showTime && inputValue) {
    // If we got a full ISO string (from DB), trim to datetime-local format
    if (inputValue.length > 16) {
      inputValue = inputValue.slice(0, 16);
    }
    // If we only got a date (YYYY-MM-DD), append midnight
    if (inputValue.length === 10) {
      inputValue = `${inputValue}T00:00`;
    }
  } else if (!showTime && inputValue && inputValue.length > 10) {
    // Trim datetime to just date
    inputValue = inputValue.slice(0, 10);
  }

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-400 pointer-events-none z-10" />
        <input
          type={inputType}
          value={inputValue}
          onChange={handleChange}
          onClick={handleClick}
          onKeyDown={(e) => e.preventDefault()}
          required={required}
          disabled={disabled}
          min={min}
          max={max}
          placeholder={placeholder || (showTime ? 'Select date & time...' : 'Select date...')}
          className={`block w-full rounded-lg border pl-9 pr-3 py-2.5 text-sm bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-gray-50 dark:disabled:bg-slate-900 disabled:text-gray-500 dark:disabled:text-slate-500 cursor-pointer dark:[color-scheme:dark] ${
            error
              ? 'border-red-300 dark:border-red-700 focus:border-red-500'
              : 'border-gray-300 dark:border-slate-700 focus:border-blue-500'
          }`}
        />
      </div>
      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && helpText && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{helpText}</p>}
    </div>
  );
}
