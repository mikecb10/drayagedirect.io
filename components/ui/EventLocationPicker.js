import { useEffect, useRef, useState } from 'react';
import { MapPin, Building2, Hash, Users, X, Loader2 } from 'lucide-react';

/**
 * EventLocationPicker — single searchable combobox for specifying an
 * event/leg location on a driver charge profile tier.
 *
 * Unlike OrgPicker (which always returns an organization), this picker
 * accepts four location types:
 *
 *   - org            — pick from your organizations by searching
 *   - city_state     — free text, e.g. "Bryan, TX"
 *   - zip            — free text, 5-digit zip
 *   - profile_group  — free text group name (placeholder / future)
 *
 * UX pattern (matches PortPro):
 *   User types freely. Live results show matching orgs as they type.
 *   Below the org results, footer rows let the user commit their typed
 *   text as a city/state, zip, or profile group. Clicking an org selects
 *   it as type='org'; clicking a footer row commits the free text with
 *   the chosen type.
 *
 * Value shape (controlled component):
 *   {
 *     type:  'org' | 'city_state' | 'zip' | 'profile_group',
 *     id:    uuid | null,   // only for type='org'
 *     value: string         // display label / free text
 *   }
 *
 * onChange(value | null):
 *   - `null` when the user clears.
 *   - object (above shape) when a selection is made.
 */
export default function EventLocationPicker({
  value,
  onChange,
  placeholder = 'City/State/Zip/Profile/Profile-Group',
  className = '',
  disabled = false,
}) {
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Close on outside click
  useEffect(() => {
    function onClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Debounced async search of organizations when query changes
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const q = query.trim();
      if (q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/tenant/organizations?search=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setResults((data.organizations || data.items || data || []).slice(0, 8));
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  function selectOrg(org) {
    onChange?.({ type: 'org', id: org.id, value: org.name });
    setOpen(false);
    setQuery('');
  }

  function commitFreeText(type) {
    const trimmed = query.trim();
    if (!trimmed) return;
    onChange?.({ type, id: null, value: trimmed });
    setOpen(false);
    setQuery('');
  }

  function clear() {
    onChange?.(null);
    setQuery('');
  }

  // Auto-detect the most likely type from the current query so we can
  // suggest the right commit option first.
  // Profile Group is deferred until the profile_groups table/admin UI
  // exists, so it's not surfaced as a commit option here.
  const trimmed = query.trim();
  const isZip = /^\d{5}(-\d{4})?$/.test(trimmed);
  const isCityState = /,\s*[A-Za-z]{2}$/.test(trimmed) || trimmed.includes(',');
  const autoType = isZip ? 'zip' : 'city_state';

  const hasValue = value && value.value;

  // Render pill for current selection
  const typeIcon = {
    org: <Building2 className="w-3.5 h-3.5" />,
    city_state: <MapPin className="w-3.5 h-3.5" />,
    zip: <Hash className="w-3.5 h-3.5" />,
    profile_group: <Users className="w-3.5 h-3.5" />,
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {hasValue ? (
        // Selected-state chip inside the input frame
        <div className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
            {typeIcon[value.type] || typeIcon.profile_group}
          </span>
          <span className="flex-1 truncate text-gray-900 dark:text-slate-100">{value.value}</span>
          {!disabled && (
            <button type="button" onClick={clear} className="shrink-0 text-gray-400 dark:text-slate-500 hover:text-red-500" aria-label="Clear">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (results.length > 0) {
                selectOrg(results[0]);
              } else if (trimmed) {
                commitFreeText(autoType);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
        />
      )}

      {/* Dropdown */}
      {open && !hasValue && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg max-h-80 overflow-auto">
          {/* Org search results */}
          {loading && (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Searching...
            </div>
          )}
          {!loading && results.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                Organizations
              </div>
              {results.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => selectOrg(org)}
                  className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-start gap-2"
                >
                  <Building2 className="w-4 h-4 mt-0.5 shrink-0 text-gray-400 dark:text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 dark:text-slate-100 truncate">{org.name}</div>
                    {(org.city || org.state) && (
                      <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                        {[org.city, org.state].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Free-text commit options — profile_group intentionally omitted;
              see autoType logic above. Restore it when the profile_groups
              feature ships. */}
          {trimmed.length >= 2 && (
            <div className={results.length > 0 ? 'border-t border-gray-100 dark:border-slate-800' : ''}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                Use as
              </div>
              <FreeTextOption icon={<MapPin className="w-4 h-4" />} label="City, State" value={trimmed}
                suggested={autoType === 'city_state'} onClick={() => commitFreeText('city_state')} />
              <FreeTextOption icon={<Hash className="w-4 h-4" />} label="Zip Code" value={trimmed}
                suggested={autoType === 'zip'} onClick={() => commitFreeText('zip')} />
            </div>
          )}

          {/* Empty-state hint */}
          {!loading && trimmed.length < 2 && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-500 dark:text-slate-400">
              Type an organization name, city &amp; state, zip code, or group...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FreeTextOption({ icon, label, value, suggested, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center gap-2 ${
        suggested
          ? 'bg-blue-100 dark:bg-blue-950/60 ring-1 ring-inset ring-blue-300 dark:ring-blue-800'
          : ''
      }`}
    >
      <span className={suggested ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-slate-500'}>
        {icon}
      </span>
      <span className={`text-xs w-24 shrink-0 ${
        suggested ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-gray-500 dark:text-slate-400'
      }`}>
        {label}
      </span>
      <span className="text-sm text-gray-900 dark:text-slate-100 truncate">{value}</span>
      {suggested && (
        <span className="ml-auto text-[9px] font-bold uppercase text-white bg-blue-600 px-1.5 py-0.5 rounded tracking-wide">
          Suggested
        </span>
      )}
    </button>
  );
}
