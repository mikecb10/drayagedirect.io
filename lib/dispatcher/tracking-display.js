/**
 * Display formatters for tracking data on dispatcher surfaces.
 * Shared between MoveCell and TrackingTab.
 */

export function fmtRelativeETA(etaIso) {
  if (!etaIso) return '—';
  const ms = new Date(etaIso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

export function fmtAbsoluteETA(etaIso) {
  if (!etaIso) return '—';
  const d = new Date(etaIso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function fmtOnSiteDuration(arrivedAtIso) {
  if (!arrivedAtIso) return '—';
  const ms = Date.now() - new Date(arrivedAtIso).getTime();
  if (ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function freshnessColor(lastPingAtIso) {
  if (!lastPingAtIso) return 'red';
  const ms = Date.now() - new Date(lastPingAtIso).getTime();
  if (ms < 2 * 60 * 1000) return 'green';
  if (ms < 10 * 60 * 1000) return 'amber';
  return 'red';
}

export function freshnessColorClass(color) {
  return {
    green: 'bg-green-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
  }[color] || 'bg-gray-400';
}
