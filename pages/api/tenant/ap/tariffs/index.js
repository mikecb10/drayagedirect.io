import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { validateAdvancedRoute } from '../../../../../lib/advanced-route-validator';

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
            id, driver_charge_profile_id,
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

    if (body.advanced_route) {
      const v = validateAdvancedRoute(body.advanced_route);
      if (!v.ok) return res.status(400).json({ error: v.error, step: 'validate_advanced_route' });
      const { error: arErr } = await svc.from('driver_tariff_advanced_routes').insert({
        tenant_id: ctx.tenantId,
        driver_tariff_id: data.id,
        routing_template_id: body.advanced_route.routing_template_id || null,
        moves: body.advanced_route.moves,
      });
      if (arErr) return res.status(500).json({ error: arErr.message, step: 'insert_advanced_route' });
    }

    // Create charge sets + profile links on initial create too. Accepts
    // both { profile_ids: [...] } and { profiles: [{ charge_profile_id, ... }] }
    // payload shapes so client and API can evolve independently.
    //
    // Errors from the charge_sets insert path bail with 500 + step so we
    // don't end up with a tariff that claims success but has no linked
    // profiles — that failure mode is invisible and confusing.
    if (Array.isArray(body.charge_sets) && body.charge_sets.length > 0) {
      for (const cs of body.charge_sets) {
        const { data: csRow, error: csErr } = await svc.from('driver_tariff_charge_sets').insert({
          tenant_id: ctx.tenantId,
          tariff_id: data.id,
          pay_to_mode: cs.pay_to_mode || 'load_driver',
          pay_to_driver_id: cs.pay_to_driver_id || null,
          notes: cs.notes || null,
        }).select().single();
        if (csErr) return res.status(500).json({ error: csErr.message, step: 'insert_charge_set', pay_to_mode: cs.pay_to_mode });
        if (!csRow) continue;

        const profileIds = Array.isArray(cs.profile_ids) && cs.profile_ids.length > 0
          ? cs.profile_ids
          : Array.isArray(cs.profiles)
            ? cs.profiles.map((p) => p.charge_profile_id).filter(Boolean)
            : [];

        if (profileIds.length > 0) {
          const { error: jxErr } = await svc.from('driver_tariff_charge_set_profiles').insert(
            profileIds.map((pid) => ({
              charge_set_id: csRow.id,
              driver_charge_profile_id: pid,
            }))
          );
          if (jxErr) return res.status(500).json({ error: jxErr.message, step: 'insert_junction', profile_ids: profileIds });
        }
      }
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'driver_tariff.create', entityType: 'driver_tariff', entityId: data.id,
      newValues: { name: data.name }, ipAddress: getClientIp(req),
    });
    return res.status(201).json({ tariff: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
