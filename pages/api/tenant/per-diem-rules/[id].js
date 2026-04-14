import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

const EDITABLE_FIELDS = [
  'name',
  'customer_id',
  'container_owner_id',
  'container_type_id',
  'load_type',
  'include_holidays',
  'include_weekends',
  'is_enabled',
  'notes',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
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

    const { data, error } = await svc
      .from('per_diem_rules')
      .select(
        `*,
         customer:customers!per_diem_rules_customer_id_fkey(id, name),
         owner:container_owners!per_diem_rules_container_owner_id_fkey(id, name, label, scac_code),
         container_type:container_types!per_diem_rules_container_type_id_fkey(id, code, label),
         tiers:per_diem_rule_tiers(id, from_day, to_day, amount_cents, sequence)`
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: 'Rule not found' });
    data.tiers = (data.tiers || []).sort((a, b) => a.sequence - b.sequence);
    return res.status(200).json({ rule: data });
  }

  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.SETTINGS, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const body = req.body || {};

    const updates = {};
    for (const f of EDITABLE_FIELDS) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const { data: oldRule } = await svc
      .from('per_diem_rules')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .maybeSingle();
    if (!oldRule) return res.status(404).json({ error: 'Rule not found' });

    const { data: rule, error: updErr } = await svc
      .from('per_diem_rules')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select()
      .single();
    if (updErr) return res.status(500).json({ error: updErr.message });

    // Replace tiers if provided
    if (Array.isArray(body.tiers)) {
      if (body.tiers.length === 0) {
        return res.status(400).json({ error: 'At least one tier is required' });
      }
      // Delete existing tiers
      await svc
        .from('per_diem_rule_tiers')
        .delete()
        .eq('tenant_id', ctx.tenantId)
        .eq('rule_id', id);
      // Insert new tiers
      const tierRows = body.tiers.map((t, idx) => ({
        tenant_id: ctx.tenantId,
        rule_id: id,
        from_day: parseInt(t.from_day, 10) || 1,
        to_day: t.to_day ? parseInt(t.to_day, 10) : null,
        amount_cents: parseInt(t.amount_cents, 10) || 0,
        sequence: idx,
      }));
      const { error: tErr } = await svc.from('per_diem_rule_tiers').insert(tierRows);
      if (tErr) return res.status(500).json({ error: tErr.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'per_diem_rule.update',
      entityType: 'per_diem_rule',
      entityId: id,
      oldValues: oldRule,
      newValues: rule,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ rule });
  }

  if (req.method === 'DELETE') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.SETTINGS, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { error } = await svc
      .from('per_diem_rules')
      .update({ deleted_at: new Date().toISOString(), is_enabled: false })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'per_diem_rule.delete',
      entityType: 'per_diem_rule',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
