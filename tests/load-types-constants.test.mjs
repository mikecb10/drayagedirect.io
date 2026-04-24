import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  LOAD_TYPES,
  VALID_LOAD_TYPES,
  LOAD_TYPE_LETTER,
  LOAD_TYPE_LABELS,
  TARIFF_MATCHING_LOAD_TYPES,
  DRIVER_TARIFF_MATCHING_LOAD_TYPES,
  DISPATCHER_BOARD_LOAD_TYPES,
  getLoadType,
  isValidLoadType,
} from '../lib/constants/load-types.js';

test('LOAD_TYPES contains all 7 types', () => {
  const values = LOAD_TYPES.map((t) => t.value);
  assert.deepEqual(values.sort(), [
    'bill_only', 'chassis_reposition', 'export', 'import',
    'inbound', 'outbound', 'road',
  ]);
});

test('every LOAD_TYPES entry has required fields', () => {
  for (const t of LOAD_TYPES) {
    assert.equal(typeof t.value, 'string', `missing value: ${JSON.stringify(t)}`);
    assert.equal(typeof t.label, 'string', `missing label: ${t.value}`);
    assert.equal(typeof t.letter, 'string', `missing letter: ${t.value}`);
    assert.equal(t.letter.length, 1, `letter must be single char: ${t.value}=${t.letter}`);
    assert.equal(typeof t.allowsNullContainer, 'boolean', `allowsNullContainer: ${t.value}`);
    assert.equal(typeof t.matchesTariffs, 'boolean', `matchesTariffs: ${t.value}`);
    assert.equal(typeof t.matchesDriverTariffs, 'boolean', `matchesDriverTariffs: ${t.value}`);
    assert.equal(typeof t.showsOnDispatcherBoard, 'boolean', `showsOnDispatcherBoard: ${t.value}`);
    assert.equal(typeof t.description, 'string', `description: ${t.value}`);
  }
});

test('LOAD_TYPE_LETTER has no duplicates', () => {
  const letters = LOAD_TYPES.map((t) => t.letter);
  const unique = new Set(letters);
  assert.equal(unique.size, letters.length, `duplicate letters: ${letters.join(',')}`);
});

test('existing letters preserved from pages/api/tenant/loads/index.js', () => {
  assert.equal(LOAD_TYPE_LETTER.import, 'M');
  assert.equal(LOAD_TYPE_LETTER.inbound, 'N');
  assert.equal(LOAD_TYPE_LETTER.export, 'E');
  assert.equal(LOAD_TYPE_LETTER.outbound, 'O');
  assert.equal(LOAD_TYPE_LETTER.road, 'R');
  assert.equal(LOAD_TYPE_LETTER.bill_only, 'B');
});

test('chassis_reposition uses letter C (collision resolution)', () => {
  assert.equal(LOAD_TYPE_LETTER.chassis_reposition, 'C');
});

test('VALID_LOAD_TYPES equals values list', () => {
  assert.deepEqual(VALID_LOAD_TYPES.sort(), LOAD_TYPES.map((t) => t.value).sort());
});

test('TARIFF_MATCHING_LOAD_TYPES excludes bill_only, includes chassis_reposition', () => {
  const values = TARIFF_MATCHING_LOAD_TYPES.map((t) => t.value);
  assert.ok(!values.includes('bill_only'), 'bill_only should NOT match tariffs');
  assert.ok(values.includes('chassis_reposition'), 'chassis_reposition SHOULD match tariffs');
});

test('chassis_reposition has reposition-specific flags', () => {
  const c = getLoadType('chassis_reposition');
  assert.equal(c.allowsNullContainer, true);
  assert.equal(c.requiresHookChassisLocation, true);
  assert.equal(c.requiresTerminateChassisLocation, true);
});

test('bill_only allows null container', () => {
  const b = getLoadType('bill_only');
  assert.equal(b.allowsNullContainer, true);
});

test('getLoadType returns null for unknown', () => {
  assert.equal(getLoadType('nonexistent'), null);
});

test('isValidLoadType', () => {
  assert.equal(isValidLoadType('import'), true);
  assert.equal(isValidLoadType('chassis_reposition'), true);
  assert.equal(isValidLoadType('nonexistent'), false);
});

test('LOAD_TYPE_LABELS is a value→label map', () => {
  assert.equal(LOAD_TYPE_LABELS.chassis_reposition, 'Chassis Reposition');
  assert.equal(LOAD_TYPE_LABELS.bill_only, 'Bill Only');
});

test('DISPATCHER_BOARD_LOAD_TYPES excludes bill_only', () => {
  const values = DISPATCHER_BOARD_LOAD_TYPES.map((t) => t.value);
  assert.ok(!values.includes('bill_only'));
  assert.ok(values.includes('chassis_reposition'));
});
