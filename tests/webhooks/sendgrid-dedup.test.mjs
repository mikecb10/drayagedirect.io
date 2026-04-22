import {
  extractBaseMessageId,
  isDuplicateEvent,
  normalizeEvent,
} from '../../lib/webhooks/sendgrid-event-processor.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// ── extractBaseMessageId ──
check('strips dot-suffix from sg_message_id',
  extractBaseMessageId('14c5d75ce93==.filter0001.16648') === '14c5d75ce93==');

check('returns input unchanged when no dot',
  extractBaseMessageId('justbase==') === 'justbase==');

check('returns null for null',
  extractBaseMessageId(null) === null);

check('returns null for empty string',
  extractBaseMessageId('') === null);

// ── isDuplicateEvent ──
check('detects duplicate via sg_event_id', isDuplicateEvent(
  [{ sg_event_id: 'a' }, { sg_event_id: 'b' }],
  'a',
) === true);

check('returns false for new event', isDuplicateEvent(
  [{ sg_event_id: 'a' }, { sg_event_id: 'b' }],
  'c',
) === false);

check('returns false for empty array', isDuplicateEvent([], 'a') === false);

check('returns false when delivery_events is null', isDuplicateEvent(null, 'a') === false);

check('returns false when sg_event_id is null/missing',
  isDuplicateEvent([{ sg_event_id: 'a' }], null) === false);

// ── normalizeEvent (canonical payload into delivery_events) ──
check('normalizeEvent extracts expected keys', (() => {
  const raw = {
    event: 'delivered',
    timestamp: 1713637200,
    sg_event_id: 'abc123',
    sg_message_id: 'base==.filter',
    email: 'a@b.com',
    response: '250 OK',
    reason: null,
    extra_field_ignored: 'x',
  };
  const norm = normalizeEvent(raw);
  return norm.event === 'delivered'
      && norm.timestamp === 1713637200
      && norm.sg_event_id === 'abc123'
      && norm.sg_message_id === 'base==.filter'
      && norm.email === 'a@b.com'
      && norm.response === '250 OK'
      && norm.reason === null
      && typeof norm.received_at === 'string';
})());

check('normalizeEvent defaults missing fields to null', (() => {
  const norm = normalizeEvent({ event: 'bounced', sg_event_id: 'x', sg_message_id: 'y', timestamp: 1 });
  return norm.email === null
      && norm.response === null
      && norm.reason === null;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
