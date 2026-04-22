import { parseReplyTo } from '../../lib/email-dispatch/parse-reply-to.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// Valid combined format
const r1 = parseReplyTo('"Acme Trucking" <acme@acme.com>');
check('combined: name + email', r1.ok === true && r1.name === 'Acme Trucking' && r1.email === 'acme@acme.com');

const r2 = parseReplyTo('Acme Trucking <acme@acme.com>');
check('combined: bare name (no quotes) + email', r2.ok === true && r2.name === 'Acme Trucking' && r2.email === 'acme@acme.com');

// Email only
const r3 = parseReplyTo('acme@acme.com');
check('email only: name is null', r3.ok === true && r3.name === null && r3.email === 'acme@acme.com');

// Empty / whitespace → ok with nulls (means "clear the reply-to")
const r4 = parseReplyTo('');
check('empty string: ok, nulls', r4.ok === true && r4.name === null && r4.email === null);

const r5 = parseReplyTo('   ');
check('whitespace-only: ok, nulls', r5.ok === true && r5.name === null && r5.email === null);

const r6 = parseReplyTo(null);
check('null input: ok, nulls', r6.ok === true && r6.name === null && r6.email === null);

// Invalid formats
const r7 = parseReplyTo('Acme Trucking');
check('name only: reject', r7.ok === false && typeof r7.error === 'string');

const r8 = parseReplyTo('"Acme <acme@acme.com');
check('unclosed angle: reject', r8.ok === false && typeof r8.error === 'string');

const r9 = parseReplyTo('not an email');
check('garbage input: reject', r9.ok === false);

// Trim whitespace
const r10 = parseReplyTo('  acme@acme.com  ');
check('trims outer whitespace on email-only', r10.ok === true && r10.email === 'acme@acme.com');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
