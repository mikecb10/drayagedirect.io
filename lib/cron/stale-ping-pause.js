// lib/cron/stale-ping-pause.js
/**
 * Pure helper: filter moves that are in_transit and haven't pinged in 10+ min.
 * Caller flips them to 'paused' via transitionTrackingSession with actor_type='system'.
 */

export const STALE_THRESHOLD_MS = 10 * 60 * 1000;

export function findStaleMoves(moves, nowMs = Date.now()) {
  return (moves || []).filter((m) => {
    if (m.tracking_status !== 'in_transit') return false;
    if (!m.last_ping_at) return false;
    const ageMs = nowMs - new Date(m.last_ping_at).getTime();
    return ageMs >= STALE_THRESHOLD_MS;
  });
}
