import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { findMatchingCharges } from '../../../../../lib/tariff-engine';

/**
 * AR charge-profile preview endpoint.
 *
 * Given a load and a charge_name code (e.g. DRY_RUN, LINE_HAUL), return
 * the hydrated prefill values for the winning charge profile on the
 * load's tariff(s). The Billing tab calls this when a dispatcher picks
 * a charge code from the Add Line dropdown.
 *
 * Returns 200 with the shaped profile payload if a matching profile
 * exists, 404 if no profile on any matching tariff has that charge_name.
 *
 * Reuses lib/tariff-engine.js's findMatchingCharges({ includeAutoAddFalse: true })
 * so we share one source of truth for "which profile wins" (tariff
 * specificity, condition evaluation, tier selection, version resolution).
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (
    !requirePermission(
      ctx,
      [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
      res
    )
  )
    return;

  const { id } = req.query;
  const charge_name = req.query.charge_name;

  if (!charge_name) {
    return res.status(400).json({ error: 'charge_name query param required' });
  }

  const svc = getServiceClient();

  // Load the order so findMatchingCharges can evaluate tariff conditions.
  const { data: load, error: loadErr } = await svc
    .from('orders')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle();

  if (loadErr) return res.status(500).json({ error: loadErr.message });
  if (!load) return res.status(404).json({ error: 'Load not found' });

  // Reuse the tariff engine. includeAutoAddFalse: true so profiles with
  // auto_add=false are still considered for manual pick.
  const matched = await findMatchingCharges(svc, load, ctx.tenantId, {
    includeAutoAddFalse: true,
  });

  // Filter by charge_name and pick the first winning profile.
  // Future enhancement: honor profile-level match_resolution for
  // multi-profile same-charge_name scenarios. First-match-wins is the
  // 99% case today.
  const winner = (matched || []).find(
    (m) => m.charge_name === charge_name && m.charge_profile_id
  );

  if (!winner) {
    return res
      .status(404)
      .json({ error: 'No matching charge profile on any tariff for this load' });
  }

  // Re-fetch the profile row directly to pull description + tier data.
  // findMatchingCharges returns denormalized fields; we want the profile's
  // own description and free_units from the first tier row.
  const { data: profile } = await svc
    .from('charge_profiles')
    .select(`
      id, name, description, charge_name, unit_of_measure, percentage_based_on,
      tiers:charge_profile_tiers(id, free_units)
    `)
    .eq('tenant_id', ctx.tenantId)
    .eq('id', winner.charge_profile_id)
    .maybeSingle();

  const isPct = winner.unit_of_measure === 'percentage';
  // Read free_units from the first tier row. Future enhancement: honor
  // tier-selection logic (by_lane / by_event / by_move) for multi-tier
  // profiles. First-tier default covers the common case and defaults to 0
  // when a profile has no tiers.
  const freeUnits = profile?.tiers?.[0]?.free_units ?? 0;

  return res.status(200).json({
    source_profile_id: winner.charge_profile_id,
    source_tariff_id: winner.tariff_id || null,
    profile_name: profile?.name || winner.name,
    charge_name: winner.charge_name,
    name: profile?.name || winner.name,
    description: profile?.description || '',
    unit_of_measure: winner.unit_of_measure,
    unit_count: 1,
    free_units: freeUnits,
    // For percentage profiles, amount_cents from the engine holds the
    // percentage value (e.g. 1500 = 15.00%). Surface it as percentage_value
    // (string, to match the form input) and leave per_unit_price_cents null;
    // the client's computePercentageAmount helper computes the real cents
    // based on the live load's base charge line.
    per_unit_price_cents: isPct ? null : (winner.amount_cents ?? null),
    percentage_value: isPct ? ((winner.amount_cents || 0) / 100).toFixed(2) : null,
    percentage_based_on: isPct ? winner.percentage_based_on || null : null,
    calculation_mode: winner.calculation_mode || null,
  });
}
