// lib/driver-app/geolocation-watcher.js
/**
 * navigator.geolocation wrapper with adaptive cadence:
 *   - moving (last 2 pings >= 100m apart):  60s
 *   - stationary (< 100m apart):           180s
 *   - on-site (caller passes flag):        300s
 *
 * Returns a normalized ping shape: { latitude, longitude, accuracy_meters,
 * speed_mph, heading, battery_pct, recorded_at }.
 */

const MOVING_INTERVAL_MS = 60 * 1000;
const STATIONARY_INTERVAL_MS = 180 * 1000;
const ON_SITE_INTERVAL_MS = 300 * 1000;
const MOVEMENT_THRESHOLD_M = 100;
const METERS_PER_MILE = 1609.344;

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const A = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(A));
}

export function pickInterval({ lastPing, currentPing, onSite }) {
  if (onSite) return ON_SITE_INTERVAL_MS;
  if (!lastPing) return MOVING_INTERVAL_MS;
  const distance = haversineMeters(lastPing, currentPing);
  return distance >= MOVEMENT_THRESHOLD_M ? MOVING_INTERVAL_MS : STATIONARY_INTERVAL_MS;
}

/**
 * Start a geolocation watcher that emits normalized pings via onPing(ping).
 * Calls navigator.geolocation.getCurrentPosition() each cycle (not watchPosition,
 * which doesn't honor cadence — getCurrentPosition + setTimeout gives precise
 * control).
 *
 * Returns a { stop() } handle.
 */
export function startWatcher({ onPing, onError, getOnSite, getBatteryPct }) {
  let stopped = false;
  let lastPing = null;
  let timeoutId = null;

  async function tick() {
    if (stopped) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError?.(new Error('geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (stopped) return;
        const { coords, timestamp } = position;
        const ping = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy_meters: coords.accuracy ?? null,
          speed_mph: coords.speed != null ? (coords.speed * 3600) / METERS_PER_MILE : null,
          heading: coords.heading ?? null,
          battery_pct: getBatteryPct?.() ?? null,
          recorded_at: new Date(timestamp).toISOString(),
        };
        onPing(ping);
        const onSite = !!getOnSite?.();
        const interval = pickInterval({ lastPing, currentPing: ping, onSite });
        lastPing = ping;
        timeoutId = setTimeout(tick, interval);
      },
      (err) => {
        if (stopped) return;
        onError?.(err);
        // Retry in MOVING_INTERVAL on error (better than backing off forever)
        timeoutId = setTimeout(tick, MOVING_INTERVAL_MS);
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    );
  }

  // First tick: fire immediately so the caller gets a ping right away.
  tick();

  return {
    stop() {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}
