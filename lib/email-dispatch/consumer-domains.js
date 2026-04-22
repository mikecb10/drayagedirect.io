/**
 * Consumer-domain blocklist for sender-address validation.
 *
 * Mail sent "from" these domains via SendGrid-as-relay fails DMARC and
 * gets silently dropped by Gmail/Outlook/Yahoo receivers. Any sender-
 * address write with one of these domains is rejected at the API layer.
 *
 * Keep this list in sync with the equivalent list in migration 082's
 * consumer-domain migration step (one-time concern; JS is the source of
 * truth going forward).
 */
export const CONSUMER_EMAIL_DOMAINS = Object.freeze([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'ymail.com',
  'mail.com',
]);

/**
 * True if `domain` is on the consumer blocklist.
 * Case- and whitespace-insensitive. Exact-match only (not substring).
 */
export function isConsumerDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  const normalized = domain.trim().toLowerCase();
  return CONSUMER_EMAIL_DOMAINS.includes(normalized);
}
