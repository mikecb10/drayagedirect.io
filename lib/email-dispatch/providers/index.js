/**
 * Provider registry — maps sender_kind → provider adapter.
 *
 * All adapters must export `dispatch(svc, tenantId, message)` returning
 * `{ ok, messageId, providerMessageId }`. Adapters are free to throw on
 * fatal errors; the dispatcher wraps each call in a try/catch.
 *
 * Phase 1 (Milestone 4c): every sender_kind routes to mock.js so trigger
 * runtime can be tested end-to-end without external accounts. Milestone
 * 4a swaps 'sendgrid' to a real SendGrid adapter; Milestone 4b swaps the
 * two gmail variants to real Gmail / Outlook OAuth adapters.
 */

import * as mock from './mock.js';
import * as sendgrid from './sendgrid.js';

// TODO (4b): import * as gmail from './gmail';

const REGISTRY = {
  sendgrid,
  shared_gmail: mock,
  user_gmail: mock,
  mock,
};

export function getProvider(senderKind) {
  return REGISTRY[senderKind] || REGISTRY.mock;
}

export function isMockProvider(senderKind) {
  // True while all senders still route through mock. Useful for the
  // trigger activity UI to badge messages as "simulated".
  return getProvider(senderKind) === mock;
}
