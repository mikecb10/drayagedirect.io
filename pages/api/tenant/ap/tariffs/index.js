import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/ap/tariffs
 *
 * GET  — list driver tariffs with nested charge sets + profiles
 * POST — create a new driver tariff
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { search, status, driver_group_id } = req.query;

    let query = svc
      .from('driver_tariffs')
      .select(`
        *,
        driver_group:driver_groups(id, name),
        charge_sets:driver_tariff_charge_sets(
          id, pay_to_mode, notes,
          profiles:driver_tariff_charge_set_profiles(
            id,
            charge_profile:driver_charge_profiles(id, name, charge_name, unit_of_measure, calculation_mode)
          )
        )
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('is_enabled', true)
      .order('priority', { ascending: false })
      .order('name');

    if (search) query = query.ilike('name', `%${search}%`);
    if (status) query = query.eq('status', status);
    if (driver_group_id) query = query.eq('driver_group_id', driver_group_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tariffs: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'Name is required' });

    const insertData = {
      tenant_id: ctx.tenantId,
      name: body.name,
      status: body.status || 'draft',
      driver_group_id: body.driver_group_id || null,
      priority: body.priority || 0,
      effective_start: body.effective_start || null,
      effective_end: body.effective_end || null,
      matching_mode: body.matching_mode || 'basic',
      load_types: body.load_types || [],
      pickup_conditions: body.pickup_conditions || {},
      delivery_conditions: body.delivery_conditions || {},
      return_conditions: body.return_conditions || {},
      container_type: body.container_type || null,
      container_size: body.container_size || null,
      ssl_id: body.ssl_id || null,
      chassis_type: body.chassis_type || null,
      chassis_size: body.chassis_size || null,
      chassis_owner: body.chassis_owner || null,
      is_hazmat: body.is_hazmat || null,
      is_overweight: body.is_overweight || null,
      is_overheight: body.is_overheight || null,
      is_liquor: body.is_liquor || null,
      is_hot: body.is_hot || null,
      is_genset: body.is_genset || null,
      is_scale: body.is_scale || null,
      is_ev: body.is_ev || null,
      is_street_turn: body.is_street_turn || null,
      is_oog: body.is_oog || null,
      is_bonded: body.is_bonded || null,
      is_double: body.is_double || null,
      is_tanker: body.is_tanker || null,
    };

    const { data, error } = await svc.from('driver_tariffs').insert(insertData).select().single();
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'driver_tariff.create', entityType: 'driver_tariff', entityId: data.id,
      newValues: { name: data.name }, ipAddress: getClientIp(req),
    });
    return res.status(201).json({ tariff: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
