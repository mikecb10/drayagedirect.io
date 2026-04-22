import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/charge-profiles/[id]
 *
 * GET    — single profile with versions + tiers
 * PUT    — update profile + replace versions/tiers
 * DELETE — soft delete
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    // Try with versions, fall back if migration 030 not applied
    let data, error;
    const result1 = await svc
      .from('charge_profiles')
      .select(`*, versions:charge_profile_versions(*, tiers:charge_profile_tiers(*)), tiers:charge_profile_tiers(*)`)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .single();
    data = result1.data;
    error = result1.error;

    if (error && error.message?.includes('charge_profile_versions')) {
      const result2 = await svc
        .from('charge_profiles')
        .select(`*, tiers:charge_profile_tiers(*)`)
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .single();
      data = result2.data;
      error = result2.error;
    }

    if (error || !data) return res.status(404).json({ error: 'Profile not found' });
    return res.status(200).json({ profile: data });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};
    const updates = {};
    // Core fields that always exist
    const coreFields = [
      'name', 'charge_name', 'description', 'tag', 'unit_of_measure',
      'auto_add', 'is_dry_run', 'effective_date_basis', 'calculation_mode',
      'conditions', 'match_resolution', 'is_enabled',
    ];
    for (const f of coreFields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    // New fields from migration 030 — only include if present to avoid schema cache errors
    if (body.percentage_based_on !== undefined) updates.percentage_based_on = body.percentage_based_on;
    if (body.tags !== undefined) updates.tags = body.tags;
    // Keep legacy tag field in sync
    if (body.tags?.length > 0 && !body.tag) {
      updates.tag = body.tags[0];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await svc
      .from('charge_profiles')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Replace versions + tiers if provided
    if (body.versions) {
      // Delete old tiers first (always exists)
      await svc.from('charge_profile_tiers').delete().eq('charge_profile_id', id);
      // Try deleting versions (may not exist if migration 030 not applied)
      try { await svc.from('charge_profile_versions').delete().eq('charge_profile_id', id); } catch {}

      let useVersions = true;
      for (const v of body.versions) {
        if (useVersions) {
          const { data: version, error: vErr } = await svc
            .from('charge_profile_versions')
            .insert({
              charge_profile_id: id,
              label: v.label || null,
              effective_from: v.effective_from || null,
              effective_to: v.effective_to || null,
            sort_order: 0,
          })
          .select()
          .single();

          if (vErr) {
            useVersions = false;
          } else if (v.rows?.length > 0) {
            const tierRows = v.rows.map((t) => buildTierRow(id, version.id, t));
            await svc.from('charge_profile_tiers').insert(tierRows);
            continue;
          }
        }

        // Fallback: flat tiers without version_id
        if (v.rows?.length > 0) {
          const tierRows = v.rows.map((t) => ({
            charge_profile_id: id,
            start_date: v.effective_from || null,
            end_date: v.effective_to || null,
            version_label: v.label || null,
            amount_cents: t.amount_cents || 0,
            minimum_amount_cents: t.minimum_amount_cents || 0,
            free_units: t.free_units || 0,
            from_status: t.from_status || null,
            to_status: t.to_status || null,
            pickup_location_id: t.origin_id || t.pickup_location_id || null,
            delivery_location_id: t.dest_id || t.delivery_location_id || null,
            event_type: t.event_type || null,
            move_index: t.move_index ?? null,
          }));
          await svc.from('charge_profile_tiers').insert(tierRows);
        }
      }
    }

    // Ensure any new tags are saved (skip if table doesn't exist)
    try { await ensureTags(svc, ctx.tenantId, body.tags || []); } catch {}

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'charge_profile.update',
      entityType: 'charge_profile',
      entityId: id,
      newValues: updates,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ profile: data });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const { error } = await svc
      .from('charge_profiles')
      .update({ is_enabled: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'charge_profile.delete',
      entityType: 'charge_profile',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/** Build a tier row for insertion */
function buildTierRow(profileId, versionId, t) {
  return {
    charge_profile_id: profileId,
    version_id: versionId || null,
    amount_cents: t.amount_cents || 0,
    minimum_amount_cents: t.minimum_amount_cents || 0,
    free_units: t.free_units || 0,
    from_status: t.from_status || null,
    to_status: t.to_status || null,
    pickup_location_id: t.origin_id || t.pickup_location_id || null,
    delivery_location_id: t.dest_id || t.delivery_location_id || null,
    return_location_id: t.return_location_id || null,
    origin_type: t.origin_type || 'org',
    origin_value: t.origin_value || null,
    dest_type: t.dest_type || 'org',
    dest_value: t.dest_value || null,
    event_type: t.event_type || null,
    event_location_id: t.event_location_id || null,
    event_location_type: t.event_location_type || null,
    event_location_value: t.event_location_value || null,
    move_events: t.move_events || [],
    move_calc_from: t.move_calc_from || null,
    move_calc_to: t.move_calc_to || null,
    radius_tiers: t.radius_tiers || [],
    move_index: t.move_index ?? null,
    version_label: null,
    start_date: null,
    end_date: null,
  };
}

/** Upsert tags into the tenant-global tags table */
async function ensureTags(svc, tenantId, tags) {
  if (!tags || tags.length === 0) return;
  for (const name of tags) {
    await svc
      .from('charge_profile_tags')
      .upsert({ tenant_id: tenantId, name }, { onConflict: 'tenant_id,name' })
      .select();
  }
}
