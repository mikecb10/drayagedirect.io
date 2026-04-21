import { computeNewDeliveryStatus } from '../../lib/webhooks/sendgrid-event-processor.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// Precedence table: bounced > dropped > spam_reported > delivered > deferred > null

// null → any event bumps
check('null → delivered becomes delivered', computeNewDeliveryStatus(null, 'delivered') === 'delivered');
check('null → bounced becomes bounced',     computeNewDeliveryStatus(null, 'bounced')   === 'bounced');
check('null → deferred becomes deferred',   computeNewDeliveryStatus(null, 'deferred')  === 'deferred');

// More severe replaces less severe
check('delivered → bounced becomes bounced', computeNewDeliveryStatus('delivered', 'bounced') === 'bounced');
check('deferred → delivered becomes delivered', computeNewDeliveryStatus('deferred', 'delivered') === 'delivered');
check('delivered → dropped becomes dropped', computeNewDeliveryStatus('delivered', 'dropped') === 'dropped');
check('delivered → spam_reported becomes spam_reported', computeNewDeliveryStatus('delivered', 'spam_reported') === 'spam_reported');

// Less severe does NOT replace more severe (conservative wins)
check('bounced → delivered keeps bounced', computeNewDeliveryStatus('bounced', 'delivered') === 'bounced');
check('bounced → deferred keeps bounced', computeNewDeliveryStatus('bounced', 'deferred') === 'bounced');
check('dropped → delivered keeps dropped', computeNewDeliveryStatus('dropped', 'delivered') === 'dropped');
check('spam_reported → delivered keeps spam_reported', computeNewDeliveryStatus('spam_reported', 'delivered') === 'spam_reported');

// Same-severity is idempotent (keeps current)
check('delivered → delivered stays delivered', computeNewDeliveryStatus('delivered', 'delivered') === 'delivered');

// Unknown event types pass through unchanged (defensive)
check('unknown event type keeps current', computeNewDeliveryStatus('delivered', 'processed') === 'delivered');

// deferred only bumps null
check('deferred → deferred stays deferred', computeNewDeliveryStatus('deferred', 'deferred') === 'deferred');
check('null → spam_reported becomes spam_reported', computeNewDeliveryStatus(null, 'spam_reported') === 'spam_reported');

// Defensive: null newEvent passes through SEVERITY[null] = undefined and
// returns current (null). Not reached in production because isTrackedEvent
// filters first; documents the boundary for cold readers.
check('null current + null newEvent stays null', computeNewDeliveryStatus(null, null) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
