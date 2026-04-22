# 2a.4b — Bulk Rate-Con Send (design)

**Status:** design approved 2026-04-20 · ready for implementation plan
**Builds on:** 2a.4 (bulk invoice send, 2026-04-19) · 2a.5 (email sender default tier, 2026-04-20)
**Next:** `writing-plans` → a task-by-task implementation plan

---

## TL;DR

Add a "Send Rate Cons" bulk action to the AR Billing Pipeline's Pre-Invoice multi-select toolbar. Reuses 2a.4's shipped `BulkGroupingModal` + `BulkEmailQueue` components — generalized with a `docType` prop — against a new bulk-send endpoint for rate-confirmation charge-sets. Successful sends transition `order_charge_sets.status` from `draft` → `rate_con_sent`. Concurrency protected by a new claim RPC mirroring 2a.4's invoice claim. Delivery follows the 2a.5 precedence path (template → config → tenant → platform floor).

**Single-session scope.** ~250 LOC new endpoint + ~50 LOC refactor of BulkGroupingModal/BulkEmailQueue + one migration (083) + one shared helper + 2 unit test files + 10 live-walk gates.

---

## Context

Rate confirmations ("rate cons") are the document a trucking company sends a customer **before** invoicing, confirming the agreed-upon charges for a load. The customer reviews, signals "ok," then the invoice follows. Both docs go to the customer — just at different stages of the AR pipeline. Today:

- **Single rate-con send** shipped in 2a.3: `POST /api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`, opened via an `EmailComposeSlideOver` from the load-detail Billing tab. Recipients are entered manually; no grouping; no claim.
- **Bulk invoice send** shipped in 2a.4: `BulkGroupingModal` → `BulkEmailQueue` → `POST /api/tenant/ar/invoices/bulk-send.js`, with a `claim_invoices_for_send` RPC preventing concurrent double-sends and a 4-step recipient fallback chain.
- **Sender pipeline** (2a.5): all three existing send endpoints use `selectActiveConfig` + `resolveFromDisplayName` + `resolveReplyTo`. Any new bulk endpoint inherits this for free.

The gap: no way to bulk-send rate cons. An operator approving 15 charge-sets for the same customer in the morning has to open 15 single-sends one at a time. This spec closes that gap.

---

## User flow

### Trigger

1. Operator opens **AR Pipeline → Billing Pipeline → Pre-Invoice box**.
2. Selects ≥1 charge-set cards via checkbox (shift-click for range select).
3. The fixed-bottom `BulkActionBar` shows the existing actions (Approve / Unapprove / Approve & Invoice) plus a new **"Send Rate Cons"** button.
4. Click → opens `BulkGroupingModal` in `docType='rate_con'` mode.

### Grouping step

`BulkGroupingModal` shows:

- The list of selected charge-sets with customer name, charge-set number, current status, order reference.
- Three radio options for grouping kind (same as 2a.4):
  - **By customer** — 1 email per customer; charge-sets for the same customer bundled with N PDFs attached.
  - **By reference #** — 1 email per `{customer_id, order.reference_number}` combo (falls back to customer-only if reference missing).
  - **Per charge-set** — 1 email per charge-set.
- Cancel / Continue.

Operator picks a grouping → Continue → `BulkEmailQueue` opens.

### Queue/review step

`BulkEmailQueue` shows one row per resolved group. Each row displays:

| Field | Source |
|---|---|
| Recipient (To/CC/BCC) | 4-step fallback chain, see "Recipient resolution" below |
| Subject | Pre-populated from `rate_con` template, variable-substituted |
| Body HTML/Text | Same |
| Attachment count | e.g. "3 rate cons" |
| Row state badge | `ready` / `needs_edit` / `failed` / `sending` / `sent` / `skipped` |

Rows with an unresolved recipient start in `needs_edit` and block the **Send All** button. Operator clicks a row → inline editor for recipients / subject / body → Save → row flips to `ready`.

### Send step

Click **Send All**:

For each row sequentially:

1. `POST /api/tenant/ar/charge-sets/bulk-send-rate-con` with the group payload.
2. Row transitions `ready → sending → sent / failed / skipped` based on the response.
3. Send All continues regardless of individual row outcomes.

On completion: modal shows summary (X sent, Y failed, Z skipped). Closing refreshes the pipeline so the newly-`rate_con_sent` charge-sets appear in the right column.

### Edge cases

| Case | Behavior |
|---|---|
| Charge-set already in `rate_con_sent` and selected | Allowed. Send succeeds; status stays `rate_con_sent`; a new `email_messages` row is created. |
| Two operator tabs select the same charge-set | First tab claims; second tab's row shows `skipped` with error "already being sent." |
| PDF render fails for one charge-set in a group | Entire group fails atomically (all-or-nothing). Row → `failed`. Other rows continue. |
| Customer has no resolvable email | Row starts in `needs_edit`. Operator types recipient inline or cancels the row. |
| `dispatchEmail` fails | Claim released, no status change, row → `failed`. |

---

## Architecture

### New files

| Path | Purpose | Est. LOC |
|---|---|---|
| `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js` | Bulk send endpoint. Pattern: claim → selectActiveConfig → fetchFullConfiguration → render N PDFs → dispatchEmail → status update. Mirrors `invoices/bulk-send.js`. | ~250 |
| `supabase/migrations/083_rate_con_bulk_send.sql` | Adds `order_charge_sets.send_claimed_at TIMESTAMPTZ NULL` column + `claim_charge_sets_for_rate_con_send(p_charge_set_ids UUID[], p_tenant_id UUID)` RPC mirroring `claim_invoices_for_send`. Follows migration template (BEGIN/COMMIT + NOTIFY pgrst reload). | ~80 |
| `lib/ar/resolve-billing-email.js` | Shared helper: `(svc, tenantId, customerId, emailType) → string \| null`. Runs the 4-step fallback chain. Used by both bulk paths (see refactor note). | ~40 |
| `pages/api/tenant/ar/resolve-billing-emails.js` | Batch endpoint: `GET ?customer_ids=a,b,c&email_type=rate_confirmation` → `{ [customer_id]: email \| null }`. Thin wrapper over the helper; tenant-scoped. Used by `BulkGroupingModal` to pre-resolve recipients. | ~50 |
| `tests/ar/resolve-billing-email.test.mjs` | Unit tests for the fallback chain. | ~60 |
| `tests/ar/bulk-rate-con-request.test.mjs` | Request-shape validator tests for the bulk endpoint (rejects missing charge_set_ids, mismatched grouping_kind, etc.). | ~80 |

### Modified files

| Path | Change | Est. LOC delta |
|---|---|---|
| `components/ar/BulkGroupingModal.js` | Rename `invoices` prop → `items`. Add `docType: 'invoice' \| 'rate_con'` prop. Switch display labels ("invoices" → "rate cons"), group-key computation stays the same (customer_id / customer_id::ref / row_id), summary wording switches based on docType. | +30 / -10 |
| `components/ar/BulkEmailQueue.js` | Add `docType` prop. Switch: send endpoint (`/invoices/bulk-send` vs `/charge-sets/bulk-send-rate-con`), PDF-count wording, attachment filename pattern (`invoice-N.pdf` vs `rate-con-N.pdf`), post-send status verb ("Invoiced" vs "Rate Con Sent"). | +40 / -15 |
| `components/ar/BillingPipelineTab.js` | In Pre-Invoice box multi-select toolbar, add a **"Send Rate Cons"** button (next to Approve / Unapprove / Approve & Invoice). Wires `BulkGroupingModal` with `docType='rate_con'`. | +25 |
| `components/ar/BulkActionBar.js` | Add "Send Rate Cons" button + conditional-disable logic (enabled only when ≥1 charge-set selected). Matches existing placement pattern of Approve / Unapprove / Approve & Invoice. | +15 |
| `pages/api/tenant/ar/invoices/bulk-send.js` | Refactor to use shared `lib/ar/resolve-billing-email.js` helper. Behavior unchanged. Covered by Gate 9 regression. | +3 / -25 |

### Data flow (single group, 3 charge-sets for one customer)

```
Operator clicks Send All on row group-X
    │
    ▼
POST /api/tenant/ar/charge-sets/bulk-send-rate-con
  body: {
    group: {
      charge_set_ids: ['a','b','c'],
      recipients: { to: ['cust@acme.com'], cc: [], bcc: [] },
      subject: 'Rate Confirmation for Test Trucking',
      body_text, body_html, body_format,
      grouping_kind: 'customer',
      group_label: 'customer-abc-123',
    }
  }
    │
    ▼
claim_charge_sets_for_rate_con_send(['a','b','c'], tenantId)
  → returns ['a','b','c']  (all claimed; else tenant mismatch / already claimed → subset)
    │
    ▼
SELECT id, order:order_id(branch_id, reference_number, customer_id)
  FROM order_charge_sets WHERE id IN (...) AND tenant_id = ctx.tenantId
    │
    ▼
loadBranchId = charge_sets[0].order.branch_id
configRow = await selectActiveConfig(svc, tenantId, loadBranchId)
fullConfig = await fetchFullConfiguration(svc, tenantId, configRow.id)
tenantRow = SELECT id, name, contact_email FROM tenants WHERE id = ctx.tenantId
    │
    ▼
for each id in claimedIds:
    pdfBuffer = await renderRateConPdf(svc, id, tenantId)
    await archivePdfToStorage(svc, tenantId, id, pdfBuffer, 'rate-con')
    attachments.push({
      content: pdfBuffer,
      filename: `rate-con-${chargeSetNumber}.pdf`,
      type: 'application/pdf',
    })
    │
    ▼
await dispatchEmail(svc, {
  tenantId, senderKind: fullConfig.sender_kind,
  fromAddress, // resolveFromAddress (exported from dispatcher)
  to, cc, bcc, subject, html, text, bodyFormat,
  attachments,
  templateId: null,
  configurationId: fullConfig.id,
  sentByUserId: ctx.userId,
  relatedEntity: { type: 'charge_set_rate_con_bulk', id: group_label },
  eventName: 'manual:rate_con_bulk_send',
  // 2a.5 precedence helpers
  config: fullConfig,
  tenant: tenantRow,
})  // returns { message_id }
    │
    ▼
UPDATE order_charge_sets
  SET status = 'rate_con_sent',
      sent_at = now(),
      send_claimed_at = NULL
  WHERE id IN ('a','b','c')
    AND tenant_id = ctx.tenantId
    │
    ▼
Response: { sent: ['a','b','c'], skipped: [], message_id }
```

### Recipient resolution (4-step fallback)

Extracted into `lib/ar/resolve-billing-email.js`:

```javascript
async function resolveBillingEmail(svc, tenantId, customerId, emailType) {
  // 1. type-specific billing email
  const { data: typed } = await svc
    .from('customer_billing_emails')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('email_type', emailType)  // 'rate_confirmation' for this use
    .maybeSingle();
  if (typed?.email) return typed.email;

  // 2. fallback to invoice-typed email (most tenants only set one)
  if (emailType !== 'invoice') {
    const { data: fallback } = await svc
      .from('customer_billing_emails')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('email_type', 'invoice')
      .maybeSingle();
    if (fallback?.email) return fallback.email;
  }

  // 3. legacy customers.billing_email column
  const { data: customer } = await svc
    .from('customers')
    .select('billing_email')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle();
  if (customer?.billing_email) return customer.billing_email;

  // 4. nothing → caller displays needs_edit
  return null;
}
```

Used by:
- `BulkGroupingModal`: when computing groups, it resolves the default recipient per group by calling the helper through a new batch endpoint `GET /api/tenant/ar/resolve-billing-emails?customer_ids=a,b,c&email_type=rate_confirmation` that returns `{ [customer_id]: email | null }`. The queue view receives pre-resolved emails and displays them.
- `bulk-send-rate-con.js`: server-side sanity check — if `recipients.to` is empty in the request, the endpoint does NOT attempt auto-resolution at send time; it returns 400 expecting the modal to have pre-filled it. This keeps the "explicit recipient" guarantee clear.
- `invoices/bulk-send.js`: refactored to use this helper in place of its inline lookup. Behavior unchanged.

### Claim RPC (migration 083)

```sql
-- Add send_claimed_at column for in-flight protection.
ALTER TABLE order_charge_sets
  ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ NULL;

-- Atomic claim: lock + filter in one pass.
CREATE OR REPLACE FUNCTION claim_charge_sets_for_rate_con_send(
  p_charge_set_ids UUID[],
  p_tenant_id UUID
) RETURNS TABLE(id UUID) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  UPDATE order_charge_sets cs
     SET send_claimed_at = now()
   WHERE cs.id = ANY(p_charge_set_ids)
     AND cs.tenant_id = p_tenant_id
     AND cs.send_claimed_at IS NULL
  RETURNING cs.id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_charge_sets_for_rate_con_send TO service_role;
```

Release on success: `UPDATE … SET send_claimed_at=NULL, status='rate_con_sent', sent_at=now() WHERE id IN (...) AND tenant_id = ctx.tenantId`.
Release on failure: `UPDATE … SET send_claimed_at=NULL WHERE id IN (...) AND tenant_id = ctx.tenantId` (no status change).

### Permissions

Endpoint gate:

```javascript
const ALLOWED_PERMS = [
  PERMISSIONS.ORDER_ENTRY,
  PERMISSIONS.DISPATCHING,
  PERMISSIONS.ACCOUNTS_RECEIVABLE,
  PERMISSIONS.ALL,
];
```

Matches the single rate-con send. No new permission added.

### Audit trail

- `dispatchEmail` inserts into `email_messages` with `related_entity: { type: 'charge_set_rate_con_bulk', id: group_label }`. Queue dashboards (future) can filter on this.
- Status transition audit: relies on `order_charge_sets.sent_at` timestamp. Consider adding `order_charge_set_status_history` backfill entry during planning if one exists.
- `email_trigger_log.umbrella_decisions` receives the same `related_entity` payload as 2a.4.

---

## Failure policy

| Failure mode | Behavior |
|---|---|
| Claim RPC returns full subset (none claimed) | Row → `skipped`, response `{ sent: [], skipped: [a,b,c], message: 'already claimed' }`, no email sent, no status change |
| Claim RPC returns partial subset (e.g. 2 of 3 claimed) | **Atomic abort.** Immediately release the partial claim (`UPDATE … SET send_claimed_at=NULL WHERE id IN <claimed>`), no email sent, no status change. Row → `skipped` with error "partial claim, retry." Keeps each group's send all-or-nothing so the operator isn't left reasoning about a 2-of-3 email. |
| PDF render throws for any charge-set in the group | **Atomic abort.** Release claim (`send_claimed_at=NULL`), no email sent, no status change. Row → `failed` with error "PDF render failed for charge-set X." |
| Storage archive throws | Treat as PDF render failure (atomic abort per above) |
| `dispatchEmail` throws before SendGrid accepted | Release claim, no status change, row → `failed` |
| SendGrid accepted (202) but status UPDATE throws | **Inconsistent state allowed.** Email was delivered; row → `failed` with a specific error code. `send_claimed_at` stays set → detected later by a stale-claim sweep (out of scope; tracked below). |
| Other rows in the batch | Continue regardless. Bulk send is not transactional across rows. |

---

## Testing

### Unit tests (new files)

| Test file | Cases |
|---|---|
| `tests/ar/resolve-billing-email.test.mjs` | • rate_confirmation set → returns it<br>• only invoice set → returns invoice via fallback<br>• only legacy billing_email → returns it<br>• none set → returns null<br>• emailType='invoice' does NOT try the invoice fallback (would be redundant) |
| `tests/ar/bulk-rate-con-request.test.mjs` | • empty charge_set_ids → 400<br>• invalid grouping_kind → 400<br>• no recipients.to → 400<br>• tenant mismatch on any charge_set → 403 |

### Reviewer-walked gates (live, post-implementation)

| # | Gate | Success criterion |
|---|---|---|
| 1 | Migration 083 applies | `\d order_charge_sets` shows `send_claimed_at`; `claim_charge_sets_for_rate_con_send(ARRAY[]::UUID[], '<tenant>'::UUID)` returns empty set without error |
| 2 | N=1 parity | Bulk send with 1 charge-set yields an `email_messages` row identical in shape to a single-send (same from_name, reply_to, attachments, related_entity except bulk marker) |
| 3 | Group by customer | 3 charge-sets same customer → 1 email with 3 PDFs; all 3 charge-sets transition to `rate_con_sent`; email_messages row has `related_entity.type='charge_set_rate_con_bulk'` |
| 4 | Group by reference # | 3 charge-sets same `order.reference_number` → 1 email with 3 PDFs |
| 5 | Per charge-set mode | 3 charge-sets → 3 emails, 3 status transitions, 3 `message_id`s |
| 6 | Recipient fallback | Customer A (rate_confirmation set) / B (only invoice set) / C (only billing_email) / D (none) — all resolve correctly; D's row starts `needs_edit` and blocks Send All |
| 7 | Status + concurrency | After Gate 3: `status='rate_con_sent'`, `sent_at IS NOT NULL`, `send_claimed_at IS NULL`. Open a second browser tab, select the same charge-set, attempt bulk send → row → `skipped` |
| 8 | Re-send allowed | Select a `rate_con_sent` charge-set → bulk send succeeds; status stays `rate_con_sent`; new `email_messages` row |
| 9 | **2a.4 invoice regression** | Walk 2a.4's full invoice bulk send (grouping by customer, by ref, per-invoice). Must behave identically to pre-refactor. No UI changes, no behavior drift. |
| 10 | Live delivery | Real rate-con lands in Gmail inbox. DKIM pass. From-name + Reply-To match 2a.5 precedence chain. Attachment opens as valid PDF displaying the rendered rate-con. |

---

## Out of scope / tracked for later

1. **Stale-claim cleanup cron** — any `order_charge_sets` row with `send_claimed_at > 5 minutes old` should be auto-released. Pre-existing gap in 2a.4 too (`invoices.send_claimed_at`). Defer to a shared operational-hygiene task.
2. **Persistent bulk-send queue dashboard** — current `BulkEmailQueue` is one-shot-per-modal. A separate admin view showing historical bulk sends belongs in a future 2a.6+ slot.
3. **2a.4c: bulk re-send from Invoices tab on already-invoiced charge-sets** — own spec.
4. **Order status history entry on rate_con_sent transition** — align with how single-send does this (verify during planning; if missing there too, add to follow-ups rather than bundle here).
5. **Custom rate-con templates per customer / per branch** — tenant-level custom templates are in 2a.8 (document designer). Today's single rate-con template applies.

---

## Open questions

None at this point. All design decisions locked per the brainstorming dialogue.

---

## References

- `docs/superpowers/specs/2026-04-19-email-sender-default-tier-design.md` — 2a.5 sender precedence that this endpoint inherits
- `docs/superpowers/plans/2026-04-20-email-sender-default-tier.md` — 2a.5 plan (reference for gate structure)
- `pages/api/tenant/ar/invoices/bulk-send.js` — 2a.4 reference implementation
- `components/ar/BulkGroupingModal.js`, `components/ar/BulkEmailQueue.js` — 2a.4 shipped UI (to generalize)
- `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js` — single rate-con send (2a.3)
- `lib/pdf/render-rate-con.js` — rate-con PDF renderer (reused as-is)
- `memory/feature_accounts_receivable.md` — AR module architecture
- `memory/feedback_rate_con_no_signature.md` — rate cons confirmed via email reply; no signature block
