import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * Per Diem Rules — list + create
 *
 * GET /api/tenant/per-diem-rules?customer_id=...&container_owner_id=...&load_type=...
 *   Returns rules (with their tiers) scoped to the tenant.
 *
 * POST /api/tenant/per-diem-rules
 *   Body: { name, customer_id, container_owner_id, container_type_id, load_type,
 *           include_holidays, include_weekends, notes, tiers: [{from_day, to_day, amount_cents}] }
 */

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.SETTINGS, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { customer_id, container_owner_id, container_type_id, load_type, enabled } =
      req.query;

    let query = svc
      .from('per_diem_rules')
      .select(
        `*,
         customer:customers!per_diem_rules_customer_id_fkey(id, name),
         owner:container_owners!per_diem_rules_container_owner_id_fkey(id, name, label, scac_code),
         container_type:container_types!per_diem_rules_container_type_id_fkey(id, code, label),
         tiers:per_diem_rule_tiers(id, from_day, to_day, amount_cents, sequence)`
      )
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (customer_id) query = query.eq('customer_id', customer_id);
    if (container_owner_id) query = query.eq('container_owner_id', container_owner_id);
    if (container_type_id) query = query.eq('container_type_id', container_type_id);
    if (load_type) query = query.eq('load_type', load_type);
    if (enabled === 'true') query = query.eq('is_enabled', true);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Sort tiers by sequence for each rule
    const rules = (data || []).map((r) => ({
      ...r,
      tiers: (r.tiers || []).sort((a, b) => a.sequence - b.sequence),
    }));

    return res.status(200).json({ rules });
  }

  if (req.method === 'POST') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.SETTINGS, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const body = req.body || {};
    const tiers = Array.isArray(body.tiers) ? body.tiers : [];
    if (tiers.length === 0) {
      return res.status(400).json({ error: 'At least one tier is required' });
    }

    // Insert the rule
    const { data: rule, error: ruleErr } = await svc
      .from('per_diem_rules')
      .insert({
        tenant_id: ctx.tenantId,
        name: body.name || null,
        customer_id: body.customer_id || null,
        container_owner_id: body.container_owner_id || null,
        container_type_id: body.container_type_id || null,
        load_type: body.load_type || null,
        include_holidays: body.include_holidays ?? true,
        include_weekends: body.include_weekends ?? true,
        is_enabled: body.is_enabled ?? true,
        notes: body.notes || null,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (ruleErr) return res.status(500).json({ error: ruleErr.message });

    // Insert tiers
    const tierRows = tiers.map((t, idx) => ({
      tenant_id: ctx.tenantId,
      rule_id: rule.id,
      from_day: parseInt(t.from_day, 10) || 1,
      to_day: t.to_day ? parseInt(t.to_day, 10) : null,
      amount_cents: parseInt(t.amount_cents, 10) || 0,
      sequence: idx,
    }));
    const { error: tierErr } = await svc.from('per_diem_rule_tiers').insert(tierRows);
    if (tierErr) return res.status(500).json({ error: tierErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'per_diem_rule.create',
      entityType: 'per_diem_rule',
      entityId: rule.id,
      newValues: { name: rule.name, tier_count: tiers.length },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ rule });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
