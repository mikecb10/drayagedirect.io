import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Box } from 'lucide-react';

// Module-level cache — persists across component instances and re-renders.
// Each endpoint gets its own cached array so container_sizes, container_types,
// chassis_types, chassis_sizes all share a single fetch per session.
const _cache = {};

/**
 * Bust the cache for a specific endpoint (or all endpoints).
 * Call this after reordering in settings so pickers fetch fresh data.
 */
export function bustCache(endpoint) {
  if (endpoint) {
    delete _cache[endpoint];
  } else {
    for (const key of Object.keys(_cache)) delete _cache[key];
  }
}

/**
 * Generic combobox for reference data tables.
 *
 * Pre-fetches data on mount and caches at the module level so every subsequent
 * open is instant. Filtering happens client-side — no debounced API calls,
 * no loading spinners. Feels snappy.
 */
export default function ReferenceDataPicker({
  label,
  endpoint,
  value,
  valueLabel,
  onChange,
  icon: Icon = Box,
  placeholder = 'Select...',
  required = false,
  helpText,
  disabled = false,
  className = '',
}) {
  const wrapperRef = useRef(null);
  const inputWrapRef = useRef(null);
  const dropdownRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [allItems, setAllItems] = useState(_cache[endpoint] || []);
  const [selectedLabel, setSelectedLabel] = useState(valueLabel || '');
  const [dropdownCoords, setDropdownCoords] = useState(null);

  useEffect(() => {
    setSelectedLabel(valueLabel || '');
  }, [valueLabel]);

  // Reposition the portalled dropdown relative to the input, with flip-up
  // if there's not enough room below the viewport. Runs when `open` changes
  // and on scroll/resize to stay anchored.
  const reposition = useCallback(() => {
    if (!open || !inputWrapRef.current) return;
    const rect = inputWrapRef.current.getBoundingClientRect();
    const dropHeight = dropdownRef.current?.offsetHeight || 288; // 72 * 4 ≈ max-h-72
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;

    let top = rect.bottom + 4;
    const spaceBelow = viewH - rect.bottom - 8;
    const spaceAbove = rect.top - 8;

    // Flip up if no room below AND there's more room above
    if (dropHeight > spaceBelow && spaceAbove > spaceBelow) {
      top = rect.top - dropHeight - 4;
      if (top < 8) top = 8;
    } else if (top + dropHeight > viewH - 8) {
      top = Math.max(8, viewH - dropHeight - 8);
    }

    let left = rect.left;
    const width = rect.width;
    if (left + width > viewW - 8) left = viewW - width - 8;
    if (left < 8) left = 8;

    setDropdownCoords({ top, left, width });
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDropdownCoords(null);
      return;
    }
    reposition();
    const raf = requestAnimationFrame(reposition);
    function onScrollOrResize() { reposition(); }
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, reposition]);

  // Pre-fetch on mount — cached so it only hits the network once per endpoint
  useEffect(() => {
    if (_cache[endpoint]) {
      setAllItems(_cache[endpoint]);
      return;
    }
    let cancelled = false;
    fetch(`${endpoint}?enabled=true`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        const items = data.items || [];
        _cache[endpoint] = items;
        if (!cancelled) setAllItems(items);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [endpoint]);

  // Close on outside click — check both the wrapper AND the portalled dropdown
  useEffect(() => {
    function handler(e) {
      const insideWrapper = wrapperRef.current && wrapperRef.current.contains(e.target);
      const insideDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!insideWrapper && !insideDropdown) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Client-side filter — instant, no API call
  const filtered = useMemo(() => {
    if (!query) return allItems;
    const q = query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.code?.toLowerCase().includes(q) ||
        item.label?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q)
    );
  }, [allItems, query]);

  function handleSelect(item) {
    setSelectedLabel(item.label);
    setOpen(false);
    setQuery('');
    onChange?.(item);
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
      <div ref={inputWrapRef} className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
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
      </div>

      {/* Dropdown — portalled to document.body so it escapes parent overflow
          (e.g. the dispatcher board's CellPopover or scroll container).
          data-popover-safe-zone opts this element into CellPopover's "inside"
          check so clicks here don't prematurely close the wrapping popover. */}
      {open && dropdownCoords && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            data-popover-safe-zone="true"
            style={{
              position: 'fixed',
              top: dropdownCoords.top,
              left: dropdownCoords.left,
              width: dropdownCoords.width,
              zIndex: 1100,
            }}
            className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-72 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-500 dark:text-slate-400 text-center">
                <Search className="w-4 h-4 inline mr-1" />
                No results found
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-blue-50/60 dark:hover:bg-blue-950/30 border-b border-gray-100 dark:border-slate-800 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide font-mono font-semibold bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 px-1.5 py-0.5 rounded shrink-0">
                        {item.code}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                        {item.label}
                      </span>
                      {item.is_system && (
                        <span className="text-[9px] uppercase tracking-wide text-gray-400 dark:text-slate-500">
                          system
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 truncate">
                        {item.description}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>,
          document.body
        )}

      {helpText && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{helpText}</p>}
    </div>
  );
}
