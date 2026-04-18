/**
 * Public API surface of the email dispatcher.
 *
 * Callers (load PUT handlers, UI action handlers, cron workers, test
 * endpoints) should only import from this barrel — the individual
 * submodules are implementation detail.
 */

export { fireTrigger } from './dispatcher.js';
export { fireFieldChangeTriggers } from './field-change-fire.js';
export { fireNotificationTrigger } from './notification-fire.js';
export { fireStatusChangeTriggers } from './status-change-fire.js';
export { fireRoutingEventTriggers } from './routing-event-fire.js';
export { runPolledEvaluation } from './polled-worker.js';
export {
  matchUmbrellaToLoad,
  resolveMatchingUmbrellas,
  dedupeUmbrellasById,
} from './umbrella-matcher.js';
export { buildTriggerContext } from './context-builder.js';
export { buildInvoiceContext } from './context-builder.js';
export { buildChargeSetContext } from './context-builder.js';
export {
  expandRecipients,
  expandGroupRecipients,
} from './recipient-expander.js';
export { getProvider, isMockProvider } from './providers/index.js';
export {
  AR_TEMPLATE_DEFAULTS,
  AR_SYSTEM_SLUGS,
  isArSystemSlug,
} from './ar-template-defaults.js';
export { resolveBillingRecipients } from './recipient-resolver.js';
