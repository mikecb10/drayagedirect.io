// pages/api/cron/breadcrumb-retention.js
/**
 * Daily cron: drops driver_location_pings rows older than 90 days.
 * Audit history (event_status_history, tracking_session_history) is NOT touched —
 * only telemetry is pruned.
 */

import { getServiceClient } from '../../../lib/tenant-api.js';
import { cutoffIso } from '../../../lib/cron/breadcrumb-retention.js';

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
  const cutoff = cutoffIso();

  const { error, count } = await svc
    .from('driver_location_pings')
    .delete({ count: 'exact' })
    .lt('recorded_at', cutoff);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ cutoff, deleted: count });
}
