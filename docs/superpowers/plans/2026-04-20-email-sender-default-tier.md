# Email Sender Default Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-owned email sending subdomain (`drayagedirect.io`)
so every tenant can deliver mail via SendGrid without configuring their own DNS.
Adds per-tenant display name, branch-scoped sender identity, Reply-To configuration,
and auto-migration of existing consumer-domain tenants.

**Architecture:** Reuses the existing `sender_kind='sendgrid'` path — zero change
to `resolveFromAddress()`. Adds one shared `tenant_sender_domains` row
(`tenant_id=NULL`) for the platform domain. Every tenant gets their own
`tenant_sender_addresses` row referencing it, `local_part=tenants.slug`. New
columns on `email_configurations` (`from_display_name`, `reply_to_email`,
`reply_to_name`, `branch_id`) and `email_templates` (`from_display_name`)
drive a precedence chain resolved at send time. Consumer-domain validator
blocks new writes at the API layer. Migration is atomic, idempotent, and
rollback-safe via a backup table.

**Tech Stack:** Next.js pages API routes, Supabase Postgres migrations,
SendGrid Node.js SDK (`@sendgrid/mail`), `email-addresses` npm package for
Reply-To parsing, existing React components under
`pages/settings/communications/`.

**Design spec:** [`docs/superpowers/specs/2026-04-19-email-sender-default-tier-design.md`](../specs/2026-04-19-email-sender-default-tier-design.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/082_email_sender_default_tier.sql` | Schema changes + data migration |
| `lib/email-dispatch/consumer-domains.js` | Blocklist constant + `isConsumerDomain()` predicate |
| `lib/email-dispatch/parse-reply-to.js` | Parse free-text combined Reply-To into `{email, name}` |
| `lib/email-dispatch/resolve-from-display-name.js` | 4-tier precedence chain for From: display name |
| `lib/email-dispatch/resolve-reply-to.js` | 3-tier precedence chain for Reply-To header |
| `lib/email-dispatch/constants.js` | `PLATFORM_SENDER_DOMAIN` constant |
| `components/settings/communications/SenderIdentityFields.js` | Form fields for display name + Reply-To + branch scope |
| `components/settings/communications/SenderPreview.js` | Read-only "how recipients see this" preview pane |
| `components/settings/communications/MigrationBanner.js` | One-time dismissable info banner |
| `tests/email-dispatch/consumer-domains.test.mjs` | Node-script tests |
| `tests/email-dispatch/parse-reply-to.test.mjs` | Node-script tests |
| `tests/email-dispatch/resolve-from-display-name.test.mjs` | Node-script tests |
| `tests/email-dispatch/resolve-reply-to.test.mjs` | Node-script tests |

### Modified files

| Path | Change |
|---|---|
| `.env.example` | Add `SENDGRID_PLATFORM_SENDER_DOMAIN` + `SENDGRID_PLATFORM_DOMAIN_ID` |
| `lib/email-dispatch/dispatcher.js` | Wire new helpers into payload assembly |
| `lib/email-dispatch/providers/sendgrid.js` | Accept `reply_to_name`, pass to SendGrid `replyTo: {email, name}` |
| `pages/api/tenant/ar/invoices/bulk-send.js` | Branch-aware config selection; pass template to resolver |
| `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js` | Same changes |
| `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js` | Same changes |
| `pages/api/tenant/emails/configurations/index.js` | Accept + return new fields in POST |
| `pages/api/tenant/emails/configurations/[id].js` | Accept + return new fields in PUT/GET |
| `pages/api/tenant/emails/sender-addresses/index.js` | Consumer-domain validator |
| `pages/api/tenant/emails/sender-domains/index.js` | Consumer-domain validator |
| `pages/settings/communications/configurations/[id].js` | Mount `SenderIdentityFields` + branch picker |
| `pages/settings/communications/configurations/index.js` | Mount `MigrationBanner` + branch column in list |
| `pages/settings/communications/templates/[id].js` | Mount `SenderPreview` + display name override |
| `pages/admin/tenants/index.js` (and the API it calls) | Auto-provision sender_address + default config |
| `package.json` | Add `email-addresses` dep |

---

## Testing Pattern

Project has no test harness wired up. Following 2a.4's established pattern:
- **Pure helpers:** inline node scripts at `tests/email-dispatch/<name>.test.mjs`,
  run with `node <path>`, exit code 0 on pass / 1 on fail.
- **API endpoints:** `curl` verification with expected JSON shape.
- **Migration:** apply + SELECT verification against the local Supabase.
- **UI:** live Cowork + Claude-in-Chrome walkthrough via verification gates.

---

## Task 1: Consumer-domain blocklist + predicate

**Files:**
- Create: `lib/email-dispatch/consumer-domains.js`
- Test: `tests/email-dispatch/consumer-domains.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/email-dispatch/consumer-domains.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/email-dispatch/consumer-domains.test.mjs
```

Expected: `Error: Cannot find module '../../lib/email-dispatch/consumer-domains.js'`

- [ ] **Step 3: Implement consumer-domains.js**

```js
// lib/email-dispatch/consumer-domains.js
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/email-dispatch/consumer-domains.test.mjs
```

Expected: `21 passed, 0 failed` (or similar pass count).

- [ ] **Step 5: Commit**

```bash
git add lib/email-dispatch/consumer-domains.js tests/email-dispatch/consumer-domains.test.mjs
git commit -m "feat(email-sender): consumer-domain blocklist + predicate

Adds isConsumerDomain() helper and frozen blocklist constant for the
default-tier sender migration. Exact-match, case-normalized, whitespace-
tolerant. Used by both the API validator (forthcoming) and the migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Install `email-addresses` + Reply-To parser

**Files:**
- Modify: `package.json` (via npm install)
- Create: `lib/email-dispatch/parse-reply-to.js`
- Test: `tests/email-dispatch/parse-reply-to.test.mjs`

- [ ] **Step 1: Install dependency**

```bash
npm install --save email-addresses
```

Expected: `package.json` gets `"email-addresses": "^<version>"` in dependencies.

- [ ] **Step 2: Write the failing test**

```js
// tests/email-dispatch/parse-reply-to.test.mjs
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
```

- [ ] **Step 3: Run test to verify it fails**

```bash
node tests/email-dispatch/parse-reply-to.test.mjs
```

Expected: `Cannot find module '.../parse-reply-to.js'`

- [ ] **Step 4: Implement parse-reply-to.js**

```js
// lib/email-dispatch/parse-reply-to.js
import addrs from 'email-addresses';

/**
 * Parse a free-text Reply-To input into structured {email, name}.
 *
 * Accepts:
 *   - `"Acme Trucking" <acme@acme.com>`  → { name: 'Acme Trucking', email: 'acme@acme.com' }
 *   - `Acme Trucking <acme@acme.com>`     → { name: 'Acme Trucking', email: 'acme@acme.com' }
 *   - `acme@acme.com`                      → { name: null, email: 'acme@acme.com' }
 *   - empty / whitespace / null            → { name: null, email: null } (= "no reply-to")
 *
 * Rejects:
 *   - name-only ("Acme Trucking")
 *   - unclosed quotes/angles
 *   - anything that isn't a valid mailbox address
 *
 * @param input string | null
 * @returns { ok: true, email: string|null, name: string|null } | { ok: false, error: string }
 */
export function parseReplyTo(input) {
  if (input == null) return { ok: true, email: null, name: null };
  const trimmed = String(input).trim();
  if (trimmed === '') return { ok: true, email: null, name: null };

  const parsed = addrs.parseOneAddress(trimmed);
  if (!parsed || !parsed.address) {
    return {
      ok: false,
      error: 'Please use the format: "Your Company" <you@yourdomain.com>',
    };
  }

  return {
    ok: true,
    email: parsed.address,
    name: parsed.name || null,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node tests/email-dispatch/parse-reply-to.test.mjs
```

Expected: `10 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/email-dispatch/parse-reply-to.js tests/email-dispatch/parse-reply-to.test.mjs
git commit -m "feat(email-sender): Reply-To free-text parser + email-addresses dep

Parses tenant-entered '\"Acme\" <a@acme.com>' into structured {email, name}
for storage. Empty/null returns {ok: true, nulls}. Invalid formats return
{ok: false, error: <format hint>}. Wraps email-addresses npm package.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Display-name + Reply-To precedence resolvers

**Files:**
- Create: `lib/email-dispatch/resolve-from-display-name.js`
- Create: `lib/email-dispatch/resolve-reply-to.js`
- Test: `tests/email-dispatch/resolve-from-display-name.test.mjs`
- Test: `tests/email-dispatch/resolve-reply-to.test.mjs`

- [ ] **Step 1: Write failing test for resolve-from-display-name**

```js
// tests/email-dispatch/resolve-from-display-name.test.mjs
import { resolveFromDisplayName } from '../../lib/email-dispatch/resolve-from-display-name.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// Precedence chain: template > config > tenant > platform floor
check(
  'tier 1: template override wins',
  resolveFromDisplayName(
    { from_display_name: 'Acme Billing' },
    { from_display_name: 'Acme Trucking' },
    { name: 'Acme Logistics LLC' }
  ) === 'Acme Billing'
);

check(
  'tier 2: config wins when template null',
  resolveFromDisplayName(
    { from_display_name: null },
    { from_display_name: 'Acme Trucking' },
    { name: 'Acme Logistics LLC' }
  ) === 'Acme Trucking'
);

check(
  'tier 3: tenant.name wins when template + config null',
  resolveFromDisplayName(
    { from_display_name: null },
    { from_display_name: null },
    { name: 'Acme Logistics LLC' }
  ) === 'Acme Logistics LLC'
);

check(
  'tier 4: platform floor when everything null',
  resolveFromDisplayName(null, null, null) === 'DrayageDirect Notifications'
);

// Empty string + whitespace = fall through
check(
  'empty string falls through',
  resolveFromDisplayName(
    { from_display_name: '' },
    { from_display_name: 'Acme Trucking' },
    { name: 'X' }
  ) === 'Acme Trucking'
);

check(
  'whitespace-only falls through',
  resolveFromDisplayName(
    { from_display_name: '   ' },
    { from_display_name: 'Acme Trucking' },
    { name: 'X' }
  ) === 'Acme Trucking'
);

// Trims the winner
check(
  'trims winning value',
  resolveFromDisplayName(
    { from_display_name: '  Acme Billing  ' },
    null,
    null
  ) === 'Acme Billing'
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/email-dispatch/resolve-from-display-name.test.mjs
```

Expected: `Cannot find module '.../resolve-from-display-name.js'`

- [ ] **Step 3: Implement resolve-from-display-name.js**

```js
// lib/email-dispatch/resolve-from-display-name.js
/**
 * Resolve the display-name portion of the From: header.
 *
 * Precedence chain (first non-null, non-empty value wins):
 *   1. template.from_display_name
 *   2. config.from_display_name
 *   3. tenant.name
 *   4. 'DrayageDirect Notifications' (platform floor)
 *
 * @param template { from_display_name?: string } | null
 * @param config { from_display_name?: string } | null
 * @param tenant { name?: string } | null
 * @returns string (always non-empty)
 */
export function resolveFromDisplayName(template, config, tenant) {
  const chain = [
    template?.from_display_name,
    config?.from_display_name,
    tenant?.name,
    'DrayageDirect Notifications',
  ];
  for (const candidate of chain) {
    const trimmed = (candidate || '').trim();
    if (trimmed) return trimmed;
  }
  return 'DrayageDirect Notifications';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/email-dispatch/resolve-from-display-name.test.mjs
```

Expected: `7 passed, 0 failed`.

- [ ] **Step 5: Write failing test for resolve-reply-to**

```js
// tests/email-dispatch/resolve-reply-to.test.mjs
import { resolveReplyTo } from '../../lib/email-dispatch/resolve-reply-to.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// Tier 1: config wins
const r1 = resolveReplyTo(
  { reply_to_email: 'dispatch@acme.com', reply_to_name: 'Acme Dispatch' },
  { email: 'admin@acme.com' }
);
check('tier 1: full config reply-to wins',
  r1 !== null && r1.email === 'dispatch@acme.com' && r1.name === 'Acme Dispatch');

// Tier 1 with name null
const r2 = resolveReplyTo(
  { reply_to_email: 'dispatch@acme.com', reply_to_name: null },
  { email: 'admin@acme.com' }
);
check('tier 1: config email, name null',
  r2 !== null && r2.email === 'dispatch@acme.com' && r2.name === null);

// Tier 2: tenant.email when config reply_to_email is null
const r3 = resolveReplyTo(
  { reply_to_email: null, reply_to_name: null },
  { email: 'admin@acme.com' }
);
check('tier 2: falls back to tenant.email, name null',
  r3 !== null && r3.email === 'admin@acme.com' && r3.name === null);

// Tier 3: null when nothing
const r4 = resolveReplyTo(
  { reply_to_email: null, reply_to_name: null },
  { email: null }
);
check('tier 3: returns null when everything null',
  r4 === null);

// Empty strings fall through
const r5 = resolveReplyTo(
  { reply_to_email: '', reply_to_name: '' },
  { email: 'admin@acme.com' }
);
check('empty config reply_to_email falls through to tenant',
  r5 !== null && r5.email === 'admin@acme.com');

// Null config
const r6 = resolveReplyTo(null, { email: 'admin@acme.com' });
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 6: Run test to verify it fails**

```bash
node tests/email-dispatch/resolve-reply-to.test.mjs
```

Expected: `Cannot find module '.../resolve-reply-to.js'`

- [ ] **Step 7: Implement resolve-reply-to.js**

```js
// lib/email-dispatch/resolve-reply-to.js
/**
 * Resolve the Reply-To header value.
 *
 * Precedence chain:
 *   1. config.reply_to_email (+ reply_to_name)
 *   2. tenant.email (name = null)
 *   3. null (= do not set Reply-To header)
 *
 * We deliberately do NOT fall through to noreply@drayagedirect.io,
 * because that would route customer replies into a black hole. Better to
 * let replies bounce back to the From: address with a clear SendGrid error.
 *
 * @param config { reply_to_email?: string|null, reply_to_name?: string|null } | null
 * @param tenant { email?: string|null } | null
 * @returns { email: string, name: string|null } | null
 */
export function resolveReplyTo(config, tenant) {
  const configEmail = (config?.reply_to_email || '').trim();
  if (configEmail) {
    return {
      email: configEmail,
      name: (config?.reply_to_name || '').trim() || null,
    };
  }

  const tenantEmail = (tenant?.email || '').trim();
  if (tenantEmail) {
    return { email: tenantEmail, name: null };
  }

  return null;
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
node tests/email-dispatch/resolve-reply-to.test.mjs
```

Expected: `8 passed, 0 failed`.

- [ ] **Step 9: Commit**

```bash
git add lib/email-dispatch/resolve-from-display-name.js lib/email-dispatch/resolve-reply-to.js tests/email-dispatch/resolve-from-display-name.test.mjs tests/email-dispatch/resolve-reply-to.test.mjs
git commit -m "feat(email-sender): send-time precedence resolvers

Two pure helpers for resolving From: display name and Reply-To at send
time. 4-tier chain for display name (template > config > tenant > floor);
3-tier chain for reply-to (config > tenant > null). Both trim winning
values and fall through on empty/whitespace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Platform-domain constant + env var

**Files:**
- Create: `lib/email-dispatch/constants.js`
- Modify: `.env.example`

- [ ] **Step 1: Implement constants.js**

```js
// lib/email-dispatch/constants.js
/**
 * The platform-owned SendGrid-authenticated subdomain that every tenant
 * sends from on the default tier. Overridable via env var so staging can
 * use a separate subdomain.
 */
export const PLATFORM_SENDER_DOMAIN =
  process.env.SENDGRID_PLATFORM_SENDER_DOMAIN || 'drayagedirect.io';

/**
 * Platform fallback From: used only when a tenant has zero
 * email_configurations (should never happen post-migration, but the
 * floor of the precedence chain needs a sane default).
 */
export const PLATFORM_FALLBACK_FROM_NAME = 'DrayageDirect Notifications';
export const PLATFORM_FALLBACK_FROM_ADDRESS = `noreply@${PLATFORM_SENDER_DOMAIN}`;
```

- [ ] **Step 2: Update .env.example**

Append to `.env.example` (create the section if absent; keep alphabetical/grouped with existing SENDGRID entries):

```
# Default-tier email sender (platform-owned SendGrid subdomain).
# Set to drayagedirect.io in prod. In dev, either use this value
# with the prod SendGrid domain or override to a staging subdomain.
SENDGRID_PLATFORM_SENDER_DOMAIN=drayagedirect.io

# SendGrid Domain Authentication numeric ID for the platform subdomain.
# Captured manually during Task 19 (DNS setup). Required by migration 082.
SENDGRID_PLATFORM_DOMAIN_ID=
```

- [ ] **Step 3: Commit**

```bash
git add lib/email-dispatch/constants.js .env.example
git commit -m "feat(email-sender): platform-domain constant + env vars

Adds PLATFORM_SENDER_DOMAIN constant driven by SENDGRID_PLATFORM_SENDER_DOMAIN
env var. .env.example documents both the sender domain and the numeric
domain-ID needed by migration 082.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Write migration 082

**Files:**
- Create: `supabase/migrations/082_email_sender_default_tier.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/082_email_sender_default_tier.sql
--
-- Email sender default tier: platform-owned subdomain + per-tenant senders.
-- See docs/superpowers/specs/2026-04-19-email-sender-default-tier-design.md
--
-- Parameterized:
--   :sendgrid_domain_id  — numeric SendGrid Domain Authentication ID for
--                          drayagedirect.io. Supply via:
--                            psql -v sendgrid_domain_id=12345678 ...
--                          or via Supabase SQL editor by replacing the
--                          :sendgrid_domain_id placeholder with the value
--                          before running.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- PRE-MIGRATION CHECKS — abort if any tenant data is invalid.
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  null_count INT;
  dup_count INT;
  invalid_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM tenants WHERE slug IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAIL: % tenant(s) have NULL slug. Fix before running.', null_count;
  END IF;

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT slug FROM tenants GROUP BY slug HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAIL: % duplicate slug value(s). Fix before running.', dup_count;
  END IF;

  SELECT COUNT(*) INTO invalid_count
  FROM tenants WHERE slug !~ '^[a-zA-Z0-9._-]+$';
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAIL: % tenant slug(s) contain invalid email-local-part characters. Fix before running.', invalid_count;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- SCHEMA CHANGES — new columns first (additive, no data).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE email_configurations
  ADD COLUMN IF NOT EXISTS from_display_name TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_email    TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_name     TEXT,
  ADD COLUMN IF NOT EXISTS branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_configurations_branch_id
  ON email_configurations(branch_id) WHERE branch_id IS NOT NULL;

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS from_display_name TEXT;

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS reply_to_name TEXT;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sender_migration_at TIMESTAMPTZ NULL;

-- ─────────────────────────────────────────────────────────────────────
-- MAKE tenant_sender_domains.tenant_id nullable — for the platform row.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_sender_domains
  ALTER COLUMN tenant_id DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- RLS — allow READ of platform row (tenant_id IS NULL) for all tenants.
-- Writes remain scoped to own tenant.
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS tenant_sender_domains_read ON tenant_sender_domains;
CREATE POLICY tenant_sender_domains_read ON tenant_sender_domains
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL OR is_dd_admin());

DROP POLICY IF EXISTS tenant_sender_domains_write ON tenant_sender_domains;
CREATE POLICY tenant_sender_domains_write ON tenant_sender_domains
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

-- ─────────────────────────────────────────────────────────────────────
-- SEED the platform domain row (idempotent).
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO tenant_sender_domains
  (id, tenant_id, domain, sendgrid_domain_id, status, dns_records, created_at)
VALUES
  (gen_random_uuid(), NULL, 'drayagedirect.io',
   :sendgrid_domain_id, 'verified', '[]'::jsonb, now())
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- PROVISION per-tenant sender_address rows (idempotent).
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO tenant_sender_addresses
  (tenant_id, local_part, domain_id, is_default)
SELECT
  t.id,
  t.slug,
  (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1),
  true
FROM tenants t
LEFT JOIN tenant_sender_addresses tsa
  ON tsa.tenant_id = t.id
  AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
WHERE tsa.id IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- BACKUP table for rollback safety.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _migration_email_config_backup (
  config_id              UUID PRIMARY KEY,
  old_sender_address_id  UUID,
  backed_up_at           TIMESTAMPTZ DEFAULT now()
);

-- Step 1: Back up every config that currently points at a consumer-domain sender.
INSERT INTO _migration_email_config_backup (config_id, old_sender_address_id)
SELECT ec.id, ec.sender_address_id
FROM email_configurations ec
JOIN tenant_sender_addresses tsa ON tsa.id = ec.sender_address_id
JOIN tenant_sender_domains   tsd ON tsd.id = tsa.domain_id
WHERE tsd.domain IN (
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'aol.com', 'protonmail.com',
  'ymail.com', 'mail.com'
)
ON CONFLICT (config_id) DO NOTHING;

-- Step 2: Populate new reply_to_email + reply_to_name from the old consumer sender.
-- Columns are new in this migration → null for every row → no COALESCE needed.
UPDATE email_configurations ec
SET reply_to_email = tsa.local_part || '@' || tsd.domain,
    reply_to_name  = t.name
FROM tenant_sender_addresses tsa,
     tenant_sender_domains   tsd,
     tenants                 t
WHERE ec.sender_address_id = tsa.id
  AND tsa.domain_id = tsd.id
  AND ec.tenant_id = t.id
  AND tsd.domain IN (
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
    'live.com', 'icloud.com', 'aol.com', 'protonmail.com',
    'ymail.com', 'mail.com'
  );

-- Step 3: Point sender_address_id at the tenant's platform sender.
-- Old consumer-domain rows in tenant_sender_addresses are left in place
-- for audit integrity; the API validator (forthcoming) prevents new refs.
UPDATE email_configurations ec
SET sender_address_id = (
  SELECT id FROM tenant_sender_addresses tsa
  WHERE tsa.tenant_id = ec.tenant_id
    AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
  LIMIT 1
)
WHERE ec.id IN (SELECT config_id FROM _migration_email_config_backup);

-- ─────────────────────────────────────────────────────────────────────
-- Ensure every tenant has at least one active configuration.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO email_configurations
  (id, tenant_id, name, sender_address_id, is_active, is_default, priority, created_at)
SELECT
  gen_random_uuid(),
  t.id,
  'Default (DrayageDirect Sender)',
  (SELECT id FROM tenant_sender_addresses tsa
    WHERE tsa.tenant_id = t.id
      AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
    LIMIT 1),
  true,
  true,
  100,
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM email_configurations ec WHERE ec.tenant_id = t.id
);

-- ─────────────────────────────────────────────────────────────────────
-- Mark migrated tenants for the one-time banner.
-- ─────────────────────────────────────────────────────────────────────

UPDATE tenants
SET sender_migration_at = now()
WHERE id IN (
  SELECT DISTINCT ec.tenant_id
  FROM email_configurations ec
  JOIN _migration_email_config_backup b ON b.config_id = ec.id
);

COMMIT;

-- Reload PostgREST schema cache (per project convention).
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Commit (do not apply yet)**

```bash
git add supabase/migrations/082_email_sender_default_tier.sql
git commit -m "feat(email-sender): migration 082 — default-tier schema + data migration

Adds from_display_name, reply_to_email, reply_to_name, branch_id to
email_configurations. Adds from_display_name to email_templates.
Adds reply_to_name to email_messages. Adds sender_migration_at to
tenants. Makes tenant_sender_domains.tenant_id nullable for the
platform row. Seeds the platform tenant_sender_domains + per-tenant
tenant_sender_addresses. Migrates consumer-domain configs to default
tier with rollback backup table.

Parameterized: set :sendgrid_domain_id before running. Not applied yet
(DNS + SendGrid verification must land first — see Task 19).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Update SendGrid provider to accept `reply_to_name`

**Files:**
- Modify: `lib/email-dispatch/providers/sendgrid.js`

- [ ] **Step 1: Read the current file**

```bash
# Identify the replyTo construction point in sendgrid.js.
# Look for: replyTo: message.reply_to ? { email: message.reply_to } : undefined
```

- [ ] **Step 2: Extend the message contract comment + replyTo construction**

In `lib/email-dispatch/providers/sendgrid.js`:

Update the JSDoc for the `message` parameter (around line 28) to include `reply_to_name`:

```js
 * @param message  {
 *   ...
 *   from_address, from_name?, reply_to?, reply_to_name?,
 *   ...
 * }
```

Update the payload assembly (around line 105) from:

```js
replyTo: message.reply_to ? { email: message.reply_to } : undefined,
```

to:

```js
replyTo: message.reply_to
  ? {
      email: message.reply_to,
      name: message.reply_to_name || undefined,
    }
  : undefined,
```

Also update the `email_messages` INSERT to persist `reply_to_name`. Find
the row construction (search for `reply_to:` within the file) and add
`reply_to_name: message.reply_to_name || null` adjacent to the existing
`reply_to` field.

- [ ] **Step 3: Verify no regressions via existing send (manual smoke test)**

```bash
# In the running dev environment, trigger a single-send via the
# EmailComposeSlideOver (any invoice with a verified tenant sender).
# Confirm the existing send path still succeeds — email_messages row
# gets a provider_message_id. This confirms the provider contract
# is backward-compatible.
```

- [ ] **Step 4: Commit**

```bash
git add lib/email-dispatch/providers/sendgrid.js
git commit -m "feat(email-sender): sendgrid provider accepts reply_to_name

Extends the message contract so callers can pass reply_to_name alongside
reply_to. SendGrid payload now sets replyTo: { email, name } instead of
{ email } only. email_messages row persists reply_to_name too.
Backward-compatible: callers that don't pass reply_to_name see no change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire helpers into dispatcher

**Files:**
- Modify: `lib/email-dispatch/dispatcher.js`

- [ ] **Step 1: Import helpers at the top of dispatcher.js**

Add imports near the existing imports:

```js
import { resolveFromDisplayName } from './resolve-from-display-name.js';
import { resolveReplyTo } from './resolve-reply-to.js';
```

- [ ] **Step 2: Extend `dispatchEmail` signature (if applicable)**

If `dispatchEmail` is the function where the SendGrid payload is assembled,
ensure it accepts the parameters needed by the helpers: `template`, `config`,
`tenant`. If the signature already takes these (as the send endpoints pass
`fullConfig`, `template`, `tenantRow`), wire them in directly.

Find the point where `fromName` + `replyTo` are set on the outgoing message
(search for `from_name:` and `reply_to:` in `dispatcher.js`). Replace the
hardcoded / upstream-set values with:

```js
// Resolve From: display name via precedence chain.
const fromName = resolveFromDisplayName(template, config, tenant);

// Resolve Reply-To via precedence chain. Null = omit Reply-To header.
const replyToResolved = resolveReplyTo(config, tenant);
const replyTo     = replyToResolved?.email  || null;
const replyToName = replyToResolved?.name   || null;
```

Then pass these into the message object handed to the provider:

```js
const message = {
  // ... existing fields ...
  from_address: fromAddress,       // resolveFromAddress() result
  from_name:    fromName,           // ← from the new helper
  reply_to:     replyTo,            // ← from the new helper
  reply_to_name: replyToName,       // ← from the new helper
  // ... rest unchanged ...
};
```

**Important:** If the existing dispatcher has callers that pass `fromName` /
`replyTo` directly (i.e., the caller resolved them upstream), those callers
become pass-through — the dispatcher ignores those values and uses the
helpers instead. This centralizes the precedence logic in one place.

- [ ] **Step 3: Export the helpers from dispatcher.js for callers that need them**

Callers that build preview UI (e.g., the template editor's live preview)
will want to call the same resolvers. Re-export:

```js
export { resolveFromDisplayName, resolveReplyTo };
```

- [ ] **Step 4: Verify no regressions via existing single-send**

```bash
# Send one invoice via the EmailComposeSlideOver. Confirm:
#  - Provider returns 202
#  - email_messages.from_name matches the selected configuration's
#    from_display_name (or tenant.name as fallback)
#  - email_messages.reply_to matches the selected configuration's
#    reply_to_email (or tenant.email, or null)
#  - email_messages.reply_to_name is populated when reply_to_name is set
```

- [ ] **Step 5: Commit**

```bash
git add lib/email-dispatch/dispatcher.js
git commit -m "feat(email-sender): dispatcher uses precedence resolvers

Centralizes From: display name + Reply-To resolution inside dispatchEmail
via resolveFromDisplayName() and resolveReplyTo(). Callers no longer need
to assemble these values upstream; they just pass the raw template/config/
tenant objects.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Branch-aware config selection in send endpoints

**Files:**
- Modify: `pages/api/tenant/ar/invoices/bulk-send.js`
- Modify: `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js`
- Modify: `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`

- [ ] **Step 1: Extract config selection into a shared helper (if not already)**

Check if there's a shared function like `fetchActiveConfigForSend(svc, tenantId, context)`
already. If yes, modify it. If no, add it to `lib/email-dispatch/dispatcher.js`
or a new `lib/email-dispatch/select-config.js`:

```js
// lib/email-dispatch/select-config.js
/**
 * Select the active email_configuration for a send.
 *
 * Prefers a configuration scoped to the load's branch; falls back to the
 * tenant-default (branch_id IS NULL) when no branch match or when the load
 * has no branch_id.
 *
 * @returns { id: UUID, branch_id: UUID|null, priority: number } | null
 */
export async function selectActiveConfig(svc, tenantId, loadBranchId) {
  const { data, error } = await svc
    .from('email_configurations')
    .select('id, branch_id, priority')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error) throw new Error(`selectActiveConfig failed: ${error.message}`);
  if (!data || data.length === 0) return null;

  // Prefer branch match when load has a branch. Configs already sorted by
  // priority ASC, so find() picks the highest-priority match.
  if (loadBranchId) {
    const branchMatch = data.find((r) => r.branch_id === loadBranchId);
    if (branchMatch) return branchMatch;
  }
  // Fall back to the highest-priority tenant-default (branch_id IS NULL),
  // or the first config if none have branch_id=null for some reason.
  return data.find((r) => r.branch_id === null) || data[0];
}
```

- [ ] **Step 2: Update bulk-send.js**

Find the existing `email_configurations` SELECT in `pages/api/tenant/ar/invoices/bulk-send.js`
(the agent exploration found it around line 95-107).

Replace with a call to `selectActiveConfig`, passing `load.branch_id` from
the first row of the claimed invoices batch (all invoices in a bulk claim
share the same customer; branch may vary — use the first for MVP, note in
spec open items if we need stricter per-invoice scoping later).

Example:

```js
// After claiming invoices and loading their rows:
const loadBranchId = invoices[0]?.load?.branch_id || null;
const configRow = await selectActiveConfig(svc, ctx.tenantId, loadBranchId);
if (!configRow) {
  return res.status(400).json({ error: 'No active email configuration for this tenant' });
}
const fullConfig = await fetchFullConfiguration(svc, ctx.tenantId, configRow.id);
```

Then ensure the `template` object (fetched elsewhere in bulk-send.js) is
passed to `dispatchEmail` so the resolver can read its `from_display_name`.

- [ ] **Step 3: Same update for invoices/[invoiceId]/send-email.js**

Find the config-fetch block. Replace with:

```js
const loadBranchId = invoice?.load?.branch_id || null;
const configRow = await selectActiveConfig(svc, ctx.tenantId, loadBranchId);
// ... rest unchanged ...
```

- [ ] **Step 4: Same update for charge-sets/[id]/send-rate-con-email.js**

```js
const loadBranchId = chargeSet?.load?.branch_id || null;
const configRow = await selectActiveConfig(svc, ctx.tenantId, loadBranchId);
// ... rest unchanged ...
```

- [ ] **Step 5: Manual verification via curl (dev env)**

```bash
# With two email_configurations rows — one with branch_id=<branchA>,
# one with branch_id=NULL — and one test load belonging to branchA:
#
# POST to the send endpoint with the load's invoice.
# Check email_messages.configuration_id in the DB: must equal the
# branch-scoped config, NOT the tenant-default.
#
# Then send for a load with no branch_id. Check:
# email_messages.configuration_id = tenant-default.
```

- [ ] **Step 6: Commit**

```bash
git add lib/email-dispatch/select-config.js pages/api/tenant/ar/invoices/bulk-send.js pages/api/tenant/ar/invoices/[invoiceId]/send-email.js pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js
git commit -m "feat(email-sender): branch-aware config selection in send endpoints

Replaces the plain 'active config by priority' query with a branch-aware
selector. When a load has branch_id, a config scoped to that branch wins
over the tenant-default. Falls back to tenant-default when no match or
no branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Config CRUD API — accept + return new fields

**Files:**
- Modify: `pages/api/tenant/emails/configurations/index.js`
- Modify: `pages/api/tenant/emails/configurations/[id].js`

- [ ] **Step 1: Update the request-body whitelist / SELECT columns in index.js**

Find the POST handler. Add handling for the new fields:

```js
const body = req.body || {};
const payload = {
  // ... existing fields ...
  from_display_name: typeof body.from_display_name === 'string'
    ? body.from_display_name.trim().slice(0, 100) || null
    : null,
  reply_to_email: typeof body.reply_to_email === 'string'
    ? body.reply_to_email.trim() || null
    : null,
  reply_to_name: typeof body.reply_to_name === 'string'
    ? body.reply_to_name.trim() || null
    : null,
  branch_id: typeof body.branch_id === 'string' && body.branch_id
    ? body.branch_id
    : null,
};
```

Also update the GET SELECT clause to return these columns (they're
included if you're using `select('*')`; explicit if not).

- [ ] **Step 2: Same for [id].js (PUT/PATCH)**

Apply the same field-whitelist logic to the update handler. Build `updates`
object only from known keys; don't blindly pass `req.body`.

- [ ] **Step 3: Validate via curl**

```bash
# POST a new config with all new fields.
curl -sS -X POST http://localhost:3000/api/tenant/emails/configurations \
  -H 'Content-Type: application/json' \
  -H "Cookie: ..." \
  -d '{
    "name": "Test Sender Identity",
    "sender_kind": "sendgrid",
    "sender_address_id": "<uuid of a platform sender_address>",
    "from_display_name": "Test Display",
    "reply_to_email": "reply@example.com",
    "reply_to_name": "Reply Name",
    "branch_id": null
  }' | jq .

# Expected: 200 OK with the row echoed back including the new fields.

# GET it back:
curl -sS http://localhost:3000/api/tenant/emails/configurations/<id> \
  -H "Cookie: ..." | jq .

# Expected: new fields present in the response.
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/emails/configurations/index.js pages/api/tenant/emails/configurations/[id].js
git commit -m "feat(email-sender): config CRUD API accepts display name + reply-to + branch_id

POST + PUT now whitelist from_display_name, reply_to_email, reply_to_name,
branch_id. Values trimmed server-side; display name capped at 100 chars.
GET returns them in the row payload.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Consumer-domain validator on sender-address + sender-domain writes

**Files:**
- Modify: `pages/api/tenant/emails/sender-addresses/index.js` (and `[id].js` if exists)
- Modify: `pages/api/tenant/emails/sender-domains/index.js` (and `[id].js` if exists)

- [ ] **Step 1: Locate the API routes**

```bash
ls pages/api/tenant/emails/sender-addresses/
ls pages/api/tenant/emails/sender-domains/
```

Expected: `index.js` in each, possibly `[id].js`. Note the exact paths.

- [ ] **Step 2: Reject consumer-domain `tenant_sender_domains.domain` writes**

In `pages/api/tenant/emails/sender-domains/index.js`, at the top of the
POST handler (and PUT in `[id].js` if it exists):

```js
import { isConsumerDomain } from '../../../../../lib/email-dispatch/consumer-domains.js';

// ... inside the POST handler, after parsing body but before DB write:
if (isConsumerDomain(body.domain)) {
  return res.status(400).json({
    error: 'consumer_domain_not_allowed',
    message:
      "Consumer email providers (gmail.com, yahoo.com, outlook.com, hotmail.com, " +
      "live.com, icloud.com, aol.com, protonmail.com, ymail.com, mail.com) can't be " +
      "used as a From address — their DMARC policies cause silent delivery failures. " +
      "Use the DrayageDirect default sender and put your personal address in the " +
      "Reply-To field instead.",
  });
}
```

- [ ] **Step 3: Reject `tenant_sender_addresses` writes referencing consumer-domain rows**

In `pages/api/tenant/emails/sender-addresses/index.js` POST handler:

```js
// After validating domain_id is present:
const { data: domainRow } = await svc
  .from('tenant_sender_domains')
  .select('domain')
  .eq('id', body.domain_id)
  .maybeSingle();

if (domainRow && isConsumerDomain(domainRow.domain)) {
  return res.status(400).json({
    error: 'consumer_domain_not_allowed',
    message: /* same as above */,
  });
}
```

- [ ] **Step 4: Validate via curl**

```bash
# Attempt to create a consumer-domain tenant_sender_domains row:
curl -sS -X POST http://localhost:3000/api/tenant/emails/sender-domains \
  -H 'Content-Type: application/json' \
  -H "Cookie: ..." \
  -d '{"domain": "gmail.com"}' \
  | jq .

# Expected: 400 with error: "consumer_domain_not_allowed"

# Case trick:
curl -sS -X POST ... -d '{"domain": "Gmail.COM"}' | jq .
# Expected: same 400

# Whitespace:
curl -sS -X POST ... -d '{"domain": "  gmail.com  "}' | jq .
# Expected: same 400

# Custom domain — should succeed:
curl -sS -X POST ... -d '{"domain": "acmetrucking.com"}' | jq .
# Expected: 200 (or whatever the normal creation response is)
```

- [ ] **Step 5: Commit**

```bash
git add pages/api/tenant/emails/sender-addresses/index.js pages/api/tenant/emails/sender-domains/index.js
git commit -m "feat(email-sender): reject consumer-domain sender writes at API layer

POST/PUT to sender-domains and sender-addresses routes now check domain
against the consumer-blocklist and return 400 with a helpful message.
Normalizes case + whitespace before match. Prevents the DMARC silent-
drop scenario from re-entering the system post-migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: SenderIdentityFields + SenderPreview components

**Files:**
- Create: `components/settings/communications/SenderIdentityFields.js`
- Create: `components/settings/communications/SenderPreview.js`

- [ ] **Step 1: Implement SenderPreview**

```jsx
// components/settings/communications/SenderPreview.js
/**
 * Read-only "how recipients will see this" preview pane.
 * Renders the final From: and Reply-To as they will appear in the inbox.
 *
 * Props:
 *   fromDisplayName  string   — resolved display name
 *   fromAddress      string   — resolved From: email address
 *   replyToEmail     string?  — resolved Reply-To email (null = hide row)
 *   replyToName      string?  — resolved Reply-To name
 *   showViaNote      boolean  — when true, shows the "via drayagedirect.io" caveat
 */
export default function SenderPreview({
  fromDisplayName,
  fromAddress,
  replyToEmail,
  replyToName,
  showViaNote = true,
}) {
  const replyToCombined = replyToEmail
    ? replyToName
      ? `"${replyToName}" <${replyToEmail}>`
      : replyToEmail
    : null;

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm font-mono dark:border-gray-700 dark:bg-gray-900">
      <div className="flex gap-2">
        <span className="w-16 text-gray-500 dark:text-gray-400">From:</span>
        <span className="text-gray-900 dark:text-gray-100">
          {fromDisplayName} &lt;{fromAddress}&gt;
        </span>
      </div>
      {replyToCombined && (
        <div className="mt-1 flex gap-2">
          <span className="w-16 text-gray-500 dark:text-gray-400">Reply-To:</span>
          <span className="text-gray-900 dark:text-gray-100">{replyToCombined}</span>
        </div>
      )}
      {showViaNote && (
        <div className="mt-2 text-xs font-sans italic text-gray-500 dark:text-gray-400">
          Appears as &quot;via drayagedirect.io&quot; in Gmail &mdash; upgrade to a custom
          domain to remove this.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement SenderIdentityFields**

```jsx
// components/settings/communications/SenderIdentityFields.js
import { useMemo } from 'react';
import SenderPreview from './SenderPreview';

/**
 * Form section: Display Name + Reply-To inputs + live preview.
 *
 * Props:
 *   value     { from_display_name, reply_to_email, reply_to_name }
 *   onChange  (patch) => void — merge-patch into parent state
 *   tenant    { name, slug, email }
 *   platformDomain  string — e.g. "drayagedirect.io"
 *   errors    { from_display_name?, reply_to?: string }  // validation errors
 */
export default function SenderIdentityFields({
  value,
  onChange,
  tenant,
  platformDomain,
  errors = {},
}) {
  // Combined Reply-To input — user types '"Acme" <a@acme.com>', we parse.
  const combinedReplyTo = useMemo(() => {
    if (!value.reply_to_email) return '';
    return value.reply_to_name
      ? `"${value.reply_to_name}" <${value.reply_to_email}>`
      : value.reply_to_email;
  }, [value.reply_to_email, value.reply_to_name]);

  const fromAddress = `${tenant.slug}@${platformDomain}`;
  const previewName = (value.from_display_name || tenant.name || 'DrayageDirect Notifications').trim();

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sender Identity</h3>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Display Name
        </label>
        <input
          type="text"
          value={value.from_display_name || ''}
          maxLength={100}
          onChange={(e) => onChange({ from_display_name: e.target.value })}
          placeholder={tenant.name || ''}
          className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          How your company appears in the recipient&apos;s inbox.
        </p>
        {errors.from_display_name && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.from_display_name}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Reply-To Address
        </label>
        <input
          type="text"
          defaultValue={combinedReplyTo}
          onBlur={(e) => onChange({ _reply_to_raw: e.target.value })}
          placeholder='"Acme Trucking" <acme@acmetrucking.com>'
          className="mt-1 block w-full rounded border-gray-300 font-mono shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Where replies go. Format: &quot;Display Name&quot; &lt;email&gt;. Leave blank to use your
          account email.
        </p>
        {errors.reply_to && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.reply_to}</p>
        )}
      </div>

      <SenderPreview
        fromDisplayName={previewName}
        fromAddress={fromAddress}
        replyToEmail={value.reply_to_email}
        replyToName={value.reply_to_name}
        showViaNote={true}
      />
    </section>
  );
}
```

*Note on Reply-To parsing:* the component passes the raw user input up via
`_reply_to_raw`, and the parent (config edit page, Task 12) runs it through
`parseReplyTo()` on submit. This keeps parsing logic centralized and lets
the parent handle validation errors.

- [ ] **Step 3: Commit (component-only, not yet wired)**

```bash
git add components/settings/communications/SenderIdentityFields.js components/settings/communications/SenderPreview.js
git commit -m "feat(email-sender): SenderIdentityFields + SenderPreview components

Reusable form section for Display Name + Reply-To inputs plus live
preview pane showing exactly how recipients will see the From: and
Reply-To headers. Dark mode variants on every gray/border class per
project convention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire Sender Identity + branch selector into config edit page

**Files:**
- Modify: `pages/settings/communications/configurations/[id].js`

- [ ] **Step 1: Import components and helpers**

At the top of `pages/settings/communications/configurations/[id].js`:

```js
import SenderIdentityFields from '../../../../components/settings/communications/SenderIdentityFields';
import { parseReplyTo } from '../../../../lib/email-dispatch/parse-reply-to';
import { PLATFORM_SENDER_DOMAIN } from '../../../../lib/email-dispatch/constants';
```

- [ ] **Step 2: Add state for new fields + fetch branches**

Extend the existing config form state to include `from_display_name`,
`reply_to_email`, `reply_to_name`, `branch_id`. On page mount, GET
`/api/tenant/branches` (or the existing branches-list endpoint) so the
branch dropdown can populate.

```js
const [branches, setBranches] = useState([]);
useEffect(() => {
  fetch('/api/tenant/branches')
    .then((r) => r.json())
    .then((d) => setBranches(d.branches || []));
}, []);
```

- [ ] **Step 3: Render SenderIdentityFields below existing sender kind/address section**

```jsx
<SenderIdentityFields
  value={{
    from_display_name: form.from_display_name || '',
    reply_to_email:    form.reply_to_email || null,
    reply_to_name:     form.reply_to_name || null,
  }}
  onChange={(patch) => {
    if ('_reply_to_raw' in patch) {
      // Parse on blur; surface errors in `errors.reply_to`.
      const parsed = parseReplyTo(patch._reply_to_raw);
      if (parsed.ok) {
        setForm((f) => ({ ...f, reply_to_email: parsed.email, reply_to_name: parsed.name }));
        setErrors((e) => ({ ...e, reply_to: null }));
      } else {
        setErrors((e) => ({ ...e, reply_to: parsed.error }));
      }
    } else {
      setForm((f) => ({ ...f, ...patch }));
    }
  }}
  tenant={tenant /* already in scope in this page */}
  platformDomain={PLATFORM_SENDER_DOMAIN}
  errors={errors}
/>
```

- [ ] **Step 4: Render Branch Scope dropdown**

Add below the SenderIdentityFields section:

```jsx
<div>
  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
    Branch Scope
  </label>
  <select
    value={form.branch_id || ''}
    onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value || null }))}
    className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
  >
    <option value="">All branches (tenant-wide default)</option>
    {branches.map((b) => (
      <option key={b.id} value={b.id}>{b.name}</option>
    ))}
  </select>
  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
    Tenant-wide configurations apply to all sends. Branch-scoped configurations
    take priority over tenant-wide ones when the load belongs to the selected branch.
  </p>
</div>
```

- [ ] **Step 5: On save, block submit if `errors.reply_to` is set**

```js
async function handleSave() {
  if (errors.reply_to) {
    // Don't submit with an invalid reply-to format.
    return;
  }
  const payload = {
    // ... existing fields ...
    from_display_name: form.from_display_name || null,
    reply_to_email:    form.reply_to_email || null,
    reply_to_name:     form.reply_to_name || null,
    branch_id:         form.branch_id || null,
  };
  const res = await fetch(`/api/tenant/emails/configurations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // ... existing error handling ...
}
```

- [ ] **Step 6: Live walkthrough (manual)**

- Open the config edit page at `/settings/communications/configurations/<id>`.
- Type a display name → preview updates live.
- Type a valid Reply-To → preview updates.
- Type an invalid Reply-To → error surfaces, save button blocked.
- Change branch dropdown → saves correctly.

- [ ] **Step 7: Commit**

```bash
git add pages/settings/communications/configurations/[id].js
git commit -m "feat(email-sender): config edit page mounts Sender Identity + branch picker

Wires the new SenderIdentityFields component and Branch Scope dropdown
into the config edit form. Reply-To input parsed via parseReplyTo on blur;
invalid format blocks submit with inline error. Branch Scope dropdown
populated from GET /api/tenant/branches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Template editor — preview + display name override

**Files:**
- Modify: `pages/settings/communications/templates/[id].js`

- [ ] **Step 1: Import components + helpers**

```js
import SenderPreview from '../../../../components/settings/communications/SenderPreview';
import Link from 'next/link';
import { PLATFORM_SENDER_DOMAIN } from '../../../../lib/email-dispatch/constants';
// Import the resolver helpers so preview matches runtime behaviour exactly:
import { resolveFromDisplayName } from '../../../../lib/email-dispatch/resolve-from-display-name';
import { resolveReplyTo } from '../../../../lib/email-dispatch/resolve-reply-to';
```

- [ ] **Step 2: Fetch the "default" email_configuration for preview**

Templates are content-only; they don't own a specific configuration.
For the preview, show what a send would look like if it picked the
tenant-default config (branch_id IS NULL, is_default=true).

```js
const [defaultConfig, setDefaultConfig] = useState(null);
useEffect(() => {
  fetch('/api/tenant/emails/configurations?default=true')
    .then((r) => r.json())
    .then((d) => setDefaultConfig(d.configuration || null));
}, []);
```

(If the existing list endpoint doesn't support `?default=true`, either
add that query param or fetch the full list client-side and find the
`is_default=true` row.)

- [ ] **Step 3: Render preview header + override input above template body editor**

```jsx
{defaultConfig && (
  <div className="mb-6 space-y-4">
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
        Sender Preview
      </h3>
      <SenderPreview
        fromDisplayName={resolveFromDisplayName(form, defaultConfig, tenant)}
        fromAddress={`${tenant.slug}@${PLATFORM_SENDER_DOMAIN}`}
        replyToEmail={resolveReplyTo(defaultConfig, tenant)?.email || null}
        replyToName={resolveReplyTo(defaultConfig, tenant)?.name || null}
        showViaNote={true}
      />
      <div className="mt-2 text-xs">
        <Link
          href={`/settings/communications/configurations/${defaultConfig.id}`}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          Change sender identity →
        </Link>
      </div>
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Display Name Override (optional)
      </label>
      <input
        type="text"
        value={form.from_display_name || ''}
        maxLength={100}
        onChange={(e) => setForm((f) => ({ ...f, from_display_name: e.target.value }))}
        placeholder={defaultConfig.from_display_name || tenant.name || ''}
        className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Leave blank to use your account-wide Display Name. Use this if this
        specific template should appear as a different identity (e.g., &quot;Acme
        Billing Department&quot; for invoices).
      </p>
    </div>
  </div>
)}
```

- [ ] **Step 4: Include from_display_name in the save payload**

```js
const payload = {
  // ... existing fields ...
  from_display_name: form.from_display_name || null,
};
```

Add `from_display_name` to the whitelist in the template API route if
field validation is strict there (`pages/api/tenant/emails/templates/[id].js`).

- [ ] **Step 5: Live walkthrough**

- Open a template edit page.
- Preview renders with the default config's display name.
- Type into "Display Name Override" → preview updates live.
- Save → refresh → value persists.
- Send a test email using this template → `email_messages.from_name` matches override.

- [ ] **Step 6: Commit**

```bash
git add pages/settings/communications/templates/[id].js pages/api/tenant/emails/templates/[id].js
git commit -m "feat(email-sender): template editor preview + display name override

Adds 'Sender Preview' read-only pane above the template body editor,
showing exactly how recipients will see From: and Reply-To. Below it, an
optional 'Display Name Override' field lets tenants force this template
to send as a different identity. Override wins over config-level
display name in the precedence chain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Migration banner component + mount

**Files:**
- Create: `components/settings/communications/MigrationBanner.js`
- Modify: `pages/settings/communications/configurations/index.js`

- [ ] **Step 1: Implement MigrationBanner**

```jsx
// components/settings/communications/MigrationBanner.js
import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';

/**
 * One-time informational banner for tenants auto-migrated to the default
 * sender tier. Dismissal stored in localStorage keyed by tenant_id.
 *
 * Props:
 *   tenantId       UUID  — for the localStorage key
 *   migratedAt     string|null — tenants.sender_migration_at; null = hide
 *   fromAddress    string — platform-domain from-address
 *   replyToEmail   string — resolved reply-to email
 */
export default function MigrationBanner({ tenantId, migratedAt, fromAddress, replyToEmail }) {
  const [dismissed, setDismissed] = useState(true); // start dismissed until we read LS

  useEffect(() => {
    if (!tenantId) return;
    const key = `sender_migration_dismissed:${tenantId}`;
    setDismissed(localStorage.getItem(key) === '1');
  }, [tenantId]);

  if (!migratedAt || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(`sender_migration_dismissed:${tenantId}`, '1');
    setDismissed(true);
  };

  return (
    <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-950">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="flex-1">
          <p className="font-semibold text-blue-900 dark:text-blue-100">
            We&apos;ve upgraded your email sender
          </p>
          <p className="mt-1 text-blue-800 dark:text-blue-200">
            Your emails now send from{' '}
            <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs dark:bg-blue-900">
              {fromAddress}
            </code>{' '}
            for better deliverability. Customer replies still come to you at{' '}
            <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs dark:bg-blue-900">
              {replyToEmail || '(your account email)'}
            </code>
            .
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in configurations/index.js**

```jsx
// At top of pages/settings/communications/configurations/index.js:
import MigrationBanner from '../../../../components/settings/communications/MigrationBanner';

// Inside the component, after fetching tenant + default config:
<MigrationBanner
  tenantId={tenant?.id}
  migratedAt={tenant?.sender_migration_at}
  fromAddress={`${tenant?.slug}@${PLATFORM_SENDER_DOMAIN}`}
  replyToEmail={defaultConfig?.reply_to_email}
/>
```

Ensure `tenants.sender_migration_at` is returned in whatever tenant-fetch
the page already does. If not, add a small endpoint or include in the
tenant-context hook.

- [ ] **Step 3: Live walkthrough**

- Using a tenant whose `sender_migration_at` was set by the migration
  (staging, after running Task 6): banner appears on configurations list.
- Click Dismiss → gone.
- Hard refresh → still gone.
- Clear localStorage → reappears.
- Log in as a tenant with `sender_migration_at IS NULL` → banner never
  shows.

- [ ] **Step 4: Commit**

```bash
git add components/settings/communications/MigrationBanner.js pages/settings/communications/configurations/index.js
git commit -m "feat(email-sender): one-time migration banner

Info banner for tenants auto-migrated to the default sender tier. Shows
the new from-address and their reply-to (so they're not surprised by the
From: change). Dismissal stored in localStorage per-tenant. Invisible
for tenants with sender_migration_at IS NULL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Tenant creation auto-provisioning

**Files:**
- Modify: whichever API route `CreateTenantModal` (pages/admin/tenants/index.js:88) POSTs to

- [ ] **Step 1: Locate the tenant-creation API route**

```bash
# Open pages/admin/tenants/index.js, find CreateTenantModal's submit handler.
# Note the fetch URL (likely /api/admin/tenants or similar).
```

Then open that API route file.

- [ ] **Step 2: Wrap the existing `INSERT INTO tenants` in a transaction + add two INSERTs**

The exact structure depends on the existing code. The goal:

```js
// pages/api/admin/tenants/index.js (or wherever the create handler lives)

// After validating input and preparing tenant insert payload:
const { data: newTenant, error: tenantErr } = await svc
  .from('tenants')
  .insert(tenantPayload)
  .select('id, slug')
  .single();

if (tenantErr) return res.status(500).json({ error: tenantErr.message });

// Provision platform sender_address:
const { data: platformDomain } = await svc
  .from('tenant_sender_domains')
  .select('id')
  .is('tenant_id', null)
  .single();

if (!platformDomain) {
  // Should never happen post-migration. Log + continue; tenant can
  // fix via settings later.
  console.error('No platform tenant_sender_domains row found');
} else {
  const { data: newAddress, error: addrErr } = await svc
    .from('tenant_sender_addresses')
    .insert({
      tenant_id:  newTenant.id,
      local_part: newTenant.slug,
      domain_id:  platformDomain.id,
      is_default: true,
    })
    .select('id')
    .single();

  if (addrErr) {
    console.error('Sender address provisioning failed:', addrErr.message);
  } else {
    // Provision default email_configuration:
    await svc.from('email_configurations').insert({
      tenant_id:         newTenant.id,
      name:              'Default (DrayageDirect Sender)',
      sender_address_id: newAddress.id,
      is_active:         true,
      is_default:        true,
      priority:          100,
    });
  }
}

return res.status(200).json({ tenant: newTenant });
```

**Transaction note:** Supabase's JS client doesn't support multi-statement
transactions natively. If atomicity is required, write this as a Postgres
RPC function (`create_tenant_with_default_sender`) and call it via
`.rpc()`. For MVP, three sequential inserts with error logging is fine —
the worst-case failure leaves a tenant with no sender, which the UI
handles gracefully (shows a "configure sender" prompt on next send
attempt).

- [ ] **Step 3: Verify with a new tenant**

```bash
# Create a test tenant via the admin UI (pages/admin/tenants).
# Then query:

psql -c "SELECT id, slug, sender_migration_at FROM tenants WHERE slug = 'test-tenant-xyz';"
# Expected: one row, sender_migration_at IS NULL (new tenants don't get the banner).

psql -c "SELECT local_part, domain_id FROM tenant_sender_addresses WHERE tenant_id = '<new-tenant-id>';"
# Expected: one row, local_part = tenant's slug, domain_id = platform domain.

psql -c "SELECT name, is_default, is_active, priority FROM email_configurations WHERE tenant_id = '<new-tenant-id>';"
# Expected: one row, name = 'Default (DrayageDirect Sender)', all flags correct.
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/admin/tenants/index.js  # (or actual path)
git commit -m "feat(email-sender): auto-provision sender on new tenant creation

Tenant-creation API now creates a tenant_sender_addresses row
(local_part=slug, domain_id=platform) plus a default email_configurations
row pointing at it. New tenants are never in a 'no sender configured'
state. Failures in provisioning are logged but don't block tenant
creation itself.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: DNS + SendGrid verification (Gate 1)

**No code changes** — this is an operator runbook step. Nothing to commit.

- [ ] **Step 1: Configure SendGrid Domain Authentication**

Per spec §8.1:
1. SendGrid → Settings → Sender Authentication → Authenticate Your Domain.
2. Domain: `drayagedirect.io`. Custom subdomain: `mail`.
3. **Automated Security: OFF**.
4. **Link Branding: OFF**.
5. Generate 3 CNAMEs.
6. Capture the numeric Domain ID.

- [ ] **Step 2: Add DNS records at registrar**

Per spec §8.2. All 3 CNAMEs, proxy/CDN OFF.

Recommended: SPF TXT record for subdomain:
- Host: `drayagedirect.io`
- Value: `v=spf1 include:sendgrid.net ~all`

- [ ] **Step 3: Verify all 3 CNAMEs via `dig`**

```bash
dig CNAME em####.drayagedirect.io +short
# Expected: u####.wl.sendgrid.net.

dig CNAME s1._domainkey.drayagedirect.io +short
dig CNAME s2._domainkey.drayagedirect.io +short
# Expected: s1.domainkey.u####.wl.sendgrid.net. and s2.domainkey.u####.wl.sendgrid.net.
```

- [ ] **Step 4: Click Verify in SendGrid dashboard**

All 3 CNAMEs must turn green.

- [ ] **Step 5: Send a test via SendGrid API to a Gmail address**

```bash
curl -sS -X POST https://api.sendgrid.com/v3/mail/send \
  -H "Authorization: Bearer $SENDGRID_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "personalizations": [{"to": [{"email": "<your-gmail-address>"}]}],
    "from": {"email": "test@drayagedirect.io", "name": "DrayageDirect Test"},
    "subject": "Sender verification test",
    "content": [{"type": "text/plain", "value": "Default-tier verification."}]
  }'
```

- [ ] **Step 6: Inspect headers in Gmail "Show original"**

Must see:
- `Authentication-Results: ... dkim=pass header.d=drayagedirect.io` ✓
- `Authentication-Results: ... spf=pass smtp.mailfrom=drayagedirect.io` ✓
- `Authentication-Results: ... dmarc=pass` ✓
- Inbox placement (not spam) ✓

If all three pass: **Gate 1 complete. Proceed to Task 17.**
If any fail: **Stop here.** Fix DNS or SendGrid config before running the migration.

- [ ] **Step 7: Update `.env.local` with the captured Domain ID**

```
SENDGRID_PLATFORM_DOMAIN_ID=<numeric id captured in Step 1>
```

---

## Task 17: Apply migration 082 + verify (Gate 2)

**Files:** `supabase/migrations/082_email_sender_default_tier.sql` (already committed in Task 5)

- [ ] **Step 1: Set the env var for the migration parameter**

```bash
export SENDGRID_PLATFORM_DOMAIN_ID=<numeric id>
```

- [ ] **Step 2: Apply the migration**

If the project uses Supabase CLI:

```bash
supabase migration up
# or:
psql "$SUPABASE_DB_URL" \
  -v sendgrid_domain_id=$SENDGRID_PLATFORM_DOMAIN_ID \
  -f supabase/migrations/082_email_sender_default_tier.sql
```

If using the Supabase SQL editor:
- Paste the migration SQL.
- Replace `:sendgrid_domain_id` with the numeric value.
- Run.

Expected output: `BEGIN`, `ALTER TABLE` × N, `CREATE INDEX` × 1, `INSERT 0 N` (several), `UPDATE N`, `NOTIFY`, `COMMIT`. No `ERROR`.

- [ ] **Step 3: Verify schema changes**

```sql
-- New columns exist:
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'email_configurations'
  AND column_name IN ('from_display_name', 'reply_to_email', 'reply_to_name', 'branch_id');
-- Expected: 4 rows.

SELECT column_name FROM information_schema.columns
WHERE table_name = 'email_templates' AND column_name = 'from_display_name';
-- Expected: 1 row.

SELECT column_name FROM information_schema.columns
WHERE table_name = 'email_messages' AND column_name = 'reply_to_name';
-- Expected: 1 row.

SELECT column_name FROM information_schema.columns
WHERE table_name = 'tenants' AND column_name = 'sender_migration_at';
-- Expected: 1 row.
```

- [ ] **Step 4: Verify platform domain seed**

```sql
SELECT id, domain, status, sendgrid_domain_id
FROM tenant_sender_domains
WHERE tenant_id IS NULL;
-- Expected: 1 row, domain = 'drayagedirect.io', status = 'verified'.
```

- [ ] **Step 5: Verify per-tenant sender_addresses**

```sql
SELECT COUNT(*) FROM tenants;
-- Note the count.

SELECT COUNT(*) FROM tenant_sender_addresses tsa
JOIN tenant_sender_domains tsd ON tsd.id = tsa.domain_id
WHERE tsd.tenant_id IS NULL;
-- Expected: same count as tenants.
```

- [ ] **Step 6: Verify migrated tenants flagged**

```sql
SELECT id, name, sender_migration_at
FROM tenants
WHERE sender_migration_at IS NOT NULL;
-- Expected: any tenants whose pre-migration sender was on a consumer domain.
--  At minimum, the test tenant from 2a.4 Gate 8 (mikecb2010@gmail.com).
```

- [ ] **Step 7: Verify backup table populated**

```sql
SELECT COUNT(*) FROM _migration_email_config_backup;
-- Expected: same count as "migrated tenants" above (give or take multi-config tenants).
```

- [ ] **Step 8: Send a test invoice from a migrated tenant**

Via the EmailComposeSlideOver UI, send an invoice from the test tenant
(previously `mikecb2010@gmail.com`) to a real Gmail address.

Inspect `email_messages`:

```sql
SELECT id, from_address, from_name, reply_to, reply_to_name, status, provider_message_id
FROM email_messages
ORDER BY created_at DESC LIMIT 1;
```

Expected:
- `from_address` = `<tenant-slug>@drayagedirect.io`
- `from_name` = tenant's display name (or `tenants.name` fallback)
- `reply_to` = the old consumer-domain address (preserved from migration)
- `status` = 'sent'
- `provider_message_id` = non-null

Open the email in Gmail "Show original" and confirm `dkim=pass`, `spf=pass`,
`dmarc=pass` on `drayagedirect.io`.

**Gate 2 complete if:** all schema checks pass, seed data present, test
send delivers with authentication passing headers.

---

## Task 18: Gate 3 — Consumer-domain validator live check

- [ ] **Step 1: Attempt to create a consumer-domain sender via API**

```bash
# Try direct domain creation:
curl -sS -X POST http://localhost:3000/api/tenant/emails/sender-domains \
  -H 'Content-Type: application/json' \
  -H "Cookie: <session-cookie>" \
  -d '{"domain": "gmail.com"}' | jq .
# Expected: {"error": "consumer_domain_not_allowed", "message": "..."}

# Try case trick:
curl -sS -X POST ... -d '{"domain": "Gmail.COM"}' | jq .
# Expected: same rejection.

# Try whitespace trick:
curl -sS -X POST ... -d '{"domain": "  gmail.com  "}' | jq .
# Expected: same rejection.

# Try subdomain trick:
curl -sS -X POST ... -d '{"domain": "gmail.com.evil.com"}' | jq .
# Expected: 200 (only exact blocklist matches are rejected — but note
# this as a follow-up hardening item if it feels risky).

# Try a legitimate custom domain:
curl -sS -X POST ... -d '{"domain": "acmetrucking.com"}' | jq .
# Expected: 200 with the new row.
```

- [ ] **Step 2: Same via the UI (settings/communications/sender-domains)**

Attempt to create a `gmail.com` sender-domain via the UI form.
Expected: inline error message from Task 10's rejection.

**Gate 3 complete when:** all three consumer-domain bypass attempts rejected,
custom domain accepted, UI error surfaces inline.

---

## Task 19: Gate 4 — Deliverability (the big gate)

- [ ] **Step 1: Identify a migrated tenant**

Use the same test tenant from Task 17 Step 6 (whose `sender_migration_at` is
set).

- [ ] **Step 2: Send a real invoice via the EmailComposeSlideOver UI**

Recipient: a real Gmail inbox you own.

- [ ] **Step 3: Open "Show original" in Gmail and inspect headers**

Required:
- `Authentication-Results: ... dkim=pass header.d=drayagedirect.io` ✓
- `Authentication-Results: ... spf=pass smtp.mailfrom=drayagedirect.io` ✓
- `Authentication-Results: ... dmarc=pass` ✓
- `From:` displays as `"<Display Name>" <<slug>@drayagedirect.io>`
- `Reply-To:` displays as the tenant's pre-migration consumer address
- Inbox placement, not spam

**Gate 4 complete when:** all four authentication lines pass, inbox placement
confirmed. **If any fail, stop and fix before proceeding.** This is the gate
that validates the whole exercise.

---

## Task 20: Gates 5–10 (remaining verification walkthrough)

- [ ] **Gate 5: Reply path**

Reply to the Gate-4 test email from Gmail. Confirm the reply lands at the
tenant's configured Reply-To address (check the tenant's actual inbox).

- [ ] **Gate 6: Display name precedence**

1. Template has no override, config `from_display_name` = "Test Billing".
   Send → `email_messages.from_name` = "Test Billing".
2. Set template override to "Template Override". Send → `from_name` =
   "Template Override".
3. Null both. Send → `from_name` = `tenants.name`.
4. Null tenant.name. Send → `from_name` = "DrayageDirect Notifications".

Verify each via:
```sql
SELECT from_name FROM email_messages ORDER BY created_at DESC LIMIT 1;
```

- [ ] **Gate 7: Branch-scoped config wins**

1. Create two configs for the test tenant: one with `branch_id=<branchA>`,
   one with `branch_id=NULL`. Give them distinct `from_display_name` values.
2. Send an invoice for a load assigned to branchA.
3. Check `email_messages.configuration_id` = the branch-scoped config.
4. Send an invoice for a load with no branch.
5. Check `email_messages.configuration_id` = the tenant-default config.

- [ ] **Gate 8: Migration banner**

1. Log in as a migrated tenant → banner visible on
   `/settings/communications/configurations`.
2. Click Dismiss → banner gone.
3. Hard refresh → banner stays gone.
4. Open DevTools → Application → Local Storage → delete the
   `sender_migration_dismissed:<tenant-id>` key. Refresh → banner reappears.
5. Log in as a non-migrated tenant (`sender_migration_at IS NULL`) → banner
   never appears.

- [ ] **Gate 9: UI integration**

1. Edit Display Name in `/settings/communications/configurations/<id>` → live preview updates.
2. Type invalid Reply-To → error surfaces, save blocked.
3. Type valid Reply-To → preview updates, save succeeds.
4. Open a template → preview reflects the saved display name.
5. Fill template override → preview updates live.
6. Save template → refresh → value persists.
7. Send a test email → `email_messages.from_name` matches the template override.

- [ ] **Gate 10: Rollback drill (STAGING ONLY)**

**Do NOT run this in production unless actually reverting.**

On a staging Supabase with migration 082 applied:

```sql
-- Rollback Step 3 only (restore sender_address_id):
BEGIN;
UPDATE email_configurations ec
SET sender_address_id = b.old_sender_address_id
FROM _migration_email_config_backup b
WHERE ec.id = b.config_id;
COMMIT;
```

Verify:
- Migrated configs now point back at their pre-migration consumer-domain sender_addresses.
- Sends from those tenants will go back to silent DMARC drops — this is the
  intended semantics of rollback.
- New columns remain populated (harmless), banner still tries to show but
  without platform address behind it.

Re-apply the forward migration Step 3 to restore the fixed state:

```sql
BEGIN;
UPDATE email_configurations ec
SET sender_address_id = (
  SELECT id FROM tenant_sender_addresses tsa
  WHERE tsa.tenant_id = ec.tenant_id
    AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
  LIMIT 1
)
WHERE ec.id IN (SELECT config_id FROM _migration_email_config_backup);
COMMIT;
```

**Gate 10 complete when:** rollback + re-apply both succeed, confirming
the backup-table rollback path works.

---

## Post-Cutover Monitoring (48-hour watch)

Not a task — an operational note. For the first 48 hours after migration 082
applies in production:

- Compare pre- and post-cutover `email_messages.status` distribution:
  ```sql
  SELECT status, COUNT(*)
  FROM email_messages
  WHERE created_at > <cutover-timestamp>
  GROUP BY status;
  ```
- SendGrid dashboard: Bounces + Blocks for new patterns.
- Spot-check 5–10 random tenants' Email Configuration pages.

If `status='failed'` rate meaningfully higher than pre-cutover: investigate
first row, check its SendGrid response in `email_messages.error_message`.

---

## Deferred — NOT in scope for this plan

- Pro tier (custom domain auth).
- Enterprise tier (Gmail OAuth / MS Graph).
- Inbound/reply parsing.
- Delivery tracking webhooks (2a.6).
- Homograph protection on the consumer-domain blocklist.
- Warning banner for unverified-custom-domain tenants (2a.5b polish).

---

## Summary

**Total tasks:** 20 (5 code-only, 3 operator/verification gates, 12 implementation).
**Commits expected:** ~15.
**New files:** 13. **Modified files:** ~15.
**Migrations:** 1 (082).
**New npm deps:** 1 (`email-addresses`).
**Estimated effort:** 1.5–2 sessions (similar scale to 2a.4).

Implementation order preserves dependency direction: pure helpers → schema
→ dispatcher integration → API routes → UI → operator gates → verification
walkthrough. Each task produces an independently committable unit.
