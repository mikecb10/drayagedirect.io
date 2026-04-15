/**
 * Pricing Tier Resolver
 *
 * Given a list of tier rows + the profile's calculation_mode + load
 * context, pick the right tier row and compute the final amount in
 * cents. Shared by both the AR tariff engine and the AP driver tariff
 * engine because the tier shapes overlap heavily (same columns for
 * between_statuses / by_event / by_move; AR has by_lane only, AP has
 * by_leg only — handled via mode dispatch).
 *
 * A tier's `amount_cents` is the per-unit rate for time-based UOMs and
 * the flat total for fixed. percentage is resolved in a second pass
 * (see resolvePercentageCharges / resolveDriverPercentageCharges in
 * the two engine files — this resolver does NOT compute percentages).
 *
 * When no tier matches the mode-specific filters, we fall back to the
 * first tier (preserves the pre-refactor behavior so legacy profiles
 * that were built without mode awareness still return a non-zero amount).
 */

import { isTimeBased, applyTimeUom } from './pricing-uom';
import { computeDurationSeconds } from './pricing-duration';

/**
 * Today's date as YYYY-MM-DD, used for tier effective-range filtering.
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Filter a tier list to only those whose effective date range covers today.
 * Tiers without a date range are always considered active.
 */
function filterActiveByDate(tiers) {
  const t = today();
  const active = tiers.filter((tier) =>
    (!tier.start_date || tier.start_date <= t) &&
    (!tier.end_date   || tier.end_date   >= t)
  );
  return active.length > 0 ? active : tiers;
}

/**
 * Select the tier row that matches a calculation_mode + load context.
 * Returns null when `tiers` is empty; returns tiers[0] when no mode
 * filter applies or matches (safety fallback).
 */
export function selectTier(tiers, mode, context) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;

  const active = filterActiveByDate(tiers);
  const load = context?.load || {};

  switch (mode) {
    case 'by_lane': {
      // AR only. Match a tier whose pickup/delivery/return_location_id
      // triple matches the load. A null on the tier side means "any".
      const hit = active.find((t) =>
        (!t.pickup_location_id   || t.pickup_location_id   === load.pickup_location_id) &&
        (!t.delivery_location_id || t.delivery_location_id === load.delivery_location_id) &&
        (!t.return_location_id   || t.return_location_id   === load.return_location_id)
      );
      return hit || active[0];
    }

    case 'by_event': {
      // Match the first tier whose event_type appears on the load.
      // Location matching (event_location_id / type / value) deferred to Plan B.
      const eventTypes = new Set((context?.routingEvents || []).map((e) => e.event_type));
      const hit = active.find((t) => t.event_type && eventTypes.has(t.event_type.toLowerCase()));
      return hit || active[0];
    }

    case 'by_move': {
      // Tiers are keyed by move_index (0-based). Pick the one matching the
      // load's first/selected move. For Plan A we target move_index 0;
      // multi-move pricing (per-move detention) lands in Plan B.
      const hit = active.find((t) => t.move_index === 0 || t.move_index == null);
      return hit || active[0];
    }

    case 'by_leg': {
      // AP only. Match leg_from + leg_to against the routing event sequence.
      // Location matching (leg_*_location_*) deferred to Plan B.
      const events = context?.routingEvents || [];
      const legTypes = events.map((e) => e.event_type);
      const hit = active.find((t) => {
        if (!t.leg_from || !t.leg_to) return false;
        const fromIdx = legTypes.indexOf(legFromToEvent(t.leg_from));
        const toIdx   = legTypes.indexOf(legFromToEvent(t.leg_to));
        return fromIdx >= 0 && toIdx > fromIdx;
      });
      return hit || active[0];
    }

    case 'between_statuses':
    case null:
    case undefined:
    default: {
      // between_statuses tiers carry from_status + to_status on the tier
      // row; multi-tier between_statuses (e.g. "0-2h @ $50, 2h+ @ $75")
      // is a future enhancement. For Plan A we pick the first active tier.
      return active[0];
    }
  }
}

/**
 * Map a LEG_OPTIONS code (pick_up_container, deliver_container, etc.) to
 * the routing event type stored in order_routing_events.event_type.
 */
function legFromToEvent(leg) {
  const map = {
    pick_up_container:       'pull',
    deliver_container:       'deliver',
    return_container:        'return',
    drop_container:          'drop',
    stop_off:                'stop_off',
    terminate_chassis:       'terminate',
    completed:               'complete',
    hook_container:          'hook',
    hook_chassis:            'hook_chassis',
    lift_off:                'lift_off',
    lift_on:                 'lift_on',
    deliver_load_drop_hook:  'deliver',
    drop_chassis:            'drop_chassis',
  };
  return map[leg] || leg;
}

/**
 * Resolve the final cents amount for a charge profile given a load +
 * routing events. This is the single entrypoint both engines call in
 * place of their legacy getProfileAmount / getDriverProfileAmount.
 *
 * Returns { amount_cents, minimum_amount_cents, tier_id, duration_seconds }
 * so the caller can (a) apply a per-profile minimum and (b) include
 * duration in the diagnostic trace when requested.
 *
 * `tiers` is the flat array of tier rows (AR: profile.tiers; AP: selected
 * version's tiers — caller unnests the version layer before passing).
 */
export function resolveAmountCents({ tiers, calculation_mode, unit_of_measure }, context) {
  const tier = selectTier(tiers || [], calculation_mode, context);
  if (!tier) {
    return { amount_cents: 0, minimum_amount_cents: 0, tier_id: null, duration_seconds: 0 };
  }

  const baseCents = tier.amount_cents || 0;
  const minCents  = tier.minimum_amount_cents || 0;
  const freeUnits = tier.free_units || 0;

  // between_statuses with a time-based UOM is the only case that needs
  // a duration multiplier. Everything else returns the stored amount
  // (fixed tiers, percentage placeholder, by_event/move/leg tier picks).
  if (calculation_mode === 'between_statuses' && isTimeBased(unit_of_measure)) {
    const seconds = computeDurationSeconds(
      tier.from_status,
      tier.to_status,
      context?.load,
      context?.routingEvents
    );
    const total = applyTimeUom(baseCents, seconds, unit_of_measure, freeUnits);
    return {
      amount_cents: Math.max(total, minCents),
      minimum_amount_cents: minCents,
      tier_id: tier.id,
      duration_seconds: seconds,
    };
  }

  return {
    amount_cents: baseCents,
    minimum_amount_cents: minCents,
    tier_id: tier.id,
    duration_seconds: 0,
  };
}
