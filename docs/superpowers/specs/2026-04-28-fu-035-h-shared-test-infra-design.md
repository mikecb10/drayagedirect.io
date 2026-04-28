# FU-035-H-shared-test-infra: JSX-Transform Test Utility — Design Spec

**Status:** Draft → user review pending
**Author:** Claude (brainstorming session 2026-04-28)
**Predecessor:** FU-035-H6-followup-A (scoped) — established the pure-JS fetcher pattern + first fetcher integration test for Credit Memo

---

## 1. Goal

Add a JSX-aware test runner to the project so that PDF renderer modules — which statically import React-PDF templates (`import InvoiceTemplate from '../../components/pdf/InvoiceTemplate'`) — can be loaded and exercised by `node --test`. Then prove the new infra works end-to-end by adding a byte-magic smoke assertion (`buffer.startsWith('%PDF-')`) to all 6 PDF renderer integration tests.

The byte-magic smoke is the highest-value end-to-end test we can write cheaply: it proves that the fetcher → composer → React-PDF render pipeline succeeds for each renderer with a representative fixture. Catches drift in any layer (query shape, doc shape, composer mapping, template props) that unit tests miss.

## 2. Non-Goals (deferred)

- **Full fetcher-shape coverage for the 5 not-yet-tested renderers** (Invoice / Rate Con / Combined Invoice / POD / Statement). Each currently has unit tests at the build-section-data level only; only Credit Memo has fetcher-integration coverage (7 tests at `tests/credit-memo-fetcher-integration.test.mjs`). Adding equivalent shape coverage for the other 5 is its own follow-up if/when needed — not part of this FU.
- **Migrating off `node --test`** to `jest`, `vitest`, or `mocha`. The native test runner remains the framework.
- **Single DO + Bulk DO renderer integration smokes** (`render-delivery-order.js`, `render-bulk-delivery-orders.js`). They're outside the AR/H-series scope; can be filed separately if there's pull.
- **Snapshot testing** (golden PDF binary comparison, pixel diffing). Out of scope; byte-magic + length is enough for this FU.
- **Mocking external services beyond Supabase** (logo fetch, font loading, image embeds). Each renderer's fixture must satisfy whatever non-Supabase I/O it performs; if a renderer crashes on missing logo / font / image, the fixture is expanded to provide it. We do NOT introduce additional mocks for those side channels — fixtures stay declarative.

## 3. Architecture

### 3.1 JSX transformer choice

Standardize on **`@swc-node/register`**. Rationale:

- Next.js 15 (the framework in use) already runs SWC under the hood for TS/JSX. Reusing the same transformer means no second toolchain to reason about — same JSX rules, same output, same edge cases.
- One-flag invocation: `node --import @swc-node/register --test ...`.
- Pinned version (`^1.x`) avoids surprise upgrades.

Alternative considered: `esbuild-register`. Equally capable but introduces esbuild as a separate transform path. Rejected to keep the toolchain count minimal.

### 3.2 Test invocation

Add `package.json` script:

```json
"test": "node --import @swc-node/register --test tests/*.test.mjs"
```

Notes:
- The `--import` flag (Node ≥ 20.6) registers the transformer before any test loads. Pre-existing tests that don't touch JSX get a no-op transform; cost is one-time SWC boot (~200-400ms). Acceptable.
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
 *
 * Chain methods returned by the builder: select, eq, in, is, not,
 * gt, lte, order. All are no-op pass-throughs that return the same
 * builder object. Add more here if a renderer's query introduces them.
 */
export function makeMockSvc(responses)
```

The 6 fetcher-integration test files import it: `import { makeMockSvc } from './helpers/mock-supabase.mjs'`.

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
| Invoice | invoice + customer + ≥1 charge_set link → order_charge_set → order + ≥1 invoice_charge line + tenant + tenant_settings |
| Rate Con | order + customer + carrier (if joined) + tenant + tenant_settings + (charges/lines if Rate Con composes them — verify on read) |
| Combined Invoice | invoice (consolidated) + customer + ≥2 charge_set links + ≥2 orders + multiple charges + tenant + tenant_settings |
| POD | order + customer + ≥1 routing event + ≥1 POD document/asset + tenant + tenant_settings + (driver if joined) |
| Statement | customer + ≥1 open invoice + (≥1 payment if Statement composes them) + tenant + tenant_settings |

**Verification step during implementation:** before writing each fixture, read the renderer's full query plan (typically 3-7 `.from(...)` calls). The fixture must satisfy every query. Crashes during the byte-magic test reveal missing fields — iterate.

### 3.6 No new dependencies beyond `@swc-node/register`

`@swc-node/register@^1.x` is the only new devDependency. Its peer `@swc/core` is bundled. No additional `@types/...`, no test-runner plugins, no babel/postcss extras.

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
| `package.json` | Add `@swc-node/register@^1.x` to devDependencies; add `"test"` script |
| `tests/credit-memo-fetcher-integration.test.mjs` | Replace inline `makeMockSvc` with `import` from helper module; add 1 new test (`renderCreditMemoPdf produces a valid PDF buffer`) |

**Total:** 6 new files + 2 modified = **8 files touched**.

---

## 5. Verification & Risks

### 5.1 Verification plan

1. **Install + scripted invocation works:** `npm install` succeeds; `npm test` runs without "JSX is not parseable" errors.
2. **No regression in 83 existing test files:** all current `tests/*.test.mjs` files pass through the new transformed-import path. SWC's transformer is a no-op for non-JSX modules — if any existing test breaks, it's a real change to investigate.
3. **New byte-magic tests pass — RED first, GREEN after:**
   - For each new test file: write the test before its fixture is complete; expect it to crash with a "cannot read property X of null" error from inside the React-PDF template.
   - Iterate on the fixture until the test passes (proving every required field is fixtured).
4. **Final state:** `npm test` reports all tests passing including 6 byte-magic smokes.

### 5.2 Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hidden non-Supabase I/O (logo fetch, font load, image embed) crashes the byte-magic test | Medium | Read each renderer end-to-end before writing its fixture. If a renderer fetches a remote logo or font, either expand the fixture's `tenant_settings.logo_url` to a known-safe placeholder or mock the I/O. |
| Static JSX import in a renderer pulls in a transitive Next.js / browser-only module that fails under bare Node | Low-Medium | If hit, mock the offending module via `node:module`'s `register()` resolver hook OR refactor that one renderer to dynamic-import (mirror the credit-memo pattern). Address case-by-case. |
| `@swc-node/register@^1.x` breaks under Node 20 / 22 (whichever the project targets) | Low | Verify supported Node versions in `@swc-node/register` README before installing. Fall back to `esbuild-register` if needed. |
| SWC's JSX transform diverges from Next.js's at the edge (e.g., automatic runtime detection) | Low | If divergence shows up, pin the JSX runtime explicitly via `.swcrc` in repo root. Not expected for our straightforward React-PDF JSX. |
| Existing tests slow down measurably | Low | Boot-time only; transform happens once per test file load. If individual test files become noticeably slower, investigate per-file caching options in `@swc-node/register`. |

### 5.3 Rollback plan

If `@swc-node/register` proves unworkable mid-implementation:
1. Remove from devDependencies + revert `package.json` test script.
2. Try `esbuild-register` as drop-in replacement (same `--import` invocation, different package).
3. If both fail, fall back to the credit-memo refactor pattern (dynamic-import JSX inside `renderXPdf`) for each of the 5 renderers — much more code change, but no transformer dependency. Treat as last resort.

---

## 6. Implementation Sequencing

Single-session, inline (no subagent dispatch). 8 files; small enough that subagent overhead exceeds direct-edit speed (handoff-noted convention).

Suggested order:

1. **Infrastructure first** — `package.json` (add devDep + test script). Run `npm install`. Run `npm test` — verify all 78 existing tests pass with the new transformer.
2. **Helper extraction** — create `tests/helpers/mock-supabase.mjs`. Refactor `tests/credit-memo-fetcher-integration.test.mjs` to import from it. Run `npm test` — verify the 7 existing credit-memo tests still pass.
3. **Credit Memo byte-magic** — add 1 new test (`renderCreditMemoPdf produces a valid PDF buffer`). Run `npm test` — verify it passes (this is the first proof the JSX transformer fully works for our PDF pipeline).
4. **Invoice → Rate Con → Combined → POD → Statement** — one renderer at a time. For each: write the test file with skeleton fixture, run it expecting RED, expand fixture to GREEN, commit. Iterate until all 5 are green.

Expected commit count: ~3-5 (infra + helper extraction + one per renderer batch, OR all-in-one if iteration is clean).

---

## 7. Success Criteria

- [ ] `npm test` script runs cleanly from a fresh checkout after `npm install`.
- [ ] All 83 pre-existing test files continue to pass.
- [ ] `tests/helpers/mock-supabase.mjs` exists and is imported by all 6 fetcher-integration test files.
- [ ] All 6 renderer fetcher-integration test files contain a byte-magic smoke test that passes.
- [ ] Total test files: 83 existing + 5 new = **88 test files minimum**, all green. The 5 new files contribute ≥5 new individual tests; the credit-memo extension adds 1; existing tests continue to pass at their current count.
- [ ] Followups.md ledger updated: `FU-035-H-shared-test-infra` marked Resolved with the commit hash; `FU-035-H6-followup-A` marked fully resolved (the remaining ~10% byte-magic gap closed).
