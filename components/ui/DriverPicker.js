import { useEffect, useRef, useState, useMemo } from 'react';
import { Search, X, User, Lock } from 'lucide-react';

// Module-level cache so drivers are only fetched once per session
let _driversCache = null;

/**
 * DriverPicker — searchable dropdown that opens directly to the driver list.
 *
 * No "Unassigned" placeholder cluttering the list. If no driver is selected
 * the field is empty. Clicking opens the list immediately with a search bar.
 * Drivers show their status (Available, On Hold, Off Duty, etc).
 *
 * When `locked` is true (e.g. the driver has already started a move):
 *   - The clear (X) button is replaced with a Lock icon
 *   - The user can still open the dropdown and select a DIFFERENT driver
 *   - But they cannot clear the field to null
 *   - Hovering the lock shows `lockTooltip`
 */
export default function DriverPicker({
  label,
  value,
  onChange,
  required = false,
  className = '',
  autoOpen = false,
  locked = false,
  lockTooltip = 'Driver is locked — cannot be removed.',
}) {
  const wrapperRef = useRef(null);
  // Only auto-open when the caller explicitly opts in (e.g. dispatcher
  // inline popover via EditableCell). The previous `!value` fallback
  // meant every unassigned picker auto-opened on mount and stole focus
  // — on the Routing tab this caused all container-move pickers to
  // race for focus, parking document.activeElement on a text input and
  // silently blocking the Ctrl+Arrow tab-switch hotkey.
  const [open, setOpen] = useState(autoOpen);
  const [query, setQuery] = useState('');
  const [drivers, setDrivers] = useState(_driversCache || []);
  const [loading, setLoading] = useState(!_driversCache);

  // Fetch drivers once, cache globally
  useEffect(() => {
    if (_driversCache) {
      setDrivers(_driversCache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch('/api/tenant/drivers')
      .then((r) => (r.ok ? r.json() : { drivers: [] }))
      .then((data) => {
        const list = data.drivers || [];
        _driversCache = list;
        if (!cancelled) {
          setDrivers(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const driverName = (d) =>
    [d.first_name, d.last_name].filter(Boolean).join(' ') || d.name || 'Unnamed';

  const selectedDriver = drivers.find((d) => d.id === value);
  const selectedName = selectedDriver ? driverName(selectedDriver) : '';

  // Filter drivers by search query
  const filtered = useMemo(() => {
    if (!query) return drivers;
    const q = query.toLowerCase();
    return drivers.filter((d) => {
      const name = driverName(d).toLowerCase();
      const phone = (d.phone || '').toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [drivers, query]);

  function handleSelect(driverId) {
    onChange?.(driverId);
    setOpen(false);
    setQuery('');
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange?.(null);
    setOpen(false);
    setQuery('');
  }

  const statusColors = {
    active: 'text-green-600 dark:text-green-400',
    inactive: 'text-gray-400 dark:text-slate-500',
    on_leave: 'text-amber-600 dark:text-amber-400',
  };

  const statusLabels = {
    active: 'Available',
    inactive: 'Off Duty',
    on_leave: 'On Hold',
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}

      {/* Display field — hidden when autoOpen (board uses inline popover) */}
      {!autoOpen && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-left hover:border-gray-400 dark:hover:border-slate-600 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 min-h-[38px]"
        >
          {selectedName ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                {selectedName[0]?.toUpperCase()}
              </div>
              <span className="text-gray-900 dark:text-slate-100 truncate">{selectedName}</span>
              {locked ? (
                <span
                  className="ml-auto text-amber-500 dark:text-amber-400 shrink-0 cursor-help"
                  title={lockTooltip}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Lock className="w-3.5 h-3.5" />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleClear}
                  className="ml-auto text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-400 dark:text-slate-500 flex-1">
              <User className="w-4 h-4" />
              <span className="text-xs">Select driver...</span>
            </div>
          )}
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div className={`${autoOpen ? '' : 'absolute z-50 mt-1'} w-full bg-white dark:bg-slate-900 ${autoOpen ? '' : 'border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg'} max-h-72 overflow-hidden`}>
          {/* Search */}
          <div className="p-2 border-b border-gray-100 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search drivers..."
                autoFocus
                className="block w-full rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-400 focus:bg-white dark:focus:bg-slate-900"
              />
            </div>
          </div>

          {/* Driver list */}
          <div className="overflow-y-auto max-h-56">
            {loading ? (
              <div className="px-3 py-4 text-xs text-gray-400 dark:text-slate-500 text-center">Loading drivers...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-400 dark:text-slate-500 text-center">
                {query ? 'No drivers match' : 'No drivers found'}
              </div>
            ) : (
              filtered.map((d) => {
                const name = driverName(d);
                const isSelected = d.id === value;
                const statusColor = statusColors[d.status] || 'text-gray-400 dark:text-slate-500';
                const statusLabel = statusLabels[d.status] || d.status;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handleSelect(d.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors ${
                      isSelected ? 'bg-blue-50 dark:bg-blue-950/40' : ''
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900 dark:text-slate-100 truncate">{name}</div>
                      {d.phone && (
                        <div className="text-[10px] text-gray-400 dark:text-slate-500">{d.phone}</div>
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold ${statusColor} shrink-0`}>
                      {statusLabel}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
