import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Search, X, Loader2, Ship, Train, MapPin, Plus } from 'lucide-react';
import dynamic from 'next/dynamic';

const OrganizationModal = dynamic(() => import('../organizations/OrganizationModal'), {
  ssr: false,
});

/**
 * Async-search combobox for picking an Organization or System Terminal.
 *
 * When `includeTerminals` is true (default when type='terminal'), the picker
 * also searches system terminals from the tenant's enabled markets alongside
 * the normal organizations query. Results are shown in two groups:
 *   1. System Terminals (marine ports + rail ramps)
 *   2. Your Organizations
 *
 * The onChange callback always returns a consistent shape:
 *   { id, name, address_line1, city, state, zip, _source: 'org'|'terminal' }
 *
 * Props:
 *   label          - field label
 *   type           - 'customer' | 'terminal' | 'warehouse' | 'yard' (filters the org list)
 *   value          - selected org id
 *   valueLabel     - display name for the currently selected org
 *   onChange(org)  - called with full org object when user picks, or null when cleared
 *   required       - show asterisk
 *   placeholder    - input placeholder
 *   helpText       - below-input help text
 *   includeTerminals - also search system_terminals (default: true when type='terminal')
 *   excludeIds     - array of org/terminal ids to hide from results (for multi-select callers)
 */
export default function OrgPicker({
  label,
  type,
  value,
  valueLabel,
  onChange,
  required = false,
  placeholder,
  helpText,
  disabled = false,
  className = '',
  includeTerminals,
  excludeIds,
}) {
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [orgResults, setOrgResults] = useState([]);
  const [terminalResults, setTerminalResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(valueLabel || '');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // O(1) lookup set for already-selected ids (used by multi-select callers)
  const excludeSet = useMemo(() => new Set(excludeIds || []), [excludeIds]);

  // Default: include terminals when type is 'terminal'
  const showTerminals = includeTerminals !== undefined ? includeTerminals : type === 'terminal';
  const placeholderText = placeholder || (showTerminals ? 'Search terminals & organizations...' : 'Search organizations...');

  useEffect(() => {
    setSelectedLabel(valueLabel || '');
  }, [valueLabel]);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Debounced search — fetches orgs + optionally terminals in parallel
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const fetches = [];

        // Org fetch
        const orgParams = new URLSearchParams();
        if (type) orgParams.set('type', type);
        if (query) orgParams.set('search', query);
        fetches.push(
          fetch(`/api/tenant/organizations?${orgParams}`)
            .then((r) => (r.ok ? r.json() : { organizations: [] }))
            .then((d) => d.organizations || [])
        );

        // Terminal fetch (only if enabled and there's a query or it's the initial open)
        if (showTerminals) {
          const tParams = new URLSearchParams();
          if (query) tParams.set('search', query);
          fetches.push(
            fetch(`/api/tenant/terminals?${tParams}`)
              .then((r) => (r.ok ? r.json() : { terminals: [] }))
              .then((d) => (d.terminals || []).filter((t) => t.effective_enabled))
          );
        } else {
          fetches.push(Promise.resolve([]));
        }

        const [orgs, terminals] = await Promise.all(fetches);
        if (!cancelled) {
          setOrgResults(orgs);
          setTerminalResults(terminals);
        }
      } catch {
        if (!cancelled) {
          setOrgResults([]);
          setTerminalResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, type, open, showTerminals]);

  function handleSelectOrg(org) {
    setSelectedLabel(org.name);
    setOpen(false);
    setQuery('');
    onChange?.({ ...org, _source: 'org' });
  }

  async function handleSelectTerminal(t) {
    setSelectedLabel(t.effective_name);
    setOpen(false);
    setQuery('');

    // Auto-import the terminal as an organization so the orders FK is satisfied.
    // The API returns the existing org if already imported, or creates a new one.
    try {
      const res = await fetch(`/api/tenant/terminals/${t.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to import terminal');
      const data = await res.json();
      const org = data.organization;
      onChange?.({
        ...org,
        _source: 'terminal',
        terminal_label: t.label,
        terminal_type: t.type,
        terminal_market: t.market,
      });
    } catch {
      // Fallback — pass the terminal data directly (will fail FK if used as location_id)
      onChange?.({
        id: t.id,
        name: t.effective_name,
        address_line1: t.address,
        city: t.city,
        state: t.state,
        zip: t.zip,
        _source: 'terminal',
      });
    }
  }

  function handleClear(e) {
    e.stopPropagation();
    setSelectedLabel('');
    setQuery('');
    onChange?.(null);
  }

  const visibleOrgResults = excludeSet.size > 0 ? orgResults.filter((o) => !excludeSet.has(o.id)) : orgResults;
  const visibleTerminalResults = excludeSet.size > 0 ? terminalResults.filter((t) => !excludeSet.has(t.id)) : terminalResults;
  const totalResults = visibleOrgResults.length + visibleTerminalResults.length;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
        {value && selectedLabel && !open ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setOpen(true)}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 pl-9 pr-9 py-2.5 text-sm text-left text-gray-900 dark:text-slate-100 bg-white dark:bg-slate-900 hover:border-gray-400 dark:hover:border-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-gray-50 dark:disabled:bg-slate-900"
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
            placeholder={placeholderText}
            disabled={disabled}
            autoComplete="off"
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 pl-9 pr-9 py-2.5 text-sm text-gray-900 dark:text-slate-100 bg-white dark:bg-slate-900 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-gray-50 dark:disabled:bg-slate-900"
          />
        )}
        {loading && open && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
        )}
      </div>

      {open && !loading && (
        <div className="absolute z-50 mt-1 w-full min-w-[280px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {totalResults === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500 dark:text-slate-400 text-center">
              <Search className="w-4 h-4 inline mr-1" />
              No results found
            </div>
          ) : (
            <>
              {/* System Terminals */}
              {visibleTerminalResults.length > 0 && (
                <>
                  <div className="px-3 py-1.5 bg-gray-50 dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 sticky top-0">
                    <MapPin className="w-3 h-3 inline -mt-0.5 mr-1" />
                    Terminals ({visibleTerminalResults.length})
                  </div>
                  {visibleTerminalResults.map((t) => (
                    <button
                      key={`t-${t.id}`}
                      type="button"
                      onClick={() => handleSelectTerminal(t)}
                      className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-blue-50/60 dark:hover:bg-blue-950/30 border-b border-gray-50 dark:border-slate-800"
                    >
                      {t.type === 'MARINE' ? (
                        <Ship className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                      ) : (
                        <Train className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                          {t.effective_name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                          {[t.address, t.city, t.state, t.zip].filter(Boolean).join(', ')}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`text-[9px] uppercase tracking-wide font-semibold px-1 py-0.5 rounded ${
                              t.type === 'MARINE'
                                ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                                : 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {t.type}
                          </span>
                          <span className="text-[10px] text-gray-400 dark:text-slate-500">{t.market}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* Organizations */}
              {visibleOrgResults.length > 0 && (
                <>
                  {visibleTerminalResults.length > 0 && (
                    <div className="px-3 py-1.5 bg-gray-50 dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 sticky top-0">
                      <Building2 className="w-3 h-3 inline -mt-0.5 mr-1" />
                      Your Organizations ({visibleOrgResults.length})
                    </div>
                  )}
                  {visibleOrgResults.map((org) => (
                    <button
                      key={`o-${org.id}`}
                      type="button"
                      onClick={() => handleSelectOrg(org)}
                      className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-blue-50/60 dark:hover:bg-blue-950/30 border-b border-gray-100 dark:border-slate-800 last:border-b-0"
                    >
                      <Building2 className="w-4 h-4 text-gray-400 dark:text-slate-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{org.name}</div>
                        {(org.city || org.state) && (
                          <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                            {[org.address_line1, org.city, org.state, org.zip]
                              .filter(Boolean)
                              .join(', ')}
                          </div>
                        )}
                        {org.customer_types?.length > 0 && (
                          <div className="flex gap-1 mt-0.5">
                            {org.customer_types.map((ct) => (
                              <span
                                key={ct}
                                className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 rounded px-1"
                              >
                                {ct}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}
            </>
          )}

          {/* Create New Organization button — always at the bottom */}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setShowCreateModal(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 border-t border-gray-200 dark:border-slate-700 sticky bottom-0 bg-white dark:bg-slate-900"
          >
            <Plus className="w-4 h-4" />
            Create New Organization
          </button>
        </div>
      )}

      {helpText && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{helpText}</p>}

      {/* Inline create modal */}
      {showCreateModal && (
        <OrganizationModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={(org) => {
            setShowCreateModal(false);
            if (org) {
              handleSelectOrg(org);
            }
          }}
        />
      )}
    </div>
  );
}
