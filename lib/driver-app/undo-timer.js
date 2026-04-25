// lib/driver-app/undo-timer.js
/**
 * 2-min undo countdown helper. Tracks last-action timestamp in sessionStorage.
 */

const KEY = 'dd_driver_last_action_at';
const WINDOW_MS = 2 * 60 * 1000;

export function recordAction() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(KEY, String(Date.now()));
}

export function clearAction() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(KEY);
}

export function getRemainingMs() {
  if (typeof window === 'undefined') return 0;
  const at = parseInt(window.sessionStorage.getItem(KEY) || '0', 10);
  if (!at) return 0;
  const remaining = WINDOW_MS - (Date.now() - at);
  return remaining > 0 ? remaining : 0;
}

export function fmtRemaining(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
