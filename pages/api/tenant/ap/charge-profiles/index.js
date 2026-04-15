import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/ap/charge-profiles
 *
 * GET  — list driver charge profiles with nested versions + tiers
 * POST — create a new driver charge profile with versions + tiers
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { search, charge_name, driver_group_id, enabled } = req.query;

    let query = svc
      .from('driver_charge_profiles')
      .select(`
        *,
        driver_group:driver_groups(id, name),
        versions:driver_charge_profile_versions(
          id, label, effective_from, effective_to, sort_order,
          tiers:driver_charge_profile_tiers(*)
        )
      `)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('name');

    if (search) query = query.ilike('name', `%${search}%`);
    if (charge_name) query = query.eq('charge_name', charge_name);
    if (driver_group_id) query = query.eq('driver_group_id', driver_group_id);
    if (enabled === 'true') query = query.eq('is_enabled', true);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ profiles: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'Name is required' });
    if (!body.charge_name) return res.status(400).json({ error: 'Charge name is required' });

    // Create profile
    const { data: profile, error: profError } = await svc
      .from('driver_charge_profiles')
      .insert({
        tenant_id: ctx.tenantId,
        name: body.name,
        charge_name: body.charge_name,
        description: body.description || null,
        driver_group_id: body.driver_group_id || null,
        unit_of_measure: body.unit_of_measure || 'fixed',
        percentage_based_on: body.percentage_based_on || null,
        percentage_charge_code: body.percentage_charge_code || null,
        effective_date_basis: body.effective_date_basis || null,
        calculation_mode: body.calculation_mode || 'by_event',
        auto_add: body.auto_add || false,
        conditions: body.conditions || [],
        match_resolution: body.match_resolution || 'first_match_wins',
      })
      .select()
      .single();

    if (profError) return res.status(500).json({ error: profError.message });

    // Create versions + tiers.
    //
    // Error-handling contract: a tier insert failure (FK violation, RLS,
    // schema mismatch) must NOT be silent. Previous behavior swallowed
    // the error and left the profile with no tiers — producing the
    // "profile exists but the engine never matches" symptom Cowork
    // caught during Plan B verification (2026-04-15). If any tier
    // insert fails, we roll back the profile + version inserts and
    // return 500 with the underlying Supabase error so the UI knows.
    const rollback = async (reason) => {
      try {
        await svc.from('driver_charge_profiles').delete().eq('id', profile.id);
      } catch { /* best effort; profile row may already be gone */ }
      return res.status(500).json({ error: reason });
    };

    if (Array.isArray(body.versions)) {
      for (let i = 0; i < body.versions.length; i++) {
        const ver = body.versions[i];
        const { data: version, error: verError } = await svc
          .from('driver_charge_profile_versions')
          .insert({
            driver_charge_profile_id: profile.id,
            label: ver.label || `Version ${i + 1}`,
            effective_from: ver.effective_from || null,
            effective_to: ver.effective_to || null,
            sort_order: i,
          })
          .select()
          .single();

        if (verError) {
          return rollback(`version insert failed: ${verError.message}`);
        }

        // Insert tiers for this version
        if (Array.isArray(ver.rows) && ver.rows.length > 0) {
          const { error: tierError } = await svc.from('driver_charge_profile_tiers').insert(
            ver.rows.map((row) => ({
              tenant_id: ctx.tenantId,
              driver_charge_profile_id: profile.id,
              version_id: version.id,
              amount_cents: row.amount_cents || 0,
              minimum_amount_cents: row.minimum_amount_cents || 0,
              free_units: row.free_units || 0,
              event_type: row.event_type || null,
              event_time: row.event_time || null,
              event_location_id: row.event_location_id || null,
              event_location_type: row.event_location_type || null,
              event_location_value: row.event_location_value || null,
              event_location_meta: row.event_location_meta || null,
              move_index: row.move_index || null,
              move_events: row.move_events || [],
              move_calc_from: row.move_calc_from || null,
              move_calc_to: row.move_calc_to || null,
              leg_from: row.leg_from || null,
              leg_from_location_id: row.leg_from_location_id || null,
              leg_from_location_type: row.leg_from_location_type || null,
              leg_from_location_value: row.leg_from_location_value || null,
              leg_from_location_meta: row.leg_from_location_meta || null,
              leg_to: row.leg_to || null,
              leg_to_location_id: row.leg_to_location_id || null,
              leg_to_location_type: row.leg_to_location_type || null,
              leg_to_location_value: row.leg_to_location_value || null,
              leg_to_location_meta: row.leg_to_location_meta || null,
              // Multi-select arrays (migration 071)
              leg_from_types: row.leg_from_types || null,
              leg_to_types: row.leg_to_types || null,
              // Between Statuses (migration 071)
              status_from: row.status_from || null,
              status_to: row.status_to || null,
              radius_tiers: row.radius_tiers || [],
            }))
          );

          if (tierError) {
            return rollback(`tier insert failed: ${tierError.message}`);
          }
        }
      }
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'driver_charge_profile.create', entityType: 'driver_charge_profile', entityId: profile.id,
      newValues: { name: profile.name, charge_name: profile.charge_name },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ profile });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
