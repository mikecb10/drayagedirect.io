/**
 * Composite atomic helper for driver-initiated actions. Wraps:
 *   1. GPS ping insert into driver_location_pings (source='mobile_app')
 *   2. ping_count cap enforcement (PING_CAP per move)
 *   3. drivers.last_* denormalization (where-is-driver-now)
 *   4. order_container_moves.last_ping_at + ping_count update (staleness)
 *   5. event-status transition (for arrive/depart)
 *   6. tracking-session transition (for all action types)
 *
 * Both transitions reference the inserted ping_id in actor_context.
 *
 * Single Postgres transaction is NOT enforced (Supabase JS client doesn't
 * expose explicit BEGIN/COMMIT). Steps execute serially; partial failures
 * leave audit history intact via the log-and-continue pattern in helpers.
 *
 * Spec: docs/superpowers/specs/2026-04-24-driver-move-tracking-design.md §3
 * Schema reconciliation note (PR 1 of plan): pings go to driver_location_pings
 * (NOT move_position_snapshots). Driver-level current location lives on
 * drivers.last_* (from migration 036), not on order_container_moves.current_*.
 */

import { transitionEventStatus } from './event-status-transition.js';
import { transitionTrackingSession } from './tracking-session-transition.js';

// Lifetime cap on GPS pings per move. The original spec specified 40 but
// real-world drayage moves at the plan's slowest cadence (300s on-site) over
// an 8-hour shift can legitimately exceed 96; at 60s in-transit cadence over
// a 4-hour long-haul leg, ~240 pings. 500 covers full-shift in-transit at
// 60s + a generous offline-queue flush margin while still preventing pure
// runaway loops. A future fix (FU follow-up) should replace this lifetime
// cap with a per-time-window rate limiter (pings/min) — that's the real
// runaway-loop protection. For v1 the lifetime cap is good enough.
const PING_CAP = 500;
const PING_SOURCE = 'mobile_app';

/**
 * @param {object} params
 * @param {object} params.supabase
 * @param {string} params.tenantId
 * @param {string} params.moveId
 * @param {'start'|'arrive'|'depart'|'undo'} params.actionType
 * @param {string} params.driverId
 * @param {object} [params.gpsPing]   { latitude, longitude, recorded_at, accuracy_meters?, speed_mph?, heading?, battery_pct? }
 * @param {string} [params.targetEventId]   required for arrive/depart
 * @returns {Promise<{ event?: object, move: object, ping_id?: string }>}
 */
export async function applyDriverAction({
  supabase, tenantId, moveId, actionType,
  driverId, gpsPing, targetEventId,
}) {
  // 1. Read current move state
  const { data: move, error: moveErr } = await supabase
    .from('order_container_moves')
    .select('id, tenant_id, driver_id, tracking_status, ping_count, eta_recompute_count')
    .eq('id', moveId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (moveErr) throw moveErr;
  if (!move) throw new Error(`Move not found: ${moveId}`);
  if (move.driver_id == null) {
    // Distinct from forbidden — endpoint will surface as 409 conflict, not 403.
    throw new Error('move_unassigned');
  }
  if (move.driver_id !== driverId) {
    throw new Error('forbidden: driver does not own this move');
  }

  // 2. Cap enforcement
  if (gpsPing && (move.ping_count ?? 0) >= PING_CAP) {
    throw new Error('ping_cap_reached');
  }

  // 3. Insert GPS ping (if provided) into driver_location_pings
  let pingId = null;
  if (gpsPing) {
    const { data: pingRow, error: pingErr } = await supabase
      .from('driver_location_pings')
      .insert({
        tenant_id: tenantId,
        move_id: moveId,
        driver_id: driverId,
        latitude: gpsPing.latitude,
        longitude: gpsPing.longitude,
        accuracy_meters: gpsPing.accuracy_meters ?? null,
        speed_mph: gpsPing.speed_mph ?? null,
        heading: gpsPing.heading ?? null,
        battery_pct: gpsPing.battery_pct ?? null,
        source: PING_SOURCE,
        recorded_at: gpsPing.recorded_at,
      })
      .select()
      .single();
    if (pingErr) throw pingErr;
    pingId = pingRow.id;

    // 3a. Denormalize "where is driver now" onto drivers row.
    //     drivers.last_* is the single source of truth for current driver
    //     position (migration 036). NOT duplicated onto order_container_moves.
    //     Log-and-continue: a denorm failure here would leave the dispatcher
    //     UI showing stale position, but the ping itself is durable and the
    //     primary state transitions still happen. Better than aborting the
    //     whole composite mid-flight.
    const { error: denormErr } = await supabase
      .from('drivers')
      .update({
        last_latitude: gpsPing.latitude,
        last_longitude: gpsPing.longitude,
        last_location_at: gpsPing.recorded_at,
        last_location_source: PING_SOURCE,
        last_speed_mph: gpsPing.speed_mph ?? null,
        last_heading: gpsPing.heading ?? null,
      })
      .eq('id', driverId)
      .eq('tenant_id', tenantId);
    if (denormErr) {
      console.error(`driver denorm update failed for ${driverId}:`, denormErr.message);
    }

    // 3b. Bump move's ping_count + last_ping_at (staleness-check column).
    //     NOTE: deliberately NOT writing current_lat/current_lng — those
    //     columns don't exist on order_container_moves. drivers.last_latitude/
    //     longitude is the authoritative source.
    const { error: counterErr } = await supabase
      .from('order_container_moves')
      .update({
        ping_count: (move.ping_count ?? 0) + 1,
        last_ping_at: gpsPing.recorded_at,
      })
      .eq('id', moveId)
      .eq('tenant_id', tenantId);
    if (counterErr) {
      console.error(`move counter update failed for ${moveId}:`, counterErr.message);
    }
  }

  const actorContext = { source: 'driver_app', ping_id: pingId };

  // 4. Resolve transition targets and fire event-status transition if needed
  let event = null;
  let trackingTarget = null;

  if (actionType === 'start') {
    trackingTarget = 'in_transit';
  } else if (actionType === 'arrive') {
    if (!targetEventId) throw new Error('targetEventId required for arrive');
    event = await transitionEventStatus({
      supabase, tenantId, eventId: targetEventId, toStatus: 'arrived',
      actor: { id: driverId, type: 'human', context: actorContext },
    });
    trackingTarget = 'on_site';
  } else if (actionType === 'depart') {
    if (!targetEventId) throw new Error('targetEventId required for depart');
    event = await transitionEventStatus({
      supabase, tenantId, eventId: targetEventId, toStatus: 'departed',
      actor: { id: driverId, type: 'human', context: actorContext },
    });
    // Track-target depends on whether remaining non-terminal events exist.
    const { data: laterEvents } = await supabase
      .from('order_routing_events')
      .select('id, event_status')
      .eq('tenant_id', tenantId)
      .eq('move_id', moveId)
      .neq('event_status', 'departed')
      .neq('event_status', 'skipped')
      .neq('id', targetEventId);
    trackingTarget = (laterEvents && laterEvents.length > 0) ? 'in_transit' : 'completed';
  } else if (actionType === 'undo') {
    throw new Error('undo handled by separate path');
  } else {
    throw new Error(`unknown actionType: ${actionType}`);
  }

  // 5. Tracking-session transition
  const updatedMove = await transitionTrackingSession({
    supabase, tenantId, moveId, toStatus: trackingTarget,
    actor: { id: driverId, type: 'human', context: actorContext },
  });

  return { event, move: updatedMove, ping_id: pingId };
}
