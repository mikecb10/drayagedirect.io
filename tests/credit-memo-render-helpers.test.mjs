import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  resolveMemoNumber,
  computeAppliedAmount,
} from '../lib/pdf/credit-memo-helpers.js';

// ── resolveMemoNumber ──────────────────────────────────────────

test('resolveMemoNumber returns the real memo_number when set', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: 'CM-2026-014', id: 'a1b2c3d4-1111-2222-3333-444455556666' }),
    'CM-2026-014',
  );
});

test('resolveMemoNumber falls back to CM-{id:0:8} uppercase when memo_number is null', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: null, id: 'a1b2c3d4-1111-2222-3333-444455556666' }),
    'CM-A1B2C3D4',
  );
});

test('resolveMemoNumber falls back when memo_number is empty string', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: '', id: 'a1b2c3d4-1111-2222-3333-444455556666' }),
    'CM-A1B2C3D4',
  );
});

test('resolveMemoNumber falls back when memo_number is whitespace only', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: '   ', id: 'a1b2c3d4-1111-2222-3333-444455556666' }),
    'CM-A1B2C3D4',
  );
});

test('resolveMemoNumber trims real memo_number', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: '  CM-2026-014  ', id: 'a1b2c3d4-...' }),
    'CM-2026-014',
  );
});

test('resolveMemoNumber returns CM-UNKNOWN if both memo_number and id are missing', () => {
  assert.equal(resolveMemoNumber({}), 'CM-UNKNOWN');
  assert.equal(resolveMemoNumber({ memo_number: null, id: null }), 'CM-UNKNOWN');
});

// ── computeAppliedAmount ───────────────────────────────────────

test('computeAppliedAmount returns null when applied invoice is null', () => {
  assert.equal(computeAppliedAmount({ amount_cents: 40000 }, null), null);
  assert.equal(computeAppliedAmount({ amount_cents: 40000 }, undefined), null);
});

test('computeAppliedAmount returns memo amount when smaller than invoice total', () => {
  // memo is $400, invoice total is $1000 → applied = $400
  assert.equal(
    computeAppliedAmount({ amount_cents: 40000 }, { total_amount_cents: 100000 }),
    40000,
  );
});

test('computeAppliedAmount clamps to invoice total when memo exceeds it', () => {
  // memo is $1000, invoice total is $400 → applied = $400
  assert.equal(
    computeAppliedAmount({ amount_cents: 100000 }, { total_amount_cents: 40000 }),
    40000,
  );
});

test('computeAppliedAmount returns 0 when invoice total is 0', () => {
  // Degenerate case: zero-total invoice. min(any, 0) = 0.
  assert.equal(
    computeAppliedAmount({ amount_cents: 40000 }, { total_amount_cents: 0 }),
    0,
  );
});

test('computeAppliedAmount returns 0 when memo amount is 0', () => {
  assert.equal(
    computeAppliedAmount({ amount_cents: 0 }, { total_amount_cents: 100000 }),
    0,
  );
});

test('computeAppliedAmount handles equal amounts', () => {
  // memo and invoice both $400 → applied = $400
  assert.equal(
    computeAppliedAmount({ amount_cents: 40000 }, { total_amount_cents: 40000 }),
    40000,
  );
});
