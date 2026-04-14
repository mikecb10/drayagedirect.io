import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../../../lib/google-maps-loader';
import { Map as MapIcon, AlertCircle } from 'lucide-react';

// Marker colors by event type
const MARKER_COLORS = {
  pull: '#2563eb',     // blue
  pickup: '#2563eb',
  drop: '#f59e0b',    // amber
  hook: '#8b5cf6',    // purple
  deliver: '#10b981', // green
  return: '#64748b',  // slate
  wait: '#6b7280',    // gray
  scale: '#6b7280',
};

/**
 * RouteMap — Google Maps embed showing the full connected route.
 *
 * Renders numbered markers at each event location, connected by a blue
 * polyline. Auto-fits bounds to show the entire route.
 *
 * Props:
 *   events — ordered array of routing events (must have address/city/state or location data)
 */
export default function RouteMap({ events = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylineRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Events with valid addresses
  const locatedEvents = events.filter((e) => {
    const addr = buildAddress(e);
    return addr && addr.length > 5;
  });

  useEffect(() => {
    if (!mapRef.current || locatedEvents.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function initMap() {
      try {
        const google = await loadGoogleMaps();
        if (cancelled) return;

        // Create or reuse map instance
        if (!mapInstanceRef.current) {
          mapInstanceRef.current = new google.maps.Map(mapRef.current, {
            zoom: 10,
            center: { lat: 39.8283, lng: -98.5795 }, // center of US
            disableDefaultUI: true,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            styles: [
              { featureType: 'poi', stylers: [{ visibility: 'off' }] },
              { featureType: 'transit', stylers: [{ visibility: 'off' }] },
            ],
          });
        }

        const map = mapInstanceRef.current;

        // Clear existing markers + polyline
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];
        if (polylineRef.current) {
          polylineRef.current.setMap(null);
          polylineRef.current = null;
        }

        // Geocode each event's address
        const geocoder = new google.maps.Geocoder();
        const positions = [];

        for (let i = 0; i < locatedEvents.length; i++) {
          const ev = locatedEvents[i];
          const addr = buildAddress(ev);
          try {
            const result = await geocodeAddress(geocoder, addr);
            if (result) {
              positions.push({ event: ev, position: result, index: i });
            }
          } catch {
            // Skip events that can't be geocoded
          }
        }

        if (cancelled || positions.length === 0) {
          setLoading(false);
          return;
        }

        // Create markers
        const bounds = new google.maps.LatLngBounds();
        const pathCoords = [];

        positions.forEach(({ event: ev, position, index }) => {
          const color = MARKER_COLORS[ev.event_type] || '#6b7280';
          const marker = new google.maps.Marker({
            map,
            position,
            title: `${index + 1}. ${ev.location_name || ev.event_type}`,
            label: {
              text: String(index + 1),
              color: '#fff',
              fontSize: '11px',
              fontWeight: 'bold',
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            },
            zIndex: index + 1,
          });

          // InfoWindow on click
          const infoContent = `
            <div style="font-family:system-ui;font-size:13px;max-width:200px">
              <div style="font-weight:600;margin-bottom:4px">${index + 1}. ${formatEventType(ev.event_type)}</div>
              <div style="color:#374151">${ev.location_name || '—'}</div>
              ${ev.city ? `<div style="color:#6b7280;font-size:12px">${[ev.city, ev.state].filter(Boolean).join(', ')}</div>` : ''}
            </div>
          `;
          const infoWindow = new google.maps.InfoWindow({ content: infoContent });
          marker.addListener('click', () => {
            infoWindow.open(map, marker);
          });

          markersRef.current.push(marker);
          bounds.extend(position);
          pathCoords.push(position);
        });

        // Draw polyline
        if (pathCoords.length >= 2) {
          polylineRef.current = new google.maps.Polyline({
            path: pathCoords,
            geodesic: true,
            strokeColor: '#2563eb',
            strokeOpacity: 0.8,
            strokeWeight: 3,
            icons: [
              {
                icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: '#2563eb' },
                offset: '50%',
              },
            ],
          });
          polylineRef.current.setMap(map);
        }

        // Fit bounds
        if (positions.length === 1) {
          map.setCenter(positions[0].position);
          map.setZoom(13);
        } else {
          map.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 });
        }

        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Map failed to load');
          setLoading(false);
        }
      }
    }

    initMap();
    return () => { cancelled = true; };
  }, [locatedEvents.map((e) => `${e.id}-${e.location_name}`).join(',')]);

  if (locatedEvents.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-800 p-6 flex flex-col items-center justify-center text-center min-h-[200px]">
        <MapIcon className="w-6 h-6 text-gray-300 dark:text-slate-600 mb-2" />
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400">Route Map</div>
        <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">Add locations to events to see the route</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden relative" style={{ minHeight: 220 }}>
      {loading && (
        <div className="absolute inset-0 bg-gray-50/80 dark:bg-slate-900/80 flex items-center justify-center z-10">
          <div className="text-xs text-gray-500 dark:text-slate-400">Loading map…</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 bg-gray-50 dark:bg-slate-900 flex flex-col items-center justify-center z-10">
          <AlertCircle className="w-5 h-5 text-gray-400 dark:text-slate-500 mb-1" />
          <div className="text-xs text-gray-500 dark:text-slate-400">{error}</div>
        </div>
      )}
      <div ref={mapRef} style={{ width: '100%', height: 220 }} />
    </div>
  );
}

function buildAddress(event) {
  const parts = [
    event.address || event.location?.address_line1,
    event.city || event.location?.city,
    event.state || event.location?.state,
    event.zip || event.location?.zip,
  ].filter(Boolean);
  return parts.join(', ');
}

function geocodeAddress(geocoder, address) {
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results[0]) {
        resolve(results[0].geometry.location);
      } else {
        reject(new Error(`Geocode failed: ${status}`));
      }
    });
  });
}

function formatEventType(type) {
  const labels = {
    pull: 'Pull from Terminal',
    pickup: 'Pickup Container',
    drop: 'Drop Container',
    hook: 'Hook Container',
    deliver: 'Deliver Container',
    return: 'Return Container',
  };
  return labels[type] || (type || '').replace(/^./, (c) => c.toUpperCase());
}
