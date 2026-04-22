// Polled by the BulkEmailQueue UI every ~5s while any open row is still
// delivery_status=null. Returns a map of message_id → { delivery_status,
// last_delivery_event_at } for rows that belong to the current tenant.
//
// Rows that don't belong to the tenant (or don't exist) are simply omitted
// from the response map — the UI treats a missing key as "still null" which
// keeps polling behavior consistent.

import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

const MAX_MESSAGE_IDS = 200;

// Union of permissions used by both bulk-send endpoints that populate the
// queue whose rows this endpoint polls (AR invoice send + rate-con send).
// Anyone allowed to send is allowed to poll the delivery status of what
// they sent.
const POLL_PERMS = [
  PERMISSIONS.ORDER_ENTRY,
  PERMISSIONS.DISPATCHING,
  PERMISSIONS.ACCOUNTS_RECEIVABLE,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, POLL_PERMS, res)) return;

  const raw = req.query.message_ids;
  if (!raw) {
    return res.status(400).json({ error: 'message_ids query param required' });
  }
  if (typeof raw !== 'string') {
    return res.status(400).json({ error: 'message_ids must be a comma-separated string' });
  }

  const messageIds = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (messageIds.length === 0) {
    return res.status(200).json({});
  }
  if (messageIds.length > MAX_MESSAGE_IDS) {
    return res.status(400).json({ error: `too many message_ids (max ${MAX_MESSAGE_IDS})` });
  }

  const svc = getServiceClient();

  const { data, error } = await svc
    .from('email_messages')
    .select('id, delivery_status, last_delivery_event_at')
    .eq('tenant_id', ctx.tenantId)
    .in('id', messageIds);

  if (error) {
    console.error('[deliveries] query failed:', error.message);
    return res.status(500).json({ error: 'query_failed' });
  }

  const map = {};
  for (const row of data || []) {
    map[row.id] = {
      delivery_status: row.delivery_status,
      last_delivery_event_at: row.last_delivery_event_at,
    };
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(map);
}
