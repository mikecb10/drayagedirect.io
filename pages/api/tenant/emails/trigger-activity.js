import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/emails/trigger-activity
 *
 * GET — list recent email_trigger_log rows for the tenant with
 *       pagination and filters. Messages per row are NOT eager-loaded
 *       — they come via a second call when a row is expanded.
 *
 * Query params:
 *   from?          ISO date — filter fired_at >= from
 *   to?            ISO date — filter fired_at <= to (end-of-day)
 *   outcome?       comma-separated outcome list
 *   trigger_id?    UUID — filter to one trigger
 *   load_search?   prefix match against load.order_number
 *   page?          1-indexed (default 1)
 *   page_size?     default 50, max 200
 *   log_id?        return the one row with this id (for row expansion)
 *                  — includes the generated email_messages in the response
 *
 * Response:
 *   { rows: [...], total: N, page, page_size }
 */

const READ_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const VALID_OUTCOMES = new Set([
  'fired',
  'skipped',
  'deduped',
  'errored',
  'disabled',
]);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, READ_PERMS, res)) return;

  const svc = getServiceClient();

  const {
    from,
    to,
    outcome,
    trigger_id: triggerId,
    load_search: loadSearch,
    page: pageParam,
    page_size: pageSizeParam,
    log_id: logId,
  } = req.query;

  // ── Single-row expansion path ──
  if (logId && typeof logId === 'string') {
    const { data: row, error } = await svc
      .from('email_trigger_log')
      .select(
        `
          *,
          trigger:email_template_triggers(id, name, trigger_kind, event_name),
          template:email_templates(id, name),
          load:orders(id, order_number, status)
        `
      )
      .eq('id', logId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Log entry not found' });

    // Fetch any email_messages created by this fire
    const { data: messages } = await svc
      .from('email_messages')
      .select(
        'id, to_addresses, cc_addresses, bcc_addresses, from_address, from_name, subject, status, provider, provider_message_id, body_html, body_text, created_at'
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('trigger_id', row.trigger_id)
      .eq('load_id', row.load_id)
      // Window messages to +/- 1 minute of the fire so we don't pick up
      // unrelated sends that happen to match the same trigger/load.
      .gte('created_at', new Date(new Date(row.fired_at).getTime() - 60_000).toISOString())
      .lte('created_at', new Date(new Date(row.fired_at).getTime() + 60_000).toISOString())
      .order('created_at', { ascending: true });

    return res.status(200).json({ row, messages: messages || [] });
  }

  // ── Pagination + filters ──
  const page = Math.max(1, parseInt(pageParam, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeParam, 10) || 50));
  const offset = (page - 1) * pageSize;

  const outcomeList = (outcome ? String(outcome).split(',') : [])
    .map((o) => o.trim())
    .filter((o) => VALID_OUTCOMES.has(o));

  let query = svc
    .from('email_trigger_log')
    .select(
      `
        id, fired_at, outcome, outcome_detail, event_name, fire_key,
        messages_created, umbrella_decisions, trigger_id, template_id, load_id,
        trigger:email_template_triggers(id, name, trigger_kind, event_name),
        template:email_templates(id, name),
        load:orders(id, order_number, status)
      `,
      { count: 'exact' }
    )
    .eq('tenant_id', ctx.tenantId)
    .order('fired_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (from) query = query.gte('fired_at', String(from));
  if (to) query = query.lte('fired_at', String(to));
  if (outcomeList.length > 0) query = query.in('outcome', outcomeList);
  if (triggerId && typeof triggerId === 'string') {
    query = query.eq('trigger_id', triggerId);
  }

  const { data: rows, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Optional client-side order_number filter — we can't do this in SQL
  // easily because of the join, so we filter the returned page. Good
  // enough for Phase 1 where the activity log is usually small.
  let finalRows = rows || [];
  if (loadSearch && typeof loadSearch === 'string' && loadSearch.trim()) {
    const needle = loadSearch.trim().toLowerCase();
    finalRows = finalRows.filter((r) =>
      (r.load?.order_number || '').toLowerCase().includes(needle)
    );
  }

  return res.status(200).json({
    rows: finalRows,
    total: count || 0,
    page,
    page_size: pageSize,
  });
}
