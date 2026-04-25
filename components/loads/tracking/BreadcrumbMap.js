// components/loads/tracking/BreadcrumbMap.js
import { useEffect, useRef } from 'react';
import { loadGoogleMaps } from '../../../lib/google-maps-loader.js';

export default function BreadcrumbMap({ move, pings }) {
  const ref = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let map = null;
    (async () => {
      try {
        const google = await loadGoogleMaps();
        if (cancelled || !ref.current) return;

        // Use the ping data for centering since drivers.last_* is per-driver,
        // not per-move. The breadcrumb itself is the source of truth for
        // "where this move's driver has been".
        const latestPing = (pings && pings.length > 0)
          ? [...pings].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0]
          : null;
        const center = latestPing
          ? { lat: parseFloat(latestPing.latitude), lng: parseFloat(latestPing.longitude) }
          : { lat: 37.5, lng: -122.0 };

        map = new google.maps.Map(ref.current, {
          center, zoom: 10,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        });

        const bounds = new google.maps.LatLngBounds();

        // Breadcrumb polyline from pings (oldest → newest).
        // Pings come back DESC from the endpoint; reverse so the polyline
        // draws in chronological order.
        if (pings && pings.length > 0) {
          const path = [...pings]
            .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
            .map((p) => ({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) }));
          new google.maps.Polyline({
            path,
            geodesic: true,
            strokeColor: '#2563eb',
            strokeOpacity: 0.8,
            strokeWeight: 3,
            map,
          });
          for (const ll of path) bounds.extend(ll);
        }

        // Driver pulse marker — most recent ping
        if (latestPing) {
          const driverPos = {
            lat: parseFloat(latestPing.latitude),
            lng: parseFloat(latestPing.longitude),
          };
          new google.maps.Marker({
            map, position: driverPos,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8, fillColor: '#2563eb', fillOpacity: 1,
              strokeColor: '#fff', strokeWeight: 2,
            },
            title: 'Driver',
          });
          bounds.extend(driverPos);
        }

        if (!bounds.isEmpty()) map.fitBounds(bounds);
      } catch (err) {
        console.error('BreadcrumbMap load error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [move?.id, pings?.length]);

  return (
    <div ref={ref} className="w-full h-[400px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800" />
  );
}
