import { useEffect, useState } from 'react';

/**
 * Currency input that lets users type whole dollars or up to 2 decimal places
 * without losing trailing zeros or decimal points while typing.
 *
 * Stores the value in CENTS via the onChange callback (so DB columns stay integer).
 *
 * Usage:
 *   <CurrencyInput
 *     label="Credit Limit"
 *     valueCents={form.credit_limit_cents}
 *     onChangeCents={(cents) => update('credit_limit_cents', cents)}
 *   />
 */
export default function CurrencyInput({
  label,
  valueCents,
  onChangeCents,
  required = false,
  error,
  helpText,
  placeholder = '0.00',
  className = '',
  disabled = false,
  currencySymbol = '$',
}) {
  // Track the raw string the user is typing so trailing "."/"00" don't disappear.
  const [displayValue, setDisplayValue] = useState('');

  // Sync displayValue from valueCents when it changes externally (e.g. when editing a record).
  useEffect(() => {
    if (valueCents == null) {
      // Only clear if user hasn't typed a partial value like "." or "100."
      if (displayValue === '' || /^\d+$/.test(displayValue) || /^\d+\.$/.test(displayValue)) {
        // leave it alone if user is mid-type
      } else {
        setDisplayValue('');
      }
      return;
    }
    // Check if the current display value already represents this cents amount.
    const parsed = parseFloat(displayValue);
    if (!isNaN(parsed) && Math.round(parsed * 100) === valueCents) {
      return; // already in sync
    }
    // Format: strip trailing ".00" for cleanliness (e.g. 10000 -> "100", 10050 -> "100.50")
    const formatted = (valueCents / 100).toFixed(2).replace(/\.00$/, '');
    setDisplayValue(formatted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCents]);

  function handleChange(e) {
    const raw = e.target.value;
    // Allow empty, digits, optional single decimal, up to 2 decimal places.
    if (raw === '' || /^\d*\.?\d{0,2}$/.test(raw)) {
      setDisplayValue(raw);
      if (raw === '' || raw === '.') {
        onChangeCents?.(null);
      } else {
        const dollars = parseFloat(raw);
        if (!isNaN(dollars)) {
          onChangeCents?.(Math.round(dollars * 100));
        }
      }
    }
  }

  function handleBlur() {
    // On blur, normalize the display (e.g. "100." -> "100", "" stays "")
    if (displayValue === '' || displayValue === '.') {
      setDisplayValue('');
      onChangeCents?.(null);
      return;
    }
    const dollars = parseFloat(displayValue);
    if (!isNaN(dollars)) {
      const cents = Math.round(dollars * 100);
      const normalized = (cents / 100).toFixed(2).replace(/\.00$/, '');
      setDisplayValue(normalized);
      onChangeCents?.(cents);
    }
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
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400 text-sm pointer-events-none">
          {currencySymbol}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={`block w-full rounded-lg border pl-7 pr-3 py-2.5 text-sm bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors disabled:bg-gray-50 dark:disabled:bg-slate-900 disabled:text-gray-500 dark:disabled:text-slate-500 ${
            error
              ? 'border-red-300 dark:border-red-700 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 dark:border-slate-700 focus:border-blue-500 focus:ring-blue-500'
          }`}
        />
      </div>
      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && helpText && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{helpText}</p>}
    </div>
  );
}
