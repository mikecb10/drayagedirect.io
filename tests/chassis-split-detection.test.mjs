import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  detectChassisSplit,
  isChassisReposition,
  hasChassisHandling,
} from '../lib/routing/chassis-split.js';

test('detectChassisSplit returns false when both chassis location fields are null', () => {
  const load = { hook_chassis_location_id: null, terminate_chassis_location_id: null };
  const r = detectChassisSplit(load);
  assert.equal(r.isSplit, false);
  assert.equal(r.isHookSplit, false);
  assert.equal(r.isTerminateSplit, false);
  assert.equal(r.hookLocationId, null);
  assert.equal(r.terminateLocationId, null);
});

test('detectChassisSplit returns true when hook_chassis_location_id is set', () => {
  const load = { hook_chassis_location_id: 'yard-uuid', terminate_chassis_location_id: null };
  const r = detectChassisSplit(load);
  assert.equal(r.isSplit, true);
  assert.equal(r.isHookSplit, true);
  assert.equal(r.isTerminateSplit, false);
  assert.equal(r.hookLocationId, 'yard-uuid');
});

test('detectChassisSplit returns true when terminate_chassis_location_id is set', () => {
  const load = { hook_chassis_location_id: null, terminate_chassis_location_id: 'yard-uuid-2' };
  const r = detectChassisSplit(load);
  assert.equal(r.isSplit, true);
  assert.equal(r.isHookSplit, false);
  assert.equal(r.isTerminateSplit, true);
  assert.equal(r.terminateLocationId, 'yard-uuid-2');
});

test('detectChassisSplit handles undefined fields as non-split', () => {
  const load = {};  // no keys set
  const r = detectChassisSplit(load);
  assert.equal(r.isSplit, false);
});

test('isChassisReposition checks load_type', () => {
  assert.equal(isChassisReposition({ load_type: 'chassis_reposition' }), true);
  assert.equal(isChassisReposition({ load_type: 'import' }), false);
  assert.equal(isChassisReposition({}), false);
});

test('hasChassisHandling is true for reposition OR split', () => {
  assert.equal(hasChassisHandling({ load_type: 'chassis_reposition' }), true);
  assert.equal(hasChassisHandling({ hook_chassis_location_id: 'uuid' }), true);
  assert.equal(hasChassisHandling({ terminate_chassis_location_id: 'uuid' }), true);
  assert.equal(hasChassisHandling({ load_type: 'import' }), false);
});
