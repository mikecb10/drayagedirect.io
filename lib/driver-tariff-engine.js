/**
 * Driver Tariff Auto-Apply Engine (AP)
 *
 * Mirrors the AR tariff engine but for driver pay:
 *   1. Fetches active driver tariffs for the tenant
 *   2. Matches tariffs by driver group membership + load conditions
 *   3. Evaluates charge profile conditions (50+ rules)
 *   4. Generates order_driver_pay_lines from matching profiles
 *
 * Auto-apply behavior: "Replace auto, keep manual"
 *   - Removes existing auto-generated pay lines before regenerating
 *   - Never touches manually added lines
 *
 * Triggered when: driver is assigned to a load
 */

/**
 * Scope notes (last updated 2026-04-15, Plan C):
 *
 *   Implemented calculation modes:  between_statuses, by_event (with location
 *                                   filter), by_move, by_leg (with from + to
 *                                   location filters).
 *   Implemented UOMs:               fixed, percentage (incl. ar_invoice +
 *                                   driver_pay), per_hour, per_day, per_15/30/45min,
 *                                   per_pounds, per_miles, radius_rate.
 *   Deferred (Plan D):              oo_benchmark data source, profile_group
 *                                   location type, by_move move_events location
 *                                   filter, per_road_toll_miles.
 */

import { evaluateConditions } from './condition-evaluator';
import { resolveAmountCents } from './pricing-tier-resolver';
import { matchesAdvancedRoute } from './advanced-route-matcher';
import {
  detectChassisSplit,
  isChassisReposition,
} from './routing/chassis-split.js';

/**
 * Find matching driver charge profiles for a load + driver.
 *
 * @param {object} svc — Supabase service client
 * @param {object} load — the load object
 * @param {string} driverId — the driver being assigned
 * @param {string} tenantId
 * @returns {Array} — matched charge profiles with amounts
 */
export async function findMatchingDriverCharges(svc, load, driverId, tenantId) {
  const today = new Date().toISOString().slice(0, 10);

  // Ensure routing events are hydrated on the load before evaluating
  // conditions. The condition evaluator's 'dropped' field (the
  // "Before Delivery / After Delivery" rule a user selects in the
  // charge profile builder) reads load.routing_events to determine
  // whether a drop event has fired before a delivery event. Callers
  // on the PUT /loads/[id] path pass the raw update response, and the
  // recalc endpoint's load select only includes org nests — neither
  // has routing_events. Hydrate once here so every caller gets the
  // same behavior without having to remember the nested select.
  //
  // The stop_off_type join (migration 100) mirrors the AR tariff engine
  // so the condition evaluator's event_* rule primitives can read
  // stop-off-type behavior flags directly from the events array.
  if (!Array.isArray(load.routing_events)) {
    const { data: events } = await svc
      .from('order_routing_events')
      .select(`
        id, event_type, arrived_at, departed_at, sequence, location_id, city, state, zip, move_id,
        stop_off_type_id,
        stop_off_type:stop_off_types (
          id, name, has_cargo_transfer, is_paid_to_driver,
          is_billable_to_customer, counts_toward_detention, requires_location_pick
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.routing_events = events || [];
  }
  // Hydrate container_moves for the advanced-route matcher.
  if (!Array.isArray(load.container_moves)) {
    const { data: moves } = await svc
      .from('order_container_moves')
      .select('id, sequence')
      .eq('tenant_id', tenantId)
      .eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.container_moves = moves || [];
  }

  // Enrich the rule-evaluation context with chassis-handling primitives
  // derived from the order row's hook_chassis_location_id /
  // terminate_chassis_location_id columns (migration 065) and load_type.
  // Mirrors the AR tariff engine so rule conditions can key on these
  // identically across both engines. All callers fetch the load with `*`
  // or the update `.select()` response, so both columns are present.
  if (load.chassisSplit === undefined) {
    load.chassisSplit = detectChassisSplit(load);
  }
  if (load.isChassisReposition === undefined) {
    load.isChassisReposition = isChassisReposition(load);
  }

  // Find which driver group(s) this driver belongs to
  const { data: memberships } = await svc
    .from('driver_group_members')
    .select('driver_group_id')
    .eq('driver_id', driverId)
    .eq('tenant_id', tenantId);
  const driverGroupIds = (memberships || []).map((m) => m.driver_group_id);

  // Fetch all active driver tariffs
  const { data: tariffs, error } = await svc
    .from('driver_tariffs')
    .select(`
      *,
      advanced_route:driver_tariff_advanced_routes(
        id, routing_template_id, moves
      ),
      charge_sets:driver_tariff_charge_sets(
        *,
        profiles:driver_tariff_charge_set_profiles(
          *,
          charge_profile:driver_charge_profiles(
            id, name, charge_name, unit_of_measure, auto_add, calculation_mode,
            percentage_based_on, percentage_charge_code, conditions,
            versions:driver_charge_profile_versions(
              id, label, effective_from, effective_to,
              tiers:driver_charge_profile_tiers(*)
            )
          )
        )
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('is_enabled', true)
    .eq('status', 'active')
    .order('priority', { ascending: false });

  if (error || !tariffs) return [];

  for (const t of tariffs) {
    if (Array.isArray(t.advanced_route)) {
      t.advanced_route = t.advanced_route[0] || null;
    }
  }

  // Find matching tariff — check driver group + load conditions.
  // Sort by specificity first (driver-group-scoped > all, location-scoped > all),
  // then by priority DESC for tiebreaking.
  const matchingTariffs = tariffs.filter((t) => matchesDriverTariff(t, load, driverGroupIds, today));

  matchingTariffs.sort((a, b) => {
    const specA = driverTariffSpecificity(a);
    const specB = driverTariffSpecificity(b);
    if (specB !== specA) return specB - specA;
    return (b.priority || 0) - (a.priority || 0);
  });

  const winningTariff = matchingTariffs[0] || null;

  const matchedCharges = [];

  if (winningTariff) {
    for (const cs of winningTariff.charge_sets || []) {
      for (const link of cs.profiles || []) {
        const cp = link.charge_profile;
        if (!cp) continue;

        // Evaluate charge profile conditions against the load
        if (cp.conditions && cp.conditions.length > 0) {
          if (!evaluateConditions(load, cp.conditions)) continue;
        }

        const tiers = activeTiersForDriverProfile(cp);
        const resolved = resolveAmountCents(
          { tiers, calculation_mode: cp.calculation_mode, unit_of_measure: cp.unit_of_measure },
          { load, routingEvents: load.routing_events || [] }
        );

        matchedCharges.push({
          tariff_id: winningTariff.id,
          tariff_name: winningTariff.name,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: resolved.amount_cents,
          minimum_amount_cents: resolved.minimum_amount_cents,
          needs_distance: resolved.needs_distance || false,
          reason: resolved.reason || null,
          tier_id: resolved.tier_id,
          duration_seconds: resolved.duration_seconds,
          pounds: resolved.pounds || 0,
          miles: resolved.miles || 0,
          radius_bracket_index: resolved.radius_bracket_index ?? null,
          percentage_based_on: cp.percentage_based_on || null,
          percentage_charge_code: cp.percentage_charge_code || null,
          source: 'driver_tariff',
        });
      }
    }
  }

  // Standalone auto-add driver charge profiles — only when NO tariff matched.
  // When a driver tariff wins, it is the complete pay package.
  if (!winningTariff) {
    const { data: autoProfiles } = await svc
      .from('driver_charge_profiles')
      .select(`
        id, name, charge_name, unit_of_measure, calculation_mode, auto_add,
        percentage_based_on, percentage_charge_code, conditions, driver_group_id,
        versions:driver_charge_profile_versions(
          id, effective_from, effective_to,
          tiers:driver_charge_profile_tiers(*)
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('is_enabled', true)
      .eq('auto_add', true)
      .is('deleted_at', null);

    if (autoProfiles) {
      for (const cp of autoProfiles) {
        // Check driver group scoping
        if (cp.driver_group_id && !driverGroupIds.includes(cp.driver_group_id)) continue;

        // Evaluate conditions
        if (cp.conditions && cp.conditions.length > 0) {
          if (!evaluateConditions(load, cp.conditions)) continue;
        }

        const tiers = activeTiersForDriverProfile(cp);
        const resolved = resolveAmountCents(
          { tiers, calculation_mode: cp.calculation_mode, unit_of_measure: cp.unit_of_measure },
          { load, routingEvents: load.routing_events || [] }
        );
        matchedCharges.push({
          tariff_id: null,
          tariff_name: null,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: resolved.amount_cents,
          minimum_amount_cents: resolved.minimum_amount_cents,
          needs_distance: resolved.needs_distance || false,
          reason: resolved.reason || null,
          tier_id: resolved.tier_id,
          duration_seconds: resolved.duration_seconds,
          pounds: resolved.pounds || 0,
          miles: resolved.miles || 0,
          radius_bracket_index: resolved.radius_bracket_index ?? null,
          percentage_based_on: cp.percentage_based_on || null,
          percentage_charge_code: cp.percentage_charge_code || null,
          source: 'auto_add',
        });
      }
    }
  }

  // Resolve percentage-based charges (async — may fetch AR line items)
  await resolveDriverPercentageCharges(svc, matchedCharges, load, tenantId);

  return matchedCharges;
}

/**
 * Calculate specificity score for a driver tariff.
 * More specific tariffs (driver-group-scoped, location-scoped) beat generic ones.
 */
function driverTariffSpecificity(tariff) {
  let score = 0;

  // Advanced-route matches always beat basic (+1000 base) plus per-event
  // specificity bonus. Mirrors the AR side scoring so behavior is
  // symmetric when a load matches both AR and AP tariffs.
  if (tariff.matching_mode === 'advanced_route' && tariff.advanced_route) {
    score += 1000;
    const moves = Array.isArray(tariff.advanced_route.moves) ? tariff.advanced_route.moves : [];
    for (const move of moves) {
      for (const ev of (move.events || [])) {
        const mode = ev.location_match?.mode;
        if (mode === 'specific')   score += 4;
        else if (mode === 'zip')    score += 3;
        else if (mode === 'city_state') score += 2;
        else if (mode === 'state')  score += 1;
      }
    }
  }

  if (tariff.driver_group_id) score += 100; // driver-group-scoped
  if (tariff.pickup_conditions && !tariff.pickup_conditions.all && tariff.pickup_conditions.ids?.length > 0) score += 50;
  if (tariff.delivery_conditions && !tariff.delivery_conditions.all && tariff.delivery_conditions.ids?.length > 0) score += 50;
  if (tariff.return_conditions && !tariff.return_conditions.all && tariff.return_conditions.ids?.length > 0) score += 25;
  if (tariff.load_types?.length > 0) score += 10;
  if (tariff.container_type) score += 5;
  if (tariff.container_size) score += 5;
  const flags = [
    'is_hazmat', 'is_overweight', 'is_overheight', 'is_hot', 'is_genset',
    'is_scale', 'is_ev', 'is_street_turn', 'is_oog', 'is_bonded',
    'is_double', 'is_tanker', 'is_liquor',
  ];
  for (const flag of flags) {
    if (tariff[flag] === true) score += 3;
  }
  return score;
}

/**
 * Check if a driver tariff matches a load + driver group.
 */
function matchesDriverTariff(tariff, load, driverGroupIds, today) {
  // Date range
  if (tariff.effective_start && tariff.effective_start > today) return false;
  if (tariff.effective_end && tariff.effective_end < today) return false;

  // Driver group check — null means "all groups"
  if (tariff.driver_group_id && !driverGroupIds.includes(tariff.driver_group_id)) return false;

  // Load type
  if (tariff.load_types?.length > 0) {
    const lt = (load.load_type || '').toLowerCase();
    if (!tariff.load_types.map((t) => t.toLowerCase()).includes(lt)) return false;
  }

  // Location branch: advanced mode replaces the basic pickup/delivery/
  // return filters entirely. Non-location filters above still apply.
  if (tariff.matching_mode === 'advanced_route') {
    if (!matchesAdvancedRoute(tariff.advanced_route, load)) return false;
  } else {
    if (tariff.pickup_conditions && !tariff.pickup_conditions.all && tariff.pickup_conditions.ids?.length > 0) {
      if (!tariff.pickup_conditions.ids.includes(load.pickup_location_id)) return false;
    }
    if (tariff.delivery_conditions && !tariff.delivery_conditions.all && tariff.delivery_conditions.ids?.length > 0) {
      if (!tariff.delivery_conditions.ids.includes(load.delivery_location_id)) return false;
    }
    if (tariff.return_conditions && !tariff.return_conditions.all && tariff.return_conditions.ids?.length > 0) {
      if (!tariff.return_conditions.ids.includes(load.return_location_id)) return false;
    }
  }

  // Equipment
  if (tariff.container_type && tariff.container_type !== load.container_type) return false;
  if (tariff.container_size && tariff.container_size !== load.container_size) return false;

  // Flags
  const flags = [
    'is_hazmat', 'is_overweight', 'is_overheight', 'is_hot', 'is_genset',
    'is_scale', 'is_ev', 'is_street_turn', 'is_oog', 'is_bonded',
    'is_double', 'is_tanker', 'is_liquor',
  ];
  for (const flag of flags) {
    if (tariff[flag] === true && !load[flag]) return false;
  }

  return true;
}

/**
 * AP profiles store tiers under versions (effective_from / effective_to
 * grouping). Pick the currently-active version and return its flat tier
 * list so the shared resolver can operate on it uniformly with AR.
 */
function activeTiersForDriverProfile(profile) {
  const versions = profile.versions || [];
  if (versions.length === 0) return [];
  const today = new Date().toISOString().slice(0, 10);
  const active = versions.find((v) =>
    (!v.effective_from || v.effective_from <= today) &&
    (!v.effective_to   || v.effective_to   >= today)
  ) || versions[0];
  return active.tiers || [];
}

/**
 * Resolve percentage-based driver charges.
 * Async because it may need to fetch AR line items from the DB.
 */
async function resolveDriverPercentageCharges(svc, charges, load, tenantId) {
  // Cache AR line items so we only fetch once if multiple percentage charges need them
  let arLineItems = null;

  for (const charge of charges) {
    if (charge.unit_of_measure !== 'percentage') continue;

    const percentageRaw = charge.amount_cents;
    const percentageValue = percentageRaw / 100;
    const basedOn = charge.percentage_based_on;
    const chargeCode = charge.percentage_charge_code; // e.g. 'LINE_HAUL', 'FUEL'

    let baseCents = 0;

    if (basedOn === 'ar_invoice') {
      // Fetch AR line items if not cached
      if (!arLineItems) {
        const { data: chargeSets } = await svc
          .from('order_charge_sets')
          .select('id')
          .eq('order_id', load.id)
          .eq('tenant_id', tenantId);
        if (chargeSets?.length > 0) {
          const csIds = chargeSets.map((cs) => cs.id);
          const { data: items } = await svc
            .from('order_charge_set_line_items')
            .select('name, total_cents, per_unit_price_cents, unit_of_measure, needs_distance')
            .in('charge_set_id', csIds)
            .eq('tenant_id', tenantId);
          arLineItems = items || [];
        } else {
          arLineItems = [];
        }
      }

      if (chargeCode) {
        // Find the specific AR charge by code (case-insensitive match on name)
        const codeUpper = chargeCode.toUpperCase();
        const match = arLineItems.find((li) =>
          li.name?.toUpperCase() === codeUpper ||
          li.name?.toUpperCase().replace(/[_ ]/g, '') === codeUpper.replace(/[_ ]/g, '') ||
          li.name?.toUpperCase().includes(codeUpper.replace(/_/g, ' '))
        );
        // Cascade needs_distance: if the AR base charge has unresolved miles,
        // this AP percentage charge can't be computed yet either.
        if (match?.needs_distance === true && match?.total_cents === null) {
          charge.amount_cents = null;
          charge.needs_distance = true;
          charge.reason = 'base_charge_unresolved_distance';
          continue;
        }
        baseCents = match ? (match.total_cents || match.per_unit_price_cents || 0) : 0;
      } else {
        // Sibling scan — if ANY AR line item has unresolved distance,
        // the reduce would silently sum $0 for null rows, underbilling.
        // Cascade the flag and skip compute.
        const hasUnresolvedArSibling = arLineItems.some(
          (li) => li.needs_distance === true && li.total_cents === null
        );
        if (hasUnresolvedArSibling) {
          charge.amount_cents = null;
          charge.needs_distance = true;
          charge.reason = 'base_charge_unresolved_distance';
          continue;
        }
        // No charge code specified — use total of all AR line items (skip NULLs)
        baseCents = arLineItems.reduce((sum, li) => sum + (li.total_cents || 0), 0);
      }
    } else if (basedOn === 'driver_pay') {
      if (chargeCode) {
        // Find specific driver charge by code in the current matched charges
        const codeUpper = chargeCode.toUpperCase();
        const match = charges.find((c) =>
          c !== charge && c.unit_of_measure !== 'percentage' &&
          (c.charge_name?.toUpperCase() === codeUpper ||
           c.name?.toUpperCase().includes(codeUpper.replace(/_/g, ' ')))
        );
        // Cascade needs_distance from the matched driver base charge.
        if (match?.needs_distance === true && match?.amount_cents === null) {
          charge.amount_cents = null;
          charge.needs_distance = true;
          charge.reason = 'base_charge_unresolved_distance';
          continue;
        }
        baseCents = match?.amount_cents || 0;
      } else {
        // Sibling scan — if ANY sibling driver charge has unresolved distance,
        // the find excludes null-amount rows, leaving baseCents=0 and skipping
        // compute. charge.amount_cents would then retain its raw percentage-rate
        // value (e.g. 1000 for 10%) and persist silently as $10.
        const hasUnresolvedDriverSibling = charges.some(
          (c) => c !== charge && c.needs_distance === true && c.amount_cents === null
        );
        if (hasUnresolvedDriverSibling) {
          charge.amount_cents = null;
          charge.needs_distance = true;
          charge.reason = 'base_charge_unresolved_distance';
          continue;
        }
        // No code — use first non-percentage driver charge with a resolved amount.
        const baseCharge = charges.find((c) =>
          c !== charge && c.unit_of_measure !== 'percentage' && c.amount_cents > 0
        );
        baseCents = baseCharge?.amount_cents || 0;
      }
    } else {
      // Sibling scan for default branch — same failure mode as driver_pay no-code.
      const hasUnresolvedDefaultSibling = charges.some(
        (c) => c !== charge && c.needs_distance === true && c.amount_cents === null
      );
      if (hasUnresolvedDefaultSibling) {
        charge.amount_cents = null;
        charge.needs_distance = true;
        charge.reason = 'base_charge_unresolved_distance';
        continue;
      }
      // Default: find first non-percentage charge by name match or first with amount
      const baseCharge = charges.find((c) =>
        c !== charge && c.unit_of_measure !== 'percentage' && c.amount_cents > 0
      );
      baseCents = baseCharge?.amount_cents || 0;
    }

    if (baseCents > 0) {
      charge.amount_cents = Math.round((baseCents * percentageValue) / 100);
    }
  }
}

/**
 * Apply matched driver charges to a load as driver pay lines.
 * "Replace auto, keep manual" — removes lines with source='tariff' or 'auto_add',
 * keeps manually entered lines.
 */
export async function applyDriverPayToLoad(svc, loadId, driverId, tenantId, charges) {
  if (!charges || charges.length === 0) return;

  // Remove existing auto-generated pay lines for this driver on this load
  // (lines created by the tariff engine have notes containing 'auto-applied')
  const { data: existing } = await svc
    .from('order_driver_pay_lines')
    .select('id, notes')
    .eq('order_id', loadId)
    .eq('driver_id', driverId)
    .eq('tenant_id', tenantId);

  const autoIds = (existing || [])
    .filter((l) => l.notes && l.notes.includes('[auto-applied]'))
    .map((l) => l.id);

  if (autoIds.length > 0) {
    await svc
      .from('order_driver_pay_lines')
      .delete()
      .in('id', autoIds);
  }

  // Create new pay lines from matched charges.
  //
  // source_type / source_tariff_id / source_charge_profile_id let the UI
  // (1) show an auto vs manual icon per row and (2) open the originating
  // charge profile when the user clicks an auto row. Migration 073 adds
  // these columns; older DBs without the migration will silently ignore
  // the extra fields because Supabase errors only on missing required
  // columns.
  const lineItems = charges.map((c) => {
    const needsDistance = c.needs_distance === true;
    const effectiveAmount = needsDistance
      ? null
      : Math.max(c.amount_cents || 0, c.minimum_amount_cents || 0);
    return {
      tenant_id: tenantId,
      order_id: loadId,
      driver_id: driverId,
      line_type: mapChargeNameToLineType(c.charge_name),
      description: `${c.name || c.charge_name}${c.tariff_name ? ` (via ${c.tariff_name})` : ''}`,
      amount_cents: effectiveAmount,
      needs_distance: needsDistance,
      status: 'drafted',
      worked_at: new Date().toISOString(),
      notes: '[auto-applied] Generated by driver tariff engine',
      source_type: c.source || 'driver_tariff',
      source_tariff_id: c.tariff_id || null,
      source_charge_profile_id: c.charge_profile_id || null,
    };
  });

  if (lineItems.length > 0) {
    await svc.from('order_driver_pay_lines').insert(lineItems);
  }
}

/**
 * Map AP charge name codes to driver pay line types.
 */
function mapChargeNameToLineType(chargeName) {
  const map = {
    LINE_HAUL: 'line_haul',
    BASE_PRICE: 'line_haul',
    FUEL: 'fuel_surcharge',
    DETENTION: 'detention',
    WAITING_TIME: 'detention',
    LAYOVER: 'layover',
    CHASSIS: 'chassis_split',
    CHASSIS_SPLIT: 'chassis_split',
    STOP_OFF: 'other',
    BONUS: 'bonus',
    SCALE: 'other',
  };
  return map[chargeName] || 'other';
}
