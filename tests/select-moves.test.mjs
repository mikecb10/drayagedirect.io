import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { selectMoves } from '../lib/pdf/select-moves.js';

const MOVES = [
  { move_index: 1, status: 'completed' },
  { move_index: 2, status: 'in_progress' },
  { move_index: 3, status: 'unassigned' },
];

test('full returns all moves sorted by move_index', () => {
  const scrambled = [MOVES[2], MOVES[0], MOVES[1]];
  const out = selectMoves(scrambled, 'delivery_order_full');
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.move_index), [1, 2, 3]);
});

test('next_move returns the first non-completed/cancelled move', () => {
  const out = selectMoves(MOVES, 'delivery_order_next_move');
  assert.equal(out.length, 1);
  assert.equal(out[0].move_index, 2);
  assert.equal(out[0].status, 'in_progress');
});

test('next_move skips cancelled moves', () => {
  const moves = [
    { move_index: 1, status: 'completed' },
    { move_index: 2, status: 'cancelled' },
    { move_index: 3, status: 'pending' },
  ];
  const out = selectMoves(moves, 'delivery_order_next_move');
  assert.equal(out.length, 1);
  assert.equal(out[0].move_index, 3);
});

test('next_move returns null when all moves are completed', () => {
  const moves = [
    { move_index: 1, status: 'completed' },
    { move_index: 2, status: 'completed' },
  ];
  const out = selectMoves(moves, 'delivery_order_next_move');
  assert.equal(out, null);
});

test('next_move returns null when all moves are cancelled', () => {
  const moves = [{ move_index: 1, status: 'cancelled' }];
  const out = selectMoves(moves, 'delivery_order_next_move');
  assert.equal(out, null);
});

test('next_move treats brand-new (unassigned) load as eligible', () => {
  const moves = [
    { move_index: 1, status: 'unassigned' },
    { move_index: 2, status: 'unassigned' },
  ];
  const out = selectMoves(moves, 'delivery_order_next_move');
  assert.equal(out.length, 1);
  assert.equal(out[0].move_index, 1);
});

test('empty moves array returns empty array for full and null for next_move', () => {
  assert.deepEqual(selectMoves([], 'delivery_order_full'), []);
  assert.equal(selectMoves([], 'delivery_order_next_move'), null);
});

test('null moves arg is treated as empty', () => {
  assert.deepEqual(selectMoves(null, 'delivery_order_full'), []);
  assert.equal(selectMoves(null, 'delivery_order_next_move'), null);
});
