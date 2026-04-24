import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  isValidTransition,
  getAllowedNextStatuses,
  transitionEventStatus,
} from '../lib/routing/event-status-transition.js';

test('isValidTransition — pending can go to arrived or skipped', () => {
  assert.equal(isValidTransition('pending', 'arrived'), true);
  assert.equal(isValidTransition('pending', 'skipped'), true);
  assert.equal(isValidTransition('pending', 'departed'), false); // must pass through arrived
});

test('isValidTransition — arrived can go to departed or skipped', () => {
  assert.equal(isValidTransition('arrived', 'departed'), true);
  assert.equal(isValidTransition('arrived', 'skipped'), true);
  assert.equal(isValidTransition('arrived', 'pending'), false);
});

test('isValidTransition — departed is terminal', () => {
  assert.equal(isValidTransition('departed', 'arrived'), false);
  assert.equal(isValidTransition('departed', 'pending'), false);
  assert.equal(isValidTransition('departed', 'skipped'), false);
});

test('isValidTransition — skipped is terminal', () => {
  assert.equal(isValidTransition('skipped', 'arrived'), false);
  assert.equal(isValidTransition('skipped', 'departed'), false);
});

test('getAllowedNextStatuses', () => {
  assert.deepEqual(getAllowedNextStatuses('pending'), ['arrived', 'skipped']);
  assert.deepEqual(getAllowedNextStatuses('arrived'), ['departed', 'skipped']);
  assert.deepEqual(getAllowedNextStatuses('departed'), []);
  assert.deepEqual(getAllowedNextStatuses('skipped'), []);
});

test('transitionEventStatus rejects invalid transition', async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ single: async () => ({ data: { id: 'e1', event_status: 'departed' }, error: null }) }) }),
      }),
    }),
  };
  await assert.rejects(
    transitionEventStatus({
      supabase: fakeSupabase, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1', type: 'human' },
    }),
    /Invalid transition/,
  );
});

test('transitionEventStatus requires actor.type', async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ single: async () => ({ data: { id: 'e1', event_status: 'pending' }, error: null }) }) }),
      }),
    }),
  };
  await assert.rejects(
    transitionEventStatus({
      supabase: fakeSupabase, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1' }, // missing type
    }),
    /actor\.type is required/,
  );
});

test('transitionEventStatus rejects actor.type outside the enum', async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ single: async () => ({ data: { id: 'e1', event_status: 'pending' }, error: null }) }) }),
      }),
    }),
  };
  await assert.rejects(
    transitionEventStatus({
      supabase: fakeSupabase, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1', type: 'robot' }, // not in enum
    }),
    /actor\.type must be one of/,
  );
});
