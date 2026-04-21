# 2a.6 — SendGrid Delivery Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lie that "Sent" means "delivered." Subscribe to SendGrid's Event Webhook (delivered / bounced / dropped / spam_reported / deferred), stamp real delivery outcomes on each `email_messages` row, and surface the result in the BulkEmailQueue status pills. Idempotent, signature-verified, no backfill.

**Architecture:** One new public endpoint (`POST /api/webhooks/sendgrid`) receives a batch of events from SendGrid, verifies each request's ECDSA signature against a public key in env, and for each event looks up the matching `email_messages` row by splitting the webhook's `sg_message_id` on `.` (first part matches our stored `provider_message_id`). Each event is appended to a `delivery_events` JSONB array; a `delivery_status` column is bumped to the most-severe outcome seen so far (precedence: `bounced > dropped > spam_reported > delivered > deferred > null`). A second endpoint `GET /api/tenant/emails/deliveries?message_ids=...` is polled by the queue UI every 5s while any open row is still `delivery_status=null`. Pills expand from flat `sent` → delivery-aware variants.

**Tech Stack:** Next.js pages API (Node runtime, `bodyParser: false` for raw-body signature verification), `@sendgrid/eventwebhook` for ECDSA P-256 verification, Supabase service client for writes, existing `requireTenantUser` / `getServiceClient` pattern for the tenant-scoped poll endpoint, plain `.test.mjs` scripts (no framework) using the repo's `check(name, cond)` convention.

---

## File Structure

**Create:**
- `supabase/migrations/085_sendgrid_delivery_webhooks.sql` — adds `delivery_status`, `last_delivery_event_at`, `delivery_events` columns to `email_messages`
- `lib/webhooks/sendgrid-signature.js` — ECDSA P-256 signature verification wrapper around `@sendgrid/eventwebhook`
- `lib/webhooks/sendgrid-event-processor.js` — pure functions: `extractBaseMessageId`, `isDuplicateEvent`, `computeNewDeliveryStatus`, `normalizeEvent`
- `pages/api/webhooks/sendgrid.js` — public POST endpoint (signature-verified); iterates events, dedups, updates rows
- `pages/api/tenant/emails/deliveries.js` — tenant-scoped GET endpoint for polling delivery status by message_id array
- `tests/webhooks/sendgrid-signature.test.mjs` — signature verify: valid / invalid / missing / timestamp drift
- `tests/webhooks/sendgrid-dedup.test.mjs` — skip when `sg_event_id` already in `delivery_events`
- `tests/webhooks/sendgrid-precedence.test.mjs` — precedence table: bounced-after-delivered keeps bounced; delivered-after-deferred bumps to delivered

**Modify:**
- `package.json` — add `@sendgrid/eventwebhook` dependency
- `components/ar/useBulkEmailQueue.js` — capture `message_id` from send response per row; add polling effect
- `components/ar/BulkEmailQueue.js` — expand `StatusPill` map with delivery-aware variants; derive effective pill from row's `delivery_status` when `status === 'sent'`
- `.env.example` — add `SENDGRID_WEBHOOK_VERIFICATION_KEY` after existing SendGrid block

---

## Background: Critical Schema Gotcha

SendGrid's webhook payload sends `sg_message_id` as `<baseId>.<filterSuffix>` (e.g. `14c5d75ce93==.filter0001.16648.5515E0B88.0`). But our `email_messages.provider_message_id` column stores only the base — the `x-message-id` response header returned by `sgMail.send()` in `lib/email-dispatch/providers/sendgrid.js:130`.

**Therefore the event handler MUST extract the base before matching.** Split the webhook's `sg_message_id` on `.` and use `parts[0]`. Base64 chars never contain dots, so this is deterministic.

The `/deliveries` poll endpoint is different — it receives our internal `email_messages.id` UUIDs from the send-response JSON, so no transformation there.

---

## Tasks

### Task 1: Migration 085 + @sendgrid/eventwebhook dependency

**Files:**
- Create: `supabase/migrations/085_sendgrid_delivery_webhooks.sql`
- Modify: `package.json`

- [ ] **Step 1: Install @sendgrid/eventwebhook**

Run:

```bash
npm install @sendgrid/eventwebhook
```

Expected: exit 0; `@sendgrid/eventwebhook` appears in `dependencies` block of `package.json` alongside `@sendgrid/mail`.

- [ ] **Step 2: Create migration 085**

Write this exact content to `supabase/migrations/085_sendgrid_delivery_webhooks.sql`:

```sql
-- ============================================================
-- Migration 085: SendGrid delivery webhooks
-- ============================================================
-- 2a.6 — Stamp real delivery outcomes on email_messages rows
-- after SendGrid confirms (or rejects) delivery via its Event
-- Webhook. Adds three columns:
--   delivery_status        — most-severe outcome seen so far
--                            (bounced > dropped > spam_reported >
--                             delivered > deferred > null)
--   last_delivery_event_at — convenience column for ORDER BY
--                            and "most recently updated" filters
--   delivery_events        — append-only JSONB array of raw
--                            events for forensic debugging + dedup
--
-- No backfill of pre-2a.6 rows — they stay delivery_status=null
-- forever. The webhook is idempotent via sg_event_id dedup
-- inside delivery_events.
-- ============================================================

BEGIN;

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS delivery_status        TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_delivery_event_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS delivery_events        JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Partial index for polling hot path (queue UI polls by id + tenant;
-- the poll only cares about rows whose delivery is still resolving).
CREATE INDEX IF NOT EXISTS idx_email_messages_delivery_pending
  ON email_messages (tenant_id, id)
  WHERE delivery_status IS NULL AND status = 'sent';

-- Index for webhook lookup (base provider_message_id → row).
-- Tenant scoping is not enforced at the webhook layer (tenant is
-- inferred from the matched row), so provider_message_id alone
-- is the lookup key.
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_message_id
  ON email_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 3: Apply migration**

Run in Supabase SQL editor (paste contents of `085_sendgrid_delivery_webhooks.sql`). Expected: three new columns visible via `\d email_messages`; existing rows have `delivery_status=NULL`, `delivery_events='[]'`, `last_delivery_event_at=NULL`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json supabase/migrations/085_sendgrid_delivery_webhooks.sql
git commit -m "feat(2a.6): migration 085 + @sendgrid/eventwebhook dep"
```

---

### Task 2: Signature verification util (TDD)

**Files:**
- Test: `tests/webhooks/sendgrid-signature.test.mjs`
- Create: `lib/webhooks/sendgrid-signature.js`

- [ ] **Step 1: Write the failing test**

Create `tests/webhooks/sendgrid-signature.test.mjs`:

```js
/**
 * Signature verification tests for SendGrid webhook.
 *
 * We can't easily fake a real ECDSA P-256 signature in a unit test without
 * a private key, so these tests focus on the guard paths that don't require
 * a valid signature: missing headers, malformed headers, timestamp drift.
 * The happy-path (valid signature) is covered by reviewer Gate 2 against the
 * live SendGrid "Test Your Integration" button.
 */
import { verifySendGridSignature } from '../../lib/webhooks/sendgrid-signature.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

const PUBLIC_KEY_FAKE = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefake==';
const rawBody = Buffer.from('[{"event":"delivered","sg_event_id":"abc"}]');
const nowSec = Math.floor(Date.now() / 1000);

// Missing signature header
check('rejects missing signature', (() => {
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: null,
    timestamp: String(nowSec),
  });
  return r.ok === false && r.reason === 'missing_signature';
})());

// Missing timestamp header
check('rejects missing timestamp', (() => {
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: 'somesignature',
    timestamp: null,
  });
  return r.ok === false && r.reason === 'missing_timestamp';
})());

// Timestamp drift > 10 min (replay protection)
check('rejects timestamp more than 10 min old', (() => {
  const old = String(nowSec - 11 * 60);
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: 'somesignature',
    timestamp: old,
  });
  return r.ok === false && r.reason === 'timestamp_drift';
})());

// Timestamp drift > 10 min into future
check('rejects timestamp more than 10 min in future', (() => {
  const future = String(nowSec + 11 * 60);
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: 'somesignature',
    timestamp: future,
  });
  return r.ok === false && r.reason === 'timestamp_drift';
})());

// Missing publicKey → mis-config
check('rejects when publicKey is empty', (() => {
  const r = verifySendGridSignature({
    publicKey: '',
    rawBody,
    signature: 'somesignature',
    timestamp: String(nowSec),
  });
  return r.ok === false && r.reason === 'missing_public_key';
})());

// Invalid signature with valid-shaped inputs → signature_invalid
check('rejects invalid signature against fake key', (() => {
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: 'MEUCIQDfakeSignatureBase64fakeSignatureBase64fakeSignatureBase64fake=',
    timestamp: String(nowSec),
  });
  return r.ok === false && (r.reason === 'signature_invalid' || r.reason === 'verification_error');
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node tests/webhooks/sendgrid-signature.test.mjs
```

Expected: FAIL with "Cannot find module '../../lib/webhooks/sendgrid-signature.js'" or similar.

- [ ] **Step 3: Write the implementation**

Create `lib/webhooks/sendgrid-signature.js`:

```js
/**
 * SendGrid Event Webhook signature verification.
 *
 * SendGrid signs webhook requests with ECDSA P-256 over (timestamp + rawBody).
 * The public key is generated by SendGrid when Signed Event Webhook is
 * enabled; we store it in SENDGRID_WEBHOOK_VERIFICATION_KEY.
 *
 * Docs:
 *   https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 *
 * This module is a thin wrapper around @sendgrid/eventwebhook so the
 * webhook handler stays decoupled from the specific verification library.
 * If we ever swap to manual crypto.createVerify, only this file changes.
 */

import pkg from '@sendgrid/eventwebhook';
const { EventWebhook } = pkg;

const TIMESTAMP_DRIFT_SECONDS = 10 * 60;  // 10 min replay protection window

/**
 * @param {{
 *   publicKey: string,       // base64-encoded ECDSA P-256 public key (from SendGrid dashboard)
 *   rawBody: Buffer,         // unparsed request body bytes
 *   signature: string | null, // value of X-Twilio-Email-Event-Webhook-Signature
 *   timestamp: string | null, // value of X-Twilio-Email-Event-Webhook-Timestamp (unix seconds as string)
 * }} params
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifySendGridSignature({ publicKey, rawBody, signature, timestamp }) {
  if (!publicKey) {
    return { ok: false, reason: 'missing_public_key' };
  }
  if (!signature) {
    return { ok: false, reason: 'missing_signature' };
  }
  if (!timestamp) {
    return { ok: false, reason: 'missing_timestamp' };
  }

  // Replay protection: reject events whose timestamp is more than
  // TIMESTAMP_DRIFT_SECONDS away from now, in either direction.
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > TIMESTAMP_DRIFT_SECONDS) {
    return { ok: false, reason: 'timestamp_drift' };
  }

  try {
    const ew = new EventWebhook();
    const ecdsaKey = ew.convertPublicKeyToECDSA(publicKey);
    const isValid = ew.verifySignature(ecdsaKey, rawBody, signature, timestamp);
    return isValid ? { ok: true } : { ok: false, reason: 'signature_invalid' };
  } catch (err) {
    return { ok: false, reason: 'verification_error' };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node tests/webhooks/sendgrid-signature.test.mjs
```

Expected: `6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/webhooks/sendgrid-signature.js tests/webhooks/sendgrid-signature.test.mjs
git commit -m "feat(2a.6): ECDSA signature verification util + tests"
```

---

### Task 3: Event-processor pure functions (TDD)

**Files:**
- Test: `tests/webhooks/sendgrid-dedup.test.mjs`
- Test: `tests/webhooks/sendgrid-precedence.test.mjs`
- Create: `lib/webhooks/sendgrid-event-processor.js`

- [ ] **Step 1: Write the failing dedup test**

Create `tests/webhooks/sendgrid-dedup.test.mjs`:

```js
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
```

- [ ] **Step 2: Write the failing precedence test**

Create `tests/webhooks/sendgrid-precedence.test.mjs`:

```js
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run both tests to verify they fail**

Run:

```bash
node tests/webhooks/sendgrid-dedup.test.mjs
node tests/webhooks/sendgrid-precedence.test.mjs
```

Expected: both fail with "Cannot find module '../../lib/webhooks/sendgrid-event-processor.js'".

- [ ] **Step 4: Write the implementation**

Create `lib/webhooks/sendgrid-event-processor.js`:

```js
/**
 * Pure functions for processing a SendGrid webhook event.
 *
 * Kept free of DB/env/IO so the handler in pages/api/webhooks/sendgrid.js
 * stays a thin orchestrator and the logic is unit-testable.
 */

/**
 * Severity ranking for delivery_status transitions.
 * Higher number = more severe. A new event only bumps delivery_status
 * if its severity exceeds (or equals, for idempotency) the current value.
 *
 * Precedence per spec: bounced > dropped > spam_reported > delivered > deferred > null
 */
const SEVERITY = Object.freeze({
  bounced:       5,
  dropped:       4,
  spam_reported: 3,
  delivered:     2,
  deferred:      1,
});

/**
 * Strip SendGrid's ".filterXXX.XX.XXX" suffix from sg_message_id.
 * Our email_messages.provider_message_id stores only the base (from the
 * x-message-id response header); webhooks arrive with the dotted suffix.
 * Base64 IDs don't contain dots, so split-on-'.' is safe.
 */
export function extractBaseMessageId(sgMessageId) {
  if (sgMessageId == null || sgMessageId === '') return null;
  const dot = sgMessageId.indexOf('.');
  return dot === -1 ? sgMessageId : sgMessageId.slice(0, dot);
}

/**
 * Dedup check: has this sg_event_id already been appended to delivery_events?
 * @param {Array<{sg_event_id:string}>|null|undefined} deliveryEvents
 * @param {string|null|undefined} sgEventId
 */
export function isDuplicateEvent(deliveryEvents, sgEventId) {
  if (!sgEventId) return false;
  if (!Array.isArray(deliveryEvents) || deliveryEvents.length === 0) return false;
  for (const e of deliveryEvents) {
    if (e && e.sg_event_id === sgEventId) return true;
  }
  return false;
}

/**
 * Compute the new delivery_status given the current value and the incoming
 * event type. Returns current unchanged if the new event is less severe or
 * unknown.
 *
 * @param {string|null} current
 * @param {string} newEvent
 * @returns {string|null}
 */
export function computeNewDeliveryStatus(current, newEvent) {
  const newSev = SEVERITY[newEvent];
  if (newSev == null) return current;  // unknown event — no-op
  const currentSev = current == null ? 0 : (SEVERITY[current] ?? 0);
  return newSev >= currentSev ? newEvent : current;
}

/**
 * Normalize a raw SendGrid event into the shape we store in delivery_events.
 * Drops fields we don't need and stamps our own received_at timestamp.
 */
export function normalizeEvent(rawEvent) {
  return {
    event: rawEvent.event ?? null,
    timestamp: rawEvent.timestamp ?? null,
    sg_event_id: rawEvent.sg_event_id ?? null,
    sg_message_id: rawEvent.sg_message_id ?? null,
    email: rawEvent.email ?? null,
    response: rawEvent.response ?? null,
    reason: rawEvent.reason ?? null,
    received_at: new Date().toISOString(),
  };
}

/** Exported for callers that need to know which events we act on. */
export const TRACKED_EVENTS = Object.freeze([
  'delivered', 'bounced', 'dropped', 'spam_reported', 'deferred',
]);

export function isTrackedEvent(event) {
  return TRACKED_EVENTS.includes(event);
}
```

- [ ] **Step 5: Run both tests to verify they pass**

Run:

```bash
node tests/webhooks/sendgrid-dedup.test.mjs
node tests/webhooks/sendgrid-precedence.test.mjs
```

Expected: dedup → `11 passed, 0 failed`; precedence → `15 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add lib/webhooks/sendgrid-event-processor.js tests/webhooks/sendgrid-dedup.test.mjs tests/webhooks/sendgrid-precedence.test.mjs
git commit -m "feat(2a.6): event-processor pure fns + tests"
```

---

### Task 4: Webhook endpoint `POST /api/webhooks/sendgrid`

**Files:**
- Create: `pages/api/webhooks/sendgrid.js`
- Modify: `.env.example` — add `SENDGRID_WEBHOOK_VERIFICATION_KEY` stanza

- [ ] **Step 1: Add env var to `.env.example`**

Append to `.env.example` after the existing `SENDGRID_PLATFORM_DOMAIN_ID=` line:

```
# SendGrid Event Webhook signature key.
# Generated by SendGrid when you enable Signed Event Webhook in
# Settings → Mail Settings → Event Webhook → Signature Verification.
# Base64-encoded ECDSA P-256 public key. REQUIRED for /api/webhooks/sendgrid.
SENDGRID_WEBHOOK_VERIFICATION_KEY=
```

- [ ] **Step 2: Create webhook handler**

Create `pages/api/webhooks/sendgrid.js`:

```js
// Public endpoint — no session. Security comes from SendGrid's ECDSA-signed
// headers. Signature is verified against SENDGRID_WEBHOOK_VERIFICATION_KEY.
//
// SendGrid sends a JSON array of events per request (batched). We iterate
// each event, dedup by sg_event_id, and update the matching email_messages
// row. Orphan events (sg_message_id we don't recognize) are logged and
// skipped without failing the batch — SendGrid would otherwise retry.

import { createClient } from '@supabase/supabase-js';
import { verifySendGridSignature } from '../../../lib/webhooks/sendgrid-signature';
import {
  extractBaseMessageId,
  isDuplicateEvent,
  computeNewDeliveryStatus,
  normalizeEvent,
  isTrackedEvent,
} from '../../../lib/webhooks/sendgrid-event-processor';

export const config = {
  runtime: 'nodejs',
  api: {
    // Disable Next.js body parsing so we can read the raw bytes for ECDSA
    // verification. Parsed JSON would lose the exact byte sequence SendGrid
    // signed against.
    bodyParser: false,
  },
};

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function getServiceClient() {
  // Inline client factory — matches the pattern in lib/tenant-api but without
  // the tenant-scoping since this endpoint runs pre-tenant (webhook is global).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE env vars missing');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'read_body_failed' });
  }

  // ── Signature verification ──
  const sigResult = verifySendGridSignature({
    publicKey: process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY || '',
    rawBody,
    signature: req.headers[SIGNATURE_HEADER] || null,
    timestamp: req.headers[TIMESTAMP_HEADER] || null,
  });

  if (!sigResult.ok) {
    // 401 without leaking which check failed. Reason is logged server-side
    // for operator debugging.
    console.warn('[webhook/sendgrid] signature rejected:', sigResult.reason);
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ── Parse body ──
  let events;
  try {
    events = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'invalid_json' });
  }
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'expected_array' });
  }

  // ── Per-event processing ──
  const svc = getServiceClient();
  let processed = 0;
  let skipped = 0;
  let orphan = 0;

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') {
      skipped++;
      continue;
    }
    if (!isTrackedEvent(raw.event)) {
      skipped++;
      continue;
    }

    const baseId = extractBaseMessageId(raw.sg_message_id);
    if (!baseId) {
      skipped++;
      continue;
    }

    // Look up the row. Use maybeSingle — if SendGrid has sent us a webhook
    // for a message we didn't originate (shared webhook URL, test event for
    // a nonexistent ID), we log and move on rather than failing the batch.
    const { data: row, error: selectErr } = await svc
      .from('email_messages')
      .select('id, delivery_events, delivery_status')
      .eq('provider_message_id', baseId)
      .maybeSingle();

    if (selectErr) {
      // DB errors are operational failures — let SendGrid retry.
      console.error('[webhook/sendgrid] select failed:', selectErr.message);
      return res.status(500).json({ error: 'db_select_failed' });
    }

    if (!row) {
      console.warn('[webhook/sendgrid] orphan event, no email_messages row for', baseId);
      orphan++;
      continue;
    }

    const existing = Array.isArray(row.delivery_events) ? row.delivery_events : [];
    if (isDuplicateEvent(existing, raw.sg_event_id)) {
      skipped++;
      continue;
    }

    const normalized = normalizeEvent(raw);
    const newStatus = computeNewDeliveryStatus(row.delivery_status, raw.event);
    const nextEvents = [...existing, normalized];
    // timestamp from SendGrid is unix seconds; convert to ISO for the column.
    const lastEventIso = typeof raw.timestamp === 'number'
      ? new Date(raw.timestamp * 1000).toISOString()
      : new Date().toISOString();

    const { error: updateErr } = await svc
      .from('email_messages')
      .update({
        delivery_status: newStatus,
        last_delivery_event_at: lastEventIso,
        delivery_events: nextEvents,
      })
      .eq('id', row.id);

    if (updateErr) {
      console.error('[webhook/sendgrid] update failed:', updateErr.message);
      return res.status(500).json({ error: 'db_update_failed' });
    }
    processed++;
  }

  return res.status(200).json({ processed, skipped, orphan });
}
```

- [ ] **Step 3: Smoke test the endpoint rejects unsigned requests**

Start dev server (if not already running), then run:

```bash
curl -i -X POST http://localhost:3000/api/webhooks/sendgrid \
  -H "Content-Type: application/json" \
  -d '[{"event":"delivered","sg_event_id":"x","sg_message_id":"y"}]'
```

Expected: `HTTP/1.1 401 Unauthorized` with `{"error":"unauthorized"}`.

- [ ] **Step 4: Commit**

```bash
git add pages/api/webhooks/sendgrid.js .env.example
git commit -m "feat(2a.6): SendGrid webhook endpoint with signature verification"
```

---

### Task 5: Poll endpoint `GET /api/tenant/emails/deliveries`

**Files:**
- Create: `pages/api/tenant/emails/deliveries.js`

- [ ] **Step 1: Create the poll endpoint**

Create `pages/api/tenant/emails/deliveries.js`:

```js
// Polled by the BulkEmailQueue UI every ~5s while any open row is still
// delivery_status=null. Returns a map of message_id → { delivery_status,
// last_delivery_event_at } for rows that belong to the current tenant.
//
// Rows that don't belong to the tenant (or don't exist) are simply omitted
// from the response map — the UI treats a missing key as "still null" which
// keeps polling behavior consistent.

import {
  requireTenantUser,
  getServiceClient,
} from '../../../../lib/tenant-api';

const MAX_MESSAGE_IDS = 200;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const raw = req.query.message_ids;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'message_ids query param required' });
  }

  const messageIds = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (messageIds.length === 0) {
    return res.status(200).json({});
  }
  if (messageIds.length > MAX_MESSAGE_IDS) {
    return res.status(400).json({ error: `too many message_ids (max ${MAX_MESSAGE_IDS})` });
  }

  const svc = getServiceClient();

  const { data, error } = await svc
    .from('email_messages')
    .select('id, delivery_status, last_delivery_event_at')
    .eq('tenant_id', ctx.tenantId)
    .in('id', messageIds);

  if (error) {
    console.error('[deliveries] query failed:', error.message);
    return res.status(500).json({ error: 'query_failed' });
  }

  const map = {};
  for (const row of data || []) {
    map[row.id] = {
      delivery_status: row.delivery_status,
      last_delivery_event_at: row.last_delivery_event_at,
    };
  }
  return res.status(200).json(map);
}
```

- [ ] **Step 2: Smoke test the endpoint with an authenticated session**

With dev server running and an active browser login, from the browser devtools console:

```js
await fetch('/api/tenant/emails/deliveries?message_ids=bogus-uuid-1,bogus-uuid-2')
  .then(r => r.json())
```

Expected: `{}` (empty map; no rows match the bogus UUIDs for the current tenant; no error).

Also verify empty 400:

```js
await fetch('/api/tenant/emails/deliveries').then(r => r.status)
```

Expected: `400`.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/emails/deliveries.js
git commit -m "feat(2a.6): tenant-scoped delivery-status poll endpoint"
```

---

### Task 6: Wire `message_id` into queue rows + add polling

**Files:**
- Modify: `components/ar/useBulkEmailQueue.js`

- [ ] **Step 1: Add `message_id` capture to the send response handler**

Open `components/ar/useBulkEmailQueue.js`. Locate the `setRows` block after the `Promise.allSettled` for bulk send (around line 184 in the current file — the block that maps `result.status === 'fulfilled'` onto `status: 'sent'`). Replace it with a version that also reads `result.value.message_id`:

Change:

```js
    setRows((prev) => prev.map((r) => {
      const result = resultByKey.get(r.groupKey);
      if (!result) return r;
      return result.status === 'fulfilled'
        ? { ...r, status: 'sent', error: null }
        : { ...r, status: 'failed', error: result.reason?.message ?? 'Send failed' };
    }));
```

To:

```js
    setRows((prev) => prev.map((r) => {
      const result = resultByKey.get(r.groupKey);
      if (!result) return r;
      if (result.status === 'fulfilled') {
        return {
          ...r,
          status: 'sent',
          // message_id comes from /bulk-send's response (email_messages.id UUID).
          // Used by the polling effect below to query delivery status.
          message_id: result.value?.message_id ?? null,
          delivery_status: null,
          error: null,
        };
      }
      return { ...r, status: 'failed', error: result.reason?.message ?? 'Send failed' };
    }));
```

Also, in the initial-rows `useState` factory at the top of the hook (around line 18), add `message_id: null` and `delivery_status: null` to the default row shape:

Change:

```js
  const [rows, setRows] = useState(() => groups.map((g) => ({
    groupKey: g.key,
    group: g,
    status: 'pending',
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    body_text: '',
    body_html: '',
    body_format: 'html',
    attachments: [],
    error: null,
  })));
```

To:

```js
  const [rows, setRows] = useState(() => groups.map((g) => ({
    groupKey: g.key,
    group: g,
    status: 'pending',
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    body_text: '',
    body_html: '',
    body_format: 'html',
    attachments: [],
    error: null,
    message_id: null,
    delivery_status: null,
  })));
```

- [ ] **Step 2: Add the polling effect**

Immediately below the existing `useEffect` mirroring `rows` into `rowsRef` (around line 61 in the current file), add a new effect that polls while any row is still waiting for delivery confirmation.

Add this block after `useEffect(() => { rowsRef.current = rows; }, [rows]);`:

```js
  // Poll /api/tenant/emails/deliveries every 5s while any row has been sent
  // but hasn't heard back from SendGrid's webhook yet. Stops automatically
  // when all rows are terminal (delivered / bounced / dropped / spam_reported)
  // or 60s have elapsed with no progress.
  //
  // Terminal states (NOT deferred — deferred is transient, SendGrid may retry
  // and emit delivered/bounced later):
  const TERMINAL = ['delivered', 'bounced', 'dropped', 'spam_reported'];
  const POLL_INTERVAL_MS = 5000;
  const MAX_POLL_DURATION_MS = 60000;

  useEffect(() => {
    // Collect message_ids of rows that are awaiting delivery confirmation.
    const pendingIds = rows
      .filter((r) => r.message_id && !TERMINAL.includes(r.delivery_status))
      .map((r) => r.message_id);

    if (pendingIds.length === 0) return;

    let cancelled = false;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > MAX_POLL_DURATION_MS) return;

      try {
        const qs = encodeURIComponent(pendingIds.join(','));
        const res = await fetch(`/api/tenant/emails/deliveries?message_ids=${qs}`);
        if (!res.ok) return; // Soft-fail; next tick tries again.
        const map = await res.json();
        if (cancelled) return;

        setRows((prev) => prev.map((r) => {
          if (!r.message_id) return r;
          const entry = map[r.message_id];
          if (!entry) return r;
          if (entry.delivery_status === r.delivery_status) return r;
          return { ...r, delivery_status: entry.delivery_status };
        }));
      } catch (_) {
        // Swallow — the next tick will retry.
      }
    };

    // Kick off first poll immediately, then every 5s.
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Re-run when the set of pending message_ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.message_id}:${r.delivery_status}`).join('|')]);
```

- [ ] **Step 3: Smoke test by watching network tab**

Start dev server. Send a test bulk email through the queue UI (AR → Billing → pick 2 invoices → Bulk Email). In the devtools Network tab, filter to `deliveries`. Expected: a GET request fires immediately after send, then every 5 seconds. Stops when all rows show delivered (or at 60s).

If `SENDGRID_WEBHOOK_VERIFICATION_KEY` isn't set yet in local env, rows stay `delivery_status=null` and polling stops at 60s — that's expected pre-Task-8 (webhook-enable step).

- [ ] **Step 4: Commit**

```bash
git add components/ar/useBulkEmailQueue.js
git commit -m "feat(2a.6): capture message_id in queue rows + poll delivery status"
```

---

### Task 7: Expand BulkEmailQueue pill for delivery variants

**Files:**
- Modify: `components/ar/BulkEmailQueue.js`

- [ ] **Step 1: Expand the `StatusPill` map**

Open `components/ar/BulkEmailQueue.js`. Replace the current `StatusPill` function (lines 11-28) with a version that derives the effective status from `row.status` + `row.delivery_status`:

Change:

```js
function StatusPill({ status }) {
  const map = {
    pending:    { cls: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400', label: 'Loading…', icon: RefreshCw, spin: true },
    ready:      { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', label: 'Ready', icon: Check },
    needs_edit: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', label: 'Needs edit', icon: AlertCircle },
    sending:    { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300', label: 'Sending…', icon: RefreshCw, spin: true },
    sent:       { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', label: 'Sent', icon: Check },
    failed:     { cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', label: 'Failed', icon: AlertCircle },
  };
  const m = map[status] ?? map.pending;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>
      <Icon className={`w-3 h-3 ${m.spin ? 'animate-spin' : ''}`} />
      {m.label}
    </span>
  );
}
```

To:

```js
// When row.status === 'sent', the pill reflects delivery_status (if known).
// Null delivery_status means SendGrid's 202 came back but no webhook yet —
// show amber "Sent" to signal the outcome is still unknown.
function resolvePillKey(status, deliveryStatus) {
  if (status !== 'sent') return status;
  switch (deliveryStatus) {
    case 'delivered':     return 'delivered';
    case 'bounced':       return 'bounced';
    case 'dropped':       return 'dropped';
    case 'spam_reported': return 'spam_reported';
    case 'deferred':      return 'deferred';
    default:              return 'sent'; // null or unknown
  }
}

function StatusPill({ status, deliveryStatus }) {
  const map = {
    pending:       { cls: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400', label: 'Loading…', icon: RefreshCw, spin: true },
    ready:         { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', label: 'Ready', icon: Check },
    needs_edit:    { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', label: 'Needs edit', icon: AlertCircle },
    sending:       { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300', label: 'Sending…', icon: RefreshCw, spin: true },
    sent:          { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', label: 'Sent', icon: Mail },
    delivered:     { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', label: 'Delivered', icon: Check },
    bounced:       { cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', label: 'Bounced', icon: AlertCircle },
    dropped:       { cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', label: 'Dropped', icon: AlertCircle },
    spam_reported: { cls: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300', label: 'Spam', icon: AlertCircle },
    deferred:      { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300', label: 'Deferred', icon: RefreshCw },
    failed:        { cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', label: 'Failed', icon: AlertCircle },
  };
  const key = resolvePillKey(status, deliveryStatus);
  const m = map[key] ?? map.pending;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>
      <Icon className={`w-3 h-3 ${m.spin ? 'animate-spin' : ''}`} />
      {m.label}
    </span>
  );
}
```

Note the spec's requirement that "Sent" post-send (null delivery_status) uses amber to signal "outcome unknown." This is a deliberate visual change — operators should know sent-without-webhook-yet is different from sent-and-confirmed-delivered.

- [ ] **Step 2: Pass `deliveryStatus` to StatusPill where it's rendered**

Locate the `<StatusPill status={r.status} />` call (line 126 in the current file). Change to:

```jsx
                  <StatusPill status={r.status} deliveryStatus={r.delivery_status} />
```

- [ ] **Step 3: Update row-greying logic to respect terminal-non-failure delivery states**

The current UI greys out `isSent` rows (line 110: `opacity-60` when `r.status === 'sent'`) but only stripes red on `r.status === 'failed'`. Bounced/dropped/spam_reported succeeded at send-time but failed at delivery-time — they deserve the same visual alarm as `failed`.

Locate this block (around lines 103-114):

```jsx
          {rows.map((r) => {
            const isSent = r.status === 'sent';
            const isFailed = r.status === 'failed';
            return (
              <div
                key={r.groupKey}
                className={`px-5 py-3 flex items-center justify-between text-sm ${
                  isSent ? 'opacity-60'
                  : isFailed ? 'bg-red-50 dark:bg-red-950/20 border-l-4 border-red-400 dark:border-red-800'
                  : ''
                }`}
              >
```

Replace with:

```jsx
          {rows.map((r) => {
            const isSent = r.status === 'sent';
            const isFailed = r.status === 'failed';
            const isBadDelivery = isSent && ['bounced', 'dropped', 'spam_reported'].includes(r.delivery_status);
            return (
              <div
                key={r.groupKey}
                className={`px-5 py-3 flex items-center justify-between text-sm ${
                  isFailed || isBadDelivery
                    ? 'bg-red-50 dark:bg-red-950/20 border-l-4 border-red-400 dark:border-red-800'
                    : isSent
                    ? 'opacity-60'
                    : ''
                }`}
              >
```

- [ ] **Step 4: Manual UI smoke test**

Start dev server if not running. Open AR → Billing → select invoices → Bulk Email → Send. Expected transitions:

1. Rows show `Sending…` (blue) during dispatch.
2. On 202 back from send endpoint, rows flip to `Sent` (AMBER — new).
3. Within 5–10s of SendGrid delivering, rows flip to `Delivered` (green).
4. If any recipient bounces, the row stripes red and shows `Bounced`.

For this gate only the color change at step 2 is observable without a real webhook; full transitions are covered by the live gates in Task 8.

- [ ] **Step 5: Commit**

```bash
git add components/ar/BulkEmailQueue.js
git commit -m "feat(2a.6): expand queue pill for delivery-aware variants"
```

---

### Task 8: Operator setup + live gates walkthrough

No code in this task — this is the end-to-end verification pass against real SendGrid webhooks.

**Files:**
- None modified.

- [ ] **Step 1: Enable the SendGrid Event Webhook (production-like)**

1. Log in to SendGrid → **Settings → Mail Settings → Event Webhook**.
2. Toggle **Event Webhook** on.
3. **HTTP Post URL**: `https://drayagedirect.io/api/webhooks/sendgrid` for prod, or the dev tunnel URL (e.g. `https://abc123.ngrok.io/api/webhooks/sendgrid`) for local gates.
4. **Select events**: check ✅ **Delivered**, ✅ **Bounced**, ✅ **Dropped**, ✅ **Spam Reports**, ✅ **Deferred**. Uncheck everything else (Opens, Clicks, Unsubscribes, Group Unsubscribes, Group Resubscribes, Processed).
5. Toggle **Enable Signed Event Webhook**. Click "Generate New Verification Key" if prompted.
6. Copy the generated verification key.
7. Paste into the appropriate env (local `.env.local` or prod secret manager) as `SENDGRID_WEBHOOK_VERIFICATION_KEY=<key>`.
8. Restart dev server (or redeploy prod) so the env var is loaded.
9. Click **Save**, then click **Test Your Integration** in the dashboard. SendGrid will POST a sample payload to your endpoint.

- [ ] **Step 2: Walk Gate 1 — Migration 085 applied**

Run in Supabase SQL editor:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'email_messages'
  AND column_name IN ('delivery_status', 'last_delivery_event_at', 'delivery_events')
ORDER BY column_name;
```

Expected: three rows, `delivery_status`/`text`/YES/NULL; `last_delivery_event_at`/`timestamp with time zone`/YES/NULL; `delivery_events`/`jsonb`/NO/`'[]'::jsonb`.

- [ ] **Step 3: Walk Gate 2 — Signature verification**

Unsigned request:

```bash
curl -i -X POST https://<env>/api/webhooks/sendgrid \
  -H "Content-Type: application/json" \
  -d '[{"event":"delivered","sg_event_id":"x","sg_message_id":"y"}]'
```

Expected: `HTTP/1.1 401 Unauthorized`.

Signed request (via SendGrid dashboard "Test Your Integration" button): Expected: `HTTP/1.1 200 OK` with `{"processed":0,"skipped":0,"orphan":0}` or similar (the test event uses a fake sg_message_id that won't match any row, so `orphan:1`).

- [ ] **Step 4: Walk Gate 3 — Live delivered event**

Send a real bulk invoice email through the AR UI to a Gmail address you own. Within 10 seconds of seeing the email arrive:

```sql
SELECT id, provider_message_id, delivery_status, last_delivery_event_at,
       jsonb_array_length(delivery_events) AS event_count
FROM email_messages
ORDER BY created_at DESC
LIMIT 3;
```

Expected: the most-recent row shows `delivery_status='delivered'`, `last_delivery_event_at` within the last minute, `event_count=1`.

- [ ] **Step 5: Walk Gate 4 — Live bounced event**

Send a bulk invoice email to a known-bad address. Two options:

- SendGrid's sandbox bounce address: `bounce-test@simulator.amazonses.com` doesn't always emit bounced events; safer to use `bounce@sink.sendgrid.net` or an obviously-invalid address in a domain you control.
- Easier: edit the recipient in the queue's Edit popup to `noreply@nonexistent-drayage-test-domain.invalid`, then click Send.

After ~30 seconds:

```sql
SELECT provider_message_id, delivery_status, delivery_events
FROM email_messages
WHERE delivery_status = 'bounced'
ORDER BY last_delivery_event_at DESC
LIMIT 1;
```

Expected: one row with `delivery_status='bounced'`; `delivery_events[0].event='bounced'`; `delivery_events[0].reason` contains the SendGrid-provided bounce reason string.

- [ ] **Step 6: Walk Gate 5 — Dedup**

From SendGrid dashboard, click "Test Your Integration" twice in quick succession. Then:

```sql
SELECT provider_message_id, jsonb_array_length(delivery_events) AS event_count
FROM email_messages
WHERE delivery_events @> '[{"event":"processed"}]'::jsonb
   OR delivery_events @> '[{"sg_event_id":"<test event id>"}]'::jsonb;
```

Expected: at most one entry per unique `sg_event_id`. If SendGrid reuses the same `sg_event_id` across test-button clicks, `event_count` should not increment on the second click.

- [ ] **Step 7: Walk Gate 6 — UI pill transitions**

With dev server running and a real webhook configured:
1. Open AR → Billing → select 1 invoice → Bulk Email.
2. Click Send. Observe the row: `Sending…` (blue, spinner) → `Sent` (AMBER, Mail icon).
3. Within 5–10 seconds of the email arriving in the recipient's inbox, observe the row flip to `Delivered` (GREEN, Check icon).

Expected: the transition happens while the modal is still open; no refresh required.

- [ ] **Step 8: Walk Gate 7 — Precedence**

Send a bulk invoice email to 2 recipients: one that will deliver, one that will bounce.

After both webhooks arrive:

```sql
SELECT provider_message_id, delivery_status,
       jsonb_array_length(delivery_events) AS event_count
FROM email_messages
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `event_count=2` (one delivered, one bounced), `delivery_status='bounced'` (conservative wins).

- [ ] **Step 9: Walk Gate 8 — Polling stops**

Open devtools Network tab, filter to `deliveries`. After a bulk send:
- Poll requests fire every 5s.
- Once all rows are terminal (delivered/bounced/dropped/spam_reported), polling stops.
- If any row stays deferred past 60s, polling stops at the 60s cap.

- [ ] **Step 10: Commit the ops documentation**

No new files to commit in this task — it's pure verification. If you took notes during the walkthrough, capture them in a handoff memory after the plan is complete, not in the repo.

---

## Self-Review Checklist

Run this checklist before handing off to execution:

- [ ] Spec coverage — every gate in the spec (1-8) maps to a step in Task 8. Every schema column in the spec (delivery_status, last_delivery_event_at, delivery_events) maps to Task 1. Every endpoint (webhook + poll) has its own task. Every unit test file the spec names (signature/dedup/precedence) is in Task 2 or 3.
- [ ] Placeholder scan — no "TBD", "handle edge cases", "similar to task N", "add validation". Every code step has the actual code.
- [ ] Type consistency — `verifySendGridSignature` input/output shape is used consistently in Tasks 2 and 4. `extractBaseMessageId` / `isDuplicateEvent` / `computeNewDeliveryStatus` / `normalizeEvent` / `isTrackedEvent` signatures match across Tasks 3 and 4. `message_id` on row (internal UUID) is distinct from `sg_message_id` (webhook). `delivery_status` null/enum values match spec's precedence table exactly.
- [ ] Path consistency — all `lib/webhooks/*` files land under `lib/webhooks/`. All tests land under `tests/webhooks/`. The webhook endpoint at `pages/api/webhooks/sendgrid.js` (new `webhooks/` dir), the poll endpoint at `pages/api/tenant/emails/deliveries.js` (existing `emails/` dir).
- [ ] The `provider_message_id` / `sg_message_id` dot-suffix gotcha is called out in both Task 3 (extractBaseMessageId) and Task 4 (webhook handler).
- [ ] The `bodyParser: false` + `readRawBody` pattern is explicit in Task 4 with the reason documented.
- [ ] Migration uses the BEGIN/COMMIT wrapper and `NOTIFY pgrst, 'reload schema'` per the repo's dev_migration_template convention.

## Out of Scope (per spec)

- Engagement events (opens, clicks, unsubscribes) — own future spec.
- Realtime push via Supabase channels — polling is fine for v1.
- Customer-facing delivery receipts.
- Backfill of pre-2a.6 email_messages rows.
- Webhook retry queue on our side (SendGrid retries for us).
- Cross-tenant dedup concerns (tenant-scoping handled via provider_message_id lookup).
