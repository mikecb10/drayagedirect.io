import { useEffect, useRef, useState } from 'react';
import { MapPin, Building2, Hash, X, Loader2 } from 'lucide-react';
import { loadGoogleMaps, parseAddressComponents } from '../../lib/google-maps-loader';

/**
 * EventLocationPicker — validated-location combobox for driver charge
 * profile tiers. Combines two search layers:
 *
 *   1. Your own organizations (tenant scope) — from /api/tenant/organizations
 *   2. Google Places Autocomplete — validated cities, zips, addresses
 *
 * When the user picks a result:
 *   - Org result      → { type: 'org', id, value, meta: {} }
 *   - Google city     → { type: 'city_state', id: null, value: 'Lampasas, TX',
 *                          meta: { place_id, formatted, city, state, country, lat, lon } }
 *   - Google zip      → { type: 'zip', id: null, value: '75098',
 *                          meta: { place_id, formatted, city, state, country, lat, lon } }
 *
 * Value shape (controlled):
 *   {
 *     type:  'org' | 'city_state' | 'zip' | 'profile_group',
 *     id:    uuid | null,
 *     value: string,
 *     meta?: { place_id, formatted, city, state, country, lat, lon }
 *   }
 *
 * If Google Maps fails to load (no API key, offline, etc.) the picker
 * degrades to org-only search + a plain-text fallback commit.
 */
export default function EventLocationPicker({
  value,
  onChange,
  placeholder = 'Search city, zip, or organization...',
  className = '',
  disabled = false,
}) {
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [orgResults, setOrgResults] = useState([]);
  const [placesResults, setPlacesResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);
  const autocompleteServiceRef = useRef(null);
  const placesServiceRef = useRef(null);
  const sessionTokenRef = useRef(null);

  // Load Google Maps + Places service once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((google) => {
        if (cancelled) return;
        autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
        // PlacesService needs a DOM node; an offscreen div is fine
        const host = document.createElement('div');
        placesServiceRef.current = new google.maps.places.PlacesService(host);
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        setMapsReady(true);
      })
      .catch(() => {
        if (!cancelled) setMapsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    function onClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Debounced async search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setOrgResults([]);
      setPlacesResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        // Parallel: orgs from our DB + Google Places predictions
        const [orgRes, placeResults] = await Promise.all([
          fetchOrgs(q),
          mapsReady ? fetchPlaces(q) : Promise.resolve([]),
        ]);
        setOrgResults(orgRes);
        setPlacesResults(placeResults);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open, mapsReady]);

  async function fetchOrgs(q) {
    try {
      const res = await fetch(`/api/tenant/organizations?search=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.organizations || data.items || data || []).slice(0, 5);
    } catch {
      return [];
    }
  }

  function fetchPlaces(q) {
    return new Promise((resolve) => {
      const service = autocompleteServiceRef.current;
      if (!service) return resolve([]);
      service.getPlacePredictions(
        {
          input: q,
          // types=(regions) captures cities + zip codes + administrative areas.
          // This is the right breadth for dispatcher pay-rule location matching.
          types: ['(regions)'],
          sessionToken: sessionTokenRef.current,
          componentRestrictions: { country: ['us', 'ca'] },
        },
        (predictions, status) => {
          if (status !== 'OK' || !predictions) return resolve([]);
          resolve(predictions.slice(0, 6));
        }
      );
    });
  }

  function selectOrg(org) {
    onChange?.({ type: 'org', id: org.id, value: org.name, meta: null });
    reset();
  }

  function selectPlace(prediction) {
    const service = placesServiceRef.current;
    if (!service) return;
    service.getDetails(
      {
        placeId: prediction.place_id,
        fields: ['address_components', 'geometry', 'formatted_address', 'types', 'place_id'],
        sessionToken: sessionTokenRef.current,
      },
      (place, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place) return;
        const parsed = parseAddressComponents(place);
        const isZip = (place.types || []).includes('postal_code');
        const type = isZip ? 'zip' : 'city_state';
        const displayValue = isZip
          ? (parsed?.zip || prediction.structured_formatting?.main_text)
          : `${parsed?.city || ''}${parsed?.state ? ', ' + parsed.state : ''}`.trim();
        onChange?.({
          type,
          id: null,
          value: displayValue || prediction.description,
          meta: {
            place_id: place.place_id || prediction.place_id,
            formatted: place.formatted_address || prediction.description,
            city: parsed?.city || null,
            state: parsed?.state || null,
            country: parsed?.country || null,
            lat: parsed?.lat ?? null,
            lon: parsed?.lng ?? null,
          },
        });
        // Rotate session token after a billing-session commit
        sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
        reset();
      }
    );
  }

  function reset() {
    setOpen(false);
    setQuery('');
    setOrgResults([]);
    setPlacesResults([]);
  }

  function clear() {
    onChange?.(null);
    setQuery('');
  }

  const hasValue = value && value.value;

  const typeIcon = {
    org: <Building2 className="w-3.5 h-3.5" />,
    city_state: <MapPin className="w-3.5 h-3.5" />,
    zip: <Hash className="w-3.5 h-3.5" />,
    profile_group: <MapPin className="w-3.5 h-3.5" />,
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {hasValue ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
            {typeIcon[value.type] || typeIcon.city_state}
          </span>
          <span className="flex-1 truncate text-gray-900 dark:text-slate-100">
            {value.meta?.formatted || value.value}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              className="shrink-0 text-gray-400 dark:text-slate-500 hover:text-red-500"
              aria-label="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <input
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
              if (placesResults.length > 0) selectPlace(placesResults[0]);
              else if (orgResults.length > 0) selectOrg(orgResults[0]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
        />
      )}

      {open && !hasValue && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg max-h-96 overflow-auto">
          {loading && (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Searching...
            </div>
          )}

          {!loading && orgResults.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                Organizations
              </div>
              {orgResults.map((org) => (
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

          {!loading && placesResults.length > 0 && (
            <div className={orgResults.length > 0 ? 'border-t border-gray-100 dark:border-slate-800' : ''}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                Cities &amp; Zip Codes
              </div>
              {placesResults.map((p) => (
                <button
                  key={p.place_id}
                  type="button"
                  onClick={() => selectPlace(p)}
                  className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-start gap-2"
                >
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-gray-400 dark:text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 dark:text-slate-100 truncate">
                      {p.structured_formatting?.main_text || p.description}
                    </div>
                    {p.structured_formatting?.secondary_text && (
                      <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                        {p.structured_formatting.secondary_text}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && query.trim().length >= 2 && orgResults.length === 0 && placesResults.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-500 dark:text-slate-400">
              {mapsFailed
                ? 'Search unavailable — Google Maps did not load. Check API key in .env.local.'
                : 'No matches. Try a different spelling or add the organization first.'}
            </div>
          )}

          {!loading && query.trim().length < 2 && (
            <div className="px-3 py-3 text-xs text-gray-500 dark:text-slate-400">
              Start typing an organization, city, or zip...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
