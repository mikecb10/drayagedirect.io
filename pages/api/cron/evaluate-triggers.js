import { getServiceClient } from '../../../lib/tenant-api';
import { runPolledEvaluation } from '../../../lib/email-dispatch';

/**
 * /api/cron/evaluate-triggers
 *
 * POST — protected by the CRON_SECRET env var in the Authorization
 * header. Runs a full polled-trigger evaluation sweep across all active
 * tenants and returns the summary.
 *
 * No tenant user context — this endpoint uses the service-role client
 * directly. Intended to be hit by:
 *   - Vercel Cron (https://vercel.com/docs/cron-jobs) every 15 minutes
 *   - External cron hitting the URL with curl
 *   - Manual fire during 4c verification
 *
 * Request:
 *   POST /api/cron/evaluate-triggers
 *   Authorization: Bearer ${process.env.CRON_SECRET}
 *   body: {} (or optional { tenant_id } to scope to one tenant)
 *
 * Response:
 *   { ok: true, summary: {evaluated, fired, skipped, ...} }
 */

function authOk(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed in production if the secret is missing, open in
    // development for easier testing.
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token === expected;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authOk(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { tenant_id: tenantId } = req.body || {};
  const svc = getServiceClient();

  try {
    const summary = await runPolledEvaluation(svc, tenantId ? { tenantId } : {});
    return res.status(200).json({ ok: true, summary });
  } catch (e) {
    console.error('evaluate-triggers cron error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
