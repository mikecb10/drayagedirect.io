import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateLoadPayload } from '../lib/validation/load-payload.js';

test('rejects unknown load_type', () => {
  const r = validateLoadPayload({ load_type: 'nonsense' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown load_type/);
});

test('import load with no chassis location fields is ok', () => {
  const r = validateLoadPayload({ load_type: 'import', container_number: 'ABCD1234567' });
  assert.equal(r.ok, true);
});

test('chassis_reposition without hook_chassis_location_id fails', () => {
  const r = validateLoadPayload({
    load_type: 'chassis_reposition',
    terminate_chassis_location_id: 'yard-uuid-2',
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /hook_chassis_location_id is required/);
});

test('chassis_reposition without terminate_chassis_location_id fails', () => {
  const r = validateLoadPayload({
    load_type: 'chassis_reposition',
    hook_chassis_location_id: 'yard-uuid-1',
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /terminate_chassis_location_id is required/);
});

test('chassis_reposition with both chassis locations is ok (no container required)', () => {
  const r = validateLoadPayload({
    load_type: 'chassis_reposition',
    hook_chassis_location_id: 'yard-uuid-1',
    terminate_chassis_location_id: 'yard-uuid-2',
    // NO container_number — reposition allows null container
  });
  assert.equal(r.ok, true);
});

test('bill_only with no container is ok (allowsNullContainer)', () => {
  const r = validateLoadPayload({ load_type: 'bill_only' });
  assert.equal(r.ok, true);
});
