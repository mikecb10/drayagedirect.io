# AR Bulk Invoice Email (sub-project 2a.4) — Design Spec

**Status:** Approved by user 2026-04-19, ready for implementation planning.

**Scope:** Bulk email delivery for invoices originating from the AR Pipeline (Billing tab). Dispatcher multi-selects N charge sets, clicks a new **Approve & Invoice** bulk action, picks a grouping strategy, reviews/sends the resulting emails from a queue dashboard. Each "group" becomes one email with N PDFs attached.

**Explicitly out of scope for 2a.4** (tracked as separate sub-projects):
- Bulk **Send Rate Con** on pre-invoice charge sets (→ 2a.4b — copy-paste of this sub-project with the rate-con template)
- Bulk **Send** from the AR Invoices tab (sending already-invoiced-but-not-emailed invoices) (→ 2a.4c)
- **Invoice + date picker** backdate button (→ 2a.5)
- SendGrid delivery webhook tracking (→ 2a.6)
- Per-tenant document designer UI (→ Later)
- QuickBooks sync integration (→ Later)

**Builds on:**
- Sub-project 2a.1 (PDF generation infrastructure) — `archiveInvoicePdf` helper with pre-rendered buffer threading.
- Sub-projects 2a.2 + 2a.3 (AR email single-send) — `EmailComposeSlideOver`, `dispatchEmail`, `fetchFullConfiguration`, `resolveFromAddress`, template system with `category='ar'`, trigger-log `umbrella_decisions.type='manual'` convention.
- Migration 080 cleanup (commit `f7e5fcf`) — `invoices.send_claimed_at` column + `claim_invoices_for_send(uuid, uuid)` RPC for race-proof single-send. This sub-project extends that pattern to bulk.

---

## 1. Goal

After 2a.4 ships, a dispatcher can invoice 20 charge sets for 5 customers in one workflow instead of 20 separate single-send popups:

1. Multi-select N charge sets on `/ar` Billing tab (existing selection UX, checkboxes + shift-click).
2. Click **Approve & Invoice** in a new bottom action bar → N invoices created, charge sets flipped to `invoiced` upfront.
3. **Grouping modal** opens asking: one email per customer / one per (customer, reference #) / separate email per charge set.
4. **Queue dashboard** opens listing the resulting emails, one row per group. Each row pre-filled from the AR invoice template, showing recipient + subject + attachment count.
5. Dispatcher clicks **Edit** on any row to tweak recipient / subject / body (attachments locked).
6. Clicks **Send N Ready** → parallel SendGrid dispatches; row statuses update live.
7. All-green → queue auto-closes + toast. Partial failure → queue stays open with per-row Retry buttons.

Privacy invariant: **no invoice ever reaches the wrong customer**, at any grouping level. "Per reference #" is internally keyed by `(customer_id, reference_number)` — two customers sharing a ref still get separate emails.

---

## 2. Architecture overview

```
  ┌─────────────────────────────────────────────────────────────┐
  │ /ar Billing tab (BillingPipelineTab.js)                     │
  │   • charge-set table with checkboxes (unchanged)            │
  │   • selection bar: MOVED from top-sticky pill to            │
  │     bottom-fixed BulkActionBar (dispatcher-board style)     │
  │     [Approve] [Unapprove] [Approve & Invoice*] [Export]     │
  │                            │                                │
  └────────────────────────────┼────────────────────────────────┘
                               │ click (N selected)
                               ▼
                ┌──────────────────────────────┐
                │  BulkGroupingModal           │
                │  radio-card: 3 kinds         │
                │  previews count per kind     │
                │  Continue → {kind, groups}   │
                └──────────────┬───────────────┘
                               │
                               ▼
  ┌────────────────────────────────────────────────────────────┐
  │  BulkEmailQueue (in-page modal overlay)                    │
  │  • one row per group, per-row status pill                  │
  │  • Edit → opens EmailComposeSlideOver (extended)           │
  │  • Send N Ready → Promise.allSettled over bulk-send POSTs  │
  │  • hybrid close: auto on all-green, stay-open on partial   │
  └────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
          ┌──────────────────────────────────────────┐
          │ POST /api/tenant/ar/invoices/bulk-send   │
          │  1. claim_invoices_for_send(ids[], user) │
          │  2. render each invoice PDF              │
          │  3. dispatchEmail(attachments: [N])      │
          │  4. mark sent_at + trigger-log row       │
          │     (umbrella_decisions.type='manual_    │
          │      bulk', invoice_ids: [...])          │
          └──────────────────────────────────────────┘
```

Separation of concerns:

- **UI orchestration**: new components (`BulkActionBar`, `BulkGroupingModal`, `BulkEmailQueue`) + new hook (`useBulkEmailQueue`). Reused: `EmailComposeSlideOver` (attachments prop extended), `BillingPipelineTab` (selection state + handlers unchanged; bar location moves).
- **Backend dispatch**: new `/invoices/bulk-send` endpoint reuses `dispatchEmail` + `fetchFullConfiguration` + `resolveFromAddress` from 2a.2/2a.3. Only the attachment array size and the claim-RPC argument shape differ from single-send.
- **Concurrency**: migration 081 extends migration 080's claim-release pattern to bulk (array-arg RPC with partial-success semantics).

---

## 3. UX specification

### 3.1 Bottom action bar (relocates existing selection UI)

Visual: fixed to bottom of viewport when `selectedIds.size > 0`, dark slate palette matching Dispatcher board (`bg-slate-800` + `text-white`). Spans full width with `rounded-t-md`. Hidden below the Export CSV button is a narrower version appearing only when selection is nonzero.

Slots (left to right):
1. **Counter chip**: `{N} selected · {$formatted_total}`. Counter has blue badge (`bg-blue-500`).
2. Vertical divider.
3. **Approve** (ghost button — same current bulk handler).
4. **Unapprove** (ghost button — same current bulk handler).
5. **Approve & Invoice** (primary blue — new handler, opens grouping modal).
6. **Export CSV** (ghost button — same current handler).
7. Spacer.
8. **× Clear** (text-only, right-aligned).

Layout leaves room for future **Send Rate Con** and **Invoice [date]** slots (between 3/4 and 5) without rendering them today. This avoids disabled-ghost buttons that never light up.

Behavior on **Approve & Invoice** click:
- Disable bar (`bulkAction = 'approve_invoice'`).
- Sequentially POST `/api/tenant/ar/invoices` for each eligible charge set (filter: `cs.status === 'approved'`, matching single-send Approve & Invoice; planning step verifies the endpoint accepts this set).
- As each POST resolves, accumulate `invoices[]` (the created invoice records with `customer_id`, `reference_number`, `total_cents`, `invoice_id`, `charge_set_id`).
- After loop, if any succeeded → open grouping modal with `invoices[]`. Otherwise show error toast with first error message.
- On partial failure show toast: `{M} of {N} invoiced · {N-M} failed` in warning variant (matches existing bulk-approve pattern).

### 3.2 Grouping modal

Centered overlay modal (not a slide-over). Title: **"How should these be sent?"**. Subtitle: `{N} invoices will be created and emailed. Pick how to group email delivery.`

Radio-card list — three options, default selected = `customer`:

| Kind | Card label | Card description |
|---|---|---|
| `customer` | "1 email per customer" | `{C} emails · {sample: Acme (3 PDFs) · Beta (2) · Gamma (1) · …}` |
| `reference` | "1 email per reference #" | `{R} emails · {sample: PO-100 (2) · BK-55 (2) · … · Echo: no ref → falls back to per-customer}` |
| `charge_set` | "Separate email per charge set" | `{N} emails · One invoice per email.` |

Sample labels truncate at ~5 entries with `…` suffix.

Footer buttons: **Cancel** (ghost) + **Continue →** (primary). Cancel closes the modal; the N invoices already created stay invoiced (no auto-void — matches single-send's no-undo convention).

`computeGroups(invoices, kind)` logic:
- `customer`: `groupBy(invoices, i => i.customer_id)`. Group key = `customer_id`. Label = customer name.
- `reference`: `groupBy(invoices, i => i.reference_number ? ${i.customer_id}::${i.reference_number} : i.customer_id)`. Null/empty refs collapse with customer-level key, preventing no-ref invoices from forming singleton groups. Label = reference # or `customer name (no ref)`.
- `charge_set`: `i => i.invoice_id`. Group key = invoice_id. Label = `INV-{number}`.

Each group returns `{ key, kind, label, customer_id, reference_number?, invoice_ids[], charge_set_ids[], total_cents }`.

### 3.3 Queue dashboard

Full-width centered modal overlay (not a slide-over — the row list benefits from horizontal room and the modal pattern already works for the grouping step just before). Header:

```
{G} emails queued · ${total_cents_sum}                 [Cancel] [Send {R} Ready]
Grouped by {kind} · {R} ready · {P} need attention
```

Rows, one per group:
```
┌─────────────────────────────────────────────────────────────────┐
│ Acme Corp                              ✓ Ready    Edit          │
│ 3 invoices · $4,200 · To: billing@acme.com                      │
├─────────────────────────────────────────────────────────────────┤
│ Gamma Inc                              ⚠ Needs edit    Edit     │
│ 1 invoice · $720 · No billing email on file                     │
└─────────────────────────────────────────────────────────────────┘
```

Row status pills:
- `pending` (initial, while defaults are loading) — spinner + "Loading..."
- `ready` — green ✓ "Ready"
- `needs_edit` — amber ⚠ "Needs edit" (recipient missing OR template missing)
- `sending` — blue spinner + "Sending..."
- `sent` — green ✓ "Sent" (row dims to `opacity-60`)
- `failed` — red ✗ "Failed: {error}" with inline Retry link

Send button text updates based on row state:
- `{R} ready` normally: "Send {R} Ready"
- Any rows `sent` + rest ready: "Send {R} Ready" (send button ignores already-sent rows)
- Any rows `failed`: "Retry {F} Failed" (replaces Send button; retry only re-fires failed rows)
- All rows `sent`: button disabled (queue auto-closes shortly)

**Edit** per row opens `EmailComposeSlideOver` prefilled with the row's `{recipients, subject, body, attachments}`. Save → `updateRow(groupKey, patch)` merges into queue state. Attachments field is rendered read-only (A1 decision).

**Cancel** closes the queue without sending. Rows not sent keep their invoices in `invoiced` status with neither `sent_at` nor `email_skipped_at` set, allowing a future bulk-send pass from the Invoices tab.

### 3.4 Hybrid close behavior

After **Send N Ready**:
- Rows flip `ready` → `sending`. Button disables.
- As each `Promise.allSettled` result resolves: `sending` → `sent` or `failed`.
- After all settle:
  - **All `sent`** → auto-close queue after 1s delay (shows the final ✓s briefly). Green toast: `{N} sent · ${total}`. `BillingPipelineTab.fetchAR({silent:true})` fires to refresh the pipeline state without unmounting child components (per yesterday's ChargeSetCard-unmount rule).
  - **Any `failed`** → queue stays open. `sent` rows stay visible but dimmed. `failed` rows highlight (red left border, error message). Send button becomes `Retry {F} Failed`. Clicking Retry re-runs step 6 only on failed rows.

---

## 4. Data model changes

### 4.1 Migration 081 — Bulk claim RPC

Extends migration 080's single-invoice claim pattern to arrays.

```sql
BEGIN;

CREATE OR REPLACE FUNCTION claim_invoices_for_send(
  p_invoice_ids UUID[],
  p_tenant_id   UUID
)
RETURNS TABLE (invoice_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE invoices
     SET send_claimed_at = now()
   WHERE invoices.id = ANY(p_invoice_ids)
     AND invoices.tenant_id = p_tenant_id      -- tenant boundary
     AND invoices.deleted_at IS NULL           -- soft-delete guard
     AND invoices.sent_at IS NULL              -- not already sent
     AND (
       invoices.send_claimed_at IS NULL
       OR invoices.send_claimed_at < now() - interval '5 minutes'  -- stale-claim recovery
     )
  RETURNING invoices.id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_invoices_for_send(UUID[], UUID)
  TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

Semantics:
- Partial-success: returns the subset of `p_invoice_ids` successfully claimed. Invoices that were already sent, or currently claimed by an active session (<5 min), are silently skipped.
- Stale-claim recovery: claims older than 5 minutes can be overridden (covers the case where an endpoint crashed before releasing the claim).
- Tenant boundary enforced at the RPC layer: the caller must pass the requesting tenant_id; cross-tenant claims are impossible even if an attacker guesses invoice UUIDs.
- Coexists with migration 080's `claim_invoice_for_send(UUID, UUID)` (note: different function name — plural here vs singular there — so this is not a Postgres overload. Both functions live independently in the schema.)

### 4.2 Release semantics (no migration; same columns as 080)

On bulk-send failure, the endpoint releases claims with:
```sql
UPDATE invoices
SET send_claimed_at = NULL
WHERE id = ANY($1) AND sent_at IS NULL;
```
Already-sent invoices (from a previous success) are not unclaimed — prevents regression of `sent_at` on a flaky retry.

### 4.3 Trigger-log audit shape

Matches yesterday's convention (manual-send audit):
```json
{
  "umbrella_decisions": [{
    "type": "manual_bulk",
    "invoice_ids": ["uuid1", "uuid2", "uuid3"],
    "sent_by_user_id": "uuid-user",
    "grouping_kind": "customer",
    "group_label": "Acme Corp"
  }],
  "messages_created": [{ "email_message_id": "uuid-msg" }]
}
```
Written once per bulk-send POST (one group = one log row). Failure path writes the row with `messages_created: []` and an error field.

---

## 5. API surface

### 5.1 New: `POST /api/tenant/ar/invoices/bulk-send`

**Body:**
```typescript
{
  group: {
    invoice_ids: string[];       // UUIDs; must belong to tenant
    recipients: { to: string[]; cc?: string[]; bcc?: string[] };
    subject: string;
    body: string;
    body_format: 'html' | 'text';  // matches 2a.2 cleanup
  }
}
```

**Handler flow:**
1. Validate: `invoice_ids` non-empty, all belong to tenant, recipients.to non-empty.
2. `claim_invoices_for_send(invoice_ids, user_id)` → `claimedIds: UUID[]`.
3. If `claimedIds.length === 0` → return 409 `{ error: 'All invoices already claimed or sent' }`.
4. If `claimedIds.length < invoice_ids.length` → log warning with unclaimed IDs, proceed with claimed subset.
5. `fetchFullConfiguration(svc, tenantId, configId)` (AR invoice config).
6. For each claimed invoice: `archiveInvoicePdf(invoice, tenant, customer, { preRendered: null })` → returns `{ buffer, filename, url }`. Buffer accumulated.
7. `resolveFromAddress(fullConfig, null, tenantRow)` + `resolveFromName(fullConfig, tenantRow)`.
8. `dispatchEmail({ provider: 'sendgrid', from, recipients, subject, body, body_format, attachments: buffers.map(b => ({ filename, content: b.buffer, content_type: 'application/pdf' })) })`.
9. On dispatch success:
   - `UPDATE invoices SET sent_at = now() WHERE id = ANY(claimedIds)`.
   - Write `email_trigger_log` row with `umbrella_decisions.type = 'manual_bulk'`, `invoice_ids: claimedIds`, `messages_created: [{email_message_id}]`.
   - Return 200 `{ sent: claimedIds, skipped: invoice_ids.filter(id => !claimedIds.includes(id)) }`.
10. On dispatch failure:
   - Release claims: `UPDATE invoices SET send_claimed_at = NULL WHERE id = ANY(claimedIds) AND sent_at IS NULL`.
   - Write `email_trigger_log` row with error payload + `messages_created: []`.
   - Return 502 `{ error: 'SendGrid dispatch failed: {message}' }` with the SendGrid error passed through for dispatcher-visible detail.

**Stage-labeled errors** (per 2a.2 convention): each stage emits a distinguishable error message (`claim_failed`, `pdf_render_failed`, `dispatch_failed`, `postdispatch_update_failed`) to make production diagnosis easier.

### 5.2 Extended: `POST /api/tenant/ar/config/email-templates/invoice/defaults`

Extends the 2a.2 single-invoice defaults endpoint to accept an array.

**Body:**
```typescript
{
  invoice_ids: string[];           // NEW: was previously singular invoice_id
  customer_id?: string;             // optional hint; derived from invoices if absent
}
```

**Handler flow:**
1. Load all invoices (validate tenant ownership).
2. Resolve `customer_id` from first invoice (all invoices in a group must share the same bill_to, guaranteed by grouping logic; server asserts).
3. Load the AR invoice template row (unchanged).
4. Build context: merge variables that would have resolved per-invoice into a plural shape — e.g. `{{invoice.numbers}}` = comma-joined list, `{{invoice.total_bulk}}` = sum, `{{invoice.count}}` = length.
5. Render subject + body.
6. Resolve recipients via `resolveBulkRecipients(customer_id, invoice_ids)` → `{to, cc, bcc}`. Defaults to customer billing email; if none set, returns empty `to` array.
7. Return:
```typescript
{
  recipients: { to, cc, bcc };
  subject: string;
  body: string;
  body_format: 'html' | 'text';
  attachments: Array<{ name: string; invoice_id: string; size_bytes?: number }>;
}
```

**Backward compatibility:** if body contains `invoice_id` (singular, legacy shape), wrap it in an array internally. Minimizes churn on any existing call sites.

**New variable tokens** (register in `lib/email-variables.js`):
- `{{invoice.numbers}}` → `"INV-0001, INV-0002, INV-0003"` (comma-joined)
- `{{invoice.count}}` → `"3"`
- `{{invoice.total_bulk}}` → formatted sum (currency kind)
- `{{invoice.earliest_due}}` → earliest `due_at` across invoices in the group (date kind, ISO string)

Existing `{{invoice.number}}` (singular) resolves to the first invoice number when called in a bulk context — a fallback so templates written for single-send don't blow up in bulk mode.

### 5.3 Unchanged

- `/api/tenant/ar/invoices` (POST, create invoice + flip status) — used by the sequential loop in Step 1 of the bulk flow. No changes required.
- `/api/tenant/ar/invoices/[invoiceId]/send` (POST, single-send) — untouched. Bulk-send is a sibling, not a replacement.
- `providers/sendgrid.js` — already accepts `attachments: []` from 2a.2. Confirm multi-attachment path e2e in Gate 5.

---

## 6. Component specification

### 6.1 `BulkActionBar` (new)

**File:** `components/ar/BulkActionBar.js`

**Props:**
```typescript
{
  count: number;
  totalCents: number;
  bulkAction: 'approve' | 'unapprove' | 'approve_invoice' | null;
  onApprove: () => void;
  onUnapprove: () => void;
  onApproveAndInvoice: () => void;
  onExport: () => void;
  onClear: () => void;
}
```

**State:** none (fully controlled).

**Visual:** fixed-position bottom bar with dark slate palette. Full width with a small bottom-margin on screen. Hidden when `count === 0`. Disabled (opacity-60, buttons pointer-events-none) when `bulkAction !== null`.

### 6.2 `BulkGroupingModal` (new)

**File:** `components/ar/BulkGroupingModal.js`

**Props:**
```typescript
{
  invoices: Array<{
    invoice_id: string;
    customer_id: string;
    reference_number: string | null;
    total_cents: number;
    charge_set_id: string;
    customer_name: string;
  }>;
  onCancel: () => void;
  onContinue: (result: {
    kind: 'customer' | 'reference' | 'charge_set';
    groups: Group[];
  }) => void;
}
```

**State:** `{ kind: 'customer' }` (default).

**Group computation:** `useMemo(() => computeGroups(invoices, kind), [invoices, kind])`. Pure function, unit-testable.

### 6.3 `BulkEmailQueue` (new)

**File:** `components/ar/BulkEmailQueue.js`

**Props:**
```typescript
{
  groups: Group[];
  groupingKind: 'customer' | 'reference' | 'charge_set';
  onClose: () => void;       // user-initiated cancel or auto-close-on-complete
  onAllSent: () => void;     // parent fires fetchAR({silent: true})
}
```

**State (via `useBulkEmailQueue`):**
```typescript
{
  rows: Array<{
    groupKey: string;
    group: Group;
    status: 'pending' | 'ready' | 'needs_edit' | 'sending' | 'sent' | 'failed';
    recipients: { to, cc, bcc };
    subject: string;
    body: string;
    body_format: 'html' | 'text';
    attachments: Array<{ name, invoice_id, size_bytes? }>;
    error: string | null;
  }>;
  editingGroupKey: string | null;  // which row's EmailComposeSlideOver is open
}
```

**Initialization** (useEffect on mount): for each group, `POST /email-templates/invoice/defaults` with `invoice_ids` → hydrate the row. All in parallel via `Promise.allSettled`.

**`sendReady()` action:**
```typescript
const readyRows = rows.filter(r => r.status === 'ready');
// flip all to 'sending'
setRows(rows => rows.map(r => readyRows.includes(r) ? {...r, status: 'sending'} : r));
// fire in parallel
const results = await Promise.allSettled(
  readyRows.map(row => fetch('/api/tenant/ar/invoices/bulk-send', {
    method: 'POST',
    body: JSON.stringify({ group: {
      invoice_ids: row.attachments.map(a => a.invoice_id),
      recipients: row.recipients,
      subject: row.subject,
      body: row.body,
      body_format: row.body_format,
    }})
  }).then(r => r.ok ? r.json() : Promise.reject(r.json())))
);
// apply results
setRows(rows => rows.map((r, idx) => {
  if (!readyRows.includes(r)) return r;
  const result = results[readyRows.indexOf(r)];
  if (result.status === 'fulfilled') return {...r, status: 'sent', error: null};
  return {...r, status: 'failed', error: result.reason?.error || 'Unknown error'};
}));
// hybrid close
const anyFailed = results.some(r => r.status === 'rejected');
if (!anyFailed) {
  setTimeout(onAllSent, 1000); // parent closes + silent-refetches
}
```

**`retryFailed()`:** same as `sendReady()` but filters to `status === 'failed'`.

### 6.4 `EmailComposeSlideOver` (extended)

**New prop:** `attachments?: Array<{ name, invoice_id, size_bytes? }>`.

**Render change:** when `attachments.length > 1`, render a read-only attachments list (filename + size) below the body field. Single-attachment case (length === 1 or undefined) continues to render the existing single-line attachment preview — zero regression for single-send callers.

**No hook changes.** The slide-over's internal state (recipient/subject/body edits) is unchanged.

**Save handler signature unchanged.** Parent wires save through a new callback that writes back into `BulkEmailQueue`'s row state via `updateRow(groupKey, patch)`.

### 6.5 `BillingPipelineTab.js` (modified)

**Changes:**
1. Selection bar JSX moves from the existing top-sticky pill location to render a new `BulkActionBar` at the bottom. The current JSX is deleted after the bar is in place; no dual rendering.
2. Add `onApproveAndInvoice` handler:
   ```javascript
   async function handleBulkApproveAndInvoice() {
     setBulkAction('approve_invoice');
     const selected = chargeSets.filter(cs => selectedIds.has(cs.id));
     const eligible = selected.filter(cs => cs.status === 'approved');
     // Matches single-send: only `approved` charge sets are eligible for invoicing.
     // Planning step should confirm `/api/tenant/ar/invoices` POST accepts the same.
     const created = [];
     let failed = 0;
     for (const cs of eligible) {
       try {
         const res = await fetch('/api/tenant/ar/invoices', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ charge_set_id: cs.id }),
         });
         if (!res.ok) throw new Error((await res.json()).error);
         const inv = await res.json();
         created.push(inv);
       } catch (e) { failed++; }
     }
     setBulkAction(null);
     if (created.length === 0) {
       setToast({ type: 'error', message: `All ${eligible.length} invoices failed` });
       return;
     }
     if (failed > 0) setToast({ type: 'warning', message: `${created.length} of ${eligible.length} invoiced · ${failed} failed` });
     setGroupingModalInvoices(created);  // opens grouping modal
   }
   ```
3. Add grouping-modal + queue state:
   ```javascript
   const [groupingModalInvoices, setGroupingModalInvoices] = useState(null);
   const [queueGroups, setQueueGroups] = useState(null);
   ```
4. Render at end of component:
   ```jsx
   {groupingModalInvoices && <BulkGroupingModal invoices={...} onCancel={...} onContinue={({kind, groups}) => {setGroupingModalInvoices(null); setQueueGroups({kind, groups});}} />}
   {queueGroups && <BulkEmailQueue groups={queueGroups.groups} groupingKind={queueGroups.kind} onClose={() => {setQueueGroups(null); fetchAR({silent: true});}} onAllSent={() => {setQueueGroups(null); fetchAR({silent: true});}} />}
   ```

No changes to pipeline-card filters, search, or the charge-set table rendering.

---

## 7. Data flow (end-to-end walkthrough)

For reference; expanded step-by-step is in [Section 3 of this spec](#3-ux-specification). Summary:

1. **Select → click**: dispatcher selects N charge sets; `BulkActionBar` appears; click **Approve & Invoice**.
2. **Sequential invoice creation**: loop POSTs to `/api/tenant/ar/invoices` for each eligible row. Failed rows skipped; `invoices[]` accumulated.
3. **Grouping modal**: opens with `invoices[]`; dispatcher picks kind → `onContinue({kind, groups[]})`.
4. **Queue init**: `BulkEmailQueue` mounts; per-group parallel POST to extended `/email-templates/invoice/defaults` populates rows.
5. **Edit (optional)**: row Edit opens `EmailComposeSlideOver` with row's data; Save merges back.
6. **Send**: `Promise.allSettled` over ready rows → `POST /invoices/bulk-send`; per-group the server claims, renders, dispatches, marks sent, logs.
7. **Close**: all-green → auto-close + silent-refetch; any-red → stay open with Retry.
8. **Skip-by-close**: dispatcher Cancel at any step leaves invoices in `invoiced` status without `sent_at`/`email_skipped_at`.

---

## 8. Error handling

| Stage | Failure | User-visible | DB state |
|---|---|---|---|
| Invoice creation | Single POST 422/500 | Loop continues; toast `{M} of {N} invoiced · {failed} failed` | Failed charge sets stay in prior status; no invoice |
| Invoice creation | All POSTs fail | Error alert on Pipeline; no grouping modal | No change |
| Defaults fetch | Template 404 | Row `needs_edit` badge: "Template missing — Edit to set subject/body" | n/a |
| Defaults fetch | Network error | Row `failed`; row-level Retry re-fetches defaults | n/a |
| Bulk-send | Claim RPC empty | Row `failed`: "Already claimed or sent elsewhere — refresh to retry" | No change; claim idempotent |
| Bulk-send | PDF render error | Row `failed`: "PDF render error for INV-XXXX" | `send_claimed_at` released |
| Bulk-send | SendGrid 4xx | Row `failed` with SendGrid error passed through | `send_claimed_at` released |
| Bulk-send | SendGrid 5xx / timeout | Row `failed`: "SendGrid error — Retry" | `send_claimed_at` released |
| Bulk-send | Post-dispatch DB update fails | Row `failed`: "Sent but state update failed — contact support" with explicit note that email WAS sent | Inconsistent; log alert required |

**Concurrency invariants:**
- Two dispatchers bulk-invoicing overlapping invoice_ids: `claim_invoices_for_send` serializes; whichever call runs first claims all, the second returns an empty array and fails cleanly.
- Crashed endpoint mid-dispatch: stale claims (>5 min old) can be re-acquired by a subsequent call. Limits "stuck" invoices to a 5-min window.

---

## 9. Verification gates

Mirrors 2a.2/2a.3 pattern — 7 headless + 1 UI click-through.

**Gate 1 — Migration 081 applies cleanly**
- Apply to dev DB. Verify `claim_invoices_for_send(uuid[], uuid)` exists, returns correct subset on partial-success scenarios.
- `NOTIFY pgrst, 'reload schema'` visible in logs.
- Re-apply is idempotent (no duplicate-function error).

**Gate 2 — Bulk invoice creation loop**
- Seed 5 charge sets: 3 `approved`, 2 `unapproved` (ineligible).
- Call `handleBulkApproveAndInvoice` with all 5 selected.
- Verify: 3 eligible rows flip to `invoiced` + have new invoice rows; 2 ineligible untouched. Toast reads `3 of 3 invoiced` (ineligible rows don't count toward the failed count, matching the existing `bulkStatusTransition` pattern in `BillingPipelineTab.js:158-169`).
- `invoices[]` passed to `BulkGroupingModal` matches exactly the 3 successful rows.

**Gate 3 — Grouping logic (client-side unit tests)**
Test `computeGroups(invoices, kind)`:
- `customer`: 6 invoices across 3 customer_ids → 3 groups with correct `invoice_ids[]` and sum of `total_cents`.
- `reference`: same invoices where two customers share ref `"PO-100"` → 2 separate groups for those (no cross-leak).
- `reference` with null refs: invoices without a ref fall back into the customer-level group, not singleton groups.
- `charge_set`: N invoices → N groups, each with `invoice_ids.length === 1`.
- Invariant across all kinds: `sum(group.invoice_ids.length for group in groups) === N`.

**Gate 4 — Email-defaults batch endpoint**
- `POST /email-templates/invoice/defaults { invoice_ids: [5 uuids], customer_id }` against seeded data.
- Verify response shape: `{ recipients: {to, cc, bcc}, subject, body, body_format, attachments[5] }`.
- Verify subject/body template resolution matches single-send output for the first invoice (canonical comparison).
- Verify new tokens (`{{invoice.numbers}}`, `{{invoice.count}}`, `{{invoice.total_bulk}}`) render correctly.
- Verify no-recipient case: customer without `billing_email` returns `to: []`.

**Gate 5 — Bulk-send happy path**
- `POST /invoices/bulk-send` with one 3-invoice group, against a mocked SendGrid provider.
- Verify: `claim_invoices_for_send` called once with `[3 UUIDs]`, returns all 3; `archiveInvoicePdf` called 3× (each returns a buffer); `dispatchEmail` called once with `attachments.length === 3`, correct `fromAddress`; all 3 invoices get `sent_at = now()`; one `email_trigger_log` row written with `umbrella_decisions: [{type: 'manual_bulk', invoice_ids: [3], grouping_kind: ..., group_label: ...}]`.

**Gate 6 — Claim pattern under contention**
- Two concurrent `POST /bulk-send` calls for overlapping invoice_ids.
- Verify: one request wins (sets `sent_at` on all overlapping), other receives empty claim + returns 409 with clean error message; no SendGrid double-dispatch; no `sent_at` regression.
- Test stale-claim recovery: artificially set `send_claimed_at = now() - interval '10 minutes'` on an invoice, verify next call succeeds.

**Gate 7 — Hybrid close + Retry**
- Mock 1 of 3 rows to fail with SendGrid 500.
- Verify: queue does not auto-close; failed row shows red + Retry + error; successful rows dimmed with ✓; `Retry 1 Failed` button replaces Send.
- Click Retry (mock now returns 200): failed row flips `sending` → `sent`; queue auto-closes.

**Gate 8 — Full UI click-through (Cowork/Chrome preview)**
Live end-to-end test on local dev:
1. `/ar` Billing tab → select 10 charge sets spanning 2 customers, all `approved` status.
2. Verify `BulkActionBar` appears at bottom with `10 selected · ${total}`.
3. Click **Approve & Invoice** → verify 10 invoices created (check DB); toast shows success.
4. **Grouping modal** opens with 10 invoices; verify both `customer` (2 groups, 5+5 PDFs) and `charge_set` (10 groups) previews render.
5. Pick **per customer** → Continue.
6. **Queue dashboard** opens with 2 rows; verify recipient/subject/body populate from template.
7. Click **Edit** on row 1 → slide-over opens with 5 attachments listed (read-only); tweak subject → Save → row flips to Ready.
8. Click **Send 2 Ready** → both rows show `sending` → `sent`.
9. Queue auto-closes; pipeline silent-refetches (no flash/unmount); charge sets in pipeline now show `invoiced` status.
10. `/settings/communications` Trigger Activity tab shows 2 new rows with `manual_bulk` type.

---

## 10. Out of scope

- **Bulk Send Rate Con**: different entry point (pre-invoice charge sets), different template slug (`rate_con_send`), but otherwise same grouping + queue pattern. Tracked as 2a.4b.
- **Bulk Send from Invoices tab**: sending already-invoiced-but-not-emailed invoices. Different invoice state machine (no invoice-creation step); slightly different grouping preset (invoices already exist, grouping happens over `invoice_ids[]` directly). Tracked as 2a.4c.
- **Invoice + date picker** backdate button: single-invoice with sent_at override. Unrelated to bulk; orthogonal UI. Tracked as 2a.5.
- **Live SendGrid delivery webhook**: bounce/deferred/open tracking. Out of scope; failures in this sub-project are surfaced only at dispatch time. Tracked as 2a.6.
- **Concurrent bulk-invoice creation from multiple dispatchers on the same charge sets**: handled passively by charge-set status transitions (first flip wins; second flip sees `invoiced` as ineligible). No explicit UI feedback for this case beyond "ineligible status" in the skip count.
- **Resume after browser refresh during a send**: not supported. If the dispatcher refreshes mid-send, completed sends stay sent (their invoices show `sent_at`); in-flight sends' claims expire in 5 minutes and those invoices become sendable again manually.
- **Retry automation**: no auto-retry on SendGrid 5xx. Dispatcher clicks Retry manually.

---

## 11. Dependencies + order of operations

- Depends on 2a.1 (PDF rendering) — shipped.
- Depends on 2a.2/2a.3 (single-send dispatch stack) — shipped.
- Depends on migration 080 (single-invoice claim RPC) — shipped + applied.
- Migration 081 (bulk claim RPC) must be applied before frontend ships.
- No dependency on 2a.5, 2a.6, or the AR Invoices tab bulk sub-project.

Recommended implementation order within this sub-project:

1. Migration 081.
2. `/invoices/bulk-send` endpoint + `resolveBulkRecipients` + dispatcher audit-shape extension.
3. Extended `/email-templates/invoice/defaults` endpoint + new variable tokens.
4. `BulkEmailQueue` + `useBulkEmailQueue` hook (can be built headless with mocked endpoints).
5. `BulkGroupingModal`.
6. `EmailComposeSlideOver` attachments-list extension.
7. `BulkActionBar`.
8. Wire into `BillingPipelineTab`: relocate bar, add Approve & Invoice handler, mount modal/queue.
9. Verification gates 1–7 headless.
10. Gate 8 UI click-through via dev server + Cowork.

Each step gets a dedicated commit. Every commit runs `npm run build` + dark-mode check (per `dev_dark_mode_convention.md`). No work after gate 8 unless explicit follow-up items surface.
