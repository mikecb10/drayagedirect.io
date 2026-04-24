/**
 * Tests for the stop-off-type rule primitives added in the Stop-Offs +
 * Chassis Splits Foundation (migration 100 + Task 15).
 *
 * These field keys roll up a load's routing events into load-level
 * predicates so the existing any_in / not_in operators can answer:
 *   - "load has at least one event of stop-off type X"
 *   - "load has at least one event whose stop-off type has flag F = true"
 *
 * The tariff + driver-tariff engines are responsible for joining
 * stop_off_types into load.routing_events; these tests bypass the DB and
 * construct the joined shape directly.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { evaluateConditions } from '../lib/condition-evaluator.js';

// ── Fixtures ─────────────────────────────────────────────────
const FUEL_STOP_ID = '11111111-1111-1111-1111-111111111111';
const CHASSIS_EXCHANGE_ID = '22222222-2222-2222-2222-222222222222';
const CROSS_DOCK_ID = '33333333-3333-3333-3333-333333333333';

// Represents the post-join shape the tariff engine now hands to the
// condition evaluator: each event has stop_off_type_id + joined
// stop_off_type record (or null if no stop-off is set on the event).
function mkEvent(overrides = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 10)}`,
    event_type: 'wait',
    sequence: 1,
    stop_off_type_id: null,
    stop_off_type: null,
    ...overrides,
  };
}

function fuelStopEvent(seq = 1) {
  return mkEvent({
    sequence: seq,
    stop_off_type_id: FUEL_STOP_ID,
    stop_off_type: {
      id: FUEL_STOP_ID,
      name: 'Fuel Stop',
      has_cargo_transfer: false,
      is_paid_to_driver: false,
      is_billable_to_customer: false,
      counts_toward_detention: false,
      requires_location_pick: true,
    },
  });
}

function chassisExchangeEvent(seq = 2) {
  return mkEvent({
    sequence: seq,
    stop_off_type_id: CHASSIS_EXCHANGE_ID,
    stop_off_type: {
      id: CHASSIS_EXCHANGE_ID,
      name: 'Chassis Exchange',
      has_cargo_transfer: false,
      is_paid_to_driver: true,
      is_billable_to_customer: false,
      counts_toward_detention: false,
      requires_location_pick: true,
    },
  });
}

function crossDockEvent(seq = 3) {
  return mkEvent({
    sequence: seq,
    stop_off_type_id: CROSS_DOCK_ID,
    stop_off_type: {
      id: CROSS_DOCK_ID,
      name: 'Cross-Dock',
      has_cargo_transfer: true,
      is_paid_to_driver: true,
      is_billable_to_customer: true,
      counts_toward_detention: true,
      requires_location_pick: true,
    },
  });
}

// ── event_stop_off_type_id ───────────────────────────────────

test('event_stop_off_type_id + any_in matches when load has an event of that type', () => {
  const load = { routing_events: [fuelStopEvent(), chassisExchangeEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_stop_off_type_id', operator: 'any_in', values: [FUEL_STOP_ID] },
  ]);
  assert.equal(ok, true);
});

test('event_stop_off_type_id + any_in returns false when no event has that type', () => {
  const load = { routing_events: [fuelStopEvent(), chassisExchangeEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_stop_off_type_id', operator: 'any_in', values: [CROSS_DOCK_ID] },
  ]);
  assert.equal(ok, false);
});

test('event_stop_off_type_id + any_in returns false when load has no routing events', () => {
  const load = { routing_events: [] };
  const ok = evaluateConditions(load, [
    { field: 'event_stop_off_type_id', operator: 'any_in', values: [FUEL_STOP_ID] },
  ]);
  assert.equal(ok, false);
});

test('event_stop_off_type_id + any_in ignores events with null stop_off_type_id', () => {
  const load = {
    routing_events: [
      mkEvent({ event_type: 'pull' }),  // no stop-off
      mkEvent({ event_type: 'deliver' }), // no stop-off
    ],
  };
  const ok = evaluateConditions(load, [
    { field: 'event_stop_off_type_id', operator: 'any_in', values: [FUEL_STOP_ID] },
  ]);
  assert.equal(ok, false);
});

test('event_stop_off_type_id + not_in returns true when no event matches the blocklist', () => {
  const load = { routing_events: [fuelStopEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_stop_off_type_id', operator: 'not_in', values: [CROSS_DOCK_ID] },
  ]);
  assert.equal(ok, true);
});

test('event_stop_off_type_id + not_in returns false when an event matches the blocklist', () => {
  const load = { routing_events: [fuelStopEvent(), crossDockEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_stop_off_type_id', operator: 'not_in', values: [CROSS_DOCK_ID] },
  ]);
  assert.equal(ok, false);
});

test('event_stop_off_type_id + any_in matches when multiple values are supplied', () => {
  const load = { routing_events: [fuelStopEvent()] };
  const ok = evaluateConditions(load, [
    {
      field: 'event_stop_off_type_id',
      operator: 'any_in',
      values: [FUEL_STOP_ID, CHASSIS_EXCHANGE_ID],
    },
  ]);
  assert.equal(ok, true);
});

// ── event_is_paid_to_driver (behavior-flag rollup) ───────────

test('event_is_paid_to_driver + any_in ["true"] matches when a paid stop-off exists', () => {
  const load = { routing_events: [fuelStopEvent(), chassisExchangeEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_is_paid_to_driver', operator: 'any_in', values: ['true'] },
  ]);
  assert.equal(ok, true);
});

test('event_is_paid_to_driver + any_in ["true"] returns false when no paid stop-off exists', () => {
  const load = { routing_events: [fuelStopEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_is_paid_to_driver', operator: 'any_in', values: ['true'] },
  ]);
  assert.equal(ok, false);
});

test('event_is_paid_to_driver returns false-tag when load has no routing events', () => {
  const load = { routing_events: [] };
  const ok = evaluateConditions(load, [
    { field: 'event_is_paid_to_driver', operator: 'any_in', values: ['false'] },
  ]);
  assert.equal(ok, true); // the empty-events load has no paid stop-offs → 'false'
});

test('event_is_paid_to_driver returns false-tag when events have no joined stop_off_type', () => {
  const load = {
    routing_events: [
      mkEvent({ event_type: 'pull' }),
      mkEvent({ event_type: 'deliver' }),
    ],
  };
  const ok = evaluateConditions(load, [
    { field: 'event_is_paid_to_driver', operator: 'any_in', values: ['false'] },
  ]);
  assert.equal(ok, true);
});

// ── event_has_cargo_transfer ─────────────────────────────────

test('event_has_cargo_transfer + any_in ["true"] matches when any cross-dock event exists', () => {
  const load = { routing_events: [fuelStopEvent(), crossDockEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_has_cargo_transfer', operator: 'any_in', values: ['true'] },
  ]);
  assert.equal(ok, true);
});

test('event_has_cargo_transfer + any_in ["true"] returns false for loads without a cargo-transfer stop', () => {
  const load = { routing_events: [fuelStopEvent(), chassisExchangeEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_has_cargo_transfer', operator: 'any_in', values: ['true'] },
  ]);
  assert.equal(ok, false);
});

// ── event_is_billable_to_customer ────────────────────────────

test('event_is_billable_to_customer rolls up across events', () => {
  const load = { routing_events: [crossDockEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_is_billable_to_customer', operator: 'any_in', values: ['true'] },
  ]);
  assert.equal(ok, true);
});

// ── event_counts_toward_detention ────────────────────────────

test('event_counts_toward_detention rolls up across events', () => {
  const load = { routing_events: [fuelStopEvent(), crossDockEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_counts_toward_detention', operator: 'any_in', values: ['true'] },
  ]);
  assert.equal(ok, true);
});

test('event_counts_toward_detention returns false when no counting stop-off exists', () => {
  const load = { routing_events: [fuelStopEvent(), chassisExchangeEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_counts_toward_detention', operator: 'any_in', values: ['true'] },
  ]);
  assert.equal(ok, false);
});

// ── event_requires_location_pick ─────────────────────────────

test('event_requires_location_pick matches when any stop-off requires a location', () => {
  const load = { routing_events: [fuelStopEvent()] };
  const ok = evaluateConditions(load, [
    { field: 'event_requires_location_pick', operator: 'any_in', values: ['true'] },
  ]);
  assert.equal(ok, true);
});

// ── AND-combination with existing rules ──────────────────────

test('stop-off rule AND-combines correctly with other rules', () => {
  const load = {
    customer_id: 'cust-1',
    load_type: 'import',
    routing_events: [fuelStopEvent()],
  };
  // Both conditions match → true
  const okBoth = evaluateConditions(load, [
    { field: 'load_type', operator: 'any_in', values: ['import'] },
    { field: 'event_stop_off_type_id', operator: 'any_in', values: [FUEL_STOP_ID] },
  ]);
  assert.equal(okBoth, true);

  // First matches, second doesn't → false
  const okOne = evaluateConditions(load, [
    { field: 'load_type', operator: 'any_in', values: ['import'] },
    { field: 'event_stop_off_type_id', operator: 'any_in', values: [CROSS_DOCK_ID] },
  ]);
  assert.equal(okOne, false);
});

// ── Context fallback (routingEvents on context instead of load) ──

test('stop-off rules use context.routingEvents when load.routing_events is missing', () => {
  const load = {}; // no routing_events key
  const ctx = { routingEvents: [fuelStopEvent()] };
  const ok = evaluateConditions(
    load,
    [{ field: 'event_stop_off_type_id', operator: 'any_in', values: [FUEL_STOP_ID] }],
    ctx,
  );
  assert.equal(ok, true);
});
