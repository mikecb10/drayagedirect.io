# FU-035-H-shared-test-infra: Test Infrastructure for End-to-End Renderer Smokes — Design Spec

**Status:** ⚠️ **Partially shipped 2026-04-28**
- ✅ **Shipped:** Dynamic-import refactor of 5 AR-family renderers + shared `tests/helpers/mock-supabase.mjs` helper. Establishes pure-JS fetcher path so `fetchXData` is testable from `node --test`.
- ⏭️ **Deferred to FU-035-H-byte-magic:** Byte-magic PDF smoke tests (Tasks 3-8 below). During implementation we discovered that the dynamic-import refactor — while valuable for fetcher-level testing — does NOT enable `renderXPdf` calls under bare `node --test`. When `renderXPdf` is called, it dynamically imports the JSX-bearing `XTemplate` module, which Node's parser still rejects without a JSX transformer. Resolving this requires solving the JSX-transformer problem on this project's setup (see §1.1 for failed approaches; the new follow-up FU enumerates options not yet tried).

The original design below is preserved for reference. Sections §1.1 (transformer rejection rationale) and §3.1-§3.6 (dynamic-import refactor) describe the **shipped** work. Sections §3.4-§3.5 (byte-magic test pattern + per-renderer fixtures) remain accurate design for the deferred FU.

**Author:** Claude (brainstorming session 2026-04-28)
**Predecessor:** FU-035-H6-followup-A (scoped) — established the pure-JS fetcher pattern + first fetcher integration test for Credit Memo

---

## 1. Goal

Enable end-to-end PDF renderer integration tests (byte-magic smoke: `buffer.startsWith('%PDF-')`) under bare `node --test`, without adding any test-time JSX transformer. Achieved by refactoring the 5 remaining AR-family renderers (`render-{invoice,rate-con,combined-invoice,pod,statement}.js`) to dynamic-import their JSX templates inside the public render function — mirroring the pattern already established in `render-credit-memo.js` during FU-035-H6-followup-A.

Once the refactor is in place, every renderer's module can be loaded by a `.test.mjs` file under bare `node --test`, and the byte-magic smoke runs through the full fetcher → composer → React-PDF render pipeline with a representative Supabase fixture.

The byte-magic smoke is the highest-value end-to-end test we can write cheaply: it proves the entire pipeline succeeds for each renderer with realistic data. Catches drift in any layer (query shape, doc shape, composer mapping, template props) that unit tests miss.

## 1.1 Why no JSX transformer

A transformer-based approach was attempted first and abandoned after empirical testing:

- **`@swc-node/register`** plain — only registers a CommonJS hook (`pirates.addHook`). Does not intercept ESM `import` statements. The 5 renderers use ESM `import XTemplate from '../../components/pdf/XTemplate'` syntax which requires an ESM loader hook.
- **`@swc-node/register/esm-register`** — does intercept ESM, but `oxc-resolver@^11` (transitively required) strictly demands `tsconfig.json`. This project uses `jsconfig.json`. Adding `tsconfig.json` would trigger Next.js's auto-TS-detection, with cascading consequences.
- **`tsx`** — broke 74/75 existing test files when applied via `--import tsx/esm`. Module resolution diverged from bare-Node's behavior in ways unrelated to JSX.
- **`esbuild-register`** — primarily a CJS register hook; weaker ESM story than the alternatives.

Rather than fight the transformer ecosystem, **the dynamic-import pattern already validated in `render-credit-memo.js` is the right answer**: it has zero new dependencies, no Next.js config interactions, and a one-time per-call cost (~5-10ms) that's invisible against PDF generation latency.

## 2. Non-Goals (deferred)

- **Full fetcher-shape coverage for the 5 not-yet-tested renderers** (Invoice / Rate Con / Combined Invoice / POD / Statement). Each currently has unit tests at the build-section-data level only; only Credit Memo has fetcher-integration coverage (7 tests at `tests/credit-memo-fetcher-integration.test.mjs`). Adding equivalent shape coverage for the other 5 is its own follow-up if/when needed — not part of this FU.
- **Migrating off `node --test`** to `jest`, `vitest`, or `mocha`. The native test runner remains the framework.
- **Single DO + Bulk DO renderer integration smokes** (`render-delivery-order.js`, `render-bulk-delivery-orders.js`). They're outside the AR/H-series scope; can be filed separately if there's pull.
- **Snapshot testing** (golden PDF binary comparison, pixel diffing). Out of scope; byte-magic + length is enough for this FU.
- **Mocking external services beyond Supabase** (logo fetch, font loading, image embeds). Each renderer's fixture must satisfy whatever non-Supabase I/O it performs; if a renderer crashes on missing logo / font / image, the fixture is expanded to provide it. We do NOT introduce additional mocks for those side channels — fixtures stay declarative.

## 3. Architecture

### 3.1 Dynamic-import refactor pattern

Each of `render-{invoice,rate-con,combined-invoice,pod,statement}.js` is refactored to mirror `render-credit-memo.js` exactly:

**Before:**

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import InvoiceTemplate from '../../components/pdf/InvoiceTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate } from './format-date';

export async function fetchInvoiceData(svc, invoiceId, tenantId) { /* ... pure JS ... */ }

export async function renderInvoicePdf(svc, invoiceId, tenantId) {
  const doc = await fetchInvoiceData(svc, invoiceId, tenantId);
  if (!doc) throw new Error('Invoice not found');
  const sectionConfig = await resolveTemplateConfig(svc, tenantId, doc.bill_to_customer_id, 'invoice');
  return await renderToBuffer(React.createElement(InvoiceTemplate, { doc, sectionConfig }));
}
```

**After:**

```js
// React-PDF + InvoiceTemplate (a JSX-bearing React component) are
// dynamically imported inside renderInvoicePdf so that this module's
// pure-JS fetcher (fetchInvoiceData) can be unit-tested under bare
// `node --test` without a JSX transformer. See
// tests/invoice-fetcher-integration.test.mjs.
import { resolveTemplateConfig } from './resolve-template-config.js';
import { formatDate } from './format-date.js';

export async function fetchInvoiceData(svc, invoiceId, tenantId) { /* ... unchanged ... */ }

export async function renderInvoicePdf(svc, invoiceId, tenantId) {
  // ... peek + delegate logic unchanged ...
  const doc = await fetchInvoiceData(svc, invoiceId, tenantId);
  if (!doc) throw new Error('Invoice not found');
  const sectionConfig = await resolveTemplateConfig(svc, tenantId, doc.bill_to_customer_id, 'invoice');

  const [{ renderToBuffer }, React, { default: InvoiceTemplate }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('react'),
    import('../../components/pdf/InvoiceTemplate'),
  ]);

  return await renderToBuffer(React.createElement(InvoiceTemplate, { doc, sectionConfig }));
}
```

Two changes per file:
1. Remove the three top-level `import` statements (React, React-PDF, the template).
2. Inside the `renderXPdf` function, add a `Promise.all([...])` that dynamic-imports them right before the `renderToBuffer` call.
3. Add `.js` suffixes to remaining internal imports (matches credit-memo's post-refactor convention; ensures consistent module-resolution behavior under bare `node --test`).

Production behavior is **unchanged**: the dynamic imports happen the first time the function is called per process; subsequent calls hit the module cache (microseconds). Cold-start is ~5-10ms one-time. Invisible against PDF generation latency (typically 200-1000ms per document).

### 3.2 Test invocation

Add `package.json` script:

```json
"test": "node --test \"tests/*.test.mjs\""
```

Notes:
- No `--import` flag, no transformer dependency. Bare Node's test runner.
- Glob pattern matches the project's existing `*.test.mjs` convention. No `.test.js` or `.test.ts` files exist.
- No watch / coverage / reporter flags. Keep the script minimal; future extensions can be added incrementally.

### 3.3 Shared mock-Supabase helper

Lift the inline `makeMockSvc` from `tests/credit-memo-fetcher-integration.test.mjs` (lines 31-55) verbatim into a new shared module:

**Path:** `tests/helpers/mock-supabase.mjs` *(creates a new convention: `tests/helpers/` for shared test infrastructure. Documented in the file's top comment for future contributors.)*

**Exported API:**

```js
/**
 * Build a Supabase-shaped client mock for unit tests.
 *
 * @param {Record<string, { data: any, error: any }>} responses
 *   Map from table name to the response object returned by terminal
 *   methods (.maybeSingle()) or returned when the chain is awaited
 *   directly (no terminal). Tables not in the map return
 *   { data: null, error: null }.
 *
 * @returns {object} A mock client supporting:
 *     client.from(table).select(...).eq(...).is(...).maybeSingle()
 *     client.from(table).select(...).in(...).eq(...).is(...)   // awaited directly
 *     client.from(table).select(...).or(...)                   // resolveTemplateConfig path
 *
 * Chain methods returned by the builder: select, eq, in, is, not,
 * gt, lte, order, or. All are no-op pass-throughs returning self.
 */
export function makeMockSvc(responses)
```

The 6 fetcher-integration test files import it: `import { makeMockSvc } from './helpers/mock-supabase.mjs'`. The chain shape extends the credit-memo original by adding `.or()` (used by `resolveTemplateConfig` when a customer-specific template is being looked up).

**No other helpers extracted in this FU.** Fixture data (memo rows, invoice rows, etc.) stays inline per test file because each renderer queries different tables. Premature factoring of fixtures would create coupling without payoff.

### 3.4 Byte-magic smoke pattern (per renderer)

Each renderer's integration test gets one new test of this shape:

```js
test('renderXPdf produces a valid PDF buffer', async () => {
  const svc = makeMockSvc({ /* per-renderer fixture */ });
  const buf = await renderXPdf(svc, /* id */, /* tenantId */);
  assert.ok(Buffer.isBuffer(buf), 'expected a Buffer');
  assert.ok(buf.length > 1000, `PDF buffer too small (${buf.length} bytes)`);
  // %PDF- magic bytes: 0x25 0x50 0x44 0x46 0x2D
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});
```

Three assertions:
1. **Is a Buffer** — defends against accidentally returning a Promise / string / undefined.
2. **Length > 1000 bytes** — defends against an empty / corrupt / minimal-skeleton PDF that technically has the magic bytes but no content. Real PDFs from `@react-pdf/renderer` are typically 5KB+ even for a single-page minimal document.
3. **`%PDF-` magic bytes** — defends against a non-PDF buffer (e.g., a serialized error object).

### 3.5 Per-renderer fixture data

Each renderer queries a different combination of tables. Fixture content per renderer (verified against actual queries during implementation, not just guessed):

| Renderer | Required fixture rows |
|---|---|
| Credit Memo *(existing)* | memo + customer + 2 invoices + tenant + tenant_settings |
| Invoice | invoice + customer + ≥1 charge_set link → order_charge_set → order + ≥1 invoice_charge_line + tenant + tenant_settings |
| Rate Con | order_charge_set (+ joined order + pickup_org + delivery_org + line_items) + moves + events + tenant + tenant_settings |
| Combined Invoice | invoice (consolidated) + customer + ≥2 charge_set links + ≥2 orders + multiple line items grouped by order + tenant + tenant_settings |
| POD | order + customer + ≥1 move + ≥1 deliver event + ≥1 POD document + tenant + tenant_settings |
| Statement | customer + ≥1 open invoice + invoice_charge_sets (for customer_reference) + tenant + tenant_settings |

**Verification step during implementation:** before writing each fixture, read the renderer's full query plan (typically 3-7 `.from(...)` calls). The fixture must satisfy every query. Crashes during the byte-magic test reveal missing fields — iterate.

### 3.6 Zero new dependencies

This FU adds **no** runtime dependencies and **no** devDependencies. The npm test script uses bare `node --test`. The dynamic-import pattern uses Node's native ESM dynamic-import semantics. No transformer, no register hook, no register loader.

---

## 4. File Touch List

### New files

| Path | Purpose |
|---|---|
| `tests/helpers/mock-supabase.mjs` | Shared `makeMockSvc(responses)` helper (extracted from credit-memo test) |
| `tests/invoice-fetcher-integration.test.mjs` | Byte-magic smoke for `renderInvoicePdf` |
| `tests/rate-con-fetcher-integration.test.mjs` | Byte-magic smoke for `renderRateConPdf` |
| `tests/combined-invoice-fetcher-integration.test.mjs` | Byte-magic smoke for `renderCombinedInvoicePdf` |
| `tests/pod-fetcher-integration.test.mjs` | Byte-magic smoke for `renderPodPdf` |
| `tests/statement-fetcher-integration.test.mjs` | Byte-magic smoke for `renderStatementPdf` |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `"test": "node --test \"tests/*.test.mjs\""` to `scripts` block |
| `lib/pdf/render-invoice.js` | Refactor: remove top-level React/React-PDF/InvoiceTemplate imports; dynamic-import them inside `renderInvoicePdf`. Add `.js` suffixes to internal imports. |
| `lib/pdf/render-rate-con.js` | Same refactor with `RateConTemplate` |
| `lib/pdf/render-combined-invoice.js` | Same refactor with `CombinedInvoiceTemplate` |
| `lib/pdf/render-pod.js` | Same refactor with `PodTemplate` |
| `lib/pdf/render-statement.js` | Same refactor with `StatementTemplate` |
| `tests/credit-memo-fetcher-integration.test.mjs` | Replace inline `makeMockSvc` with `import` from helper module; add 1 new test (`renderCreditMemoPdf produces a valid PDF buffer`) |

**Total:** 6 new files + 7 modified = **13 files touched**.

---

## 5. Verification & Risks

### 5.1 Verification plan

1. **Bare `npm test` works:** `npm test` runs without any transformer flags; invokes `node --test "tests/*.test.mjs"`.
2. **No regression in 83 existing test files:** all current tests pass (modulo the pre-existing `fire-trigger-entity-aware.test.mjs` failure documented in the H6 handoff).
3. **Refactored renderers still produce valid PDFs in production-like calls:** the byte-magic smoke tests exercise this path. Each refactor + smoke is verified together (RED-then-GREEN).
4. **New byte-magic tests pass — RED first, GREEN after:**
   - For each new test file: write the test before its fixture is complete; expect it to crash with a "cannot read property X of null" error from inside the React-PDF template.
   - Iterate on the fixture until the test passes (proving every required field is fixtured).
5. **Final state:** `npm test` reports all tests passing including 6 byte-magic smokes.

### 5.2 Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hidden non-Supabase I/O (logo fetch, font load, image embed) crashes the byte-magic test | Medium | Read each renderer end-to-end before writing its fixture. If a renderer fetches a remote logo or font, either expand the fixture's `tenant_settings.logo_url` to a known-safe placeholder or mock the I/O. |
| Dynamic-import refactor changes production behavior in subtle ways | Low | The `await` semantics are equivalent — `Promise.all([static-imported])` resolves identically to `Promise.all([dynamic-imported])` once cached. The only observable difference is first-call latency (+5-10ms one time). Verify via existing PDF download endpoints during a manual smoke after Task 1 lands. |
| Refactoring the renderer changes the order of operations and breaks consolidated-invoice delegation | Medium | `render-invoice.js` does a `peek` query then delegates to `render-combined-invoice.js` if `is_consolidated`. The delegate-call site is BEFORE the new dynamic-import block, so unaffected. Verify via test in Task 4. |
| Templates that crash on minimal data | Medium-High | Byte-magic test catches this (good — that's the value!) but means each fixture must cover all required-non-null fields. Each iteration is fast. |
| `node --test` glob semantics differ between OS shells | Low | Quoting `"tests/*.test.mjs"` ensures consistent behavior; Node's `--test` parses the pattern itself rather than relying on shell expansion. Existing 83 tests already exercise this. |

### 5.3 Rollback plan

If the dynamic-import refactor proves unworkable mid-implementation (highly unlikely — credit-memo already uses this pattern in production):
1. Revert the renderer-file diffs (5 files).
2. The `tests/helpers/mock-supabase.mjs` and `npm test` script can stay — they're pure additions.
3. Reassess: was a transformer the wrong choice or just imperfect? Re-attempt the transformer path with `tsconfig.json` shim + `@swc-node/register/esm-register`.

---

## 6. Implementation Sequencing

Single-session, inline (no subagent dispatch needed for individual tasks). 13 files; small enough that subagent overhead exceeds direct-edit speed (handoff-noted convention). Subagent dispatch is still used for spec + code-quality review of each task.

Suggested order:

1. **Refactor + bare test script** (NEW Task 1) — refactor 5 renderers + add `npm test` script. Run all 83 existing tests to confirm no regression.
2. **Helper extraction** (Task 2) — create `tests/helpers/mock-supabase.mjs`. Refactor `tests/credit-memo-fetcher-integration.test.mjs` to import from it.
3. **Credit Memo byte-magic** (Task 3) — add 1 new test. First proof the dynamic-import path lets `renderToBuffer(<JSX>)` run under bare `node --test`.
4. **Invoice → Rate Con → Combined → POD → Statement** (Tasks 4-8) — one renderer at a time. For each: write the test file with skeleton fixture, run it expecting RED, expand fixture to GREEN, commit.
5. **Final verification + ledger update** (Task 9).

Expected commit count: ~9 (1 per task).

---

## 7. Success Criteria

### Shipped (this FU)

- [x] No new devDependencies added (`package.json` `devDependencies` block unchanged).
- [x] `npm test` script exists and uses bare `node --test`.
- [x] All 83 pre-existing test files continue to pass (only the documented `fire-trigger-entity-aware.test.mjs` baseline failure remains).
- [x] All 5 of `lib/pdf/render-{invoice,rate-con,combined-invoice,pod,statement}.js` use the dynamic-import pattern for React + React-PDF + their respective `XTemplate`.
- [x] `tests/helpers/mock-supabase.mjs` exists and is imported by `tests/credit-memo-fetcher-integration.test.mjs`.
- [x] Followups.md ledger updated: `FU-035-H-shared-test-infra` marked Resolved with this scope; new `FU-035-H-byte-magic` filed for deferred work.

### Deferred (FU-035-H-byte-magic)

- [ ] All 6 renderer fetcher-integration test files contain a byte-magic smoke test that passes.
- [ ] Total test files: 83 existing + 5 new = 88 test files, all green. (Currently: 83 existing only — Tasks 4-8 not implemented.)
- [ ] `FU-035-H6-followup-A` marked fully resolved (the remaining ~10% byte-magic gap remains open until this FU lands).
