import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/emails/triggers
 *
 * GET — flat list of all email_template_triggers for the tenant, with
 *       the owning template name joined. Used by the Trigger Activity
 *       page's filter dropdown.
 *
 * Triggers are also addressable under
 * /api/tenant/emails/templates/[id]/triggers (the template-scoped list),
 * but that route can't answer "show me every trigger in the tenant" in
 * a single call. This endpoint fills that gap.
 */

const READ_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, READ_PERMS, res)) return;

  const svc = getServiceClient();

  const { data: triggers, error } = await svc
    .from('email_template_triggers')
    .select(
      'id, name, trigger_kind, event_name, is_active, dedupe_window_seconds, template:email_templates(id, name, is_active)'
    )
    .eq('tenant_id', ctx.tenantId)
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ triggers: triggers || [] });
}
