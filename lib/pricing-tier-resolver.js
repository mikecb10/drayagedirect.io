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
  // Fallback to unfiltered tiers when nothing is active. This keeps
  // legacy profiles (built without date ranges, or with expired-but-
  // not-rotated ranges) returning a non-zero amount. Plan C adds a
  // diagnostic "no active tier on <date>" warning at the engine layer.
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
      // Match the first tier whose event_type appears on the load AND
      // whose location filter (if any) matches that specific event.
      // Lowercase event_type comparison to tolerate mixed-case data.
      const events = context?.routingEvents || [];
      const hit = active.find((t) => {
        if (!t.event_type) return false;
        const want = t.event_type.toLowerCase();
        // Find the first event on the load whose type matches the tier AND
        // whose location satisfies the tier's location filter. If the tier
        // has no location filter, any event of that type matches.
        const event = events.find((e) =>
          (e.event_type || '').toLowerCase() === want &&
          matchesLocationFilter(t, e, 'event_location')
        );
        return Boolean(event);
      });
      if (hit) return hit;
      // Fall back to active[0] ONLY when no tier has a location filter.
      // When a tier explicitly scoped itself to an org / city / zip and
      // the load didn't match, falling back to the stored amount would
      // silently bill "Dallas-only" rates on Houston loads. Return null
      // so the engine reports \$0 — the user's configured intent.
      const anyHasLocationFilter = active.some((t) => t.event_location_type);
      return anyHasLocationFilter ? null : active[0];
    }

    case 'by_move': {
      // Tiers are keyed by move_index (0-based). Pick the one matching the
      // load's first/selected move. For Plan A we target move_index 0.
      // TODO (Plan C or later): by_move tiers can carry location filters
      // via the move_events JSONB array (migration 030 / 067) — the shape
      // is [{event, event_time, location_id, location_type, location_value}].
      // Not yet honored by selectTier; location-scoped by_move pricing will
      // silently match any move's first tier. Fix when per-move detention
      // rates land.
      const hit = active.find((t) => t.move_index === 0 || t.move_index == null);
      return hit || active[0];
    }

    case 'by_leg': {
      // AP only. Match leg_from + leg_to against the routing event sequence,
      // AND require both endpoints' location filters (if set) to match.
      const events = context?.routingEvents || [];
      const hit = active.find((t) => {
        if (!t.leg_from || !t.leg_to) return false;
        const wantFrom = legFromToEvent(t.leg_from).toLowerCase();
        const wantTo   = legFromToEvent(t.leg_to).toLowerCase();
        // Find the first from-event that satisfies leg_from_location_*.
        // Then find the first to-event AFTER it that satisfies leg_to_location_*.
        // Scanning the sequence this way lets a tier say "pickup in Dallas →
        // deliver in Oklahoma City" and only match when BOTH endpoints line up.
        // Lowercase comparison matches by_event's behavior (resilient to
        // mixed-case event_type values from imports).
        const fromIdx = events.findIndex((e) =>
          (e.event_type || '').toLowerCase() === wantFrom && matchesLocationFilter(t, e, 'leg_from_location')
        );
        if (fromIdx < 0) return false;
        const toIdx = events.findIndex((e, i) =>
          i > fromIdx && (e.event_type || '').toLowerCase() === wantTo && matchesLocationFilter(t, e, 'leg_to_location')
        );
        return toIdx >= 0;
      });
      if (hit) return hit;
      // Note: legs like 'lift_on' exist in LEG_OPTIONS (UI) but don't
      // correspond to a stored order_routing_events.event_type yet. Those
      // tiers fall through to active[0]. Tracked for a future routing update.
      //
      // Same fallback-masking rule as by_event: if a tier has an explicit
      // leg_from or leg_to location filter, a miss returns null (engine
      // bills \$0) rather than silently falling back to the stored amount.
      const anyHasLocationFilter = active.some((t) =>
        t.leg_from_location_type || t.leg_to_location_type
      );
      return anyHasLocationFilter ? null : active[0];
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
 * Check if a tier's location filter matches a routing event.
 *
 * Tiers can scope a rate to a specific location using three columns
 * (or trios on by_leg tiers):
 *   - <prefix>_type:  'org' | 'city_state' | 'zip' | 'profile_group'
 *   - <prefix>_id:    UUID (when type = 'org')
 *   - <prefix>_value: free text (when type = 'city_state' or 'zip')
 *
 * When the type is null/empty, the tier is unconstrained → match.
 * When the type is 'profile_group', we fall through to match (deferred
 * to Plan D — the profile_groups table doesn't exist yet).
 *
 * @param {object} tier — a tier row
 * @param {object} event — a routing event with location_id, city, state, zip
 * @param {string} prefix — field prefix: 'event_location', 'leg_from_location', or 'leg_to_location'
 * @returns {boolean}
 */
function matchesLocationFilter(tier, event, prefix) {
  const type = tier?.[`${prefix}_type`];

  // No type set → tier doesn't care about location. Match.
  if (!type) return true;

  // profile_group is a declared UI value but has no data source yet.
  // Fail-open so the UI doesn't appear broken while the feature is
  // stubbed; Plan D adds real filtering once the tables land.
  if (type === 'profile_group' || type === 'profile') return true;

  if (!event) return false;

  if (type === 'org') {
    const tid = tier?.[`${prefix}_id`];
    if (!tid) return false;
    return event.location_id === tid;
  }

  if (type === 'city_state') {
    const raw = tier?.[`${prefix}_value`];
    if (!raw) return false;
    return normalizeCityState(raw) === normalizeCityState(`${event.city || ''}, ${event.state || ''}`);
  }

  if (type === 'zip') {
    const raw = tier?.[`${prefix}_value`];
    if (!raw) return false;
    const a = normalizeZip(raw);
    const b = normalizeZip(event.zip);
    // Null on either side (empty or non-numeric) means we can't compare
    // safely. Fail-closed rather than returning a false positive.
    if (!a || !b) return false;
    return a === b;
  }

  // Unknown type → fail-closed. Better to miss a match than to bill wrong.
  return false;
}

/**
 * Normalize a "City, ST" style string for comparison:
 * lowercase, collapse whitespace, strip trailing commas, tolerate
 * missing or extra commas ("Dallas TX" / "Dallas,TX" / "Dallas, TX"
 * all compare equal).
 */
function normalizeCityState(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a zip for comparison. Accepts "75201", "75201-1234", " 75201 "
 * and compares on the 5-digit prefix only (zip+4 suffix is routing noise
 * for pricing purposes; the 5-digit base defines the market).
 */
function normalizeZip(s) {
  const digits = String(s || '').replace(/[^0-9]/g, '');
  // Fail-closed on empty/non-numeric: return null so two empty zips don't
  // compare equal (which would make a tier with an empty zip_value match
  // a location with no zip data — a silent false positive).
  if (!digits) return null;
  return digits.slice(0, 5);
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
    // Schema asymmetry: AR stores the endpoints as from_status/to_status
    // (migration 026), AP stores them as status_from/status_to (migration
    // 071). Accept either naming so the shared resolver works against both
    // engines without forcing the caller to rename columns.
    const fromStatus = tier.from_status ?? tier.status_from;
    const toStatus   = tier.to_status   ?? tier.status_to;
    const seconds = computeDurationSeconds(
      fromStatus,
      toStatus,
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
    amount_cents: Math.max(baseCents, minCents),
    minimum_amount_cents: minCents,
    tier_id: tier.id,
    duration_seconds: 0,
  };
}
