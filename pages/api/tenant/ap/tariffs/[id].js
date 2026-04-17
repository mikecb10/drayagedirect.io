import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { validateAdvancedRoute } from '../../../../../lib/advanced-route-validator';

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
        advanced_route:driver_tariff_advanced_routes(
          id, routing_template_id, moves
        ),
        charge_sets:driver_tariff_charge_sets(
          id, pay_to_mode, pay_to_driver_id, notes,
          profiles:driver_tariff_charge_set_profiles(
            id, driver_charge_profile_id,
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

    if (Array.isArray(data.advanced_route)) {
      data.advanced_route = data.advanced_route[0] || null;
    }

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

    // Cross-field guard: can't switch to advanced_route mode in this
    // PUT without also providing a route.
    if (body.matching_mode === 'advanced_route' && !body.advanced_route) {
      return res.status(400).json({ error: 'advanced_route is required when matching_mode=advanced_route', step: 'validate_advanced_route' });
    }

    // Upsert advanced_route if present.
    //   null -> delete; object -> validate + upsert; absent -> no-op
    if ('advanced_route' in body) {
      const ar = body.advanced_route;
      if (ar === null) {
        const { error: delErr } = await svc.from('driver_tariff_advanced_routes').delete()
          .eq('driver_tariff_id', id).eq('tenant_id', ctx.tenantId);
        if (delErr) return res.status(500).json({ error: delErr.message, step: 'delete_advanced_route' });
      } else {
        const v = validateAdvancedRoute(ar);
        if (!v.ok) return res.status(400).json({ error: v.error, step: 'validate_advanced_route' });
        const { error: upErr } = await svc.from('driver_tariff_advanced_routes').upsert({
          tenant_id: ctx.tenantId,
          driver_tariff_id: id,
          routing_template_id: ar.routing_template_id || null,
          moves: ar.moves,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_tariff_id' });
        if (upErr) return res.status(500).json({ error: upErr.message, step: 'upsert_advanced_route' });
      }
    }

    // Manage charge sets if provided. Accepts two equivalent payload
    // shapes for the profile list:
    //   - cs.profile_ids: ['uuid', 'uuid']
    //   - cs.profiles:    [{ charge_profile_id: 'uuid', ... }]
    // Client pages settled on the latter; older code used the former.
    //
    // IMPORTANT: Every DB write below captures its error object — silent
    // failures here are how we ended up with "save returns 200 but no
    // charge_sets persisted." If anything fails, bail with 500 and the
    // specific step, so the frontend shows something actionable instead
    // of a cheerful success with zero data.
    if (Array.isArray(body.charge_sets)) {
      // Delete existing
      const { error: delErr } = await svc.from('driver_tariff_charge_sets').delete()
        .eq('tariff_id', id).eq('tenant_id', ctx.tenantId);
      if (delErr) return res.status(500).json({ error: delErr.message, step: 'delete_charge_sets' });

      for (const cs of body.charge_sets) {
        const { data: csRow, error: csErr } = await svc.from('driver_tariff_charge_sets').insert({
          tenant_id: ctx.tenantId,
          tariff_id: id,
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
