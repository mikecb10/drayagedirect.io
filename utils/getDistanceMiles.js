/**
 * Google Distance Matrix helpers — CLIENT-SIDE implementation.
 *
 * Uses the Maps JavaScript API's DistanceMatrixService (loaded via
 * google-maps-loader.js) instead of the REST endpoint. This avoids
 * CORS issues and uses the same API key as the map rendering.
 */

import { loadGoogleMaps } from '../lib/google-maps-loader';

/**
 * Get distance in miles between two addresses.
 * @returns {number} distance in miles
 */
export async function getDistanceMiles(origin, destination) {
  const result = await getDistanceAndDuration(origin, destination);
  return result.distance_miles;
}

/**
 * Get distance + duration between two addresses using the client-side
 * Google Maps DistanceMatrixService.
 *
 * @returns {{ distance_miles: number, distance_text: string, duration_minutes: number, duration_text: string }}
 */
export async function getDistanceAndDuration(origin, destination) {
  const empty = { distance_miles: 0, distance_text: '—', duration_minutes: 0, duration_text: '—' };
  if (!origin || !destination) return empty;

  try {
    const google = await loadGoogleMaps();
    const service = new google.maps.DistanceMatrixService();

    const response = await new Promise((resolve, reject) => {
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL,
          // Prefer major highways — closer to commercial truck routing.
          // Google's DRIVING mode uses truck-legal roads by default on
          // highways. For true FMCSA-compliant truck routing (bridge
          // heights, weight limits), integrate PC*MILER or Trimble later.
          avoidFerries: true,
        },
        (result, status) => {
          if (status === 'OK') resolve(result);
          else reject(new Error(`Distance Matrix failed: ${status}`));
        }
      );
    });

    const element = response?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return empty;

    const distanceText = element.distance.text; // e.g. "50.3 mi"
    const distanceMiles = parseFloat(distanceText.replace(/,/g, '').replace('mi', '').trim()) || 0;
    const durationSeconds = element.duration.value;
    const durationMinutes = Math.round(durationSeconds / 60);

    return {
      distance_miles: Math.round(distanceMiles * 100) / 100,
      distance_text: `${distanceMiles.toFixed(1)} mi`,
      duration_minutes: durationMinutes,
      duration_text: formatDuration(durationMinutes),
    };
  } catch {
    return empty;
  }
}

/**
 * Format minutes into a human-readable duration string.
 * e.g. 83 → "1h 23m", 45 → "45m", 0 → "—"
 */
function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
