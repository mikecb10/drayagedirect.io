# AR Bulk Invoice Email (2a.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dispatcher bulk-invoice N selected charge sets on `/ar` and email the invoices out in one pass, with a grouping modal (per customer / per (customer, ref#) / per charge set) and a queue dashboard for review + per-row Retry on partial failure.

**Architecture:** Thin bulk layer over 2a.2's shipped single-send stack. One new POST endpoint (`/invoices/bulk-send`) that reuses `dispatchEmail`/`fetchFullConfiguration`/`resolveFromAddress` and renders N invoice PDFs into one SendGrid message. Three new React components (BulkActionBar, BulkGroupingModal, BulkEmailQueue), one new hook (useBulkEmailQueue), and a minimal extension to `EmailComposeSlideOver` for multi-attachment display. Migration 081 extends migration 080's claim-RPC pattern to arrays (partial-success semantics).

**Tech Stack:** Next.js (pages router), Supabase (service-role client + RPC), @sendgrid/mail, @react-pdf/renderer, Tailwind CSS with dark mode, lucide-react icons.

**Spec:** [docs/superpowers/specs/2026-04-19-ar-bulk-invoice-email-design.md](../specs/2026-04-19-ar-bulk-invoice-email-design.md)

**Testing convention for this repo:** No test harness exists. "Write the test first" translates to **define the verification gate first** — a curl/SQL/browser check that confirms behavior. "Run test to verify it fails" becomes "run gate → observe the current failure mode (404, empty row, stale column)". After implementation, rerun the gate to confirm success. Full verification gate walkthrough is Task 13.

**Branch discipline (yesterday's handoff):** direct-to-main. Before every commit: `git branch --show-current` → must read `main`. Every commit includes the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer. Never use `--no-verify`.

**Dark mode convention (MANDATORY):** every new component MUST include `dark:` variants on every gray/white/border class per `memory/dev_dark_mode_convention.md`. Run a grep for `\bbg-white\b|\btext-gray-\d+\b|\bborder-gray-\d+\b` before committing component changes — matches must have a paired `dark:` variant.

**Migration convention (MANDATORY):** every SQL migration MUST follow `memory/dev_migration_template.md` — `BEGIN; ... NOTIFY pgrst, 'reload schema'; COMMIT;`. User applies the migration manually before the frontend ships.

---

## Pre-flight: files the engineer should skim first

Before starting Task 1, the engineer should have read these files into context:

- [docs/superpowers/specs/2026-04-19-ar-bulk-invoice-email-design.md](../specs/2026-04-19-ar-bulk-invoice-email-design.md) — the design spec this plan implements
- `db/migrations/080_invoice_send_claim.sql` (or whatever path; likely under `db/migrations/`) — the single-invoice claim pattern this extends
- `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js` — the single-send endpoint; bulk-send is its plural cousin
- `pages/api/tenant/ar/invoices/[invoiceId]/email-defaults.js` — the single-invoice defaults endpoint being extended
- `lib/email-dispatch/dispatcher.js` — where `dispatchEmail` + manual-send audit shape live
- `lib/email-dispatch/recipient-resolver.js` — where `resolveBillingRecipients` lives (adding a bulk variant)
- `lib/email-variables.js` — where template token catalog lives (adding bulk tokens)
- `components/ui/EmailComposeSlideOver.js` (or wherever; search for the export) — the shipped single-send popup being extended
- `components/ar/BillingPipelineTab.js` — the AR Pipeline page being wired
- `memory/session_2026_04_18_evening_handoff.md` — yesterday's hard-won lessons (silent refetch, sender FK, trigger-log audit shape)

---

## File Structure

Files to create:

| Path | Responsibility |
|---|---|
| `db/migrations/081_bulk_invoice_claim_rpc.sql` | Array-accepting claim RPC with partial-success semantics |
| `pages/api/tenant/ar/invoices/bulk-send.js` | POST handler for one group = one email with N PDFs |
| `components/ar/BulkActionBar.js` | Bottom-fixed action bar (replaces the existing top sticky pill in BillingPipelineTab) |
| `components/ar/BulkGroupingModal.js` | 3-choice grouping modal + pure `computeGroups` helper |
| `components/ar/BulkEmailQueue.js` | Queue dashboard (one row per group, hybrid close behavior) |
| `components/ar/useBulkEmailQueue.js` | Orchestration hook (state, defaults fetch, sendReady, retryFailed) |

Files to modify:

| Path | Change |
|---|---|
| `lib/email-dispatch/recipient-resolver.js` | Add `resolveBulkBillingRecipients(svc, customerId, tenantId, emailType, invoiceIds)` |
| `lib/email-dispatch/dispatcher.js` | Extend manual-send audit to support `type: 'manual_bulk'` with `invoice_ids[]` |
| `lib/email-variables.js` | Add `{{invoice.numbers}}`, `{{invoice.count}}`, `{{invoice.total_cents}}`, `{{invoice.earliest_due}}` |
| `pages/api/tenant/ar/invoices/[invoiceId]/email-defaults.js` OR a new sibling `pages/api/tenant/ar/invoices/email-defaults-bulk.js` | Accept `invoice_ids[]` (decision in Task 5 based on route shape) |
| `components/ui/EmailComposeSlideOver.js` | Render read-only list when `attachments.length > 1` |
| `components/ar/BillingPipelineTab.js` | Relocate selection bar to bottom; add Approve & Invoice handler; mount grouping modal + queue |

---

## Task 1: Migration 081 — Bulk claim RPC

**Files:**
- Create: `db/migrations/081_bulk_invoice_claim_rpc.sql`

- [ ] **Step 1: Verify migration file location + numbering**

Run: `ls db/migrations/ | tail -10`
Expected: see `080_...sql` (from yesterday's `f7e5fcf`). If the path differs (e.g. `supabase/migrations/`), follow that convention and adjust numbering. Confirm 080 is the highest current number.

- [ ] **Step 2: Create migration file**

Create `db/migrations/081_bulk_invoice_claim_rpc.sql`:

```sql
-- ============================================================
-- Migration 081: Bulk invoice claim RPC
-- ============================================================
-- Extends migration 080's single-invoice claim pattern to arrays
-- for AR bulk-send (sub-project 2a.4). Returns the successfully-
-- claimed subset so the caller can dispatch only what it owns;
-- invoices already sent or currently claimed by another session
-- (< 5 min) are silently skipped.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION claim_invoices_for_send(
  p_invoice_ids UUID[],
  p_user_id UUID
)
RETURNS TABLE (invoice_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE invoices
  SET send_claimed_at = now(),
      send_claimed_by = p_user_id
  WHERE id = ANY(p_invoice_ids)
    AND sent_at IS NULL
    AND (
      send_claimed_at IS NULL
      OR send_claimed_at < now() - interval '5 minutes'
      OR send_claimed_by = p_user_id
    )
  RETURNING id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_invoices_for_send(UUID[], UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

Name collision note: migration 080 already defines a single-UUID `claim_invoices_for_send(UUID, UUID)`. Postgres allows function overloading by signature, so `(UUID[], UUID)` is a distinct function — they coexist. Verify in Step 4.

- [ ] **Step 3: Commit**

```bash
git branch --show-current   # must print: main
git add db/migrations/081_bulk_invoice_claim_rpc.sql
git commit -m "$(cat <<'EOF'
feat(ar-email): migration 081 — bulk invoice claim RPC

Adds claim_invoices_for_send(UUID[], UUID) overload for bulk-send
(sub-project 2a.4). Partial-success semantics: returns the subset
of input IDs successfully claimed. Invoices already sent or held
by another session (<5 min) are silently skipped.

Coexists with migration 080's single-UUID overload by PG function
signature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: User applies migration manually; verify**

Stop here and ask the user to apply `081_bulk_invoice_claim_rpc.sql` in the Supabase SQL editor (same flow as 080). After they confirm:

Run a verification query in SQL editor:
```sql
SELECT proname, pg_get_function_identity_arguments(oid) as args
FROM pg_proc
WHERE proname = 'claim_invoices_for_send';
```
Expected: two rows — one with `p_invoice_ids uuid, p_user_id uuid` (from 080) and one with `p_invoice_ids uuid[], p_user_id uuid` (from 081).

Test partial-success semantics:
```sql
-- seed: pick 3 invoice IDs from a test tenant where sent_at IS NULL and send_claimed_at IS NULL
-- pre-claim one of them to simulate contention
UPDATE invoices SET send_claimed_at = now(), send_claimed_by = auth.uid()
WHERE id = '<first-invoice-id>';

-- claim all 3 as a different user (use a fresh UUID for p_user_id)
SELECT * FROM claim_invoices_for_send(
  ARRAY['<first>', '<second>', '<third>']::UUID[],
  '00000000-0000-0000-0000-000000000001'::UUID
);
-- Expected: 2 rows returned (second and third). First is held by another user.

-- cleanup:
UPDATE invoices SET send_claimed_at = NULL, send_claimed_by = NULL
WHERE id IN ('<first>', '<second>', '<third>');
```

---

## Task 2: Extend `dispatcher.js` for `manual_bulk` audit shape

**Files:**
- Modify: `lib/email-dispatch/dispatcher.js`

- [ ] **Step 1: Read dispatcher.js end-to-end**

Run: `cat lib/email-dispatch/dispatcher.js | head -200` and the rest in 200-line chunks until you find the manual-send audit write (usually in `logManualSend` / `logManualSkip` or a block inside `dispatchEmail`).

Locate the code that writes to `email_trigger_log` with `umbrella_decisions: [{ type: 'manual' | 'manual_skip', ... }]`. This is the shape being extended.

- [ ] **Step 2: Identify the extension point**

Yesterday's handoff (commit `20fa364`) established the convention:
```
umbrella_decisions: [{ type: 'manual' | 'manual_skip', ...payload }]
messages_created: [{ email_message_id: uuid }]
```
where payload carries `sent_by_user_id`, `invoice_id`, `decision_key`, etc.

The new variant:
```
umbrella_decisions: [{
  type: 'manual_bulk',
  sent_by_user_id: <uuid>,
  invoice_ids: [<uuid>, ...],
  grouping_kind: 'customer' | 'reference' | 'charge_set',
  group_label: <string>,
  bill_to_id: <uuid>,
  reference_number: <string | null>
}]
messages_created: [{ email_message_id: <uuid> }]   // on success
                OR []                               // on failure, with error field
```

- [ ] **Step 3: Extend the audit-write function**

If dispatcher.js has a `logManualSend({ tenantId, invoiceId, messageId, userId })` export, add a sibling:

```javascript
/**
 * Write an email_trigger_log row for a bulk send (one row per group, one email per call).
 * @param {SupabaseClient} svc - service-role client
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string[]} args.invoiceIds
 * @param {string} args.userId
 * @param {'customer'|'reference'|'charge_set'} args.groupingKind
 * @param {string} args.groupLabel
 * @param {string} args.billToId
 * @param {string|null} args.referenceNumber
 * @param {string|null} args.messageId   // null on failure
 * @param {string|null} args.error        // error message on failure, null on success
 */
export async function logManualBulkSend(svc, args) {
  const {
    tenantId, invoiceIds, userId, groupingKind, groupLabel,
    billToId, referenceNumber, messageId, error,
  } = args;

  const umbrellaDecision = {
    type: 'manual_bulk',
    sent_by_user_id: userId,
    invoice_ids: invoiceIds,
    grouping_kind: groupingKind,
    group_label: groupLabel,
    bill_to_id: billToId,
    reference_number: referenceNumber,
    ...(error ? { error } : {}),
  };

  const row = {
    tenant_id: tenantId,
    trigger_id: null,
    umbrella_decisions: [umbrellaDecision],
    messages_created: messageId ? [{ email_message_id: messageId }] : [],
  };

  const { error: logErr } = await svc.from('email_trigger_log').insert(row);
  if (logErr) {
    // Don't fail the request on audit-log failure — log and continue.
    // Matches the existing manual-send convention.
    console.error('[logManualBulkSend] trigger_log insert failed:', logErr.message);
  }
}
```

Copy field names exactly from the adjacent `logManualSend` function in this same file — the real schema column names (e.g. `messages_created` vs `email_messages_created`) may differ from the spec. Yesterday's handoff (commit `20fa364`) flagged that earlier drafts used wrong column names. Read the working `logManualSend` and mirror it.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: build completes with only the pre-existing ESLint warnings (same set as baseline). No errors, no new warnings in `lib/email-dispatch/dispatcher.js`.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # main
git add lib/email-dispatch/dispatcher.js
git commit -m "$(cat <<'EOF'
feat(ar-email): logManualBulkSend audit helper

Adds a sibling to logManualSend that writes a single
email_trigger_log row for a bulk-send group. Reuses the
umbrella_decisions JSONB convention from yesterday's
manual-send audit (commit 20fa364).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `resolveBulkBillingRecipients` to recipient-resolver.js

**Files:**
- Modify: `lib/email-dispatch/recipient-resolver.js`

- [ ] **Step 1: Re-read the existing resolveBillingRecipients**

Current signature: `resolveBillingRecipients(svc, customerId, tenantId, emailType)` → `{ to, source }`. Already handles per-type + fallback.

- [ ] **Step 2: Define expected behavior of the bulk variant**

Bulk requirement: all invoice_ids in a group share the same `bill_to_id` (guaranteed by grouping logic). The bulk-send endpoint can therefore just call the existing function once per group. No new function is strictly required — but a convenience wrapper makes the call site clearer and allows the spec's guarantee to be asserted server-side.

Add `resolveBulkBillingRecipients(svc, customerId, tenantId, emailType, invoiceIds)`:
- Asserts `invoiceIds` is non-empty
- Optionally cross-checks that all invoices belong to `customerId` (defense-in-depth against grouping bugs)
- Delegates to `resolveBillingRecipients`
- Returns `{ to, source, verifiedInvoiceCount }`

- [ ] **Step 3: Implement**

Append to `lib/email-dispatch/recipient-resolver.js`:

```javascript
/**
 * Bulk variant of resolveBillingRecipients — used by /invoices/bulk-send.
 *
 * Asserts that all invoiceIds belong to customerId (defense against
 * grouping bugs that would otherwise leak invoices across customers).
 * Delegates recipient resolution to resolveBillingRecipients.
 *
 * @param {SupabaseClient} svc
 * @param {string} customerId
 * @param {string} tenantId
 * @param {'invoice' | 'rate_confirmation'} emailType
 * @param {string[]} invoiceIds
 * @returns {Promise<{ to: string[], source: string, verifiedInvoiceCount: number }>}
 */
export async function resolveBulkBillingRecipients(
  svc, customerId, tenantId, emailType, invoiceIds
) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new Error('resolveBulkBillingRecipients: invoiceIds must be non-empty array');
  }

  // Cross-check: every invoice in the group must belong to customerId within tenantId.
  const { data: rows, error } = await svc
    .from('invoices')
    .select('id, bill_to_id')
    .eq('tenant_id', tenantId)
    .in('id', invoiceIds);

  if (error) {
    throw new Error(`bulk recipient verification failed: ${error.message}`);
  }

  if (!rows || rows.length !== invoiceIds.length) {
    throw new Error(
      `bulk recipient verification failed: expected ${invoiceIds.length} invoices, found ${rows?.length ?? 0}`
    );
  }

  const mismatched = rows.filter((r) => r.bill_to_id !== customerId);
  if (mismatched.length > 0) {
    throw new Error(
      `bulk recipient verification failed: ${mismatched.length} invoice(s) have a different bill_to_id than group customer`
    );
  }

  const { to, source } = await resolveBillingRecipients(
    svc, customerId, tenantId, emailType
  );

  return { to, source, verifiedInvoiceCount: rows.length };
}
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: clean build, no new warnings in `lib/email-dispatch/recipient-resolver.js`.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # main
git add lib/email-dispatch/recipient-resolver.js
git commit -m "$(cat <<'EOF'
feat(ar-email): resolveBulkBillingRecipients with cross-customer guard

Bulk-send variant of resolveBillingRecipients that asserts every
invoice_id in the group shares the requested bill_to_id. Defense
against grouping bugs that could otherwise leak invoices across
customers — the design-spec privacy invariant enforced at the
dispatch layer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add bulk variable tokens to email-variables.js

**Files:**
- Modify: `lib/email-variables.js`

- [ ] **Step 1: Read email-variables.js**

Run: `cat lib/email-variables.js | head -100`
Find the flat Map catalog where tokens register. Yesterday's handoff (plan-deviations note): "Resolver uses flat Map, not family switch. Tokens register in `lib/email-variables.js` catalog."

Each entry has shape:
```javascript
{ key, kind: 'text' | 'currency' | 'date', resolve: (ctx) => value, label, description }
```

Currency kind expects DOLLARS not cents (context builders pre-divide).

- [ ] **Step 2: Define the new bulk tokens**

| Token | Kind | Resolves to | Example |
|---|---|---|---|
| `{{invoice.numbers}}` | text | `ctx.invoices.map(i => i.invoice_number).join(', ')` | `"INV-0001, INV-0002, INV-0003"` |
| `{{invoice.count}}` | text | `String(ctx.invoices?.length ?? 0)` | `"3"` |
| `{{invoice.total_cents}}` | currency | `sum(i.total_cents) / 100` (dollars) | `"$4,200.00"` |
| `{{invoice.earliest_due}}` | date | `min(i.due_at)` | `"2026-05-01"` |

Existing `{{invoice.number}}` (singular) stays; in bulk contexts it resolves to `ctx.invoices?.[0]?.invoice_number` as fallback so single-send templates don't blow up if reused in bulk mode.

- [ ] **Step 3: Implement**

Locate the Map entries for `invoice.number` (singular, already registered in 2a.2). Add new entries alongside:

```javascript
// Singular tokens (existing) — verify shape before editing.
// 'invoice.number': { key: 'invoice.number', kind: 'text', resolve: (ctx) => ctx.invoice?.invoice_number ?? '', ... }

// NEW: bulk-aware plural tokens
'invoice.numbers': {
  key: 'invoice.numbers',
  kind: 'text',
  label: 'Invoice numbers (bulk)',
  description: 'Comma-joined list of invoice numbers in this group',
  resolve: (ctx) => {
    if (Array.isArray(ctx.invoices) && ctx.invoices.length > 0) {
      return ctx.invoices.map((i) => i.invoice_number).filter(Boolean).join(', ');
    }
    return ctx.invoice?.invoice_number ?? '';
  },
},
'invoice.count': {
  key: 'invoice.count',
  kind: 'text',
  label: 'Invoice count',
  description: 'Number of invoices in this bulk email',
  resolve: (ctx) => {
    if (Array.isArray(ctx.invoices)) return String(ctx.invoices.length);
    return ctx.invoice ? '1' : '0';
  },
},
'invoice.total_cents': {
  key: 'invoice.total_cents',
  kind: 'currency',
  label: 'Invoice total (bulk-aware)',
  description: 'Sum of totals for all invoices in the group',
  resolve: (ctx) => {
    if (Array.isArray(ctx.invoices) && ctx.invoices.length > 0) {
      const sumCents = ctx.invoices.reduce((a, i) => a + (i.total_cents || 0), 0);
      return sumCents / 100;   // currency kind expects dollars
    }
    return (ctx.invoice?.total_cents ?? 0) / 100;
  },
},
'invoice.earliest_due': {
  key: 'invoice.earliest_due',
  kind: 'date',
  label: 'Earliest due date (bulk-aware)',
  description: 'Minimum due_at across invoices in the group',
  resolve: (ctx) => {
    if (Array.isArray(ctx.invoices) && ctx.invoices.length > 0) {
      const dates = ctx.invoices.map((i) => i.due_at).filter(Boolean).sort();
      return dates[0] ?? null;
    }
    return ctx.invoice?.due_at ?? null;
  },
},
```

Backwards-compat: existing `'invoice.number'` token should also fall back to `ctx.invoices?.[0]?.invoice_number` when called in a bulk context — update its resolve to handle both shapes.

- [ ] **Step 4: Verify with a render smoke check**

Quick inline verification — no test harness, but we can run a one-off node script:

Create `/tmp/verify_bulk_tokens.js`:
```javascript
const { resolveTemplate } = require('./lib/email-variables');
const ctx = {
  invoices: [
    { invoice_number: 'INV-0001', total_cents: 100000, due_at: '2026-05-15' },
    { invoice_number: 'INV-0002', total_cents: 250000, due_at: '2026-05-01' },
  ],
};
// Adjust call signature to match whatever your resolveTemplate exports:
console.log(resolveTemplate('Bulk: {{invoice.numbers}} ({{invoice.count}} totaling {{invoice.total_cents}}), earliest {{invoice.earliest_due}}', ctx));
```
Run: `node /tmp/verify_bulk_tokens.js`
Expected stdout: `Bulk: INV-0001, INV-0002 (2 totaling $3,500.00), earliest 2026-05-01`

If signature mismatch, import the correct helper name from email-variables.js and rerun. Delete `/tmp/verify_bulk_tokens.js` after verification.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # main
git add lib/email-variables.js
git commit -m "$(cat <<'EOF'
feat(ar-email): bulk-aware invoice variable tokens

Adds {{invoice.numbers}}, {{invoice.count}}, {{invoice.total_cents}}
(bulk-aware), and {{invoice.earliest_due}} to the email-variable
catalog for 2a.4 bulk templates. Existing {{invoice.number}} now
falls back to ctx.invoices[0] so single-send templates remain
functional when reused in bulk contexts.

Currency kind renders sum in dollars (catalog expects
pre-divided values). Date kind returns ISO string.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extend invoice email-defaults endpoint to accept `invoice_ids[]`

**Files:**
- Modify: `pages/api/tenant/ar/invoices/[invoiceId]/email-defaults.js` — add a new POST variant, OR
- Create: `pages/api/tenant/ar/invoices/email-defaults-bulk.js` — separate route

Decision: the single-invoice endpoint uses the `[invoiceId]` dynamic segment in its path. Bulk needs a non-parameterized path. Create a sibling route rather than overloading the existing one.

**Files (final):**
- Create: `pages/api/tenant/ar/invoices/email-defaults-bulk.js`

- [ ] **Step 1: Read the single-invoice email-defaults endpoint**

Run: `cat pages/api/tenant/ar/invoices/\[invoiceId\]/email-defaults.js`

Note the handler's pattern:
1. Resolve tenant + auth user
2. Load invoice + related customer/order
3. Build context via `buildInvoiceContext(svc, tenantId, invoiceId)` from `lib/email-dispatch/context-builder.js`
4. Load template row (category='ar', slug='invoice_send')
5. Call `resolveTemplate(...)` twice — once for subject, once for body — with the built context
6. Call `resolveBillingRecipients(...)` for the To field
7. Return `{ recipients, subject, body, body_format, attachments: [{ name, invoice_id }] }`

The bulk variant is "same but plural" — context built from N invoices, attachments array of N entries.

- [ ] **Step 2: Read context-builder.js for buildInvoiceContext shape**

Run: `cat lib/email-dispatch/context-builder.js | head -150`
Find `buildInvoiceContext`. Note: yesterday's handoff said it returns `{ context, formatPrefs }` (refactored to eliminate duplicate tenant_format_preferences fetch).

- [ ] **Step 3: Add a bulk context builder**

Prepend to `lib/email-dispatch/context-builder.js` (or add a new exported function alongside the existing builders):

```javascript
/**
 * Build a template-rendering context for a bulk-invoice email.
 * All invoice_ids must belong to the same bill_to_id (caller asserts).
 *
 * Returns the same shape as buildInvoiceContext but with
 * ctx.invoices = [invoice, invoice, ...] populated. ctx.invoice
 * is set to the first invoice so single-send tokens continue to
 * resolve.
 *
 * @param {SupabaseClient} svc
 * @param {string} tenantId
 * @param {string[]} invoiceIds
 * @returns {Promise<{ context: object, formatPrefs: object }>}
 */
export async function buildBulkInvoiceContext(svc, tenantId, invoiceIds) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new Error('buildBulkInvoiceContext: invoiceIds required');
  }
  // Load all invoices with their customer + line items joined
  const { data: invoices, error } = await svc
    .from('invoices')
    .select('*, customer:customers(*), order:orders(*), line_items:invoice_line_items(*)')
    .eq('tenant_id', tenantId)
    .in('id', invoiceIds)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`bulk invoice context: ${error.message}`);
  if (!invoices || invoices.length !== invoiceIds.length) {
    throw new Error(`bulk invoice context: expected ${invoiceIds.length} invoices, got ${invoices?.length ?? 0}`);
  }

  // Reuse the single-invoice context builder for the first invoice to
  // get tenant/format/customer fields; then augment with the plural array.
  const { context: singleCtx, formatPrefs } = await buildInvoiceContext(
    svc, tenantId, invoiceIds[0]
  );
  const context = {
    ...singleCtx,
    invoices,           // plural — used by {{invoice.numbers}} et al
    invoice: invoices[0], // backcompat fallback for {{invoice.*}} singular
  };
  return { context, formatPrefs };
}
```

- [ ] **Step 4: Write the bulk email-defaults endpoint**

Create `pages/api/tenant/ar/invoices/email-defaults-bulk.js`:

```javascript
import { getTenantFromRequest } from '../../../../../lib/tenant';    // adjust to actual tenant-resolver import
import { getServiceClient } from '../../../../../lib/supabase-service';
import { buildBulkInvoiceContext } from '../../../../../lib/email-dispatch/context-builder';
import { resolveBulkBillingRecipients } from '../../../../../lib/email-dispatch/recipient-resolver';
import { resolveTemplate } from '../../../../../lib/email-variables';
import { formatInvoiceNumber } from '../../../../../lib/invoice-utils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tenantId, userId } = await getTenantFromRequest(req);
    const { invoice_ids, bill_to_id: billToHint } = req.body || {};

    if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return res.status(400).json({ error: 'invoice_ids (non-empty array) required' });
    }

    const svc = getServiceClient();

    // 1. Build context from all invoices (also validates they belong to tenant)
    const { context, formatPrefs } = await buildBulkInvoiceContext(svc, tenantId, invoice_ids);

    // 2. Derive bill_to_id from context (all invoices share it by caller contract)
    const billToId = context.invoice.bill_to_id || billToHint;
    if (!billToId) {
      return res.status(400).json({ error: 'bill_to_id could not be resolved' });
    }

    // 3. Load AR invoice template (category='ar', slug='invoice_send')
    const { data: tpl, error: tplErr } = await svc
      .from('email_templates')
      .select('subject, body, body_format')
      .eq('tenant_id', tenantId)
      .eq('category', 'ar')
      .eq('system_slug', 'invoice_send')
      .maybeSingle();
    if (tplErr) throw new Error(`template lookup: ${tplErr.message}`);
    if (!tpl) {
      return res.status(404).json({ error: 'AR invoice template missing — configure in Settings > AR Configuration', code: 'TEMPLATE_NOT_FOUND' });
    }

    // 4. Resolve subject + body against the bulk context
    const subject = resolveTemplate(tpl.subject ?? '', context, formatPrefs);
    const body = resolveTemplate(tpl.body ?? '', context, formatPrefs);

    // 5. Resolve recipients (delegates to existing resolveBillingRecipients + cross-customer guard)
    const { to } = await resolveBulkBillingRecipients(
      svc, billToId, tenantId, 'invoice', invoice_ids
    );

    // 6. Build attachments array (one per invoice)
    const attachments = context.invoices.map((inv) => ({
      name: `${formatInvoiceNumber(inv.invoice_number_base, inv.rebill_count)}.pdf`,
      invoice_id: inv.id,
    }));

    return res.status(200).json({
      recipients: { to, cc: [], bcc: [] },
      subject,
      body,
      body_format: tpl.body_format || 'html',
      attachments,
    });
  } catch (err) {
    console.error('[email-defaults-bulk] error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
```

Import paths: verify against the actual single-invoice email-defaults.js imports (copy-paste the header and adjust depth — `../../../../../` is for 5 levels up from `pages/api/tenant/ar/invoices/email-defaults-bulk.js`).

- [ ] **Step 5: Smoke-test via curl**

Start dev server: `npm run dev` (or `next dev`)

In another terminal:
```bash
curl -X POST http://localhost:3000/api/tenant/ar/invoices/email-defaults-bulk \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <your-dev-cookie>' \
  -d '{"invoice_ids":["<real-invoice-id-1>","<real-invoice-id-2>"]}' \
  | jq .
```
Expected: 200 with `{recipients: {to: [...], cc: [], bcc: []}, subject: "...", body: "...", body_format: "html", attachments: [{name, invoice_id}, {name, invoice_id}]}`. Subject contains the comma-joined invoice numbers (from `{{invoice.numbers}}` if the template uses it).

If 404 Template Not Found: seed the template via `/settings/ar/configuration` first, then rerun.

If 401: the endpoint requires tenant auth. Use a browser session cookie; on Windows Git Bash you can extract with browser devtools → Network → any authenticated request → copy cookie header.

- [ ] **Step 6: Build check + commit**

```bash
npm run build
# Expected: build succeeds

git branch --show-current   # main
git add lib/email-dispatch/context-builder.js pages/api/tenant/ar/invoices/email-defaults-bulk.js
git commit -m "$(cat <<'EOF'
feat(ar-email): bulk email-defaults endpoint + bulk context builder

POST /api/tenant/ar/invoices/email-defaults-bulk accepts
{invoice_ids:[...]} and returns recipients/subject/body/attachments
for a bulk-send group. Sibling to the per-[invoiceId] defaults
endpoint from 2a.2.

buildBulkInvoiceContext reuses the single-invoice builder for
tenant/format/customer fields and augments with ctx.invoices[]
for plural tokens (see task 4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: New `POST /invoices/bulk-send` endpoint

**Files:**
- Create: `pages/api/tenant/ar/invoices/bulk-send.js`

- [ ] **Step 1: Read the single-send endpoint**

Run: `cat pages/api/tenant/ar/invoices/\[invoiceId\]/send-email.js`

Note the stages (post-2a.2 + yesterday's cleanup fixes):
1. Validate req + auth + tenant
2. Claim via `claim_invoices_for_send(UUID, UUID)` RPC (fail fast on 409)
3. Fetch full config via `fetchFullConfiguration(svc, tenantId, configId)` (yesterday's `a8afd96` — prevents raw FK struct leaking to SendGrid)
4. Render PDF via `archiveInvoicePdf(invoice, tenant, customer, { preRendered: null })`
5. Resolve `fromAddress` + `fromName` via `resolveFromAddress` + `resolveFromName`
6. Call `dispatchEmail({ provider, from, recipients, subject, body, body_format, attachments: [single] })`
7. On success: UPDATE `invoices.sent_at`; write trigger-log via `logManualSend`
8. On failure: release claim (`send_claimed_at = NULL`); write failure trigger-log; return stage-labeled error (`claim_failed`, `pdf_render_failed`, `dispatch_failed`, `postdispatch_update_failed`)

The bulk variant is "do that for N invoices in one group, one SendGrid call, N attachments."

- [ ] **Step 2: Read fetchFullConfiguration + resolveFromAddress**

Likely in `lib/email-dispatch/dispatcher.js` (exported per yesterday's commit `a8afd96`). Confirm exports:

```bash
grep -n "export.*fetchFullConfiguration\|export.*resolveFromAddress\|export.*resolveFromName\|export.*dispatchEmail" lib/email-dispatch/dispatcher.js
```

Record the import line you'll use.

- [ ] **Step 3: Read archive.js for archiveInvoicePdf signature**

Run: `cat lib/pdf/archive.js | head -100` (adjust path if 2a.1 put it elsewhere).

Note the exact arg shape — likely `archiveInvoicePdf(invoice, tenant, customer, { preRendered })` → returns `{ buffer, filename, url, storageKey }`.

- [ ] **Step 4: Implement the bulk-send endpoint**

Create `pages/api/tenant/ar/invoices/bulk-send.js`:

```javascript
import { getTenantFromRequest } from '../../../../lib/tenant';   // verify path
import { getServiceClient } from '../../../../lib/supabase-service';
import {
  fetchFullConfiguration,
  resolveFromAddress,
  resolveFromName,
  dispatchEmail,
  logManualBulkSend,
} from '../../../../lib/email-dispatch/dispatcher';
import { archiveInvoicePdf } from '../../../../lib/pdf/archive';

const STAGE = {
  validate: 'validate',
  claim: 'claim',
  fetch_config: 'fetch_config',
  render: 'render',
  dispatch: 'dispatch',
  postdispatch: 'postdispatch',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let stage = STAGE.validate;
  let claimedIds = [];
  const svc = getServiceClient();

  try {
    // ── STAGE: validate ─────────────────────────────────
    const { tenantId, userId } = await getTenantFromRequest(req);
    const { group } = req.body || {};
    if (!group || typeof group !== 'object') {
      return res.status(400).json({ error: 'group required' });
    }
    const {
      invoice_ids: invoiceIds,
      recipients,
      subject,
      body,
      body_format: bodyFormat = 'html',
    } = group;

    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'group.invoice_ids (non-empty array) required' });
    }
    if (!recipients || !Array.isArray(recipients.to) || recipients.to.length === 0) {
      return res.status(400).json({ error: 'group.recipients.to (non-empty array) required' });
    }
    if (!subject || !body) {
      return res.status(400).json({ error: 'group.subject and group.body required' });
    }

    // ── STAGE: claim ────────────────────────────────────
    stage = STAGE.claim;
    const { data: claimRows, error: claimErr } = await svc.rpc(
      'claim_invoices_for_send',
      { p_invoice_ids: invoiceIds, p_user_id: userId }
    );
    if (claimErr) throw new Error(`claim RPC failed: ${claimErr.message}`);

    claimedIds = (claimRows ?? []).map((r) => r.invoice_id);
    if (claimedIds.length === 0) {
      return res.status(409).json({
        error: 'All invoices already claimed or sent',
        code: 'ALL_CLAIMED',
      });
    }

    // Partial-claim: proceed with claimed subset, log skipped
    const skippedIds = invoiceIds.filter((id) => !claimedIds.includes(id));

    // ── STAGE: fetch_config ─────────────────────────────
    stage = STAGE.fetch_config;
    const { data: cfgRow, error: cfgErr } = await svc
      .from('email_configurations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('kind', 'ar')    // or whatever discriminator identifies the AR config
      .maybeSingle();
    if (cfgErr) throw new Error(`config lookup: ${cfgErr.message}`);
    if (!cfgRow) throw new Error('AR email configuration missing for tenant');

    const fullConfig = await fetchFullConfiguration(svc, tenantId, cfgRow.id);

    const { data: tenantRow } = await svc
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .maybeSingle();

    const fromAddress = resolveFromAddress(fullConfig, null, tenantRow);
    const fromName = resolveFromName(fullConfig, tenantRow);

    // ── STAGE: render ───────────────────────────────────
    stage = STAGE.render;
    const { data: invoices, error: invErr } = await svc
      .from('invoices')
      .select('*, customer:customers(*), order:orders(*), line_items:invoice_line_items(*)')
      .eq('tenant_id', tenantId)
      .in('id', claimedIds);
    if (invErr) throw new Error(`invoice load: ${invErr.message}`);

    const attachments = [];
    for (const inv of invoices) {
      const { buffer, filename } = await archiveInvoicePdf(
        inv, tenantRow, inv.customer, { preRendered: null }
      );
      attachments.push({
        filename,
        content: buffer.toString('base64'),      // sendgrid expects base64
        type: 'application/pdf',
        disposition: 'attachment',
      });
    }

    // ── STAGE: dispatch ─────────────────────────────────
    stage = STAGE.dispatch;
    const dispatchResult = await dispatchEmail({
      provider: 'sendgrid',
      from: { email: fromAddress, name: fromName },
      recipients,
      subject,
      body,
      body_format: bodyFormat,
      attachments,
      svc,
      tenantId,
    });
    // dispatchEmail should return { messageId, ... } on success or throw

    // ── STAGE: postdispatch ─────────────────────────────
    stage = STAGE.postdispatch;
    const sentAt = new Date().toISOString();
    const { error: updErr } = await svc
      .from('invoices')
      .update({ sent_at: sentAt, send_claimed_at: null, send_claimed_by: null })
      .in('id', claimedIds);
    if (updErr) throw new Error(`sent_at update: ${updErr.message}`);

    // Audit log (single row for the group)
    const primaryInvoice = invoices[0];
    await logManualBulkSend(svc, {
      tenantId,
      invoiceIds: claimedIds,
      userId,
      groupingKind: group.grouping_kind ?? 'customer',
      groupLabel: group.group_label ?? primaryInvoice.customer?.name ?? '(group)',
      billToId: primaryInvoice.bill_to_id,
      referenceNumber: primaryInvoice.order?.reference_number ?? null,
      messageId: dispatchResult.messageId ?? null,
      error: null,
    });

    return res.status(200).json({
      sent: claimedIds,
      skipped: skippedIds,
      message_id: dispatchResult.messageId ?? null,
    });
  } catch (err) {
    // Release claims on failure so Retry can reacquire
    if (claimedIds.length > 0) {
      await svc
        .from('invoices')
        .update({ send_claimed_at: null, send_claimed_by: null })
        .in('id', claimedIds)
        .is('sent_at', null);
    }
    // Audit-log the failure
    try {
      await logManualBulkSend(svc, {
        tenantId: req.__tenantId ?? null,   // best-effort if we got past validate
        invoiceIds: claimedIds,
        userId: req.__userId ?? null,
        groupingKind: req.body?.group?.grouping_kind ?? 'customer',
        groupLabel: req.body?.group?.group_label ?? null,
        billToId: null,
        referenceNumber: null,
        messageId: null,
        error: `${stage}: ${err.message}`,
      });
    } catch (_) { /* audit-log failure is not fatal */ }

    console.error(`[bulk-send] ${stage} failure:`, err);
    const status = stage === STAGE.claim ? 409 : 502;
    return res.status(status).json({
      error: `${stage}_failed: ${err.message}`,
      stage,
    });
  }
}
```

Notes for the implementer:
- Verify `dispatchEmail` return shape against `lib/email-dispatch/dispatcher.js`. If it returns `{ messageIds: [] }` or similar, adapt.
- The `email_configurations.kind` discriminator may be named differently (e.g. `purpose`, `type`). Grep the table: `grep -rn "from('email_configurations')" lib/ pages/api/ | head -5` and match usage.
- Sendgrid attachment `content` must be base64 string per `@sendgrid/mail` docs (we encode above). If the existing single-send passes a Buffer instead, follow that convention — consistency over spec.

- [ ] **Step 5: Smoke test via curl**

```bash
curl -X POST http://localhost:3000/api/tenant/ar/invoices/bulk-send \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <dev-cookie>' \
  -d '{
    "group": {
      "invoice_ids": ["<id-1>", "<id-2>"],
      "recipients": { "to": ["qa@example.com"], "cc": [], "bcc": [] },
      "subject": "Test bulk",
      "body": "<p>Test</p>",
      "body_format": "html",
      "grouping_kind": "customer",
      "group_label": "Test Customer"
    }
  }' | jq .
```
Expected: 200 with `{ sent: ["<id-1>","<id-2>"], skipped: [], message_id: "..." }`. A real SendGrid message is sent to `qa@example.com` (configure a safelist tenant for testing, or use SendGrid sandbox mode).

Re-run the same curl immediately — expected: 409 `{error: "claim_failed: ...", stage: "claim"}` because both invoices now have `sent_at` set (not reclaimable).

- [ ] **Step 6: Build + commit**

```bash
npm run build
# Expected: clean build

git branch --show-current   # main
git add pages/api/tenant/ar/invoices/bulk-send.js
git commit -m "$(cat <<'EOF'
feat(ar-email): POST /invoices/bulk-send endpoint

Accepts { group: { invoice_ids, recipients, subject, body,
body_format } } and emits one SendGrid message with N PDF
attachments. Stage-labeled errors, partial-claim passthrough,
claim release on failure, audit-log via logManualBulkSend.

Reuses 2a.2 infrastructure: fetchFullConfiguration,
resolveFromAddress/Name, dispatchEmail, archiveInvoicePdf.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `BulkGroupingModal` component + `computeGroups` pure helper

**Files:**
- Create: `components/ar/BulkGroupingModal.js`

- [ ] **Step 1: Define computeGroups semantics**

Input: `invoices: Array<{invoice_id, bill_to_id, customer_name, reference_number, charge_set_id, total_cents}>`
Kinds: `'customer' | 'reference' | 'charge_set'`
Output: `Array<{key, kind, label, bill_to_id, customer_name, reference_number?, invoice_ids, charge_set_ids, total_cents}>`

Invariants (enforced with assertions):
- Per-`customer`: one group per distinct `bill_to_id`
- Per-`reference`: one group per distinct `(bill_to_id, reference_number)`; null/empty ref falls back into the customer-level group (label = `"${customer_name} (no ref)"`)
- Per-`charge_set`: one group per charge_set_id
- For every kind: `Σ(group.invoice_ids.length) === input.length`

- [ ] **Step 2: Write computeGroups as a pure exported function**

Create `components/ar/BulkGroupingModal.js`:

```javascript
import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { formatInvoiceNumber } from '../../lib/invoice-utils';

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Pure group computation. Exported for unit testing in Task 13 Gate 3.
 *
 * @param {Array} invoices
 * @param {'customer' | 'reference' | 'charge_set'} kind
 * @returns {Array<Group>}
 */
export function computeGroups(invoices, kind) {
  if (!Array.isArray(invoices) || invoices.length === 0) return [];

  const keyFn = (inv) => {
    switch (kind) {
      case 'customer':
        return inv.bill_to_id;
      case 'reference':
        // null/empty ref → customer-level key (fallback)
        return inv.reference_number
          ? `${inv.bill_to_id}::${inv.reference_number}`
          : inv.bill_to_id;
      case 'charge_set':
        return inv.charge_set_id ?? inv.invoice_id;  // fallback to invoice if charge_set absent
      default:
        throw new Error(`unknown grouping kind: ${kind}`);
    }
  };

  const labelFn = (group) => {
    const first = group.invoices[0];
    switch (kind) {
      case 'customer':
        return first.customer_name ?? '(unknown customer)';
      case 'reference':
        return first.reference_number
          ? `${first.customer_name} · ${first.reference_number}`
          : `${first.customer_name} (no ref)`;
      case 'charge_set':
        return `${first.customer_name} · INV-${first.invoice_number ?? ''}`;
      default:
        return '';
    }
  };

  const map = new Map();
  for (const inv of invoices) {
    const k = keyFn(inv);
    if (!map.has(k)) map.set(k, { key: k, invoices: [] });
    map.get(k).invoices.push(inv);
  }

  const groups = [];
  for (const raw of map.values()) {
    const invoice_ids = raw.invoices.map((i) => i.invoice_id);
    const charge_set_ids = raw.invoices.map((i) => i.charge_set_id).filter(Boolean);
    const total_cents = raw.invoices.reduce((a, i) => a + (i.total_cents || 0), 0);
    const first = raw.invoices[0];
    groups.push({
      key: raw.key,
      kind,
      label: labelFn(raw),
      bill_to_id: first.bill_to_id,
      customer_name: first.customer_name,
      reference_number: first.reference_number ?? null,
      invoice_ids,
      charge_set_ids,
      total_cents,
    });
  }

  // Sanity invariant
  const totalInvoicesAcrossGroups = groups.reduce((a, g) => a + g.invoice_ids.length, 0);
  if (totalInvoicesAcrossGroups !== invoices.length) {
    throw new Error(
      `computeGroups invariant violation: ${totalInvoicesAcrossGroups} != ${invoices.length}`
    );
  }

  return groups;
}
```

- [ ] **Step 3: Add the modal component**

Append to the same file:

```javascript
const KINDS = [
  { key: 'customer',   label: '1 email per customer',      hint: 'All invoices for the same customer consolidated into one email with multiple PDFs attached.' },
  { key: 'reference',  label: '1 email per reference #',   hint: 'Bundle by PO / booking #. Invoices without a ref fall back into the customer grouping.' },
  { key: 'charge_set', label: 'Separate email per charge set', hint: 'One invoice per email. Like single-send, looped.' },
];

export default function BulkGroupingModal({ invoices, onCancel, onContinue }) {
  const [kind, setKind] = useState('customer');

  const groupsByKind = useMemo(() => ({
    customer: computeGroups(invoices, 'customer'),
    reference: computeGroups(invoices, 'reference'),
    charge_set: computeGroups(invoices, 'charge_set'),
  }), [invoices]);

  const selectedGroups = groupsByKind[kind];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-slate-950/60" onClick={onCancel}>
      <div
        className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div>
            <div className="text-base font-semibold text-gray-900 dark:text-slate-100">How should these be sent?</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {invoices.length} invoices ready · ${formatCents(invoices.reduce((a, i) => a + (i.total_cents || 0), 0))} total
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2">
          {KINDS.map((k) => {
            const groups = groupsByKind[k.key];
            const sample = groups.slice(0, 5).map((g) => `${g.label} (${g.invoice_ids.length})`).join(' · ');
            const more = groups.length > 5 ? ` · …+${groups.length - 5}` : '';
            const isSel = kind === k.key;
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={`w-full text-left rounded-lg border p-3 transition-all ${
                  isSel
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900/50'
                    : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{k.label}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    isSel ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                  }`}>
                    {groups.length} email{groups.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">{sample}{more}</div>
                <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 italic">{k.hint}</div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700">
            Cancel
          </button>
          <button
            onClick={() => onContinue({ kind, groups: selectedGroups })}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Dark mode verification**

Run: `grep -nE "\bbg-white\b|\btext-gray-[0-9]+\b|\bborder-gray-[0-9]+\b" components/ar/BulkGroupingModal.js`
Every match should be paired with a `dark:` variant on the same element. Audit manually.

- [ ] **Step 5: Build check + commit**

```bash
npm run build
git branch --show-current   # main
git add components/ar/BulkGroupingModal.js
git commit -m "$(cat <<'EOF'
feat(ar-email): BulkGroupingModal + pure computeGroups helper

Three-choice grouping modal (customer / reference / charge_set)
for the 2a.4 bulk flow. computeGroups is exported for unit-test
coverage (Task 13 Gate 3). Enforces Σ(invoice_ids) == input
invariant and (bill_to_id, reference_number) pairing per the
spec's cross-customer-leak guard.

Dark mode variants on every gray/white/border class.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `useBulkEmailQueue` hook

**Files:**
- Create: `components/ar/useBulkEmailQueue.js`

- [ ] **Step 1: Define the hook's state shape**

```typescript
type Row = {
  groupKey: string;
  group: Group;                   // from BulkGroupingModal
  status: 'pending' | 'ready' | 'needs_edit' | 'sending' | 'sent' | 'failed';
  recipients: { to: string[]; cc: string[]; bcc: string[] };
  subject: string;
  body: string;
  body_format: 'html' | 'text';
  attachments: Array<{ name: string; invoice_id: string; size_bytes?: number }>;
  error: string | null;
};
```

- [ ] **Step 2: Implement**

Create `components/ar/useBulkEmailQueue.js`:

```javascript
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Orchestrates the bulk-email queue: initial defaults fetch,
 * send-ready, retry-failed, per-row edit merge.
 *
 * @param {Group[]} groups
 * @param {'customer'|'reference'|'charge_set'} groupingKind
 */
export function useBulkEmailQueue(groups, groupingKind) {
  const [rows, setRows] = useState(() => groups.map((g) => ({
    groupKey: g.key,
    group: g,
    status: 'pending',
    recipients: { to: [], cc: [], bcc: [] },
    subject: '',
    body: '',
    body_format: 'html',
    attachments: [],
    error: null,
  })));
  const initialized = useRef(false);

  // On mount: fetch email-defaults for each group in parallel.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      const results = await Promise.allSettled(
        groups.map((g) =>
          fetch('/api/tenant/ar/invoices/email-defaults-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice_ids: g.invoice_ids, bill_to_id: g.bill_to_id }),
          }).then(async (res) => {
            if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
            return res.json();
          })
        )
      );

      setRows((rows) => rows.map((r, idx) => {
        const result = results[idx];
        if (result.status === 'fulfilled') {
          const d = result.value;
          const hasRecipient = (d.recipients?.to ?? []).length > 0;
          return {
            ...r,
            recipients: d.recipients,
            subject: d.subject,
            body: d.body,
            body_format: d.body_format,
            attachments: d.attachments,
            status: hasRecipient ? 'ready' : 'needs_edit',
            error: null,
          };
        } else {
          return {
            ...r,
            status: 'needs_edit',
            error: result.reason?.message ?? 'Failed to load defaults',
          };
        }
      }));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Merge edited fields back into a row (called from EmailComposeSlideOver Save)
  const updateRow = useCallback((groupKey, patch) => {
    setRows((rows) => rows.map((r) => {
      if (r.groupKey !== groupKey) return r;
      const merged = { ...r, ...patch };
      const hasRecipient = (merged.recipients?.to ?? []).length > 0;
      return {
        ...merged,
        status: merged.status === 'failed' ? 'failed' : (hasRecipient ? 'ready' : 'needs_edit'),
        error: merged.status === 'failed' ? merged.error : null,
      };
    }));
  }, []);

  // Internal — send a filtered subset
  const sendRowsByStatus = useCallback(async (targetStatus) => {
    const targetKeys = [];
    setRows((rows) => rows.map((r) => {
      if (r.status !== targetStatus) return r;
      targetKeys.push(r.groupKey);
      return { ...r, status: 'sending', error: null };
    }));

    const currentRows = await new Promise((resolve) => {
      setRows((rows) => { resolve(rows); return rows; });
    });
    const rowsToSend = currentRows.filter((r) => targetKeys.includes(r.groupKey));

    const results = await Promise.allSettled(
      rowsToSend.map((r) =>
        fetch('/api/tenant/ar/invoices/bulk-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            group: {
              invoice_ids: r.attachments.map((a) => a.invoice_id),
              recipients: r.recipients,
              subject: r.subject,
              body: r.body,
              body_format: r.body_format,
              grouping_kind: groupingKind,
              group_label: r.group.label,
            },
          }),
        }).then(async (res) => {
          if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
          return res.json();
        })
      )
    );

    setRows((rows) => rows.map((r) => {
      const idx = targetKeys.indexOf(r.groupKey);
      if (idx === -1) return r;
      const result = results[idx];
      if (result.status === 'fulfilled') {
        return { ...r, status: 'sent', error: null };
      }
      return { ...r, status: 'failed', error: result.reason?.message ?? 'Send failed' };
    }));

    return results;
  }, [groupingKind]);

  const sendReady   = useCallback(() => sendRowsByStatus('ready'),  [sendRowsByStatus]);
  const retryFailed = useCallback(() => sendRowsByStatus('failed'), [sendRowsByStatus]);

  const readyCount  = rows.filter((r) => r.status === 'ready').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const sentCount   = rows.filter((r) => r.status === 'sent').length;
  const needsEditCount = rows.filter((r) => r.status === 'needs_edit').length;
  const allSent = rows.length > 0 && rows.every((r) => r.status === 'sent');

  return {
    rows,
    updateRow,
    sendReady,
    retryFailed,
    readyCount,
    failedCount,
    sentCount,
    needsEditCount,
    allSent,
  };
}
```

Note: the `setRows → resolve(rows)` dance in `sendRowsByStatus` is intentional — `setRows` with an updater function exposes the latest state without stale closures. A simpler alternative if it feels hacky: read via a ref that mirrors rows on every update.

- [ ] **Step 3: Build check + commit**

```bash
npm run build
git branch --show-current   # main
git add components/ar/useBulkEmailQueue.js
git commit -m "$(cat <<'EOF'
feat(ar-email): useBulkEmailQueue orchestration hook

Drives the BulkEmailQueue component: initial email-defaults
fetch (Promise.allSettled), sendReady + retryFailed
(Promise.allSettled over /invoices/bulk-send), and updateRow
merge for EmailComposeSlideOver Save.

Per-row status state machine: pending → ready/needs_edit via
defaults fetch; ready → sending → sent/failed via bulk-send;
failed → retryFailed → sending → sent/failed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `BulkEmailQueue` component

**Files:**
- Create: `components/ar/BulkEmailQueue.js`

- [ ] **Step 1: Implement the queue dashboard**

Create `components/ar/BulkEmailQueue.js`:

```javascript
import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Mail, AlertCircle, Check, Edit2 } from 'lucide-react';
import { useBulkEmailQueue } from './useBulkEmailQueue';
import EmailComposeSlideOver from '../ui/EmailComposeSlideOver';   // verify path during implementation

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

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

export default function BulkEmailQueue({ groups, groupingKind, onClose, onAllSent }) {
  const {
    rows, updateRow, sendReady, retryFailed,
    readyCount, failedCount, sentCount, needsEditCount, allSent,
  } = useBulkEmailQueue(groups, groupingKind);

  const [editingKey, setEditingKey] = useState(null);
  const editingRow = editingKey ? rows.find((r) => r.groupKey === editingKey) : null;

  // Hybrid close: auto-close on all-green after a 1s beat
  useEffect(() => {
    if (!allSent) return;
    const t = setTimeout(() => {
      onAllSent?.();
    }, 1000);
    return () => clearTimeout(t);
  }, [allSent, onAllSent]);

  const totalCents = rows.reduce((a, r) => a + (r.group.total_cents || 0), 0);

  // Send button logic
  let sendLabel, sendHandler, sendDisabled;
  if (failedCount > 0 && readyCount === 0) {
    sendLabel = `Retry ${failedCount} Failed`;
    sendHandler = retryFailed;
    sendDisabled = false;
  } else if (readyCount > 0) {
    sendLabel = `Send ${readyCount} Ready`;
    sendHandler = sendReady;
    sendDisabled = false;
  } else {
    sendLabel = sentCount === rows.length ? 'All sent' : 'Nothing to send';
    sendHandler = () => {};
    sendDisabled = true;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-slate-950/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div>
            <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
              {rows.length} email{rows.length !== 1 ? 's' : ''} queued · {formatCents(totalCents)}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Grouped by {groupingKind} · {readyCount} ready
              {needsEditCount > 0 && ` · ${needsEditCount} need attention`}
              {failedCount > 0 && ` · ${failedCount} failed`}
              {sentCount > 0 && ` · ${sentCount} sent`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={sendHandler}
              disabled={sendDisabled}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <Mail className="w-3.5 h-3.5" />
              {sendLabel}
            </button>
            <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-800">
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
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900 dark:text-slate-100 font-medium truncate">{r.group.label}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                    {r.group.invoice_ids.length} invoice{r.group.invoice_ids.length !== 1 ? 's' : ''} · {formatCents(r.group.total_cents)}
                    {r.recipients?.to?.length > 0 ? ` · To: ${r.recipients.to.join(', ')}` : ' · (no recipient)'}
                  </div>
                  {r.error && (
                    <div className="text-xs text-red-600 dark:text-red-400 mt-1 truncate">Error: {r.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-3">
                  <StatusPill status={r.status} />
                  {!isSent && (
                    <button
                      onClick={() => setEditingKey(r.groupKey)}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 inline-flex items-center gap-0.5"
                    >
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700">
            Close
          </button>
        </div>
      </div>

      {/* Edit slide-over */}
      {editingRow && (
        <EmailComposeSlideOver
          isOpen={true}
          onClose={() => setEditingKey(null)}
          initialRecipients={editingRow.recipients}
          initialSubject={editingRow.subject}
          initialBody={editingRow.body}
          bodyFormat={editingRow.body_format}
          attachments={editingRow.attachments}
          onSave={({ recipients, subject, body }) => {
            updateRow(editingRow.groupKey, { recipients, subject, body });
            setEditingKey(null);
          }}
          saveLabel="Save"
          hideSendButton={true}   // queue drives sending; slide-over is edit-only
          title={`Edit email — ${editingRow.group.label}`}
        />
      )}
    </div>
  );
}
```

The `EmailComposeSlideOver` prop names above (`initialRecipients`, `onSave`, `hideSendButton`, etc.) are provisional — verify exact prop surface during Task 10. Update this file if they diverge.

- [ ] **Step 2: Dark mode verification**

Run:
```bash
grep -nE "\bbg-white\b|\btext-gray-[0-9]+\b|\bborder-gray-[0-9]+\b" components/ar/BulkEmailQueue.js
```
Each match should have a `dark:` variant.

- [ ] **Step 3: Build check + commit**

```bash
npm run build
git branch --show-current   # main
git add components/ar/BulkEmailQueue.js
git commit -m "$(cat <<'EOF'
feat(ar-email): BulkEmailQueue dashboard

Queue view for the 2a.4 bulk flow. One row per group, per-row
StatusPill, Send/Retry button logic, hybrid close on all-green
(1s beat then onAllSent), Edit opens EmailComposeSlideOver
with hideSendButton (queue drives sending).

Dark mode variants throughout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Extend `EmailComposeSlideOver` for multi-attachment + hideSendButton

**Files:**
- Modify: `components/ui/EmailComposeSlideOver.js` (or actual path)

- [ ] **Step 1: Find the file**

Run:
```bash
grep -rln "export default function EmailComposeSlideOver\|export default function EmailComposeSlideOver\|const EmailComposeSlideOver" components/
```
Open it and read the current prop surface + state shape.

- [ ] **Step 2: Identify props to add / extend**

Current props (assumed, verify): `{ isOpen, onClose, docType, contextId, onSent, ... }`.

Needed additions for bulk mode:
- `attachments?: Array<{ name, invoice_id, size_bytes? }>` — when length > 1, render read-only list; otherwise render existing single-line attachment preview
- `hideSendButton?: boolean` — when true, hide the send/skip buttons, show only Save (bulk mode: queue sends, slide-over edits)
- `initialRecipients`, `initialSubject`, `initialBody`, `bodyFormat` — seed inputs for bulk edit flow (single-send already fetches these itself; bulk passes them in pre-resolved)
- `onSave?: ({recipients, subject, body}) => void` — callback for Save (hideSendButton mode)
- `title?: string` — optional override

Single-send continues to work: when `attachments` has length 1, and `hideSendButton` is falsy, and `onSave` is omitted, behavior is identical to today.

- [ ] **Step 3: Modify the slide-over**

Locate the attachment-render block (likely uses `archiveUrl` or similar single-attachment state). Replace with:

```jsx
{attachments && attachments.length > 1 ? (
  <div className="space-y-1">
    <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
      Attachments ({attachments.length})
    </div>
    <ul className="border border-gray-200 dark:border-slate-700 rounded-md divide-y divide-gray-100 dark:divide-slate-800 max-h-32 overflow-y-auto">
      {attachments.map((a) => (
        <li key={a.invoice_id} className="px-3 py-1.5 text-xs text-gray-700 dark:text-slate-300 flex items-center justify-between">
          <span className="truncate">{a.name}</span>
          {typeof a.size_bytes === 'number' && (
            <span className="text-gray-400 dark:text-slate-500 ml-2">{Math.ceil(a.size_bytes / 1024)} KB</span>
          )}
        </li>
      ))}
    </ul>
    <div className="text-[10px] text-gray-400 dark:text-slate-500 italic">
      Attachment set is locked for this group. To change it, cancel and re-group.
    </div>
  </div>
) : (
  /* existing single-attachment render — leave untouched */
  <ExistingSingleAttachmentPreview ... />
)}
```

Locate the send-button area and conditionally render based on `hideSendButton`:
```jsx
{hideSendButton ? (
  <div className="flex items-center justify-end gap-2">
    <button onClick={onClose} className="...">Cancel</button>
    <button
      onClick={() => onSave?.({ recipients, subject, body })}
      className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
    >
      Save
    </button>
  </div>
) : (
  /* existing Send / Skip / Cancel buttons — leave untouched */
  <ExistingFullFooter ... />
)}
```

If the slide-over currently fetches its own `email-defaults` on mount, add a guard that skips the fetch when `initialRecipients` etc. are provided:
```jsx
useEffect(() => {
  if (initialRecipients) {
    setRecipients(initialRecipients);
    setSubject(initialSubject ?? '');
    setBody(initialBody ?? '');
    return;
  }
  // existing fetch-on-mount logic
  fetchDefaults();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

- [ ] **Step 4: Dark mode verification + single-send regression check**

Run grep:
```bash
grep -nE "\bbg-white\b|\btext-gray-[0-9]+\b|\bborder-gray-[0-9]+\b" components/ui/EmailComposeSlideOver.js
```
All matches should have `dark:` variants (same audit as always).

Manual single-send regression: open `/loads/{id}` → Billing tab → click Approve & Invoice on an eligible charge set → verify popup still opens with the single attachment rendered as a single-line preview and Send/Skip buttons visible (NOT the new multi-attachment list or hideSendButton layout).

- [ ] **Step 5: Build check + commit**

```bash
npm run build
git branch --show-current   # main
git add components/ui/EmailComposeSlideOver.js
git commit -m "$(cat <<'EOF'
feat(ar-email): EmailComposeSlideOver multi-attachment + hideSendButton

Two additive changes for 2a.4 bulk mode, zero regression for
single-send:

1. `attachments?: Array` prop — when length > 1, renders a
   read-only list instead of the single-attachment preview.
2. `hideSendButton?: boolean` + `onSave` — when hidden, footer
   shows Cancel + Save (bulk queue drives sending). `initial*`
   props short-circuit the on-mount email-defaults fetch.

Existing single-send call sites unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `BulkActionBar` component

**Files:**
- Create: `components/ar/BulkActionBar.js`

- [ ] **Step 1: Implement**

Create `components/ar/BulkActionBar.js`:

```javascript
import React from 'react';
import { Check, AlertCircle, Mail, Download, X, RefreshCw } from 'lucide-react';

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function BulkActionBar({
  count,
  totalCents,
  bulkAction,         // 'approve' | 'unapprove' | 'approve_invoice' | null
  onApprove,
  onUnapprove,
  onApproveAndInvoice,
  onExport,
  onClear,
}) {
  if (count === 0) return null;

  const busy = bulkAction != null;
  const btnBase = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const ghostBtn = `${btnBase} bg-slate-700 text-white hover:bg-slate-600`;
  const primaryBtn = `${btnBase} bg-blue-500 text-white hover:bg-blue-600 shadow-sm`;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-slate-950 border border-slate-700 dark:border-slate-800 shadow-xl text-white">
      <div className="inline-flex items-center gap-2 font-semibold text-sm">
        <span className="bg-blue-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full min-w-[24px] text-center">
          {count}
        </span>
        <span className="text-slate-100">selected · {formatCents(totalCents)}</span>
      </div>

      <div className="h-5 w-px bg-slate-700 dark:bg-slate-800" />

      <button type="button" onClick={onApprove} disabled={busy} className={ghostBtn}>
        {bulkAction === 'approve' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        Approve
      </button>

      <button type="button" onClick={onUnapprove} disabled={busy} className={ghostBtn}>
        {bulkAction === 'unapprove' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
        Unapprove
      </button>

      <button type="button" onClick={onApproveAndInvoice} disabled={busy} className={primaryBtn}>
        {bulkAction === 'approve_invoice' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
        Approve & Invoice
      </button>

      <button type="button" onClick={onExport} disabled={busy} className={ghostBtn}>
        <Download className="w-3.5 h-3.5" />
        Export CSV
      </button>

      <div className="w-px h-5 bg-slate-700 dark:bg-slate-800" />

      <button type="button" onClick={onClear} disabled={busy} className="text-xs text-slate-300 hover:text-white inline-flex items-center gap-0.5 disabled:opacity-50">
        <X className="w-3.5 h-3.5" />
        Clear
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Dark mode verification**

The bar uses dark slate palette on both light and dark app modes (matches Dispatcher board convention). The `dark:` variants shift from slate-900/700 to slate-950/800 for slightly more contrast on dark backgrounds.

Run grep:
```bash
grep -nE "\bbg-white\b|\btext-gray-[0-9]+\b|\bborder-gray-[0-9]+\b" components/ar/BulkActionBar.js
```
Expected: no matches (bar uses slate exclusively).

- [ ] **Step 3: Build check + commit**

```bash
npm run build
git branch --show-current   # main
git add components/ar/BulkActionBar.js
git commit -m "$(cat <<'EOF'
feat(ar-email): BulkActionBar bottom-fixed dispatcher-style bar

Replaces the top sticky pill in BillingPipelineTab. Slate palette
matching dispatcher board. Slots: counter, Approve, Unapprove,
Approve & Invoice (primary blue, new — wired in Task 12),
Export CSV, Clear. Layout leaves room for future Send Rate Con
(2a.4b) and Invoice[date] (2a.5) without rendering disabled
ghost buttons.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire into `BillingPipelineTab.js`

**Files:**
- Modify: `components/ar/BillingPipelineTab.js`

- [ ] **Step 1: Read the current file end-to-end**

Run: `cat components/ar/BillingPipelineTab.js | head -300`

Note:
- Selection state is already in place (`selectedIds`, `toggleAll`, `toggleRow`, `bulkStatusTransition`)
- The existing top-sticky selection pill is at lines ~259–312 in the current revision (will drift — grep for `selectedIds.size > 0` to find it)
- `handleBulkApprove`, `handleBulkUnapprove`, `handleExportCsv` already exist

- [ ] **Step 2: Add imports**

Add to the import block at the top of the file:
```javascript
import BulkActionBar from './BulkActionBar';
import BulkGroupingModal from './BulkGroupingModal';
import BulkEmailQueue from './BulkEmailQueue';
```

- [ ] **Step 3: Add new state**

Add alongside existing `useState` calls:
```javascript
const [groupingModalInvoices, setGroupingModalInvoices] = useState(null);  // Array | null
const [queueState, setQueueState] = useState(null);  // { kind, groups } | null
```

- [ ] **Step 4: Add handleBulkApproveAndInvoice**

Below `handleBulkUnapprove`:
```javascript
async function handleBulkApproveAndInvoice() {
  setBulkAction('approve_invoice');
  const selected = chargeSets.filter((cs) => selectedIds.has(cs.id));
  const eligible = selected.filter((cs) => cs.status === 'approved');
  const ineligibleCount = selected.length - eligible.length;

  const created = [];
  let failed = 0;
  let firstError = null;

  for (const cs of eligible) {
    try {
      const res = await fetch('/api/tenant/ar/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charge_set_id: cs.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const inv = await res.json();
      created.push({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        bill_to_id: inv.bill_to_id,
        customer_name: cs.order?.customer?.name ?? inv.customer_name ?? 'Unknown',
        reference_number: cs.order?.reference_number ?? null,
        charge_set_id: cs.id,
        total_cents: inv.total_cents ?? cs.total_cents ?? 0,
      });
    } catch (e) {
      failed++;
      if (!firstError) firstError = e.message;
    }
  }

  setBulkAction(null);
  setSelectedIds(new Set());
  setLastClickedId(null);

  if (created.length === 0) {
    setToast({
      type: 'error',
      message: failed > 0 ? `All ${failed} invoice creations failed` : 'No eligible charge sets',
    });
    return;
  }

  // Pipeline refresh so flipped charge sets disappear from current filter
  await fetchAR({ silent: true });

  const parts = [`Invoiced ${created.length}`];
  if (ineligibleCount > 0) parts.push(`skipped ${ineligibleCount} (not approved)`);
  if (failed > 0) parts.push(`${failed} failed`);
  const kind = failed === 0 ? 'success' : 'warning';
  const base = parts.join(' · ');
  setToast({ type: kind, message: firstError ? `${base} — ${firstError}` : base });

  setGroupingModalInvoices(created);
}
```

Exact field names from the `POST /api/tenant/ar/invoices` response (e.g. `inv.id` vs `inv.invoice_id`) — verify against the single-send call site in BillingTab from 2a.2 and mirror.

- [ ] **Step 5: Replace the top selection pill with BulkActionBar**

Find the JSX block starting with `{selectedIds.size > 0 && (` — the top sticky pill. Delete the entire block through its matching `)}`.

Verify total_cents computation of selected:
```javascript
const selectedTotalCents = chargeSets
  .filter((cs) => selectedIds.has(cs.id))
  .reduce((a, cs) => a + (cs.total_cents || 0), 0);
```
(Add this derived value near the other derived selection vars around line 84.)

Render `BulkActionBar` at the end of the returned JSX (after the table `</div>`, before the closing fragment):
```jsx
<BulkActionBar
  count={selectedIds.size}
  totalCents={selectedTotalCents}
  bulkAction={bulkAction}
  onApprove={handleBulkApprove}
  onUnapprove={handleBulkUnapprove}
  onApproveAndInvoice={handleBulkApproveAndInvoice}
  onExport={handleExportCsv}
  onClear={() => {
    setSelectedIds(new Set());
    setLastClickedId(null);
  }}
/>
```

- [ ] **Step 6: Render grouping modal + queue conditionally**

Also at the end of the returned JSX:
```jsx
{groupingModalInvoices && (
  <BulkGroupingModal
    invoices={groupingModalInvoices}
    onCancel={() => setGroupingModalInvoices(null)}
    onContinue={({ kind, groups }) => {
      setGroupingModalInvoices(null);
      setQueueState({ kind, groups });
    }}
  />
)}

{queueState && (
  <BulkEmailQueue
    groups={queueState.groups}
    groupingKind={queueState.kind}
    onClose={() => {
      setQueueState(null);
      fetchAR({ silent: true });
    }}
    onAllSent={() => {
      setQueueState(null);
      fetchAR({ silent: true });
    }}
  />
)}
```

- [ ] **Step 7: Build check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 8: Dev-server smoke test (pre-gate-8 sanity)**

Start: `npm run dev`
Navigate to `/ar` Billing tab, select 2+ charge sets → verify `BulkActionBar` appears at bottom. Click one of the existing buttons (Approve / Unapprove) — should behave as before. Click `Approve & Invoice` — verify grouping modal opens. Cancel — verify modal closes.

(Full gate-8 end-to-end with SendGrid is Task 13.)

- [ ] **Step 9: Commit**

```bash
git branch --show-current   # main
git add components/ar/BillingPipelineTab.js
git commit -m "$(cat <<'EOF'
feat(ar-email): wire AR Pipeline bulk Approve & Invoice flow

Replaces top-sticky selection pill with BulkActionBar (bottom-
fixed). Adds handleBulkApproveAndInvoice that sequentially
POSTs /api/tenant/ar/invoices for each eligible charge set,
surfaces partial-failure in the existing toast pattern, and
opens BulkGroupingModal with the created invoices array.

Grouping modal Continue → mounts BulkEmailQueue. Queue close
or all-sent → silent fetchAR refresh so flipped charge sets
relocate without a full reload flash (per ChargeSetCard-
unmount rule from yesterday's 4e789f3).

Ties together the six new/extended files from Tasks 1–11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Run verification gates 1–8

**Files:** none (verification only)

This task is the test suite for the sub-project. Run each gate in order. If any gate fails, diagnose + fix in its originating task's file(s) and commit the fix with a `fix(ar-email): ...` message. Do NOT proceed to the next gate on a red result.

- [ ] **Step 1: Gate 1 — Migration 081 applied cleanly**

Confirmed in Task 1 Step 4. Re-verify:
```sql
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc WHERE proname = 'claim_invoices_for_send';
```
Expected: 2 rows (UUID + UUID[] overloads).

Result: ✅ / ❌ + notes

- [ ] **Step 2: Gate 2 — Bulk invoice creation loop**

Seed data: in dev DB, create 5 charge sets on loads for a single tenant:
- 3 with `status = 'approved'`, non-zero totals
- 2 with `status = 'unapproved'`

Run the UI:
1. Open `/ar` Billing tab, filter by All
2. Multi-select all 5
3. Click **Approve & Invoice**

Assert:
- Toast reads something like `Invoiced 3 · skipped 2 (not approved)` (warning variant because ineligible > 0)
- Pipeline silent-refetches; the 3 now show status `invoiced`
- Grouping modal opens with 3 invoice cards in its summary

Result: ✅ / ❌ + notes

- [ ] **Step 3: Gate 3 — computeGroups unit test**

Run a one-off node script to validate the pure function.

Create `/tmp/gate3_computeGroups.mjs`:
```javascript
import { computeGroups } from '../../../../app-drayagedirect/components/ar/BulkGroupingModal.js';   // adjust path for your shell

const fixtures = [
  { invoice_id: 'i1', charge_set_id: 'c1', bill_to_id: 'A', customer_name: 'Acme', reference_number: 'PO-100', total_cents: 1000, invoice_number: 'INV-0001' },
  { invoice_id: 'i2', charge_set_id: 'c2', bill_to_id: 'A', customer_name: 'Acme', reference_number: 'PO-100', total_cents: 2000, invoice_number: 'INV-0002' },
  { invoice_id: 'i3', charge_set_id: 'c3', bill_to_id: 'A', customer_name: 'Acme', reference_number: 'PO-200', total_cents: 3000, invoice_number: 'INV-0003' },
  { invoice_id: 'i4', charge_set_id: 'c4', bill_to_id: 'B', customer_name: 'Beta',  reference_number: 'PO-100', total_cents: 4000, invoice_number: 'INV-0004' },   // same ref as A, different customer
  { invoice_id: 'i5', charge_set_id: 'c5', bill_to_id: 'C', customer_name: 'Gamma', reference_number: null,     total_cents: 5000, invoice_number: 'INV-0005' },   // no ref
];

function check(name, cond) {
  console[cond ? 'log' : 'error'](cond ? '✅' : '❌', name);
}

const byCustomer = computeGroups(fixtures, 'customer');
check('customer: 3 groups', byCustomer.length === 3);
check('customer: sum invariant', byCustomer.reduce((a, g) => a + g.invoice_ids.length, 0) === 5);
check('customer: Acme group has 3 invoices', byCustomer.find((g) => g.customer_name === 'Acme').invoice_ids.length === 3);

const byRef = computeGroups(fixtures, 'reference');
check('reference: Acme-PO-100 and Beta-PO-100 are SEPARATE groups', byRef.filter((g) => g.reference_number === 'PO-100').length === 2);
check('reference: null ref (Gamma) falls back to customer-level key', byRef.find((g) => g.customer_name === 'Gamma').invoice_ids.length === 1);
check('reference: sum invariant', byRef.reduce((a, g) => a + g.invoice_ids.length, 0) === 5);

const byCs = computeGroups(fixtures, 'charge_set');
check('charge_set: 5 groups', byCs.length === 5);
check('charge_set: all groups length 1', byCs.every((g) => g.invoice_ids.length === 1));
```

Run: `node /tmp/gate3_computeGroups.mjs`
Expected stdout: 8 green checks.

If any fail: fix `computeGroups` in `components/ar/BulkGroupingModal.js` and commit `fix(ar-email): ...`.

Delete `/tmp/gate3_computeGroups.mjs` after.

Result: ✅ / ❌ + notes

- [ ] **Step 4: Gate 4 — Email-defaults batch endpoint**

Pick 3 real invoice IDs from Gate 2's seeded data (they're now `status='invoiced'`).

```bash
curl -X POST http://localhost:3000/api/tenant/ar/invoices/email-defaults-bulk \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <dev-cookie>' \
  -d '{"invoice_ids":["<id1>","<id2>","<id3>"]}' \
  | jq .
```

Assert:
- HTTP 200
- `recipients.to` is non-empty (if the seeded customer has a billing_email) or is `[]` (triggering needs_edit in the UI)
- `subject` contains text (template rendered)
- `body` contains text
- `attachments.length === 3`
- Each `attachment` has `{ name, invoice_id }`
- If the template uses `{{invoice.numbers}}`, subject/body contains comma-joined invoice numbers

Result: ✅ / ❌ + notes

- [ ] **Step 5: Gate 5 — Bulk-send happy path (mocked SendGrid OR real with test email)**

For this gate, either:
- (A) Temporarily swap `lib/email-dispatch/providers/sendgrid.js` to use `providers/mock.js` (if a mock provider exists from 2a.2)
- (B) Use a real SendGrid sandbox address the dispatcher owns

Use Gate 4's invoice IDs. Run:
```bash
curl -X POST http://localhost:3000/api/tenant/ar/invoices/bulk-send \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <dev-cookie>' \
  -d '{
    "group": {
      "invoice_ids": ["<id1>","<id2>","<id3>"],
      "recipients": {"to":["qa@example.com"],"cc":[],"bcc":[]},
      "subject": "Gate 5 test",
      "body": "<p>Gate 5 body</p>",
      "body_format": "html",
      "grouping_kind": "customer",
      "group_label": "Gate 5 Group"
    }
  }' | jq .
```

Assert:
- HTTP 200
- `sent.length === 3`
- `skipped.length === 0`
- `message_id` is non-null

SQL verify:
```sql
SELECT id, sent_at, send_claimed_at
FROM invoices
WHERE id IN ('<id1>','<id2>','<id3>');
-- Expected: all 3 have non-null sent_at, null send_claimed_at

SELECT umbrella_decisions, messages_created
FROM email_trigger_log
WHERE tenant_id = '<tenant-id>'
ORDER BY id DESC LIMIT 1;
-- Expected: umbrella_decisions contains { type: 'manual_bulk', invoice_ids: [<3>], ... }
-- messages_created has one { email_message_id: '<uuid>' } entry
```

Result: ✅ / ❌ + notes

- [ ] **Step 6: Gate 6 — Claim contention**

Reset state: pick 3 fresh invoice IDs (sent_at IS NULL).
```sql
UPDATE invoices SET sent_at = NULL, send_claimed_at = NULL, send_claimed_by = NULL
WHERE id IN ('<id1>','<id2>','<id3>');
```

Fire two curls back-to-back in parallel (use `&`):
```bash
curl -X POST http://localhost:3000/api/tenant/ar/invoices/bulk-send -H 'Content-Type: application/json' -H 'Cookie: <c>' -d '{...same body as Gate 5 with id1,id2,id3...}' > /tmp/call1.json &
curl -X POST http://localhost:3000/api/tenant/ar/invoices/bulk-send -H 'Content-Type: application/json' -H 'Cookie: <c>' -d '{...same body...}' > /tmp/call2.json &
wait
cat /tmp/call1.json /tmp/call2.json | jq .
```

Assert: one call returns 200 with `sent.length === 3`, the other returns 409 with `error: 'All invoices already claimed or sent'` OR 200 with `sent.length === 0, skipped.length === 3` depending on timing of the race. No duplicate SendGrid dispatch (verify by counting `email_trigger_log` rows for these invoice_ids — should be 1 success + at most 1 failure row).

Stale-claim test:
```sql
UPDATE invoices SET send_claimed_at = now() - interval '10 minutes', send_claimed_by = gen_random_uuid()
WHERE id = '<fresh-id>';
```
Fire bulk-send for that id. Expected: 200 (stale claim recovered).

Result: ✅ / ❌ + notes

- [ ] **Step 7: Gate 7 — Hybrid close + Retry**

This is best done via the UI with a controlled fail.

Temporarily stub `/invoices/bulk-send` to return 502 for the second of two groups — edit the handler to do:
```javascript
if (req.body.group.group_label === 'FAIL_ME') {
  return res.status(502).json({ error: 'Test failure', stage: 'dispatch' });
}
```

In the UI: select charge sets for 2 customers, use "per customer" grouping so you get 2 groups. Ensure one customer's label is `FAIL_ME` (rename customer via `/organizations` if needed, or override in query params if the component allows).

Click `Send 2 Ready`:
- Row 1: `sending` → `sent` (green, dimmed)
- Row 2: `sending` → `failed` (red, with error message)
- Queue does NOT auto-close
- Header button becomes `Retry 1 Failed`

Click `Retry 1 Failed` with the stub still in place:
- Row 2: `sending` → `failed` again

Remove the stub (revert the temp edit). Click `Retry 1 Failed` again:
- Row 2: `sending` → `sent`
- Queue auto-closes after ~1s
- Pipeline silent-refetches

REVERT the temp handler stub before commit.

Result: ✅ / ❌ + notes

- [ ] **Step 8: Gate 8 — Full UI click-through via dev server**

Live end-to-end test. Use the real SendGrid config + a safelist tenant.

1. `/ar` Billing tab → select 10 charge sets across 2 customers, all `approved` status (seed if needed via `/loads/[id]`).
2. Verify `BulkActionBar` appears at bottom with `10 selected · ${total}`.
3. Click **Approve & Invoice** → verify 10 invoices created (check DB: `SELECT count(*) FROM invoices WHERE tenant_id = '<t>' AND sent_at IS NULL AND created_at > now() - interval '2 minutes'`); toast shows success.
4. Verify **Grouping modal** opens. Click between `customer` / `reference` / `charge_set` tabs — verify count/summary updates live.
5. Pick **per customer** → Continue.
6. Verify **Queue dashboard** opens with 2 rows; recipient/subject/body populated from template.
7. Click **Edit** on row 1 → slide-over opens with 5 attachments listed (read-only) + Save/Cancel (NO Send/Skip). Tweak subject → Save → row back to Ready.
8. Click **Send 2 Ready** → both rows flip `sending` → `sent`.
9. Queue auto-closes after 1s; pipeline silent-refetches (no unmount flash); charge sets now show `invoiced` status.
10. `/settings/communications` → Trigger Activity tab → verify 2 new rows with `umbrella_decisions.type = 'manual_bulk'`.
11. Verify 2 emails actually landed in the recipient inboxes with the correct PDFs attached.

Result: ✅ / ❌ + notes

- [ ] **Step 9: Final commit — verification notes**

If all gates pass, commit a no-op doc commit that captures the verification results:

```bash
git branch --show-current   # main
git commit --allow-empty -m "$(cat <<'EOF'
chore(ar-email): 2a.4 verification gates 1-8 passed

Gate 1 — Migration 081: ✅
Gate 2 — Bulk invoice creation loop: ✅
Gate 3 — computeGroups unit tests: ✅ (8/8 assertions)
Gate 4 — Email-defaults batch endpoint: ✅
Gate 5 — Bulk-send happy path: ✅
Gate 6 — Claim contention (race + stale recovery): ✅
Gate 7 — Hybrid close + Retry UI: ✅
Gate 8 — Full Cowork/browser click-through: ✅

Sub-project 2a.4 ready for merge (already on main per
direct-to-main discipline). Follow-ups queued:
  - 2a.4b — bulk Send Rate Con (copy pattern)
  - 2a.4c — bulk send from Invoices tab (different entry)
  - 2a.5 — Invoice + date picker
  - 2a.6 — SendGrid delivery webhooks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Push to origin:
```bash
git push origin main
```

---

## Self-Review

After writing the full plan, checked against the spec:

**1. Spec coverage.** Every section of the spec has a task:
- Goal + UX flow → Tasks 7 (modal) + 9 (queue) + 11 (bar) + 12 (wire)
- Architecture overview → Tasks 1–12 collectively
- Bottom action bar → Task 11 + wired in 12
- Grouping modal → Task 7
- Queue dashboard → Task 9 (+ hook Task 8)
- Hybrid close behavior → Task 9 (useEffect + sendLabel logic)
- Data model (migration 081) → Task 1
- Release semantics → Task 6 (catch block)
- Trigger-log audit shape → Task 2 + wired in Task 6
- `/invoices/bulk-send` endpoint → Task 6
- Extended `/email-templates/invoice/defaults` → Task 5
- Bulk variable tokens → Task 4
- `resolveBulkBillingRecipients` → Task 3
- Component specs (BulkActionBar, BulkGroupingModal, BulkEmailQueue, useBulkEmailQueue, EmailComposeSlideOver extension) → Tasks 7, 8, 9, 10, 11
- `BillingPipelineTab` wiring → Task 12
- Data flow (end-to-end) → Tasks 1–12 sequence
- Error handling table → Task 6 stage-labeled errors + Task 9 row state machine
- Verification gates 1–8 → Task 13 (one step per gate)
- Out of scope → honored by not including tasks for 2a.4b/c/5/6 or document designer
- Dependencies + order → this plan's order (1–13) mirrors the spec's order

No gaps identified.

**2. Placeholder scan.** No "TBD", "TODO", "implement later" in the plan. Two spots explicitly call out implementer verification ("verify exact prop surface during Task 10" in Task 9, "verify against the single-send call site in BillingTab from 2a.2" in Task 12) — these are not placeholders but notes about file-reading context the implementer should do at the task boundary. Every task has complete code in its steps.

**3. Type consistency.** Cross-task checks:
- `computeGroups` (Task 7) returns `{key, kind, label, bill_to_id, customer_name, reference_number, invoice_ids, charge_set_ids, total_cents}`. Consumed in Task 8 (`useBulkEmailQueue`), Task 9 (`BulkEmailQueue`), Task 12 (`queueState.groups`). Matches.
- `logManualBulkSend` (Task 2) takes `{tenantId, invoiceIds, userId, groupingKind, groupLabel, billToId, referenceNumber, messageId, error}`. Called in Task 6 with the same arg names. Matches.
- `attachments` prop on `EmailComposeSlideOver` (Task 10) is `Array<{name, invoice_id, size_bytes?}>`. Produced by Task 5 (`email-defaults-bulk` response). Matches.
- `updateRow(groupKey, patch)` signature (Task 8 hook) — called in Task 9 component with `updateRow(editingRow.groupKey, {recipients, subject, body})`. Matches.
- `handleBulkApproveAndInvoice` (Task 12) sets `groupingModalInvoices` with fields `{invoice_id, invoice_number, bill_to_id, customer_name, reference_number, charge_set_id, total_cents}`. `BulkGroupingModal` (Task 7) consumes these exact fields. Matches.

No inconsistencies found. Plan is ready for execution.
