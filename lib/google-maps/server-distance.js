/**
 * Server-side Google Distance Matrix wrapper.
 * - Reads GOOGLE_MAPS_SERVER_API_KEY (separate restricted server key)
 * - In-memory LRU cache keyed by (origLat3, origLng3, destLat3, destLng3, eventId), 60s TTL
 * - Cost-gate: rejects when recomputeCount >= 50
 * - Returns { eta_arrival_at, distance_remaining_miles, cached: bool }
 *           or { skipped: true, reason: 'cost_cap_reached' }
 *
 * Spec: docs/superpowers/specs/2026-04-24-driver-move-tracking-design.md §4
 */

const CACHE_TTL_MS = 60 * 1000;
const COST_CAP_PER_MOVE = 50;
const METERS_PER_MILE = 1609.344;

// Module-level Map; entries: { key -> { value, expiresAt } }. Manual LRU.
const cache = new Map();

export function __resetCacheForTesting() {
  cache.clear();
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export function buildCacheKey({ origin, destination }) {
  return `${round3(origin.lat)},${round3(origin.lng)}|${round3(destination.lat)},${round3(destination.lng)}|${destination.eventId}`;
}

function readFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeToCache(key, value) {
  // Cap cache size at 1000; on overflow drop oldest insertion.
  if (cache.size >= 1000) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * @param {object} params
 * @param {{lat: number, lng: number}} params.origin
 * @param {{lat: number, lng: number, eventId: string}} params.destination
 * @param {number} params.recomputeCount  current move.eta_recompute_count
 * @param {string} [params.apiKey]        defaults to process.env.GOOGLE_MAPS_SERVER_API_KEY
 * @param {Function} [params.fetchImpl]   defaults to global fetch (test override)
 * @returns {Promise<{eta_arrival_at?: string, distance_remaining_miles?: number, cached?: boolean, skipped?: boolean, reason?: string}>}
 */
export async function recomputeETA({
  origin,
  destination,
  recomputeCount,
  apiKey,
  fetchImpl,
}) {
  if (recomputeCount >= COST_CAP_PER_MOVE) {
    return { skipped: true, reason: 'cost_cap_reached' };
  }

  const key = buildCacheKey({ origin, destination });
  const cached = readFromCache(key);
  if (cached) {
    return { ...cached, cached: true };
  }

  const finalKey = apiKey ?? process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!finalKey) {
    throw new Error('GOOGLE_MAPS_SERVER_API_KEY is not set');
  }

  const f = fetchImpl ?? globalThis.fetch;
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destinations', `${destination.lat},${destination.lng}`);
  url.searchParams.set('departure_time', 'now');
  url.searchParams.set('traffic_model', 'best_guess');
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('key', finalKey);

  const res = await f(url.toString());
  if (!res.ok) {
    throw new Error(`Distance Matrix HTTP ${res.status}`);
  }
  const json = await res.json();
  const element = json?.rows?.[0]?.elements?.[0];
  if (!element || element.status !== 'OK') {
    throw new Error(`Distance Matrix element status: ${element?.status ?? 'no_element'}`);
  }

  // duration_in_traffic preferred when available; falls back to duration
  const durationSec = element.duration_in_traffic?.value ?? element.duration?.value;
  const distanceMeters = element.distance?.value;
  if (typeof durationSec !== 'number' || typeof distanceMeters !== 'number') {
    throw new Error('Distance Matrix returned invalid duration/distance');
  }

  const result = {
    eta_arrival_at: new Date(Date.now() + durationSec * 1000).toISOString(),
    distance_remaining_miles: Math.round((distanceMeters / METERS_PER_MILE) * 100) / 100,
  };
  writeToCache(key, result);
  return { ...result, cached: false };
}
