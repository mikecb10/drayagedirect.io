import { useRef, useState, useEffect } from 'react';
import { X, ChevronDown } from 'lucide-react';

/**
 * Multi-select with chips.
 *
 * Usage:
 *   <MultiSelect
 *     label="Customer Types"
 *     value={['customer', 'terminal']}
 *     onChange={setTypes}
 *     options={[
 *       { value: 'customer', label: 'Customer' },
 *       { value: 'terminal', label: 'Terminal' },
 *     ]}
 *   />
 */
export default function MultiSelect({
  label,
  value = [],
  onChange,
  options = [],
  placeholder = 'Select...',
  required = false,
  helpText,
  error,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function toggle(optValue) {
    const has = value.includes(optValue);
    onChange?.(has ? value.filter((v) => v !== optValue) : [...value, optValue]);
  }

  function removeChip(optValue, e) {
    e.stopPropagation();
    onChange?.(value.filter((v) => v !== optValue));
  }

  const selectedOptions = options.filter((o) => value.includes(o.value));

  return (
    <div ref={wrapperRef} className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`w-full min-h-[42px] rounded-lg border px-3 py-1.5 text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors ${
            error
              ? 'border-red-300 focus:border-red-500'
              : 'border-gray-300 focus:border-blue-500'
          }`}
        >
          <div className="flex flex-wrap gap-1.5 pr-6 items-center">
            {selectedOptions.length === 0 && (
              <span className="text-gray-400 py-1">{placeholder}</span>
            )}
            {selectedOptions.map((opt) => (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1 rounded-md bg-blue-50 text-blue-700 text-xs font-medium px-2 py-1"
              >
                {opt.label}
                <span
                  onClick={(e) => removeChip(opt.value, e)}
                  className="hover:bg-blue-100 rounded cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </span>
              </span>
            ))}
          </div>
          <ChevronDown
            className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {options.length === 0 ? (
              <div className="p-3 text-sm text-gray-500 text-center">No options</div>
            ) : (
              options.map((opt) => {
                const checked = value.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 ${
                      checked ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="rounded text-blue-600 border-gray-300"
                    />
                    <span className="flex-1">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {!error && helpText && <p className="mt-1 text-xs text-gray-500">{helpText}</p>}
    </div>
  );
}
