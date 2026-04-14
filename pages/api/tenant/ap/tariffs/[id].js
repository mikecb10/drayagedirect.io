import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const EDITABLE_FIELDS = [
  'name', 'status', 'driver_group_id', 'priority',
  'effective_start', 'effective_end', 'matching_mode',
  'load_types', 'pickup_conditions', 'delivery_conditions', 'return_conditions',
  'container_type', 'container_size', 'ssl_id',
  'chassis_type', 'chassis_size', 'chassis_owner',
  'is_hazmat', 'is_overweight', 'is_overheight', 'is_liquor',
  'is_hot', 'is_genset', 'is_scale', 'is_ev',
  'is_street_turn', 'is_oog', 'is_bonded', 'is_double', 'is_tanker',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('driver_tariffs')
      .select(`
        *,
        driver_group:driver_groups(id, name),
        charge_sets:driver_tariff_charge_sets(
          id, pay_to_mode, pay_to_driver_id, notes,
          profiles:driver_tariff_charge_set_profiles(
            id,
            charge_profile:driver_charge_profiles(id, name, charge_name, unit_of_measure, calculation_mode,
              versions:driver_charge_profile_versions(id, label, effective_from, effective_to,
                tiers:driver_charge_profile_tiers(*)
              )
            )
          )
        )
      `)
      .eq('id', id).eq('tenant_id', ctx.tenantId).single();
    if (error || !data) return res.status(404).json({ error: 'Tariff not found' });
    return res.status(200).json({ tariff: data });
  }

  if (req.method === 'PUT') {
    const body = req.body || {};
    const updates = {};
    for (const f of EDITABLE_FIELDS) {
      if (f in body) updates[f] = body[f];
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await svc.from('driver_tariffs').update(updates)
        .eq('id', id).eq('tenant_id', ctx.tenantId);
      if (error) return res.status(500).json({ error: error.message });
    }

    // Manage charge sets if provided
    if (Array.isArray(body.charge_sets)) {
      // Delete existing
      await svc.from('driver_tariff_charge_sets').delete()
        .eq('tariff_id', id).eq('tenant_id', ctx.tenantId);

      for (const cs of body.charge_sets) {
        const { data: csRow } = await svc.from('driver_tariff_charge_sets').insert({
          tenant_id: ctx.tenantId,
          tariff_id: id,
          pay_to_mode: cs.pay_to_mode || 'load_driver',
          pay_to_driver_id: cs.pay_to_driver_id || null,
          notes: cs.notes || null,
        }).select().single();

        if (csRow && Array.isArray(cs.profile_ids)) {
          await svc.from('driver_tariff_charge_set_profiles').insert(
            cs.profile_ids.map((pid) => ({
              charge_set_id: csRow.id,
              driver_charge_profile_id: pid,
            }))
          );
        }
      }
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'driver_tariff.update', entityType: 'driver_tariff', entityId: id,
      newValues: updates, ipAddress: getClientIp(req),
    });
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    await svc.from('driver_tariffs').update({ is_enabled: false })
      .eq('id', id).eq('tenant_id', ctx.tenantId);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
