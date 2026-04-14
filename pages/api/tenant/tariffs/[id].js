import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

const EDITABLE_FIELDS = [
  'name', 'status', 'effective_start', 'effective_end', 'matching_mode',
  'route_template', 'load_types', 'customer_ids',
  'pickup_conditions', 'delivery_conditions', 'return_conditions',
  'container_type', 'container_size', 'ssl_id', 'csr_user_id',
  'chassis_type', 'chassis_size', 'chassis_owner', 'priority',
  // Flags
  'is_hazmat', 'is_overweight', 'is_liquor', 'is_hot', 'is_genset',
  'is_overheight', 'is_scale', 'is_ev', 'is_street_turn',
  'is_oog', 'is_bonded', 'is_double', 'is_tanker',
];

/**
 * /api/tenant/tariffs/[id]
 *
 * GET    — single tariff with charge sets
 * PUT    — update tariff fields
 * DELETE — soft delete
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('tariffs')
      .select(`
        *,
        charge_sets:tariff_charge_sets(
          *,
          profiles:tariff_charge_set_profiles(
            *,
            charge_profile:charge_profiles(id, name, charge_name, unit_of_measure, tag, tags)
          ),
          items:tariff_charge_items(*),
          tags:tariff_charge_set_tags(*)
        )
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Tariff not found' });
    return res.status(200).json({ tariff: data });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};
    const updates = {};
    for (const f of EDITABLE_FIELDS) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await svc
      .from('tariffs')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'tariff.update',
      entityType: 'tariff',
      entityId: id,
      newValues: updates,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ tariff: data });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const { error } = await svc
      .from('tariffs')
      .update({ is_enabled: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'tariff.delete',
      entityType: 'tariff',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
