/**
 * Tariff Auto-Apply Engine
 *
 * When a load is created or updated, this engine:
 *   1. Fetches all active tariffs for the tenant
 *   2. Checks each tariff's matching conditions against the load
 *   3. For matching tariffs, pulls their charge sets + linked charge profiles
 *   4. Evaluates charge profile conditions (50+ rule types) against the load
 *   5. Creates billing line items on the load from matching charge profiles
 *
 * Priority: more specific tariffs (with customer/location conditions) beat generic ones.
 * Match resolution (first_match_wins, highest_rate, etc.) is on the charge profile level.
 *
 * Auto-apply behavior: "Replace auto, keep manual"
 *   - Removes existing is_auto=true line items before regenerating
 *   - Never touches manually added lines
 */

/**
 * Scope notes (last updated 2026-04-15, Plan C):
 *
 *   Implemented calculation modes:  between_statuses (with per_hour / per_day /
 *                                   per_Nmin UOMs), by_lane, by_event (with
 *                                   location filter: org / city_state / zip),
 *                                   by_move.
 *   Implemented UOMs:               fixed, percentage, per_hour, per_day,
 *                                   per_15/30/45min, per_pounds, per_miles,
 *                                   radius_rate (with tiered brackets).
 *   Implemented endpoints:          POST .../recalculate-charges (applies),
 *                                   POST .../recalculate-charges-diagnostic
 *                                   (read-only tariff trace + would-be charges).
 *   Deferred (Plan D):              per_road_toll_miles (toll-aware routing),
 *                                   profile_group location type (schema work),
 *                                   server-side distance calc (orders.actual_miles
 *                                   read directly for now).
 */

import { evaluateConditions } from './condition-evaluator';
import { resolveAmountCents } from './pricing-tier-resolver';
import { matchesAdvancedRoute } from './advanced-route-matcher';

/**
 * Find all matching tariffs for a load and return the charge profiles to apply.
 *
 * @param {object} svc — Supabase service client
 * @param {object} load — the load object with customer_id, pickup_location_id, etc.
 * @param {string} tenantId
 * @returns {Array} — array of { charge_profile, charge_set, tariff } objects to apply
 */
export async function findMatchingCharges(svc, load, tenantId, opts = {}) {
  const { includeAutoAddFalse = false } = opts;
  const today = new Date().toISOString().slice(0, 10);

  // Ensure routing_events are hydrated. The condition evaluator's
  // before_delivery / after_delivery rules need them, and the shared
  // pricing resolver needs them for between_statuses duration +
  // by_event / by_move / by_leg tier selection. Callers on the
  // PUT /loads/[id] path pass the raw update response, which doesn't
  // include routing_events — hydrate once here so every downstream
  // consumer sees the same shape.
  if (!Array.isArray(load.routing_events)) {
    const { data: events } = await svc
      .from('order_routing_events')
      .select('id, event_type, arrived_at, departed_at, sequence, location_id, city, state, zip, move_id')
      .eq('tenant_id', tenantId)
      .eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.routing_events = events || [];
  }
  // Also hydrate container_moves for the advanced-route matcher. Kept
  // cheap — id + sequence are all the matcher needs.
  if (!Array.isArray(load.container_moves)) {
    const { data: moves } = await svc
      .from('order_container_moves')
      .select('id, sequence')
      .eq('tenant_id', tenantId)
      .eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.container_moves = moves || [];
  }

  // Fetch all active tariffs with their charge sets + linked profiles
  const { data: tariffs, error } = await svc
    .from('tariffs')
    .select(`
      *,
      advanced_route:tariff_advanced_routes(
        id, routing_template_id, moves
      ),
      charge_sets:tariff_charge_sets(
        *,
        profiles:tariff_charge_set_profiles(
          *,
          charge_profile:charge_profiles(
            id, name, description, charge_name, unit_of_measure, auto_add, calculation_mode, percentage_based_on,
            tiers:charge_profile_tiers(*)
          )
        ),
        items:tariff_charge_items(*)
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('is_enabled', true)
    .eq('status', 'active')
    .order('priority', { ascending: false });

  if (error || !tariffs) return [];

  // Supabase returns to-many joins as arrays even for UNIQUE FKs;
  // collapse advanced_route to a single row per tariff.
  for (const t of tariffs) {
    if (Array.isArray(t.advanced_route)) {
      t.advanced_route = t.advanced_route[0] || null;
    }
  }

  // Find the SINGLE best matching tariff — most specific wins.
  // 1. Filter to only tariffs whose conditions match the load
  // 2. Sort by specificity (customer-specific > all-customers, location-specific > all-locations)
  // 3. Break ties with priority DESC
  // This ensures a customer-specific tariff always beats a generic "All Customers" tariff,
  // even if the generic one has a higher priority number.
  const matchingTariffs = tariffs.filter((t) => matchesTariff(t, load, today));

  matchingTariffs.sort((a, b) => {
    const specA = tariffSpecificity(a);
    const specB = tariffSpecificity(b);
    if (specB !== specA) return specB - specA; // higher specificity first
    return (b.priority || 0) - (a.priority || 0); // then higher priority
  });

  const winningTariff = matchingTariffs[0] || null;

  if (!winningTariff) {
    // No tariff matched — still check for standalone auto-add profiles below
  }

  const matchedCharges = [];

  if (winningTariff) {
    const tariff = winningTariff;
    // Collect charge profiles from the winning tariff's charge sets
    for (const cs of tariff.charge_sets || []) {
      // Linked charge profiles
      for (const link of cs.profiles || []) {
        const cp = link.charge_profile;
        if (!cp) continue;
        if (!includeAutoAddFalse && cp.auto_add === false) continue;

        // Evaluate charge profile conditions (50+ rules) against the load
        if (cp.conditions && cp.conditions.length > 0) {
          if (!evaluateConditions(load, cp.conditions)) continue; // Conditions didn't match
        }

        const resolved = resolveAmountCents(cp, {
          load,
          routingEvents: load.routing_events || [],
        });
        matchedCharges.push({
          tariff_id: tariff.id,
          tariff_name: tariff.name,
          charge_set_id: cs.id,
          bill_to_mode: cs.bill_to_mode,
          bill_to_customer_id:
            cs.bill_to_mode === 'specified' ? cs.bill_to_customer_id : load.customer_id,
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
          source: 'tariff',
        });
      }

      // One-off charge items
      for (const item of cs.items || []) {
        matchedCharges.push({
          tariff_id: tariff.id,
          tariff_name: tariff.name,
          charge_set_id: cs.id,
          bill_to_mode: cs.bill_to_mode,
          bill_to_customer_id:
            cs.bill_to_mode === 'specified' ? cs.bill_to_customer_id : load.customer_id,
          charge_profile_id: null,
          charge_name: item.charge_name || item.name,
          name: item.name,
          unit_of_measure: item.unit_of_measure || 'fixed',
          calculation_mode: null,
          amount_cents: item.amount_cents || 0,
          minimum_amount_cents: item.minimum_amount_cents || 0,
          source: 'tariff_item',
        });
      }
    }
  }

  // Standalone auto-add charge profiles — only apply when NO tariff matched.
  // When a tariff wins, it is the complete rate package for the load.
  // If you need fuel surcharge, detention, etc. on tariff-matched loads,
  // add those charge profiles to the tariff's charge set.
  // Auto-add profiles serve as a fallback for loads with no matching tariff.
  if (!winningTariff) {
    const { data: autoProfiles } = await svc
      .from('charge_profiles')
      .select('id, name, charge_name, unit_of_measure, calculation_mode, auto_add, percentage_based_on, tiers:charge_profile_tiers(*)')
      .eq('tenant_id', tenantId)
      .eq('is_enabled', true)
      .eq('auto_add', true);

    if (autoProfiles) {
      for (const cp of autoProfiles) {
        // Evaluate charge profile conditions
        if (cp.conditions && cp.conditions.length > 0) {
          if (!evaluateConditions(load, cp.conditions)) continue;
        }
        const resolved = resolveAmountCents(cp, {
          load,
          routingEvents: load.routing_events || [],
        });
        matchedCharges.push({
          tariff_id: null,
          tariff_name: null,
          charge_set_id: null,
          bill_to_mode: 'load_customer',
          bill_to_customer_id: load.customer_id,
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
          source: 'auto_add',
        });
      }
    }
  }

  // Second pass: resolve percentage-based charges
  // For charges with unit_of_measure === 'percentage', amount_cents stores the
  // percentage value via CentsInput (e.g. 1500 = 15.00%). We need to find the
  // base charge and compute: base_amount * percentage / 10000
  resolvePercentageCharges(matchedCharges);

  return matchedCharges;
}

/**
 * Resolve percentage-based charges by computing actual amounts from base charges.
 * Mutates the matchedCharges array in place.
 */
function resolvePercentageCharges(charges) {
  for (const charge of charges) {
    if (charge.unit_of_measure !== 'percentage') continue;

    // amount_cents holds the percentage value from CentsInput: 1500 = 15.00%
    const percentageRaw = charge.amount_cents; // e.g. 1500 for 15%
    const percentageValue = percentageRaw / 100; // e.g. 15.00

    // Find the base charge to calculate against
    const basedOn = charge.percentage_based_on; // e.g. 'LINE_HAUL'
    let baseCharge = null;

    if (basedOn) {
      // Match by charge_name code (e.g. LINE_HAUL === LINE_HAUL)
      baseCharge = charges.find((c) =>
        c !== charge &&
        c.unit_of_measure !== 'percentage' &&
        (c.charge_name === basedOn ||
         c.charge_name?.toUpperCase() === basedOn.toUpperCase() ||
         c.name?.toUpperCase() === basedOn.replace(/_/g, ' ').toUpperCase())
      );
    }

    if (!baseCharge) {
      // Fallback: find the first non-percentage charge (usually Line Haul)
      baseCharge = charges.find((c) =>
        c !== charge && c.unit_of_measure !== 'percentage' && c.amount_cents > 0
      );
    }

    if (baseCharge) {
      // Cascade needs_distance: if the base charge has unresolved miles, this
      // percentage charge also can't be computed yet. Mark it unresolved so
      // the invoice-send gate (Task 8) can catch it. Without this, the || 0
      // coercion would silently produce $0 and slip past the gate.
      if (baseCharge.needs_distance === true && baseCharge.amount_cents === null) {
        charge.amount_cents = null;
        charge.needs_distance = true;
        charge.reason = 'base_charge_unresolved_distance';
        continue;
      }
      // amount_cents is already post-minimum after Task 2.2 wired in the
      // shared resolveAmountCents(), so we don't need another Math.max here.
      const baseCents = baseCharge.amount_cents || 0;
      charge.amount_cents = Math.round((baseCents * percentageValue) / 100);
    }
    // If no base charge found, amount_cents stays as-is (raw percentage value)
  }
}

/**
 * Calculate how specific a tariff is. More specific tariffs should win over
 * generic "catch-all" tariffs. Customer-specific beats All Customers, etc.
 *
 * Scoring (higher = more specific):
 *   - Has customer_ids:   +100  (customer-scoped)
 *   - Has pickup location:  +50  (origin-scoped)
 *   - Has delivery location: +50  (destination-scoped)
 *   - Has return location:  +25  (return-scoped)
 *   - Has load_types:      +10  (type-scoped)
 *   - Has equipment filters: +5 each (container type/size, SSL, chassis)
 *   - Has flag requirements: +3 each
 */
function tariffSpecificity(tariff) {
  let score = 0;

  // Advanced-route matches always beat basic (+1000 base) plus per-event
  // specificity bonus so more-precisely-pinned templates beat looser ones.
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

  if (tariff.customer_ids?.length > 0) score += 100;
  if (tariff.pickup_conditions && !tariff.pickup_conditions.all && tariff.pickup_conditions.ids?.length > 0) score += 50;
  if (tariff.delivery_conditions && !tariff.delivery_conditions.all && tariff.delivery_conditions.ids?.length > 0) score += 50;
  if (tariff.return_conditions && !tariff.return_conditions.all && tariff.return_conditions.ids?.length > 0) score += 25;
  if (tariff.load_types?.length > 0) score += 10;
  if (tariff.container_type) score += 5;
  if (tariff.container_size) score += 5;
  if (tariff.ssl_id) score += 5;
  if (tariff.chassis_type) score += 5;
  if (tariff.chassis_size) score += 5;
  // Flag specificity — each required flag adds a small amount
  const flagFields = [
    'is_hazmat', 'is_overweight', 'is_liquor', 'is_hot', 'is_genset',
    'is_overheight', 'is_scale', 'is_ev', 'is_street_turn',
    'is_oog', 'is_bonded', 'is_double', 'is_tanker',
  ];
  for (const flag of flagFields) {
    if (tariff[flag] === true) score += 3;
  }
  return score;
}

/**
 * Check if a tariff's conditions match a load.
 */
function matchesTariff(tariff, load, today) {
  // Date range check
  if (tariff.effective_start && tariff.effective_start > today) return false;
  if (tariff.effective_end && tariff.effective_end < today) return false;

  // Load type check
  if (tariff.load_types?.length > 0) {
    const loadType = (load.load_type || '').toUpperCase();
    const tariffTypes = tariff.load_types.map((t) => t.toUpperCase());
    if (!tariffTypes.includes(loadType)) return false;
  }

  // Customer check
  if (tariff.customer_ids?.length > 0) {
    if (!tariff.customer_ids.includes(load.customer_id)) return false;
  }

  // Location branch: advanced mode replaces the basic pickup/delivery/
  // return filters entirely. Non-location filters above still apply.
  if (tariff.matching_mode === 'advanced_route') {
    if (!matchesAdvancedRoute(tariff.advanced_route, load)) return false;
  } else {
    // Pickup location check
    if (tariff.pickup_conditions && !tariff.pickup_conditions.all) {
      const ids = tariff.pickup_conditions.ids || [];
      if (ids.length > 0 && !ids.includes(load.pickup_location_id)) return false;
    }

    // Delivery location check
    if (tariff.delivery_conditions && !tariff.delivery_conditions.all) {
      const ids = tariff.delivery_conditions.ids || [];
      if (ids.length > 0 && !ids.includes(load.delivery_location_id)) return false;
    }

    // Return location check
    if (tariff.return_conditions && !tariff.return_conditions.all && tariff.return_conditions.ids?.length > 0) {
      if (!tariff.return_conditions.ids.includes(load.return_location_id)) return false;
    }
  }

  // Equipment checks
  if (tariff.container_type && tariff.container_type !== load.container_type) return false;
  if (tariff.container_size && tariff.container_size !== load.container_size) return false;
  if (tariff.ssl_id && tariff.ssl_id !== load.container_owner_id) return false;
  if (tariff.chassis_type && tariff.chassis_type !== load.chassis_type) return false;
  if (tariff.chassis_size && tariff.chassis_size !== load.chassis_size) return false;

  // Flag checks
  const flagFields = [
    'is_hazmat', 'is_overweight', 'is_liquor', 'is_hot', 'is_genset',
    'is_overheight', 'is_scale', 'is_ev', 'is_street_turn',
    'is_oog', 'is_bonded', 'is_double', 'is_tanker',
  ];
  for (const flag of flagFields) {
    if (tariff[flag] === true && !load[flag]) return false;
  }

  return true;
}

/**
 * Apply matched charges to a load by creating billing line items.
 *
 * @param {object} svc — Supabase service client
 * @param {string} loadId
 * @param {string} tenantId
 * @param {Array} charges — from findMatchingCharges()
 */
export async function applyChargesToLoad(svc, loadId, tenantId, charges) {
  charges = charges || [];

  // Find existing charge set (if any) for this load.
  const { data: existingSets } = await svc
    .from('order_charge_sets')
    .select('id')
    .eq('order_id', loadId)
    .eq('tenant_id', tenantId)
    .limit(1);

  // Case A: no existing charge set AND no charges to apply → genuine no-op.
  if (!existingSets?.length && charges.length === 0) return;

  // Case B: existing charge set — always wipe auto lines, even when the
  // new charges list is empty. This ensures the engine's current state
  // of truth is reflected: no match → no auto lines. Previously this
  // function early-exited on empty charges, leaving stale auto lines
  // whenever a load's matching fields changed to a state that no tariff
  // matched.
  if (existingSets?.length > 0) {
    await svc
      .from('order_charge_set_line_items')
      .delete()
      .eq('charge_set_id', existingSets[0].id)
      .eq('tenant_id', tenantId)
      .eq('is_auto', true);

    // If we also have no charges to insert, refresh the charge set totals
    // (manual lines only) and return.
    if (charges.length === 0) {
      const { data: remaining } = await svc
        .from('order_charge_set_line_items')
        .select('total_cents')
        .eq('tenant_id', tenantId)
        .eq('charge_set_id', existingSets[0].id)
        .not('total_cents', 'is', null);
      const total = (remaining || []).reduce((sum, li) => sum + (li.total_cents || 0), 0);
      await svc.from('order_charge_sets').update({
        subtotal_cents: total,
        total_cents: total,
        updated_at: new Date().toISOString(),
      }).eq('id', existingSets[0].id);
      return;
    }
    // NOTE: the existing charge set's `bill_to_customer_id` is DELIBERATELY
    // not updated here — a dispatcher may have manually changed it via the
    // Bill To dropdown on the Billing tab, and we preserve that edit against
    // auto-recalc overwrites. If product intent later shifts to "tariff
    // always wins on draft charge sets", the update would go in this branch.
  }

  // Case C: need to create a charge set (no existing + we have charges)
  let chargeSetId;
  if (existingSets?.length > 0) {
    chargeSetId = existingSets[0].id;
  } else {
    const { generateChargeSetNumber } = await import('./charge-set-utils');
    const csNumber = await generateChargeSetNumber(svc, tenantId, loadId);
    // NOTE: Assumes all `charges` in a single apply call share the same
    // `bill_to_customer_id` (true for single-charge-set tariffs — the common
    // case). Heterogeneous tariffs with multiple charge_sets that differ in
    // bill_to_mode will silently drop non-first values, because the
    // `order_charge_sets` table is 1 row per load. Proper multi-charge-set
    // sharding is a future refactor; a tariff-save-time validator that warns
    // on heterogeneous charge_sets would be a cheaper mitigation.
    const { data: newSet } = await svc
      .from('order_charge_sets')
      .insert({
        tenant_id: tenantId,
        order_id: loadId,
        charge_set_number: csNumber,
        status: 'draft',
        bill_to_customer_id: charges[0]?.bill_to_customer_id || null,
      })
      .select()
      .single();
    chargeSetId = newSet?.id;
  }

  if (!chargeSetId) return;

  // Create line items matching the actual DB schema
  const lineItems = charges.map((c) => {
    const needsDistance = c.needs_distance === true;
    const effectiveTotal = needsDistance
      ? null
      : Math.max(c.amount_cents || 0, c.minimum_amount_cents || 0);
    return {
      tenant_id: tenantId,
      charge_set_id: chargeSetId,
      name: c.name || c.charge_name,
      description: `${c.charge_name}${c.tariff_name ? ` (via ${c.tariff_name})` : ' (Auto-Add)'}`,
      unit_of_measure: c.unit_of_measure || 'fixed',
      unit_count: 1,
      free_units: 0,
      per_unit_price_cents: c.amount_cents || 0,
      total_cents: effectiveTotal,
      needs_distance: needsDistance,
      is_auto: true,
      source_tariff_id: c.tariff_id || null,
      source_profile_id: c.charge_profile_id || null,
    };
  });

  await svc.from('order_charge_set_line_items').insert(lineItems);

  // Recompute charge set totals (auto lines we just inserted + any
  // existing manual lines already on the set). Skip NULL rows — those are
  // unresolved per_mile charges that don't yet have a computable total.
  const { data: allLines } = await svc
    .from('order_charge_set_line_items')
    .select('total_cents')
    .eq('tenant_id', tenantId)
    .eq('charge_set_id', chargeSetId)
    .not('total_cents', 'is', null);
  const total = (allLines || []).reduce((sum, li) => sum + (li.total_cents || 0), 0);
  await svc.from('order_charge_sets').update({
    subtotal_cents: total,
    total_cents: total,
    updated_at: new Date().toISOString(),
  }).eq('id', chargeSetId);
}
