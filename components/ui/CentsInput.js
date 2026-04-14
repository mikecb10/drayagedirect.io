import { useState } from 'react';

/**
 * CentsInput — dollar input that stores as cents internally.
 *
 * Shows dollars while typing (no live conversion), converts to cents
 * on blur. Prevents the "type 250, see 2.00" bug caused by converting
 * on every keystroke.
 *
 * Props:
 *   value       — amount in CENTS (integer)
 *   onChange     — called with new cents value on blur
 *   label       — optional field label
 *   isPercent   — if true, shows % instead of $ (still stores as cents where 100 = 1%)
 *   placeholder — input placeholder
 *   className   — wrapper class
 *   disabled    — disable input
 *   step        — step increment (default 0.01)
 */
export default function CentsInput({
  value,
  onChange,
  label,
  isPercent = false,
  placeholder,
  className = '',
  disabled = false,
  step = '0.01',
  inputClassName = '',
}) {
  const [editing, setEditing] = useState(false);
  const [displayVal, setDisplayVal] = useState('');

  const dollarValue = value != null ? (value / 100).toFixed(2) : '0.00';

  function handleFocus() {
    setEditing(true);
    setDisplayVal(value != null ? String(value / 100) : '');
  }

  function handleBlur() {
    setEditing(false);
    const cents = Math.round(parseFloat(displayVal || 0) * 100);
    onChange?.(cents);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  }

  return (
    <div className={className}>
      {label && (
        <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-400 mb-1">
          {label} {isPercent ? '(%)' : '($)'}
        </label>
      )}
      <input
        type="number"
        step={step}
        value={editing ? displayVal : dollarValue}
        onChange={(e) => setDisplayVal(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClassName || 'block w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-gray-50 dark:disabled:bg-slate-900'}
      />
    </div>
  );
}
