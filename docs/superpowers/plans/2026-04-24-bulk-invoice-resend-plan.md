# Bulk Invoice Resend (2a.4c / FU-024) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship bulk-resend-from-Invoices-tab so operators can select multiple already-sent invoices and resend them via the existing grouping modal + queue infrastructure.

**Architecture:** Pattern-copy selection/bulk UI from `BillingPipelineTab.js` into `InvoicesTab.js` (which has none today). Add a narrow `force_resend: true` branch to the existing `/api/tenant/ar/invoices/bulk-send` endpoint that bypasses the claim RPC (which filters out already-sent rows) with a direct UPDATE that filters on `status IN ('sent', 'overdue')` and reuses the same 5-minute `send_claimed_at` freshness mutex. Extend `logManualBulkSend` with a `resend` flag so audit rows discriminate `manual_bulk_resend` from `manual_bulk`. No migration, no new RPC.

**Tech Stack:** Next.js 14 (pages router), React, Supabase (service-role), PostgREST. No test framework in repo — ship verification via Chrome gates per 2a.4 / 2a.4b / driver-planner convention.

**Spec:** [docs/superpowers/specs/2026-04-24-bulk-invoice-resend-design.md](../specs/2026-04-24-bulk-invoice-resend-design.md)

---

## File Structure

**Modify:**
- `lib/email-dispatch/dispatcher.js` — extend `logManualBulkSend` at line 642 with `resend` flag
- `pages/api/tenant/ar/invoices/bulk-send.js` — accept `force_resend`, branch claim + postdispatch + audit call
- `components/ar/BulkEmailQueue.js` — add `mode` prop, thread `force_resend` into fetch body
- `components/ar/InvoicesTab.js` — add selection state, checkbox column, `handleBulkResend`, modal/queue wiring

**Create:**
- `components/ar/InvoicesBulkBar.js` — focused bulk bar (Resend + Deselect + count/total)

**Parallelizable:** Tasks 1, 3, 4, 5 touch disjoint files and can run as concurrent subagents. Task 2 must follow Task 1. Tasks 6, 7, 8 all edit InvoicesTab.js so must be sequential. Tasks 9-10 come last.

---

## Task 1: Extend `logManualBulkSend` with `resend` flag

**Files:**
- Modify: `lib/email-dispatch/dispatcher.js:642-682`

- [ ] **Step 1: Add `resend` to the destructured args and branch `type` + `event_name` + `fire_key`**

Read the current implementation at [dispatcher.js:642](lib/email-dispatch/dispatcher.js:642) to confirm the surrounding shape is unchanged. Then replace the function body with:

```js
export async function logManualBulkSend(svc, args) {
  const {
    tenantId,
    invoiceIds,
    userId,
    groupingKind,
    groupLabel,
    customerId,
    referenceNumber,
    messageId,
    error: dispatchError,
    resend = false,
  } = args;

  const umbrellaDecision = {
    type: resend ? 'manual_bulk_resend' : 'manual_bulk',
    sent_by_user_id: userId,
    invoice_ids: invoiceIds,
    grouping_kind: groupingKind,
    group_label: groupLabel,
    customer_id: customerId,
    reference_number: referenceNumber,
    ...(dispatchError ? { error: dispatchError } : {}),
  };

  const eventName = resend ? 'manual:invoice_bulk_resend' : 'manual:invoice_bulk_send';
  const fireKeyPrefix = resend ? 'manual:invoice_bulk_resend' : 'manual:invoice_bulk';

  const { error: logErr } = await svc.from('email_trigger_log').insert({
    tenant_id: tenantId,
    trigger_id: null,
    event_name: eventName,
    fire_key: `${fireKeyPrefix}:${groupLabel || 'noref'}:${Date.now()}`,
    outcome: dispatchError ? 'errored' : 'fired',
    umbrella_decisions: [umbrellaDecision],
    messages_created: (typeof messageId === 'string' && messageId.length > 0) ? 1 : 0,
    fired_at: new Date().toISOString(),
  });

  if (logErr) {
    console.error('[logManualBulkSend] trigger_log insert failed:', logErr.message);
  }
}
```

- [ ] **Step 2: Verify the file still parses cleanly**

Run: `node --check lib/email-dispatch/dispatcher.js`
Expected: exits 0 with no output (syntax valid).

- [ ] **Step 3: Commit**

```bash
git add lib/email-dispatch/dispatcher.js
git commit -m "feat(email-dispatch): add resend flag to logManualBulkSend"
```

---

## Task 2: Extend `bulk-send.js` endpoint with `force_resend` branch

**Files:**
- Modify: `pages/api/tenant/ar/invoices/bulk-send.js`

**Context:** The existing endpoint calls `claim_invoices_for_send` RPC which silently skips rows where `sent_at IS NOT NULL`. For resend we bypass that RPC with a direct UPDATE filtering on status. Postdispatch must NOT re-stamp `sent_at` (aging preservation). The audit call passes `resend: true`.

- [ ] **Step 1: Accept `force_resend` from the request body**

Find the line:
```js
const { group } = req.body || {};
```
Replace with:
```js
const { group, force_resend = false } = req.body || {};
```

- [ ] **Step 2: Branch the claim stage on `force_resend`**

Find the claim block (around line 75-88 — the `svc.rpc('claim_invoices_for_send', …)` call). Replace it with:

```js
    // ── STAGE: claim ─────────────────────────────────────────────────────────
    // First-send path: claim_invoices_for_send RPC (migration 081).
    // Resend path (force_resend): direct UPDATE that filters on status
    // IN (sent, overdue) and reuses the 5-minute send_claimed_at freshness
    // mutex. Does NOT require sent_at IS NULL (that's the whole point of
    // resend). Skipped rows (wrong status, mid-flight, deleted) appear in
    // skippedIds exactly like the RPC path.
    stage = STAGE.claim;
    let claimRows;
    if (force_resend) {
      const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const nowIso = new Date().toISOString();
      const { data, error: claimErr } = await svc
        .from('invoices')
        .update({ send_claimed_at: nowIso })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .in('id', invoiceIds)
        .in('status', ['sent', 'overdue'])
        .or(`send_claimed_at.is.null,send_claimed_at.lt.${staleCutoff}`)
        .select('id');
      if (claimErr) throw new Error(`resend claim failed: ${claimErr.message}`);
      claimRows = (data ?? []).map((r) => ({ invoice_id: r.id }));
    } else {
      const { data, error: claimErr } = await svc.rpc(
        'claim_invoices_for_send',
        { p_invoice_ids: invoiceIds, p_tenant_id: ctx.tenantId }
      );
      if (claimErr) throw new Error(`claim RPC failed: ${claimErr.message}`);
      claimRows = data;
    }

    claimedIds = (claimRows ?? []).map((r) => r.invoice_id);
    if (claimedIds.length === 0) {
      const err = new Error(
        force_resend
          ? 'No eligible invoices — must be sent or overdue, not currently mid-send'
          : 'All invoices already claimed or sent'
      );
      err.code = 'ALL_CLAIMED';
      throw err;
    }
```

- [ ] **Step 3: Branch the postdispatch update payload on `force_resend`**

Find the postdispatch block (around line 287-299 — the `.update({ sent_at: sentAt, send_claimed_at: null, status: 'sent' })` call). Replace that specific `.update()` call:

```js
    // For resend: do NOT re-stamp sent_at (preserves original send timestamp
    // critical for aging/overdue). Do NOT flip status (already sent/overdue).
    // Only release the claim. For first-send: stamp sent_at + flip status.
    const updatePayload = force_resend
      ? { send_claimed_at: null }
      : { sent_at: sentAt, send_claimed_at: null, status: 'sent' };
    const { error: updErr } = await svc
      .from('invoices')
      .update(updatePayload)
      .eq('tenant_id', ctx.tenantId)
      .in('id', sendableInvoiceIds);
    if (updErr) throw new Error(`sent_at update: ${updErr.message}`);
```

- [ ] **Step 4: Pass `resend: force_resend` to the audit call**

Find the `logManualBulkSend` call (around line 302) and add the `resend` field:

```js
    await logManualBulkSend(svc, {
      tenantId: ctx.tenantId,
      invoiceIds: sendableInvoiceIds,
      userId: ctx.userId,
      groupingKind,
      groupLabel: groupLabel ?? primaryInvoice?.customers?.name ?? primaryInvoice?.customer_id ?? '(group)',
      customerId: primaryInvoice?.customer_id ?? null,
      referenceNumber: null,
      messageId: dispatchResult?.messageId ?? null,
      error: null,
      resend: force_resend,
    });
```

Also update the error-path audit call near the bottom of the file (around line 338-348) so failed resends write the right audit type:

```js
      await logManualBulkSend(svc, {
        tenantId: ctx?.tenantId ?? null,
        invoiceIds: claimedIds,
        userId: ctx?.userId ?? null,
        groupingKind: req.body?.group?.grouping_kind ?? 'customer',
        groupLabel: req.body?.group?.group_label ?? null,
        customerId: null,
        referenceNumber: null,
        messageId: null,
        error: `${stage}: ${err.message}`,
        resend: req.body?.force_resend === true,
      });
```

- [ ] **Step 5: Verify the file still parses cleanly**

Run: `node --check pages/api/tenant/ar/invoices/bulk-send.js`
Expected: exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add pages/api/tenant/ar/invoices/bulk-send.js
git commit -m "feat(ar-bulk-send): accept force_resend to bypass claim RPC"
```

---

## Task 3: Create `InvoicesBulkBar.js`

**Files:**
- Create: `components/ar/InvoicesBulkBar.js`

- [ ] **Step 1: Write the component**

Write to `components/ar/InvoicesBulkBar.js`:

```js
import React from 'react';
import { Mail, X, RefreshCw } from 'lucide-react';

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Focused bulk bar for the Invoices tab. Offers a single action: bulk resend
 * already-sent invoices. Kept separate from the Pipeline tab's BulkActionBar
 * (which carries 5 actions for its multi-status pipeline) so neither caller
 * has to deal with irrelevant buttons or status-based visibility flags.
 *
 * Visual parity with BulkActionBar: same fixed bottom slide-up, same button
 * styling tokens.
 */
export default function InvoicesBulkBar({
  count,
  totalCents,
  bulkAction,      // 'resend' | null
  onResend,
  onClear,
}) {
  if (count === 0) return null;

  const busy = bulkAction != null;
  const btnBase = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
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

      <button type="button" onClick={onResend} disabled={busy} className={primaryBtn}>
        {bulkAction === 'resend' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
        Resend
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

- [ ] **Step 2: Verify syntax**

Run: `node --check components/ar/InvoicesBulkBar.js`
Expected: exits 0 — Node parses JSX-free JS fine (the JSX in this file is compiled by Next.js, but Node accepts it in the .js → node won't fully parse JSX. Skip this check; rely on Next build in Task 9 Chrome gate).

Actually — **skip Step 2**. Node can't parse JSX directly. The check lives in the Chrome-gate build step (Task 9).

- [ ] **Step 3: Commit**

```bash
git add components/ar/InvoicesBulkBar.js
git commit -m "feat(ar): add InvoicesBulkBar component"
```

---

## Task 4: Extend `BulkEmailQueue` with `mode` prop

**Files:**
- Modify: `components/ar/BulkEmailQueue.js` (line 51 component signature, line 207 fetch body)
- Modify: `components/ar/useBulkEmailQueue.js` (hook signature, body composition)

**Context:** The fetch-body composition lives inside `useBulkEmailQueue`, not `BulkEmailQueue`. Both need the `mode` prop/arg, threaded in.

- [ ] **Step 1: Add `mode` prop to `BulkEmailQueue` and pass it to the hook**

In `components/ar/BulkEmailQueue.js` line 51, change the component signature:

Current:
```js
export default function BulkEmailQueue({ groups, groupingKind, docType = 'invoice', onClose, onAllSent }) {
  const {
    rows, updateRow, sendReady, retryFailed,
    readyCount, failedCount, sentCount, needsEditCount, allSent,
  } = useBulkEmailQueue(groups, groupingKind, docType);
```

Change to:
```js
export default function BulkEmailQueue({ groups, groupingKind, docType = 'invoice', mode = 'first-send', onClose, onAllSent }) {
  const {
    rows, updateRow, sendReady, retryFailed,
    readyCount, failedCount, sentCount, needsEditCount, allSent,
  } = useBulkEmailQueue(groups, groupingKind, docType, mode);
```

- [ ] **Step 2: Accept `mode` in the hook and thread it into the fetch body**

In `components/ar/useBulkEmailQueue.js` line 17, change the hook signature:

Current:
```js
export function useBulkEmailQueue(groups, groupingKind, docType = 'invoice') {
```

Change to:
```js
export function useBulkEmailQueue(groups, groupingKind, docType = 'invoice', mode = 'first-send') {
```

Then inside `sendRowsByStatus` (around line 205-236, the `fetch(cfg.sendUrl, …)` call), find the body block:

```js
        body: JSON.stringify({
          group: {
            [cfg.idField]: r.attachments.map((a) => a.item_id ?? a.invoice_id ?? a.charge_set_id),
            recipients: { to: r.to, cc: r.cc, bcc: r.bcc },
            subject: r.subject,
            body_text: r.body_text,
            body_html: r.body_html,
            body_format: r.body_format,
            grouping_kind: groupingKind,
            group_label: r.group.label,
          },
        }),
```

Replace with:

```js
        body: JSON.stringify({
          group: {
            [cfg.idField]: r.attachments.map((a) => a.item_id ?? a.invoice_id ?? a.charge_set_id),
            recipients: { to: r.to, cc: r.cc, bcc: r.bcc },
            subject: r.subject,
            body_text: r.body_text,
            body_html: r.body_html,
            body_format: r.body_format,
            grouping_kind: groupingKind,
            group_label: r.group.label,
          },
          // 2a.4c: resend flag. Only invoice docType currently supports resend;
          // for rate-con it's silently ignored by the endpoint.
          ...(mode === 'resend' ? { force_resend: true } : {}),
        }),
```

Then add `mode` to the `useCallback` deps for `sendRowsByStatus` (around line 261):

Current:
```js
  }, [groupingKind, cfg.sendUrl, cfg.idField]);
```

Change to:
```js
  }, [groupingKind, cfg.sendUrl, cfg.idField, mode]);
```

- [ ] **Step 3: Commit**

```bash
git add components/ar/BulkEmailQueue.js components/ar/useBulkEmailQueue.js
git commit -m "feat(ar): add mode prop to BulkEmailQueue for resend flow"
```

---

## Task 5: Add selection state + helpers to `InvoicesTab.js`

**Files:**
- Modify: `components/ar/InvoicesTab.js`

**Context:** Pattern-copy directly from [BillingPipelineTab.js:37-42, 110-113, 129-160, 122-128](components/ar/BillingPipelineTab.js). We're adding state only; checkbox rendering and handler wiring come in Tasks 6-8.

- [ ] **Step 1: Add imports and new state at the top of the component**

In `components/ar/InvoicesTab.js` line 1-2, update imports:

Current:
```js
import { useEffect, useState } from 'react';
import { Plus, Send, CheckCircle2, XCircle, Search, FileText } from 'lucide-react';
```

Change to:
```js
import { useEffect, useState } from 'react';
import { Plus, Send, CheckCircle2, XCircle, Search, FileText } from 'lucide-react';
import InvoicesBulkBar from './InvoicesBulkBar';
import BulkGroupingModal from './BulkGroupingModal';
import BulkEmailQueue from './BulkEmailQueue';
```

Then find the existing state block (around line 21-33):

```js
  const emailCompose = useEmailCompose();
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Create invoice state
  const [approvedSets, setApprovedSets] = useState([]);
  const [selectedSets, setSelectedSets] = useState([]);
  const [creating, setCreating] = useState(false);
```

Add after it:

```js
  // 2a.4c: bulk resend selection state. Only sent/overdue invoices are
  // selectable. Mirrors BillingPipelineTab's pattern.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [bulkAction, setBulkAction] = useState(null); // 'resend' | null
  const [groupingModalInvoices, setGroupingModalInvoices] = useState(null);
  const [queueState, setQueueState] = useState(null);
```

- [ ] **Step 2: Add selection-clear effect**

Find the existing `useEffect(() => { load(); }, [statusFilter, filters]);` (line 80). Add right after it:

```js
  // Selection is meaningful only within the currently displayed list — when
  // filter/search changes, rows change, so clear selection.
  useEffect(() => {
    setSelectedIds(new Set());
    setLastClickedId(null);
  }, [statusFilter, search, filters]);
```

- [ ] **Step 3: Add derived selection values and toggle helpers**

Find the existing `function toggleSet(id) { … }` (around line 132 — this is for the Create Invoice modal, NOT our bulk flow — don't touch it). Add these helpers right ABOVE `toggleSet` (so they're inside the component body but not inside JSX):

```js
  // 2a.4c: resendable rows are sent or overdue. Drafts have the per-row Send
  // button already; paid/void are never resent.
  const resendableInvoices = invoices.filter(
    (inv) => inv.status === 'sent' || inv.status === 'overdue'
  );
  const visibleResendableIds = resendableInvoices.map((inv) => inv.id);
  const allSelected = visibleResendableIds.length > 0
    && visibleResendableIds.every((id) => selectedIds.has(id));
  const someSelected = visibleResendableIds.some((id) => selectedIds.has(id)) && !allSelected;
  const selectedTotalCents = invoices
    .filter((inv) => selectedIds.has(inv.id))
    .reduce((a, inv) => a + (inv.total_amount_cents || 0), 0);

  function toggleAllResendable() {
    if (allSelected || someSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleResendableIds));
    }
  }

  function toggleResendableRow(invId, event) {
    event.stopPropagation();
    if (event.shiftKey && lastClickedId) {
      const startIdx = visibleResendableIds.indexOf(lastClickedId);
      const endIdx = visibleResendableIds.indexOf(invId);
      if (startIdx >= 0 && endIdx >= 0) {
        const [a, b] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
        const rangeIds = visibleResendableIds.slice(a, b + 1);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of rangeIds) next.add(id);
          return next;
        });
      }
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(invId)) next.delete(invId);
        else next.add(invId);
        return next;
      });
    }
    setLastClickedId(invId);
  }
```

- [ ] **Step 4: Commit**

```bash
git add components/ar/InvoicesTab.js
git commit -m "feat(ar-invoices): add selection state and toggle helpers"
```

---

## Task 6: Add checkbox column to InvoicesTab

**Files:**
- Modify: `components/ar/InvoicesTab.js`

- [ ] **Step 1: Add header checkbox cell**

Find the `<thead>` block (around line 190-201). Add a new `<th>` as the FIRST column inside `<tr>`:

Current:
```jsx
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Invoice #</th>
```

Change to:
```jsx
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAllResendable}
                    disabled={bulkAction != null || visibleResendableIds.length === 0}
                    aria-label="Select all resendable invoices"
                    className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Invoice #</th>
```

- [ ] **Step 2: Update colSpan for the loading/empty states**

The existing loading/empty states use `colSpan={8}` (lines 203-206). Bump to `colSpan={9}`:

Current:
```jsx
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No invoices yet.</td></tr>
              ) : (
```

Change to:
```jsx
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No invoices yet.</td></tr>
              ) : (
```

- [ ] **Step 3: Add the row-level checkbox cell**

Find the `invoices.map((inv) => { … return ( <tr …> )` block (around line 208-256). Inside the `<tr>`, add this as the FIRST `<td>`:

Current:
```jsx
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{inv.invoice_number}</span>
```

Change to:
```jsx
                  const isResendable = inv.status === 'sent' || inv.status === 'overdue';
                  return (
                    <tr
                      key={inv.id}
                      className={`${
                        selectedIds.has(inv.id)
                          ? 'bg-blue-50 dark:bg-blue-950/40'
                          : 'hover:bg-gray-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-3 py-2.5 w-10">
                        {isResendable ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(inv.id)}
                            onChange={(e) => toggleResendableRow(inv.id, e)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={bulkAction != null}
                            aria-label={`Select invoice ${inv.invoice_number || ''}`}
                            className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{inv.invoice_number}</span>
```

Note: the `isResendable` const is declared inside the map callback so each row can decide. Non-resendable rows render an empty `<td className="px-3 py-2.5 w-10" />` (the `{isResendable ? … : null}` branch — the `<td>` itself is still rendered so the grid aligns).

- [ ] **Step 4: Commit**

```bash
git add components/ar/InvoicesTab.js
git commit -m "feat(ar-invoices): add checkbox column for resendable rows"
```

---

## Task 7: Add `handleBulkResend` + modal/queue wiring to InvoicesTab

**Files:**
- Modify: `components/ar/InvoicesTab.js`

- [ ] **Step 1: Add the `handleBulkResend` handler**

Add this function right after `toggleResendableRow` (from Task 5). The function builds items for `BulkGroupingModal` and sets the modal state:

```js
  function handleBulkResend() {
    const selected = invoices.filter((inv) => selectedIds.has(inv.id));
    if (selected.length === 0) return;

    // Items shape for BulkGroupingModal (docType='invoice' path). Field paths
    // mirror the Pipeline tab's handleBulkApproveAndInvoice at
    // BillingPipelineTab.js:277-285. reference_number comes from
    // customer_reference on the order (aliased per convention); the invoices
    // list endpoint exposes it at inv.charge_sets[0].charge_set.order.customer_reference.
    const items = selected.map((inv) => ({
      id: inv.id,
      invoice_id: inv.id,
      customer_id: inv.customer?.id ?? inv.customer_id ?? null,
      customer_name: inv.customer?.name ?? '(unknown customer)',
      reference_number: inv.charge_sets?.[0]?.charge_set?.order?.customer_reference ?? null,
      invoice_number: inv.invoice_number,
      total_cents: inv.total_amount_cents ?? 0,
    }));

    setGroupingModalInvoices(items);
  }
```

- [ ] **Step 2: Render the `InvoicesBulkBar`, `BulkGroupingModal`, and `BulkEmailQueue` components**

Find the closing `</div>` of the main component return (right before the Create Invoice modal block, around line 275 — `{createOpen && (`). Add these three blocks just BEFORE the `EmailComposeSlideOver` component (around line 266):

Find:
```jsx
      <EmailComposeSlideOver
        open={emailCompose.isOpen}
        onClose={emailCompose.close}
        docType={emailCompose.docType}
        contextId={emailCompose.contextId}
        onSent={() => load()}
        onSkipped={() => load()}
      />
```

Add this BEFORE it:

```jsx
      <InvoicesBulkBar
        count={selectedIds.size}
        totalCents={selectedTotalCents}
        bulkAction={bulkAction}
        onResend={handleBulkResend}
        onClear={() => {
          setSelectedIds(new Set());
          setLastClickedId(null);
        }}
      />

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
          mode="resend"
          onClose={() => {
            setQueueState(null);
            setSelectedIds(new Set());
            setLastClickedId(null);
            load();
          }}
          onAllSent={() => {
            setQueueState(null);
            setSelectedIds(new Set());
            setLastClickedId(null);
            load();
          }}
        />
      )}
```

- [ ] **Step 3: Commit**

```bash
git add components/ar/InvoicesTab.js
git commit -m "feat(ar-invoices): wire bulk resend handler and modal/queue"
```

---

## Task 8: Chrome gate — happy path

**Files (verification only, no code changes):**
- None

**Context:** Start the Next.js dev server via `preview_start`, navigate to the AR Invoices tab, and verify the three primary flows listed in the spec. Requires at least 2 sent invoices for the same customer and 2+ for different customers in the test tenant. If the test tenant is bare, use the Pipeline tab to create them first (Approve & Invoice → Send Emails).

- [ ] **Step 1: Start dev server**

Use `preview_start` with the dev command (e.g. `npm run dev`) and wait for the server to be ready.

- [ ] **Step 2: Navigate to AR Invoices tab**

Navigate to `http://localhost:3000/ar` (or the actual AR page path — verify via `preview_snapshot` if uncertain). Click the "Invoices" tab.

- [ ] **Step 3: Gate 1 — same-customer bulk resend**

Select 2 sent invoices belonging to the same customer. Expected behavior:
- Checkboxes visible on both rows.
- Checkboxes NOT visible on draft/paid/void rows (empty checkbox cell).
- `InvoicesBulkBar` appears at bottom with "2 selected · $XX.XX" and a blue "Resend" button.

Click "Resend" → `BulkGroupingModal` opens with both invoices. Choose "Group by customer" → Continue.

`BulkEmailQueue` opens with 1 row (both invoices in one email). Click "Send 1 Ready" → wait for status pill to flip through `sending` → `sent` (amber) → eventually `delivered` (emerald) once SendGrid webhook lands.

Close the modal. Back on the Invoices tab: **both invoices STILL show status='sent'**. This is the core resend assertion — first-send flow would have been a no-op on already-sent rows.

Open email client for the test recipient: 1 new email with 2 PDFs attached.

- [ ] **Step 4: Gate 2 — cross-customer split**

Select 2 sent invoices from DIFFERENT customers. Click Resend → group by customer → Continue. Queue shows 2 rows. Send. 2 emails received, 1 PDF each.

- [ ] **Step 5: Gate 3 — per-invoice grouping**

Select 2 sent invoices (same or different customer). Click Resend → choose "One email per invoice" grouping → Continue. Queue shows 2 rows. Send. 2 separate emails, 1 PDF each.

- [ ] **Step 6: Commit only if anything needed fixing**

If gates 1-3 all passed cleanly, no commit. If a UI bug surfaced, fix it, then:

```bash
git add <fixed files>
git commit -m "fix(ar-invoices): <bug description>"
```

---

## Task 9: Chrome gate — edge cases + audit verification + regression

**Files (verification only):**
- None

- [ ] **Step 1: Gate 4 — audit query**

In a SQL console (Supabase Studio or similar), run:
```sql
SELECT umbrella_decisions->0->>'type' AS type, event_name, fired_at
FROM email_trigger_log
WHERE event_name = 'manual:invoice_bulk_resend'
ORDER BY fired_at DESC LIMIT 5;
```

Expected: rows from Task 8 gates 1-3 appear, each with `type = 'manual_bulk_resend'`. If no rows appear, Tasks 1-2 shipped incorrectly — revisit.

Also verify the first-send flow still writes `manual_bulk`:
```sql
SELECT umbrella_decisions->0->>'type', event_name, fired_at
FROM email_trigger_log
WHERE event_name = 'manual:invoice_bulk_send'
ORDER BY fired_at DESC LIMIT 3;
```
Expected: pre-existing rows with `type = 'manual_bulk'`. If none exist, that's OK — just means no first-sends happened recently.

- [ ] **Step 2: Gate 5 — ineligible-status API probe**

Direct-POST to `/api/tenant/ar/invoices/bulk-send` with `force_resend: true` and an invoice ID mix that includes a `draft` row:

```bash
curl -X POST http://localhost:3000/api/tenant/ar/invoices/bulk-send \
  -H 'Content-Type: application/json' \
  -b '<session cookie>' \
  -d '{
    "group": {
      "invoice_ids": ["<sent-invoice-uuid>", "<draft-invoice-uuid>"],
      "recipients": { "to": ["test@example.com"] },
      "subject": "Probe",
      "body_html": "<p>test</p>",
      "grouping_kind": "customer",
      "group_label": "Probe"
    },
    "force_resend": true
  }'
```

Expected response: `{ "sent": ["<sent-invoice-uuid>"], "skipped": ["<draft-invoice-uuid>"], ... }`. Draft MUST appear in `skipped`, NOT in `sent`.

- [ ] **Step 3: Gate 6 — concurrent-resend mutex**

In the UI, click the Resend button, immediately click it again within 5 seconds (before the first call returns). Expected: the second call returns 409 `ALL_CLAIMED` OR a partial response with the same invoices in `skipped`. No duplicate emails sent.

(If the UI disables the button during `bulkAction != null` and prevents this, construct the race via two browser tabs or two curl calls.)

- [ ] **Step 4: Gate 7 — regression: first-send still works**

On the Billing Pipeline tab: Approve & Invoice a charge set → click Send Emails in the resulting grouping modal → verify an email is sent, the invoice's `sent_at` is stamped, `status='sent'`. This is the existing 2a.4 flow — we must NOT have regressed it.

- [ ] **Step 5: Gate 8 — aging preservation**

Pick an invoice that was already sent (known `sent_at`). Resend it via the bulk flow. Query after:
```sql
SELECT id, sent_at, status FROM invoices WHERE id = '<invoice-uuid>';
```
Expected: `sent_at` is unchanged from its pre-resend value. `status` still `sent` (or `overdue`, whichever it was before).

- [ ] **Step 6: Screenshot proof for the user**

Use `preview_screenshot` to capture:
- The InvoicesBulkBar visible with 2 selected
- The BulkEmailQueue post-send state showing "2 sent"

These will accompany the final PR/ship message.

- [ ] **Step 7: Commit only if any fixes needed**

If all gates passed, no commit. If any fix was needed, commit it.

---

## Task 10: Final ship — squash review + `Resolves: FU-024` commit

**Files:**
- None

- [ ] **Step 1: Review the commit series**

Run `git log --oneline main..HEAD` to list the commits from Tasks 1-9. Expected: 6-8 commits. Inspect each to confirm the message reflects the change.

- [ ] **Step 2: Run dd-qa skill for final review**

Invoke the dd-qa skill to check field consistency, enum alignment, routing logic, UI pattern compliance on the changed files.

- [ ] **Step 3: Confirm no leftover debug / console.log / commented code**

Run:
```bash
git diff main..HEAD -- components/ar/ pages/api/tenant/ar/ lib/email-dispatch/ | grep -E '^\+.*(console\.log|debugger|TODO|XXX|FIXME)'
```
Expected: no output (or only unrelated pre-existing lines).

- [ ] **Step 4: Write the final ship commit message**

The individual Task 1-9 commits already stand on their own. The final ship is just verifying the branch is clean and flagging the follow-up closure. Rather than amend, add an empty-but-annotated tag commit? No — better: just let the series land as-is and add a final note commit:

Actually, the simplest path: amend the LAST commit's body to include `Resolves: FU-024`. But we don't amend. Better: do a single empty-allow commit if needed, OR cherry-pick into main with a squash. Since the brief says "Commit on main with `Resolves: FU-024` in the body" — the cleanest approach is a squash-merge at the end.

If on a worktree/branch: push this branch, open a PR titled `feat(ar): bulk invoice resend (2a.4c / FU-024)`, squash-merge with body:

```
feat(ar): bulk invoice resend from Invoices tab (2a.4c)

- InvoicesTab: checkbox column on sent/overdue rows + selection helpers
- New InvoicesBulkBar with Resend action
- BulkEmailQueue: mode="resend" prop threads force_resend to backend
- bulk-send.js: force_resend branch bypasses claim RPC with direct UPDATE
  (status IN (sent, overdue) + 5-minute send_claimed_at mutex)
- logManualBulkSend: resend flag → umbrella type 'manual_bulk_resend' +
  event_name 'manual:invoice_bulk_resend'
- No migration, no new RPC

Verified: same-customer bulk, cross-customer split, per-invoice grouping,
aging-preservation (sent_at unchanged on resend), audit discrimination,
first-send regression clean.

Resolves: FU-024
```

If committing directly to main locally, the pattern is: after Tasks 1-9 land on the feature branch, merge to main with the above message, then push.

- [ ] **Step 5: Verify ledger closure**

The `update-followups` skill should, on its next run, move FU-024 to Recently Resolved via Case A SHA match on the merge/squash commit. Spot-check:

```bash
# On main after merge:
git log --grep="FU-024" --oneline | head -3
```

Expected: the ship commit is visible. Then running `update-followups` should close FU-024 on its next pass.

---

## Self-Review

**Spec coverage check:**

- Decision 1 (force_resend mechanism) → Task 2 ✓
- Decision 2 (sent + overdue eligibility) → Task 2 (backend `status IN`), Task 5 (frontend `resendableInvoices` filter) ✓
- Decision 3 (manual_bulk_resend audit type) → Task 1, Task 2 Step 4 ✓
- Decision 4 (no last_resent_at column) → not added anywhere ✓
- Decision 5 (hide checkbox on ineligible rows) → Task 6 Step 3 ✓
- Frontend architecture (InvoicesTab changes) → Tasks 5, 6, 7 ✓
- InvoicesBulkBar component → Task 3 ✓
- BulkEmailQueue mode prop → Task 4 ✓
- Data flow (10 stages) → Task 2 covers backend; Task 7 covers frontend wiring ✓
- Error handling (ALL_CLAIMED, CROSS_CUSTOMER, etc.) → all inherited from existing endpoint, unchanged ✓
- Testing gates 1-8 → Tasks 8-9 ✓
- File count summary → matches File Structure section ✓

**Placeholder scan:** No TBD, TODO, or "add appropriate X" phrases. All code steps show complete code. Commands are exact. Expected outputs are specified where relevant.

**Type consistency:**
- `force_resend` (boolean, default false) — consistent across Task 2 backend accept, Task 4 body composition.
- `resend` flag on `logManualBulkSend` — consistent across Task 1 definition, Task 2 callers.
- `mode` prop: `'first-send' | 'resend'` — consistent across Task 4 hook + component.
- `selectedIds` is `Set<string>` everywhere (Tasks 5, 6, 7). 
- `resendableInvoices` / `visibleResendableIds` naming consistent in Task 5 and referenced by Task 6 header/row checkboxes.

No issues found.
