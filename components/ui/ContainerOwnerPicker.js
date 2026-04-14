import { useEffect, useRef, useState } from 'react';
import { Ship, Search, X, Loader2 } from 'lucide-react';

/**
 * Async-search combobox for picking a Container Owner (Steamship Line).
 * Fetches /api/tenant/container-owners?search=...&enabled=true
 *
 * Props:
 *   label          - field label
 *   value          - selected container_owner_id
 *   valueLabel     - current display label (for edit mode)
 *   onChange(owner) - called with full owner object or null when cleared
 *                    onChange receives { id, name, scac_code, ... }
 */
export default function ContainerOwnerPicker({
  label,
  value,
  valueLabel,
  onChange,
  required = false,
  placeholder = 'Search steamship lines...',
  helpText,
  disabled = false,
  className = '',
}) {
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(valueLabel || '');

  useEffect(() => {
    setSelectedLabel(valueLabel || '');
  }, [valueLabel]);

  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ enabled: 'true' });
        if (query) params.set('search', query);
        const res = await fetch(`/api/tenant/container-owners?${params}`);
        if (!res.ok) throw new Error('Fetch failed');
        const data = await res.json();
        if (!cancelled) setResults(data.container_owners || []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  function handleSelect(owner) {
    setSelectedLabel(owner.label || owner.name);
    setOpen(false);
    setQuery('');
    onChange?.(owner);
  }

  function handleClear(e) {
    e.stopPropagation();
    setSelectedLabel('');
    setQuery('');
    onChange?.(null);
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <Ship className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
        {value && selectedLabel && !open ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setOpen(true)}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 pl-9 pr-9 py-2.5 text-sm text-left text-gray-900 dark:text-slate-100 bg-white dark:bg-slate-950 hover:border-gray-400 dark:hover:border-slate-600 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-gray-50 dark:disabled:bg-slate-900"
          >
            {selectedLabel}
            <span
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </span>
          </button>
        ) : (
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 pl-9 pr-9 py-2.5 text-sm text-gray-900 dark:text-slate-100 bg-white dark:bg-slate-950 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-gray-50 dark:disabled:bg-slate-900"
          />
        )}
        {loading && open && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
        )}
      </div>

      {open && !loading && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500 dark:text-slate-400 text-center">
              <Search className="w-4 h-4 inline mr-1" />
              No steamship lines found
            </div>
          ) : (
            results.map((owner) => (
              <button
                key={owner.id}
                type="button"
                onClick={() => handleSelect(owner)}
                className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-blue-50/60 dark:hover:bg-blue-950/30 border-b border-gray-100 dark:border-slate-800 last:border-b-0"
              >
                <Ship className="w-4 h-4 text-gray-400 dark:text-slate-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                      {owner.label || owner.name}
                    </span>
                    {owner.scac_code && (
                      <span className="text-[10px] uppercase tracking-wide font-mono font-semibold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                        {owner.scac_code}
                      </span>
                    )}
                    {owner.is_system && (
                      <span className="text-[9px] uppercase tracking-wide text-gray-400 dark:text-slate-500">
                        system
                      </span>
                    )}
                  </div>
                  {owner.label && owner.name !== owner.label && (
                    <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{owner.name}</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {helpText && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{helpText}</p>}
    </div>
  );
}
