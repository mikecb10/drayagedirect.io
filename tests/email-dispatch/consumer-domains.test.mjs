import { isConsumerDomain, CONSUMER_EMAIL_DOMAINS } from '../../lib/email-dispatch/consumer-domains.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// Exact-match blocklist
check('blocks gmail.com', isConsumerDomain('gmail.com') === true);
check('blocks yahoo.com', isConsumerDomain('yahoo.com') === true);
check('blocks outlook.com', isConsumerDomain('outlook.com') === true);
check('blocks hotmail.com', isConsumerDomain('hotmail.com') === true);
check('blocks live.com', isConsumerDomain('live.com') === true);
check('blocks icloud.com', isConsumerDomain('icloud.com') === true);
check('blocks aol.com', isConsumerDomain('aol.com') === true);
check('blocks protonmail.com', isConsumerDomain('protonmail.com') === true);
check('blocks ymail.com', isConsumerDomain('ymail.com') === true);
check('blocks mail.com', isConsumerDomain('mail.com') === true);

// Normalization
check('normalizes case: Gmail.COM', isConsumerDomain('Gmail.COM') === true);
check('normalizes whitespace: "  gmail.com  "', isConsumerDomain('  gmail.com  ') === true);

// Exact match, not substring
check('does not match gmail.com.evil.com', isConsumerDomain('gmail.com.evil.com') === false);
check('does not match fakegmail.com', isConsumerDomain('fakegmail.com') === false);

// Null / empty / invalid input
check('returns false on null', isConsumerDomain(null) === false);
check('returns false on undefined', isConsumerDomain(undefined) === false);
check('returns false on empty string', isConsumerDomain('') === false);

// Custom domains pass through
check('allows acmetrucking.com', isConsumerDomain('acmetrucking.com') === false);
check('allows drayagedirect.io', isConsumerDomain('drayagedirect.io') === false);

// Constant exposed
check('CONSUMER_EMAIL_DOMAINS is an array of 10 entries', CONSUMER_EMAIL_DOMAINS.length === 10);
check('CONSUMER_EMAIL_DOMAINS is frozen', Object.isFrozen(CONSUMER_EMAIL_DOMAINS));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
