import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/charge-profiles
 *
 * GET  — list all charge profiles for the tenant (with versions + tiers)
 * POST — create a new charge profile (with versions + tiers)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { search, charge_name, tag, enabled } = req.query;

    // Try with versions table first, fall back to tiers-only if migration 030 not applied
    let data, error;
    try {
      const result = await svc
        .from('charge_profiles')
        .select(`*, versions:charge_profile_versions(*, tiers:charge_profile_tiers(*)), tiers:charge_profile_tiers(*)`)
        .eq('tenant_id', ctx.tenantId)
        .eq('is_enabled', true)
        .order('name', { ascending: true });
      data = result.data;
      error = result.error;
    } catch {}

    // Fallback: versions table doesn't exist yet
    if (error) {
      const result = await svc
        .from('charge_profiles')
        .select(`*, tiers:charge_profile_tiers(*)`)
        .eq('tenant_id', ctx.tenantId)
        .eq('is_enabled', true)
        .order('name', { ascending: true });
      data = result.data;
      error = result.error;
    }

    if (error) return res.status(500).json({ error: error.message });

    // Apply filters in-memory (since we can't chain after the fallback)
    let filtered = data || [];
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(q) || p.charge_name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    }
    if (charge_name) filtered = filtered.filter((p) => p.charge_name === charge_name);
    if (tag) filtered = filtered.filter((p) => (p.tags || []).includes(tag) || p.tag === tag);
    if (enabled === 'true') filtered = filtered.filter((p) => p.is_enabled !== false);

    return res.status(200).json({ profiles: filtered });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};
    if (!body.name || !body.charge_name) {
      return res.status(400).json({ error: 'Name and charge name are required' });
    }

    // Create the profile — only include new columns if they have values
    // (prevents errors if migrations 030+ haven't been applied yet)
    const insertRow = {
      tenant_id: ctx.tenantId,
      name: body.name,
      charge_name: body.charge_name,
      description: body.description || null,
      tag: (body.tags || [])[0] || body.tag || null,
      unit_of_measure: body.unit_of_measure || 'fixed',
      auto_add: body.auto_add ?? false,
      effective_date_basis: body.effective_date_basis || 'CURRENT_DATE',
      calculation_mode: body.calculation_mode || 'by_lane',
      conditions: body.conditions || [],
      match_resolution: body.match_resolution || 'first_match_wins',
    };
    // New columns from migration 030 — only include if non-empty
    if (body.percentage_based_on) insertRow.percentage_based_on = body.percentage_based_on;
    if (body.tags?.length > 0) insertRow.tags = body.tags;

    const { data: profile, error } = await svc
      .from('charge_profiles')
      .insert(insertRow)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Create versions + tiers (try versions table, fall back to flat tiers)
    if (body.versions?.length > 0) {
      let useVersions = true;
      for (const v of body.versions) {
        if (useVersions) {
          const { data: version, error: vErr } = await svc
            .from('charge_profile_versions')
            .insert({
              charge_profile_id: profile.id,
              label: v.label || null,
              effective_from: v.effective_from || null,
              effective_to: v.effective_to || null,
              sort_order: 0,
            })
            .select()
            .single();

          if (vErr) {
            // Versions table doesn't exist — fall back to flat tiers
            useVersions = false;
          } else if (v.rows?.length > 0) {
            const tierRows = v.rows.map((t) => buildTierRow(profile.id, version.id, t));
            await svc.from('charge_profile_tiers').insert(tierRows);
            continue;
          }
        }

        // Fallback: create flat tiers without version_id
        if (v.rows?.length > 0) {
          const tierRows = v.rows.map((t) => ({
            charge_profile_id: profile.id,
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

    // Ensure any new tags are saved to the tenant-global tags table
    await ensureTags(svc, ctx.tenantId, body.tags || []);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'charge_profile.create',
      entityType: 'charge_profile',
      entityId: profile.id,
      newValues: { name: profile.name, charge_name: profile.charge_name },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ profile });
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
    // Legacy fields
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
