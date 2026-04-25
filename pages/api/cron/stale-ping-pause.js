// pages/api/cron/stale-ping-pause.js
/**
 * Vercel cron handler — every 60s.
 * Finds in_transit moves that haven't pinged in 10+ minutes; flips to paused.
 *
 * Auth: shared CRON_SECRET (Bearer header).
 */

import { getServiceClient } from '../../../lib/tenant-api.js';
import { findStaleMoves } from '../../../lib/cron/stale-ping-pause.js';
import { transitionTrackingSession } from '../../../lib/routing/tracking-session-transition.js';

function authOk(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token === expected;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });

  const svc = getServiceClient();
  // Pull all in_transit moves with last_ping_at not null. v1 scans all tenants —
  // bounded by typical at-most-few-hundred concurrent in_transit moves industry-
  // wide. Add tenant scoping later if needed.
  const { data: moves, error } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, tracking_status, last_ping_at')
    .eq('tracking_status', 'in_transit')
    .not('last_ping_at', 'is', null);
  if (error) return res.status(500).json({ error: error.message });

  const stale = findStaleMoves(moves, Date.now());
  let paused = 0;
  let failed = 0;
  for (const m of stale) {
    try {
      await transitionTrackingSession({
        supabase: svc,
        tenantId: m.tenant_id,
        moveId: m.id,
        toStatus: 'paused',
        actor: {
          type: 'system',
          context: { source: 'system', reason: 'ping_timeout', last_ping_at: m.last_ping_at },
        },
        note: 'auto-paused: 10min idle',
      });
      paused++;
    } catch (e) {
      console.error(`stale-ping-pause failed for move ${m.id}:`, e?.message || e);
      failed++;
    }
  }

  return res.status(200).json({ scanned: moves?.length ?? 0, paused, failed });
}
