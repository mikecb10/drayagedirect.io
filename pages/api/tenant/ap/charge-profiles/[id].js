import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const EDITABLE_FIELDS = [
  'name', 'charge_name', 'description', 'driver_group_id',
  'unit_of_measure', 'percentage_based_on', 'percentage_charge_code', 'effective_date_basis',
  'calculation_mode', 'auto_add', 'conditions', 'match_resolution', 'is_enabled',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('driver_charge_profiles')
      .select(`
        *,
        driver_group:driver_groups(id, name),
        versions:driver_charge_profile_versions(
          id, label, effective_from, effective_to, sort_order,
          tiers:driver_charge_profile_tiers(*)
        )
      `)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Profile not found' });
    return res.status(200).json({ profile: data });
  }

  if (req.method === 'PUT') {
    const body = req.body || {};
    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await svc.from('driver_charge_profiles').update(updates)
        .eq('id', id).eq('tenant_id', ctx.tenantId);
      if (error) return res.status(500).json({ error: error.message });
    }

    // Replace versions + tiers if provided.
    //
    // Error-handling contract (2026-04-15 fix):
    //
    //   1. Validate that every version has an array of rows BEFORE any
    //      destructive delete. If the UI sends a malformed payload
    //      (e.g. versions[].tiers instead of versions[].rows, or no rows
    //      at all), we'd otherwise wipe existing tiers and fail to
    //      recreate them. Reject up front instead.
    //   2. Capture any version / tier insert error and 500 with the
    //      underlying reason so the UI surfaces it. Previously these
    //      errors were swallowed, producing the "edit-wiped-my-tiers"
    //      bug Cowork caught during Plan B verification.
    //
    // NB: Plan D candidate — wrap the whole delete+insert sequence in
    // a Postgres function or use an RPC transaction so partial failures
    // can't leave the profile in a half-state.
    if (Array.isArray(body.versions)) {
      // Pre-validate: every version MUST include a rows array. Empty is
      // allowed (delete-only), but missing/malformed is a 400.
      for (let i = 0; i < body.versions.length; i++) {
        const ver = body.versions[i];
        if (!Array.isArray(ver?.rows)) {
          return res.status(400).json({
            error: `versions[${i}].rows must be an array (received ${typeof ver?.rows})`,
          });
        }
      }

      // Delete old versions (cascades to tiers)
      const { error: delError } = await svc
        .from('driver_charge_profile_versions')
        .delete()
        .eq('driver_charge_profile_id', id);

      if (delError) {
        return res.status(500).json({ error: `version delete failed: ${delError.message}` });
      }

      for (let i = 0; i < body.versions.length; i++) {
        const ver = body.versions[i];
        const { data: version, error: verError } = await svc
          .from('driver_charge_profile_versions')
          .insert({
            driver_charge_profile_id: id,
            label: ver.label || `Version ${i + 1}`,
            effective_from: ver.effective_from || null,
            effective_to: ver.effective_to || null,
            sort_order: i,
          })
          .select().single();

        if (verError || !version) {
          return res.status(500).json({
            error: `version insert failed: ${verError?.message || 'unknown'}`,
          });
        }

        if (ver.rows.length > 0) {
          const { error: tierError } = await svc.from('driver_charge_profile_tiers').insert(
            ver.rows.map((row) => ({
              tenant_id: ctx.tenantId,
              driver_charge_profile_id: id,
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
            return res.status(500).json({ error: `tier insert failed: ${tierError.message}` });
          }
        }
      }
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'driver_charge_profile.update', entityType: 'driver_charge_profile', entityId: id,
      newValues: updates, ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    await svc.from('driver_charge_profiles')
      .update({ deleted_at: new Date().toISOString(), is_enabled: false })
      .eq('id', id).eq('tenant_id', ctx.tenantId);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
