import { getSupabaseBreaker } from '../../lib/resilience/circuit-breaker.js';

// Public health endpoint — no auth required.
// Reads breaker state directly (does NOT hit Supabase) so a tripped
// breaker still returns quickly. External monitoring services
// (UptimeRobot, Better Uptime, Vercel Analytics) auto-detect 503.

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const breaker = getSupabaseBreaker();
  const snap = breaker.snapshot();
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev';

  const body = {
    status: snap.state === 'closed' ? 'ok' : 'degraded',
    breaker: snap.state,
    supabase_last_ok_at: snap.lastOkAt,
    opened_at: snap.openedAt,
    cooldown_ms_remaining: snap.cooldownMsRemaining,
    version,
  };

  // Cache-Control: no-cache so monitoring services always see fresh state.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  return res.status(snap.state === 'closed' ? 200 : 503).json(body);
}
