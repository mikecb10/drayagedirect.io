# AR Filter Bar Phase C — Rate-Con-Sent + Invoice-Email-Sent Y/N

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two boolean "has-been-sent" filters — **Is Rate Confirmation Sent** (Billing only, charge-set-level) and **Is Invoice Email Sent** (Invoices only, invoice-level) — each as a 3-pill Y/N/All toggle mirroring Phase B4's Factor Company pattern.

**Architecture:** Neither signal is a direct column; both derive from `email_trigger_log` rows produced by the manual-send pipelines (Phase 2a.x email work). Each endpoint runs a secondary query against `email_trigger_log` to collect the Set of "ever-sent" entity IDs, then filters rows accordingly. Per-section `SECTION_KEYS` scoping ensures rate-con-sent appears only on Billing and invoice-email-sent only on Invoices — no sidebar clutter. Load Margin % is explicitly deferred; this plan closes out the remaining "sent?" dimensions.

**Tech Stack:** Next.js pages/api, Supabase, React. Reuses Phase B4's Y/N pill pattern. No migration — `email_trigger_log` rows already populate on every send.

---

## File Structure

**Backend:**
- Modify: `lib/ar-filter-schema.js` (add 2 new keys to `ALL_B2_KEYS`, narrow SECTION_KEYS appropriately)
- Modify: `lib/ar-filter-params.js` (extend `STRING_KEYS`)
- Modify: `pages/api/tenant/ar/index.js` (fetch sent charge-set IDs, apply filter)
- Modify: `pages/api/tenant/ar/invoices/index.js` (fetch sent invoice IDs, apply filter)

**Frontend:**
- Modify: `components/ar/FilterSidebar.js` (2 new 3-pill sections)
- Modify: `components/ar/ArFiltersBar.js` (extend `filtersMatch` + `filtersAreEmpty`)
- Modify: `components/ar/BillingPipelineTab.js` + `components/ar/InvoicesTab.js` (forward new params)

**Tests:**
- Modify: `tests/ar-filter-params.test.mjs` (2 new assertions)

---

## Conventions

1. **Key names + values**:
   - `rate_con_sent_y`: string 'yes' | 'no' (Billing only)
   - `invoice_email_sent_y`: string 'yes' | 'no' (Invoices only)
2. **`email_trigger_log` query signals** — confirmed patterns from Phase 2a.x:
   - Rate con events: `event_name IN ('manual:rate_con_send', 'manual:rate_con_bulk_send')`; charge_set IDs live in `umbrella_decisions[0].related_entity.id` (single) or `umbrella_decisions[0].charge_set_ids[]` (bulk). Filter on `outcome !== 'errored'` to exclude failed sends.
   - Invoice events: `event_name IN ('manual:invoice_send', 'manual:invoice_bulk_send')`; invoice IDs in `umbrella_decisions[0].related_entity.id` (single) or `umbrella_decisions[0].invoice_ids[]` (bulk). Same outcome filter.
3. **Per-section scoping**: `billing` SECTION_KEYS gains `rate_con_sent_y` only; `invoices` gains `invoice_email_sent_y` only.
4. **Y/N semantics**: 'yes' → entity IS in the sent set; 'no' → entity is NOT in the sent set (never been sent).
5. **Performance**: the email_trigger_log query only runs when the relevant filter is active, avoiding per-request overhead.

---

## Task 1: Schema + sanitizer + tests

**Files:**
- Modify: `lib/ar-filter-schema.js`
- Modify: `lib/ar-filter-params.js`
- Modify: `tests/ar-filter-params.test.mjs`

- [ ] **Step 1: Append keys to `ALL_B2_KEYS`**

In `lib/ar-filter-schema.js`, find the `const ALL_B2_KEYS = [...]` array (29 entries). APPEND just before the closing `];`:

```javascript
  // Phase C: "is X sent?" Y/N filters
  'rate_con_sent_y',
  'invoice_email_sent_y',
```

- [ ] **Step 2: Narrow SECTION_KEYS per section**

Find the `SECTION_KEYS` object. `billing` and `invoices` currently map to `ALL_B2_KEYS`. To scope rate_con_sent_y to billing only and invoice_email_sent_y to invoices only, change the mappings to:

```javascript
const SECTION_KEYS = {
  // Billing gets every key EXCEPT invoice_email_sent_y (charge-set-level; no invoice email concept)
  billing:  ALL_B2_KEYS.filter((k) => k !== 'invoice_email_sent_y'),
  // Invoices gets every key EXCEPT rate_con_sent_y (invoice-level; rate cons are per-charge-set)
  invoices: ALL_B2_KEYS.filter((k) => k !== 'rate_con_sent_y'),
  apply_payments: [],
  payments:       ['customer_ids', 'customer_ids_exclude', 'from', 'to', 'reference_number'],
  credit_memos:   ['customer_ids', 'customer_ids_exclude', 'from', 'to'],
  aging:          ['customer_ids', 'customer_ids_exclude', 'invoiced_from', 'invoiced_to'],
};
```

- [ ] **Step 3: Write the failing tests**

In `tests/ar-filter-params.test.mjs`, find the final summary `console.log` line. INSERT before it:

```javascript
console.log('\nsanitizeFilterSet (Phase C keys)');
check('keeps rate_con_sent_y yes',
  JSON.stringify(sanitizeFilterSet({ rate_con_sent_y: 'yes' })) === '{"rate_con_sent_y":"yes"}');
check('keeps rate_con_sent_y no',
  JSON.stringify(sanitizeFilterSet({ rate_con_sent_y: 'no' })) === '{"rate_con_sent_y":"no"}');
check('keeps invoice_email_sent_y yes',
  JSON.stringify(sanitizeFilterSet({ invoice_email_sent_y: 'yes' })) === '{"invoice_email_sent_y":"yes"}');
check('drops empty rate_con_sent_y',
  JSON.stringify(sanitizeFilterSet({ rate_con_sent_y: '' })) === '{}');
```

- [ ] **Step 4: Run tests → 4 new fail**

```bash
node tests/ar-filter-params.test.mjs
```

Expected: 42 pass, 4 fail.

- [ ] **Step 5: Extend `STRING_KEYS` in `lib/ar-filter-params.js`**

Find `const STRING_KEYS = [ ... ];`. APPEND the two new keys:

```javascript
const STRING_KEYS = [
  'from',
  'to',
  'reference_number',
  'invoiced_from',
  'invoiced_to',
  'factor_company',
  // Phase C: "is X sent?" Y/N filters
  'rate_con_sent_y',
  'invoice_email_sent_y',
];
```

- [ ] **Step 6: Run tests → all pass**

```bash
node tests/ar-filter-params.test.mjs
```

Expected: `46 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add lib/ar-filter-schema.js lib/ar-filter-params.js tests/ar-filter-params.test.mjs
git commit -m "feat(ar): extend schema + sanitizer for Phase C keys"
```

---

## Task 2: AR pipeline endpoint — rate_con_sent_y

**Files:**
- Modify: `pages/api/tenant/ar/index.js`

- [ ] **Step 1: Parse the new param**

AFTER the existing Phase B4 parse block (ending with `const { factor_company } = req.query;`), add:

```javascript
  // Phase C: rate-con-sent Y/N
  const { rate_con_sent_y } = req.query;
```

- [ ] **Step 2: Query email_trigger_log + apply filter**

AFTER all existing Phase B4 filters (the factor_company block) and BEFORE the `// Compute counts` comment, INSERT:

```javascript
  // ── Phase C: rate-con-sent Y/N ─────────────────────────────────────
  // Signal comes from email_trigger_log rows with event_name in the
  // manual rate_con_send events. Single sends stash the charge_set ID
  // at umbrella_decisions[0].related_entity.id; bulk sends stash an
  // array at umbrella_decisions[0].charge_set_ids.
  if (rate_con_sent_y === 'yes' || rate_con_sent_y === 'no') {
    const { data: logRows } = await svc
      .from('email_trigger_log')
      .select('event_name, umbrella_decisions, outcome')
      .eq('tenant_id', ctx.tenantId)
      .in('event_name', ['manual:rate_con_send', 'manual:rate_con_bulk_send'])
      .neq('outcome', 'errored');

    const sentChargeSetIds = new Set();
    for (const row of logRows || []) {
      const decisions = Array.isArray(row.umbrella_decisions) ? row.umbrella_decisions : [];
      for (const d of decisions) {
        if (d?.related_entity?.type?.startsWith('charge_set') && d.related_entity.id) {
          // Single send: related_entity.id may be a comma-joined list for bulk
          // (see bulk-send-rate-con.js). Split defensively.
          for (const id of String(d.related_entity.id).split(',')) {
            const trimmed = id.trim();
            if (trimmed) sentChargeSetIds.add(trimmed);
          }
        }
        if (Array.isArray(d?.charge_set_ids)) {
          for (const id of d.charge_set_ids) {
            if (id) sentChargeSetIds.add(id);
          }
        }
      }
    }

    if (rate_con_sent_y === 'yes') {
      scopedSets = scopedSets.filter((cs) => sentChargeSetIds.has(cs.id));
    } else {
      scopedSets = scopedSets.filter((cs) => !sentChargeSetIds.has(cs.id));
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/ar/index.js
git commit -m "feat(ar): AR pipeline endpoint applies rate_con_sent_y filter"
```

---

## Task 3: AR invoices endpoint — invoice_email_sent_y

**Files:**
- Modify: `pages/api/tenant/ar/invoices/index.js`

- [ ] **Step 1: Parse the new param**

Inside the GET branch, AFTER the Phase B4 `const { factor_company } = req.query;` line, add:

```javascript
    // Phase C: invoice-email-sent Y/N
    const { invoice_email_sent_y } = req.query;
```

- [ ] **Step 2: Query email_trigger_log + apply filter**

AFTER the existing Phase B4 `hasChargeSetFilters` block (and any invoiced-date filter that comes after), INSERT:

```javascript
    // ── Phase C: invoice-email-sent Y/N ────────────────────────────────
    // Signal from email_trigger_log event_name in manual invoice send events.
    // Single sends stash invoice ID at umbrella_decisions[0].related_entity.id;
    // bulk sends stash the array at umbrella_decisions[0].invoice_ids.
    if (invoice_email_sent_y === 'yes' || invoice_email_sent_y === 'no') {
      const { data: logRows } = await svc
        .from('email_trigger_log')
        .select('event_name, umbrella_decisions, outcome')
        .eq('tenant_id', ctx.tenantId)
        .in('event_name', ['manual:invoice_send', 'manual:invoice_bulk_send'])
        .neq('outcome', 'errored');

      const sentInvoiceIds = new Set();
      for (const row of logRows || []) {
        const decisions = Array.isArray(row.umbrella_decisions) ? row.umbrella_decisions : [];
        for (const d of decisions) {
          if (d?.related_entity?.type === 'invoice' && d.related_entity.id) {
            for (const id of String(d.related_entity.id).split(',')) {
              const trimmed = id.trim();
              if (trimmed) sentInvoiceIds.add(trimmed);
            }
          }
          if (Array.isArray(d?.invoice_ids)) {
            for (const id of d.invoice_ids) {
              if (id) sentInvoiceIds.add(id);
            }
          }
        }
      }

      if (invoice_email_sent_y === 'yes') {
        filtered = filtered.filter((inv) => sentInvoiceIds.has(inv.id));
      } else {
        filtered = filtered.filter((inv) => !sentInvoiceIds.has(inv.id));
      }
    }
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/ar/invoices/index.js
git commit -m "feat(ar): invoices endpoint applies invoice_email_sent_y filter"
```

---

## Task 4: ArFiltersBar match/empty

**Files:**
- Modify: `components/ar/ArFiltersBar.js`

- [ ] **Step 1: Extend `filtersMatch`**

Find the function at the bottom of the file. Add these two lines to the return expression (just before the closing `);` — after the existing `(a.factor_company ...) === (b.factor_company ...)`):

```javascript
    (a.rate_con_sent_y ?? '') === (b.rate_con_sent_y ?? '') &&
    (a.invoice_email_sent_y ?? '') === (b.invoice_email_sent_y ?? '')
```

(Remove the trailing `&&` from the previous line if it now chains into the new lines — ensure the final comparison has no trailing `&&`.)

- [ ] **Step 2: Extend `filtersAreEmpty`**

Find the existing `filtersAreEmpty` block. Just before its closing `)` (after the `!(currentFilters.factor_company === 'yes' || currentFilters.factor_company === 'no')` line), append:

```javascript
      && !(currentFilters.rate_con_sent_y === 'yes' || currentFilters.rate_con_sent_y === 'no')
      && !(currentFilters.invoice_email_sent_y === 'yes' || currentFilters.invoice_email_sent_y === 'no')
```

(Adjust the `&&` chaining so the final expression is syntactically clean — typically means moving the `&&` from the end of the old final line to the beginning of the new lines, as shown.)

- [ ] **Step 3: Commit**

```bash
git add components/ar/ArFiltersBar.js
git commit -m "feat(ar): ArFiltersBar covers Phase C keys"
```

---

## Task 5: FilterSidebar — 2 new Y/N sections

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`
- Modify: `components/ar/InvoicesTab.js`

- [ ] **Step 1: Update `EMPTY`**

Append two new keys to the `EMPTY` constant:

```javascript
  rate_con_sent_y: '',
  invoice_email_sent_y: '',
```

- [ ] **Step 2: Render the 2 sections AFTER Factor Company section**

Find the Factor Company section (gated by `showKey('factor_company')`). IMMEDIATELY AFTER its closing `)}`, INSERT:

```jsx
          {/* Rate Confirmation Sent — Billing only */}
          {showKey('rate_con_sent_y') && (
            <section>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Rate confirmation sent</label>
              <div className="inline-flex rounded-md border border-gray-200 dark:border-slate-700 overflow-hidden">
                {[
                  { value: '',    label: 'All' },
                  { value: 'yes', label: 'Sent' },
                  { value: 'no',  label: 'Not sent' },
                ].map((opt, i) => {
                  const active = (draft.rate_con_sent_y ?? '') === opt.value;
                  return (
                    <button
                      key={opt.value || 'all'}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, rate_con_sent_y: opt.value }))}
                      className={`px-3 py-1 text-xs font-semibold ${i > 0 ? 'border-l border-gray-200 dark:border-slate-700' : ''} ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Invoice Email Sent — Invoices only */}
          {showKey('invoice_email_sent_y') && (
            <section>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Invoice email sent</label>
              <div className="inline-flex rounded-md border border-gray-200 dark:border-slate-700 overflow-hidden">
                {[
                  { value: '',    label: 'All' },
                  { value: 'yes', label: 'Sent' },
                  { value: 'no',  label: 'Not sent' },
                ].map((opt, i) => {
                  const active = (draft.invoice_email_sent_y ?? '') === opt.value;
                  return (
                    <button
                      key={opt.value || 'all'}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, invoice_email_sent_y: opt.value }))}
                      className={`px-3 py-1 text-xs font-semibold ${i > 0 ? 'border-l border-gray-200 dark:border-slate-700' : ''} ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
```

- [ ] **Step 3: Extend Apply handler**

After the existing factor_company forward, add:

```javascript
                if (draft.rate_con_sent_y === 'yes' || draft.rate_con_sent_y === 'no') {
                  cleaned.rate_con_sent_y = draft.rate_con_sent_y;
                }
                if (draft.invoice_email_sent_y === 'yes' || draft.invoice_email_sent_y === 'no') {
                  cleaned.invoice_email_sent_y = draft.invoice_email_sent_y;
                }
```

- [ ] **Step 4: Extend `activeCount`**

Add two lines next to the existing factor_company tally:

```javascript
    (draft.rate_con_sent_y === 'yes' || draft.rate_con_sent_y === 'no' ? 1 : 0) +
    (draft.invoice_email_sent_y === 'yes' || draft.invoice_email_sent_y === 'no' ? 1 : 0) +
```

- [ ] **Step 5: Forward in both tabs**

In `components/ar/BillingPipelineTab.js`, after the factor_company forward, add:

```javascript
if (filters.rate_con_sent_y === 'yes' || filters.rate_con_sent_y === 'no') params.set('rate_con_sent_y', filters.rate_con_sent_y);
```

In `components/ar/InvoicesTab.js`, after the factor_company forward, add:

```javascript
if (filters.invoice_email_sent_y === 'yes' || filters.invoice_email_sent_y === 'no') params.set('invoice_email_sent_y', filters.invoice_email_sent_y);
```

(Note: rate_con_sent_y is ONLY forwarded by the Billing tab — Invoices would never render it per SECTION_KEYS. Invoice_email_sent_y is ONLY forwarded by the Invoices tab. This avoids sending params that the endpoint won't use.)

- [ ] **Step 6: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Rate Con Sent + Invoice Email Sent Y/N"
```

---

## Task 6: E2E verification

**Files:** none — smoke test only.

- [ ] **Step 1: Run tests**

```bash
node tests/ar-filter-params.test.mjs
```

Expected: `46 passed, 0 failed`.

- [ ] **Step 2: Manual gates walkthrough**

On Billing → open Filters → find "Rate confirmation sent" 3-pill (All / Sent / Not sent). Not visible on other sections.
On Invoices → open Filters → find "Invoice email sent" 3-pill. Not visible on Billing.
Click "Sent" on each → fetch includes `rate_con_sent_y=yes` or `invoice_email_sent_y=yes`.

- [ ] **Step 3: No commit** — verification only.

---

## Live Gates

- **Gate 1** — Tests: `46 passed, 0 failed`
- **Gate 2** — On Billing, sidebar shows "Rate confirmation sent" 3-pill; on Invoices, sidebar shows "Invoice email sent" 3-pill
- **Gate 3** — On Invoices, sidebar does NOT show "Rate confirmation sent" (section-scoped)
- **Gate 4** — On Billing, sidebar does NOT show "Invoice email sent"
- **Gate 5** — Click "Sent" on Rate Con → Billing fetch includes `rate_con_sent_y=yes`, rows narrow to charge sets that have a non-errored rate-con send log
- **Gate 6** — Click "Not sent" on Rate Con → fetch includes `rate_con_sent_y=no`, rows narrow to charge sets that have NO rate-con send log
- **Gate 7** — Click "Sent" on Invoice Email (Invoices tab) → Invoices fetch includes `invoice_email_sent_y=yes`
- **Gate 8** — Save a tab with both filters set (one rate_con_sent, one invoice_email_sent) on each respective section → reload → re-applies correctly on each tab
- **Gate 9** — Cross-section: save "QA Phase C" on Billing → switch to Invoices → tab visible, rate_con_sent_y is silently ignored by Invoices endpoint (doesn't error)
- **Gate 10** — Dark-mode audit on the 2 new 3-pill sections

---

## Self-Review

**Spec coverage**
- Rate con sent Y/N: ✅ Tasks 1, 2, 5 (UI + endpoint + schema)
- Invoice email sent Y/N: ✅ Tasks 1, 3, 5
- ArFiltersBar: ✅ Task 4
- Per-section scoping: ✅ Task 1 (SECTION_KEYS narrowed via `.filter(...)`)
- Tests: ✅ Task 1 (46/46)

**Placeholder scan** — concrete code + bash throughout.

**Type consistency**
- Both keys are `STRING_KEYS` ('yes' | 'no' | '')
- UI pattern identical to Factor Company (Phase B4)
- Endpoint Set-lookup pattern mirrored for both (charge_set_id vs invoice_id)
- event_name list matches what the existing manual-send endpoints emit

**Load Margin % explicitly deferred** — no mention in this plan's tasks.
