import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';
import { validateAdvancedRoute } from '../../../../lib/advanced-route-validator';

/**
 * /api/tenant/tariffs
 *
 * GET  — list all load tariffs for the tenant
 * POST — create a new tariff
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { search, status, load_type } = req.query;

    let query = svc
      .from('tariffs')
      .select(`
        *,
        charge_sets:tariff_charge_sets(
          *,
          profiles:tariff_charge_set_profiles(
            *,
            charge_profile:charge_profiles(id, name, charge_name)
          ),
          items:tariff_charge_items(*)
        )
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('is_enabled', true)
      .order('priority', { ascending: false })
      .order('name', { ascending: true });

    if (search) {
      query = query.or(`name.ilike.%${search}%`);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ tariffs: data || [] });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};
    if (!body.name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Validate advanced_route BEFORE inserting the tariff row so we
    // never persist an orphan tariff with matching_mode='advanced_route'
    // but no matching advanced_route row. Cross-field check: if the
    // caller asked for advanced mode, they must supply a valid route.
    if (body.matching_mode === 'advanced_route' && !body.advanced_route) {
      return res.status(400).json({ error: 'advanced_route is required when matching_mode=advanced_route', step: 'validate_advanced_route' });
    }
    if (body.advanced_route) {
      const v = validateAdvancedRoute(body.advanced_route);
      if (!v.ok) return res.status(400).json({ error: v.error, step: 'validate_advanced_route' });
    }

    const { data: tariff, error } = await svc
      .from('tariffs')
      .insert({
        tenant_id: ctx.tenantId,
        name: body.name,
        status: body.status || 'draft',
        effective_start: body.effective_start || null,
        effective_end: body.effective_end || null,
        matching_mode: body.matching_mode || 'basic',
        load_types: body.load_types || [],
        customer_ids: body.customer_ids || [],
        pickup_conditions: body.pickup_conditions || { all: true },
        delivery_conditions: body.delivery_conditions || { all: true },
        return_conditions: body.return_conditions || {},
        container_type: body.container_type || null,
        container_size: body.container_size || null,
        ssl_id: body.ssl_id || null,
        csr_user_id: body.csr_user_id || null,
        chassis_type: body.chassis_type || null,
        chassis_size: body.chassis_size || null,
        chassis_owner: body.chassis_owner || null,
        // Flags
        is_hazmat: body.is_hazmat ?? null,
        is_overweight: body.is_overweight ?? null,
        is_liquor: body.is_liquor ?? null,
        is_hot: body.is_hot ?? null,
        is_genset: body.is_genset ?? null,
        is_overheight: body.is_overheight ?? null,
        is_scale: body.is_scale ?? null,
        is_ev: body.is_ev ?? null,
        is_street_turn: body.is_street_turn ?? null,
        is_oog: body.is_oog ?? null,
        is_bonded: body.is_bonded ?? null,
        is_double: body.is_double ?? null,
        is_tanker: body.is_tanker ?? null,
        priority: body.priority || 0,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Insert advanced_route row. Already validated above before the
    // tariff row insert, so no second validation needed.
    if (body.advanced_route) {
      const { error: arErr } = await svc.from('tariff_advanced_routes').insert({
        tenant_id: ctx.tenantId,
        tariff_id: tariff.id,
        routing_template_id: body.advanced_route.routing_template_id || null,
        moves: body.advanced_route.moves,
      });
      if (arErr) return res.status(500).json({ error: arErr.message, step: 'insert_advanced_route' });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'tariff.create',
      entityType: 'tariff',
      entityId: tariff.id,
      newValues: { name: tariff.name, status: tariff.status },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ tariff });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
