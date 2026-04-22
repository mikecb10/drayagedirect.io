import { resolveReplyTo } from '../../lib/email-dispatch/resolve-reply-to.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// Tier 1: config wins
const r1 = resolveReplyTo(
  { reply_to_email: 'dispatch@acme.com', reply_to_name: 'Acme Dispatch' },
  { contact_email: 'admin@acme.com' }
);
check('tier 1: full config reply-to wins',
  r1 !== null && r1.email === 'dispatch@acme.com' && r1.name === 'Acme Dispatch');

// Tier 1 with name null
const r2 = resolveReplyTo(
  { reply_to_email: 'dispatch@acme.com', reply_to_name: null },
  { contact_email: 'admin@acme.com' }
);
check('tier 1: config email, name null',
  r2 !== null && r2.email === 'dispatch@acme.com' && r2.name === null);

// Tier 2: tenant.contact_email when config reply_to_email is null
const r3 = resolveReplyTo(
  { reply_to_email: null, reply_to_name: null },
  { contact_email: 'admin@acme.com' }
);
check('tier 2: falls back to tenant.contact_email, name null',
  r3 !== null && r3.email === 'admin@acme.com' && r3.name === null);

// Tier 3: null when nothing
const r4 = resolveReplyTo(
  { reply_to_email: null, reply_to_name: null },
  { contact_email: null }
);
check('tier 3: returns null when everything null',
  r4 === null);

// Empty strings fall through
const r5 = resolveReplyTo(
  { reply_to_email: '', reply_to_name: '' },
  { contact_email: 'admin@acme.com' }
);
check('empty config reply_to_email falls through to tenant',
  r5 !== null && r5.email === 'admin@acme.com');

// Null config
const r6 = resolveReplyTo(null, { contact_email: 'admin@acme.com' });
check('null config falls through to tenant',
  r6 !== null && r6.email === 'admin@acme.com');

// Null tenant
const r7 = resolveReplyTo(null, null);
check('null config + null tenant returns null', r7 === null);

// Trimming
const r8 = resolveReplyTo(
  { reply_to_email: '  dispatch@acme.com  ', reply_to_name: '  Acme  ' },
  null
);
check('trims winning values',
  r8 !== null && r8.email === 'dispatch@acme.com' && r8.name === 'Acme');

// Legacy {email: ...} callers should not match (guards against reversion)
const r9 = resolveReplyTo(
  { reply_to_email: null, reply_to_name: null },
  { email: 'admin@acme.com' }
);
check('legacy {email} key is no longer read (was the bug)',
  r9 === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
