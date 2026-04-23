# Bulk Invoice Resend (2a.4c / FU-024) — Design

**Status:** Design approved 2026-04-24
**Follow-up:** FU-024
**Predecessors:** 2a.4 (bulk invoice first-send, migration 081), 2a.4b (bulk rate-con, migration 083), audit duplicate-row fix (`178eafa`, FU-025)

## 1. Goal

Enable operators to select multiple already-sent invoices on the Invoices tab and bulk-resend them through the existing grouping modal + queue infrastructure. Today the Invoices tab has zero bulk UI — every interaction is per-row.

## 2. Scope

**In scope**
- Checkbox selection UI on the Invoices tab (new — tab has none today).
- Bulk action bar with a single action: **Resend**.
- Backend support for resending invoices whose status is already `sent` or `overdue`.
- Audit-row discrimination so downstream queries can filter resends.

**Out of scope (deferred)**
- Bulk first-send for `draft` invoices (existing per-row Send covers this). If needed later, file as 2a.4d.
- Per-row resend button. The bulk flow is sufficient for the stated use case.
- `invoices.last_resent_at` column. Audit log has everything; UI doesn't need it yet.
- Any new migration. This feature ships pure-code.

## 3. Design Decisions (resolved during brainstorming)

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Resend mechanism | **Option A:** `force_resend: true` param on existing endpoint | Max code reuse (~80% shared with first-send). Single-endpoint cognitive load acceptable given clean `if (force_resend)` branching at two points. |
| 2 | Eligible statuses | `sent`, `overdue` | `draft` has per-row Send. `paid` conflates invoice with receipt. `void` never. |
| 3 | Audit discrimination | `type='manual_bulk_resend'`, `event_name='manual:invoice_bulk_resend'` | Mirrors existing `manual_bulk` / `manual_bulk_rate_con` naming. Extend `logManualBulkSend` with `resend` flag rather than adding a 3rd helper. |
| 4 | `last_resent_at` column | **Not added.** Audit-only. | YAGNI. `email_trigger_log` captures full history. Can derive on read if UI ever needs it. |
| 5 | Selection UX when rows are ineligible | **Option A:** hide the checkbox on non-resendable rows | Crisper than "allow-all-then-silently-skip". Matches 2a.4c's narrow framing. |

## 4. Architecture

### 4.1 Frontend

#### `components/ar/InvoicesTab.js` (significant)

Pattern-copy from [BillingPipelineTab.js](../../../components/ar/BillingPipelineTab.js). Additions:

**State** (mirror lines 37-42 of Pipeline):
```js
const [selectedIds, setSelectedIds] = useState(() => new Set());
const [lastClickedId, setLastClickedId] = useState(null);
const [bulkAction, setBulkAction] = useState(null);
const [toast, setToast] = useState(null);
const [groupingModalInvoices, setGroupingModalInvoices] = useState(null);
const [queueState, setQueueState] = useState(null);
```

**Selection helpers** (mirror Pipeline's `toggleAll`, `toggleRow`, visibleIds/allSelected/someSelected). One deviation: only `sent` + `overdue` rows are selectable. `visibleIds` is filtered to resendable statuses:

```js
const resendableInvoices = invoices.filter(
  (i) => i.status === 'sent' || i.status === 'overdue'
);
const visibleIds = resendableInvoices.map((i) => i.id);
```

**Selection-clear effect** on `statusFilter` / `search` / `filters` change (mirror Pipeline lines 110-113).

**Checkbox rendering** in the table: render a checkbox `<td>` only when the row is resendable. Non-resendable rows render an empty-width `<td className="w-10" />` so the grid aligns. The header checkbox toggles only resendable rows.

**`handleBulkResend`** builds items for the grouping modal:
```js
const items = invoices
  .filter((i) => selectedIds.has(i.id))
  .map((inv) => ({
    id: inv.id,
    invoice_id: inv.id,
    customer_id: inv.customer?.id ?? inv.customer_id,
    customer_name: inv.customer?.name ?? '(unknown)',
    reference_number:
      inv.charge_sets?.[0]?.charge_set?.order?.customer_reference ?? null,
    invoice_number: inv.invoice_number,
    total_cents: inv.total_amount_cents ?? 0,
  }));
setGroupingModalInvoices(items);
```

Note: `reference_number` must come from `customer_reference` on the order, per the `reference_number`↔`customer_reference` alias convention ([`feature_accounts_receivable.md`](../../../memory/feature_accounts_receivable.md) and pattern at [BillingPipelineTab.js:282](../../../components/ar/BillingPipelineTab.js:282)).

**Modal wiring** (mirror Pipeline lines 601-625):
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
    mode="resend"   /* ← new prop */
    onClose={() => { setQueueState(null); load(); }}
    onAllSent={() => { setQueueState(null); load(); }}
  />
)}
```

#### `components/ar/InvoicesBulkBar.js` (new, ~60 LoC)

Focused bulk bar for this tab. Does NOT reuse `BulkActionBar` — that component is already overloaded with 5 actions for the Pipeline tab's multi-status pipeline, and threading a 6th `onResend` + status-based visibility flags onto it would muddy both callers.

Props: `{ count, totalCents, bulkAction, onResend, onClear }`. Visual style matches `BulkActionBar` (same fixed bottom slide-up, same button styling). Buttons:
- **Resend** — primary blue, disabled when `bulkAction != null`.
- **Deselect** — ghost/secondary.

Appears when `count > 0`.

#### `components/ar/BulkEmailQueue.js` (minor)

Add optional `mode` prop (`'first-send' | 'resend'`, default `'first-send'`). When `mode === 'resend'`, append `force_resend: true` to the POST body sent to `/api/tenant/ar/invoices/bulk-send`.

No other component changes. `BulkGroupingModal` requires zero changes — it's already docType-generalized.

### 4.2 Backend

#### `pages/api/tenant/ar/invoices/bulk-send.js` — extend

Shape additive, no breaking changes:

```js
const { group, force_resend = false } = req.body || {};
```

**STAGE: claim** branches on `force_resend`:

- **`force_resend === false`** (existing path): call `claim_invoices_for_send` RPC. Unchanged.
- **`force_resend === true`**: direct UPDATE with status + freshness mutex:

```js
const { data: claimRows, error: claimErr } = await svc
  .from('invoices')
  .update({ send_claimed_at: new Date().toISOString() })
  .eq('tenant_id', ctx.tenantId)
  .is('deleted_at', null)
  .in('id', invoiceIds)
  .in('status', ['sent', 'overdue'])
  .or('send_claimed_at.is.null,send_claimed_at.lt.' +
      new Date(Date.now() - 5 * 60 * 1000).toISOString())
  .select('id');
```

This reuses the same 5-minute `send_claimed_at` freshness mutex used by migration 081's RPC. No new column. Any invoice not currently in `sent`/`overdue` is silently skipped and appears in `skippedIds`. Any invoice currently mid-send by another session is also skipped.

**STAGE: postdispatch** — different column updates on resend:

```js
const updatePayload = force_resend
  ? { send_claimed_at: null }
  : { sent_at: sentAt, send_claimed_at: null, status: 'sent' };
```

Resend does NOT re-stamp `sent_at` — the original first-send timestamp stays (critical for aging/overdue calculations). Status is already `sent` or `overdue`, no flip.

**Audit:** pass `resend: force_resend` to `logManualBulkSend`.

All other stages (validate, fetch_config, cross-customer guard, distance gate, render PDFs, dispatch) are completely unchanged.

#### `lib/email-dispatch/dispatcher.js:642` — extend `logManualBulkSend`

```js
export async function logManualBulkSend(svc, args) {
  const { ..., resend = false } = args;

  const umbrellaDecision = {
    type: resend ? 'manual_bulk_resend' : 'manual_bulk',
    // ...rest unchanged
  };
  const eventName = resend ? 'manual:invoice_bulk_resend' : 'manual:invoice_bulk_send';
  const fireKeyPrefix = resend ? 'manual:invoice_bulk_resend' : 'manual:invoice_bulk';

  const { error: logErr } = await svc.from('email_trigger_log').insert({
    tenant_id: tenantId,
    trigger_id: null,
    event_name: eventName,
    fire_key: `${fireKeyPrefix}:${groupLabel || 'noref'}:${Date.now()}`,
    // ...rest unchanged
  });
  // ...
}
```

Backwards compatible — existing callers default to `resend: false`.

## 5. Data Flow

```
Operator selects 3 sent invoices (same customer)
  └─> InvoicesBulkBar [Resend] click
      └─> handleBulkResend() builds items
          └─> setGroupingModalInvoices(items)
              └─> BulkGroupingModal (docType="invoice")
                  └─> operator picks grouping (customer|reference|charge_set)
                      └─> setQueueState({ kind, groups })
                          └─> BulkEmailQueue (mode="resend")
                              └─> POST /api/tenant/ar/invoices/bulk-send
                                  body: { group, force_resend: true }
                                  ─ STAGE: validate
                                  ─ STAGE: claim (direct UPDATE, 5min mutex,
                                                  status ∈ {sent, overdue})
                                  ─ STAGE: fetch_config (branch-aware)
                                  ─ cross-customer guard (defense-in-depth)
                                  ─ distance gate per invoice
                                  ─ STAGE: render (PDFs → archive)
                                  ─ STAGE: dispatch (dispatchEmail)
                                  ─ STAGE: postdispatch (release claim only —
                                                          no sent_at re-stamp)
                                  ─ logManualBulkSend({ resend: true })
                              └─> toast + refetch invoices
```

## 6. Error Handling

All existing error paths are inherited unchanged:

- `NO_ACTIVE_CONFIG` → 400
- `CROSS_CUSTOMER` → 400
- `ALL_CLAIMED` → 409 (applies to resend path too: if direct UPDATE returns 0 rows, treat identically)
- Distance gate block → 400 with `skipped_distance`
- Dispatch failure → 502, claims released

Resend-specific additions:

- **Status changed mid-flight** (someone voids an invoice between selection and claim): the `status IN ('sent', 'overdue')` filter drops it; appears in `skippedIds` alongside other skips; partial success returned (same shape as first-send).
- **Audit failure** on resend: same try/catch as existing path — non-fatal.

## 7. Testing / Verification Gates

Chrome gates (matches brief):

1. **Same-customer bulk:** Select 2 sent invoices from same customer → group by customer → send → verify 1 email received with 2 PDF attachments. Both invoices STILL `status='sent'`, `sent_at` unchanged from original.
2. **Cross-customer split:** Select 2 invoices from different customers → group by customer → verify 2 separate emails.
3. **Per-invoice grouping:** Same selection, choose "one email per invoice" → verify 2 separate emails, 1 PDF each.
4. **Audit query:**
   ```sql
   SELECT umbrella_decisions->0->>'type'
   FROM email_trigger_log
   WHERE event_name = 'manual:invoice_bulk_resend'
   ORDER BY fired_at DESC LIMIT 5;
   ```
   Expect `'manual_bulk_resend'`.
5. **Ineligible-status API probe:** POST `force_resend: true` with a draft invoice ID mixed in → verify it appears in response `skipped`, not in `sent`.
6. **Concurrent-resend mutex:** Spam Resend twice rapidly → second call returns 409 `ALL_CLAIMED` OR partial with claimed-elsewhere skips.
7. **Regression on first-send path:** Run an existing 2a.4 first-send flow end-to-end (Pipeline tab → Approve & Invoice → Send Emails) → verify no regression.
8. **Aging preservation:** Resend an overdue invoice → verify `sent_at` column unchanged, invoice still shows as overdue.

## 8. Files Changed

| File | Change | Approx LoC |
|---|---|---|
| `components/ar/InvoicesTab.js` | Add selection UI, handler, modal/queue wiring | +100 |
| `components/ar/InvoicesBulkBar.js` | New file | +60 |
| `components/ar/BulkEmailQueue.js` | Add `mode` prop, thread to fetch body | +5 |
| `pages/api/tenant/ar/invoices/bulk-send.js` | Accept `force_resend`, branch claim + postdispatch | +30 |
| `lib/email-dispatch/dispatcher.js` | Extend `logManualBulkSend` with `resend` flag | +10 |

**Total:** ~205 LoC across 5 files. **Zero migrations. Zero new RPCs.**

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Operator resends wrong invoice by mistake | Bulk bar shows count + total before the confirmation modal; grouping modal requires explicit grouping choice before send. |
| `sent_at` accidentally re-stamped, breaking aging | Postdispatch branches on `force_resend`; unit-verify update payload in Chrome gate #8. |
| Audit queries over-broad-match on `manual_bulk` | New discriminator `manual_bulk_resend` is added; existing `umbrella_decisions->0->>'type' = 'manual_bulk'` queries will NOT match resends (by design — callers filter on the full type string). |
| Race: two operators resend simultaneously | Same 5-minute `send_claimed_at` mutex used by first-send; second caller's direct UPDATE returns 0 rows or partial. |
| Breaking change to existing callers of `logManualBulkSend` | `resend` param defaulted to `false`; all existing callers unaffected. |

## 10. Commit plan

Single commit on `main` with body:
```
feat(ar): bulk resend from Invoices tab (2a.4c)

[summary...]

Resolves: FU-024
```

The `update-followups` skill will move FU-024 to Recently Resolved via Case A SHA match.
