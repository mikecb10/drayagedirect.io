import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { loadGoogleMaps, parseAddressComponents } from '../../lib/google-maps-loader';

/**
 * Address autocomplete input powered by Google Places API.
 *
 * As the user types, shows suggestions from Google. Selecting one calls
 * `onSelect` with a parsed address object: { street, city, state, zip, country, lat, lng }
 *
 * Falls back to a plain text input if Google Maps fails to load, so typing still works.
 *
 * Usage:
 *   <AddressAutocomplete
 *     label="Address"
 *     value={form.address_line1}
 *     onChange={(val) => update('address_line1', val)}
 *     onSelect={(addr) => {
 *       update('address_line1', addr.street);
 *       update('city', addr.city);
 *       update('state', addr.state);
 *       update('zip', addr.zip);
 *       update('country', addr.country);
 *     }}
 *   />
 */
export default function AddressAutocomplete({
  label,
  value = '',
  onChange,
  onSelect,
  placeholder = 'Start typing an address...',
  required = false,
  error,
  helpText,
  className = '',
  disabled = false,
  countryRestrictions = ['us', 'ca', 'mx'],
}) {
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  const autocompleteServiceRef = useRef(null);
  const placesServiceRef = useRef(null);
  const sessionTokenRef = useRef(null);

  const [predictions, setPredictions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [ready, setReady] = useState(false);

  // Initialize Google Maps + Places services
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((google) => {
        if (cancelled) return;
        autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
        // PlacesService requires a DOM element (any div works)
        const dummyDiv = document.createElement('div');
        placesServiceRef.current = new google.maps.places.PlacesService(dummyDiv);
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[AddressAutocomplete] Google Maps failed to load:', err.message);
        setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handleInputChange(e) {
    const input = e.target.value;
    onChange?.(input);

    if (!input || input.length < 3 || !autocompleteServiceRef.current) {
      setPredictions([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    setOpen(true);

    autocompleteServiceRef.current.getPlacePredictions(
      {
        input,
        sessionToken: sessionTokenRef.current,
        componentRestrictions: { country: countryRestrictions },
        types: ['address'],
      },
      (results, status) => {
        setLoading(false);
        if (status === window.google?.maps?.places?.PlacesServiceStatus.OK && results) {
          setPredictions(results);
        } else {
          setPredictions([]);
        }
      }
    );
  }

  function handleSelectPrediction(prediction) {
    if (!placesServiceRef.current) return;

    placesServiceRef.current.getDetails(
      {
        placeId: prediction.place_id,
        sessionToken: sessionTokenRef.current,
        fields: ['address_components', 'formatted_address', 'geometry'],
      },
      (place, status) => {
        if (status === window.google?.maps?.places?.PlacesServiceStatus.OK && place) {
          const parsed = parseAddressComponents(place);
          if (parsed) {
            onChange?.(parsed.street || prediction.structured_formatting?.main_text || '');
            onSelect?.(parsed);
          }
          // Reset session token after a selection (per Google best practices)
          if (window.google?.maps?.places?.AutocompleteSessionToken) {
            sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
          }
        }
        setOpen(false);
        setPredictions([]);
      }
    );
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
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => value.length >= 3 && predictions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete="off"
          className={`block w-full rounded-lg border pl-9 pr-9 py-2.5 text-sm bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors disabled:bg-gray-50 dark:disabled:bg-slate-900 ${
            error
              ? 'border-red-300 dark:border-red-800 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 dark:border-slate-700 focus:border-blue-500 focus:ring-blue-500'
          }`}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
        )}
      </div>

      {/* Dropdown */}
      {open && predictions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {predictions.map((p) => (
            <button
              key={p.place_id}
              type="button"
              onClick={() => handleSelectPrediction(p)}
              className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-blue-50/60 dark:hover:bg-blue-950/30 border-b border-gray-100 dark:border-slate-800 last:border-b-0"
            >
              <MapPin className="w-4 h-4 text-gray-400 dark:text-slate-500 mt-0.5 shrink-0" strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                  {p.structured_formatting?.main_text || p.description}
                </div>
                <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                  {p.structured_formatting?.secondary_text || ''}
                </div>
              </div>
            </button>
          ))}
          <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-800 border-t border-gray-100 dark:border-slate-800">
            Powered by Google
          </div>
        </div>
      )}

      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && helpText && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{helpText}</p>}
      {loadError && !error && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Address suggestions unavailable — typing still works. ({loadError})
        </p>
      )}
    </div>
  );
}
