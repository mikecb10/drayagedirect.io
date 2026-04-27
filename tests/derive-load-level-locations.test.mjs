import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deriveLoadLevelLocations } from '../lib/pdf/render-delivery-order.js';

test('deriveLoadLevelLocations finds first pull / last deliver / last return across multi-move', () => {
  const moves = [
    { events: [
      { sequence: 1, event_type: 'pull',    location: { name: 'PORT A', city: 'Newark', state: 'NJ' } },
      { sequence: 2, event_type: 'deliver', location: { name: 'WAREHOUSE A', city: 'Edison', state: 'NJ' } },
    ] },
    { events: [
      { sequence: 3, event_type: 'pull',    location: { name: 'WAREHOUSE A', city: 'Edison', state: 'NJ' } },
      { sequence: 4, event_type: 'deliver', location: { name: 'CUSTOMER B', city: 'Trenton', state: 'NJ' } },
      { sequence: 5, event_type: 'return',  location: { name: 'PORT A', city: 'Newark', state: 'NJ' } },
    ] },
  ];
  const r = deriveLoadLevelLocations(moves);
  assert.equal(r.pickup_location.name, 'PORT A');       // first pull
  assert.equal(r.delivery_location.name, 'CUSTOMER B'); // last deliver
  assert.equal(r.return_location.name, 'PORT A');       // last return
});

test('deriveLoadLevelLocations handles single-move loads', () => {
  const moves = [
    { events: [
      { sequence: 1, event_type: 'pull',    location: { name: 'PORT', city: 'X', state: 'NJ' } },
      { sequence: 2, event_type: 'deliver', location: { name: 'DROP', city: 'Y', state: 'NJ' } },
      { sequence: 3, event_type: 'return',  location: { name: 'PORT', city: 'X', state: 'NJ' } },
    ] },
  ];
  const r = deriveLoadLevelLocations(moves);
  assert.equal(r.pickup_location.name, 'PORT');
  assert.equal(r.delivery_location.name, 'DROP');
  assert.equal(r.return_location.name, 'PORT');
});

test('deriveLoadLevelLocations handles one-way drayage (no return)', () => {
  const moves = [
    { events: [
      { sequence: 1, event_type: 'pull',    location: { name: 'PORT', city: 'X', state: 'NJ' } },
      { sequence: 2, event_type: 'deliver', location: { name: 'DROP', city: 'Y', state: 'NJ' } },
    ] },
  ];
  const r = deriveLoadLevelLocations(moves);
  assert.equal(r.pickup_location.name, 'PORT');
  assert.equal(r.delivery_location.name, 'DROP');
  assert.equal(r.return_location, null);
});

test('deriveLoadLevelLocations returns nulls for empty moves array', () => {
  assert.deepEqual(deriveLoadLevelLocations([]), {
    pickup_location: null,
    delivery_location: null,
    return_location: null,
  });
});

test('deriveLoadLevelLocations returns nulls when moves have no events', () => {
  assert.deepEqual(deriveLoadLevelLocations([{ events: [] }, { events: [] }]), {
    pickup_location: null,
    delivery_location: null,
    return_location: null,
  });
});

test('deriveLoadLevelLocations skips events without location', () => {
  const moves = [
    { events: [
      { sequence: 1, event_type: 'pull',    location: null },
      { sequence: 2, event_type: 'deliver', location: { name: 'DROP', city: 'X', state: 'NJ' } },
    ] },
  ];
  const r = deriveLoadLevelLocations(moves);
  assert.equal(r.pickup_location, null);
  assert.equal(r.delivery_location.name, 'DROP');
});

test('deriveLoadLevelLocations sorts events by sequence across moves', () => {
  const moves = [
    { events: [
      { sequence: 5, event_type: 'return', location: { name: 'RETURN_LATE', city: 'X', state: 'NJ' } },
    ] },
    { events: [
      { sequence: 1, event_type: 'pull', location: { name: 'PULL_FIRST', city: 'X', state: 'NJ' } },
    ] },
  ];
  const r = deriveLoadLevelLocations(moves);
  assert.equal(r.pickup_location.name, 'PULL_FIRST');
  assert.equal(r.return_location.name, 'RETURN_LATE');
});

test('deriveLoadLevelLocations location object has expected shape', () => {
  const moves = [
    { events: [
      { sequence: 1, event_type: 'pull', location: { name: 'PORT', city: 'NEWARK', state: 'NJ' } },
    ] },
  ];
  const r = deriveLoadLevelLocations(moves);
  assert.deepEqual(r.pickup_location, {
    name: 'PORT',
    address_line1: null,
    city: 'NEWARK',
    state: 'NJ',
    zip: null,
  });
});
