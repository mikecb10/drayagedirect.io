# PDF Generation Infrastructure (2a.1) — Design Spec

**Date:** 2026-04-18
**Status:** Approved — ready for implementation plan
**Scope:** Install `@react-pdf/renderer`, ship two on-demand PDF endpoints (invoice + rate con) with minimal default templates, plus the archival plumbing (DB columns, Storage bucket, serve-archived-or-render logic) for future email-send flows to consume.

## Goal

Build the foundational PDF render + archive pipeline so downstream sub-projects (2a.2 email popup, 2a.3 rate-con popup, 2a.4 bulk email, eventual document designer, eventual customer portal) have a single predictable place to produce and retrieve branded invoice and rate-confirmation PDFs.

## Non-goals

- **No email sending** — just the PDF pipeline. Email popup is sub-project 2a.2.
- **No actual archival trigger** — 2a.1 ships the archive helper exported but UNCALLED. 2a.2 decides when to archive (on email send / on status transition).
- **No template design work** — hardcoded "minimal functional default" templates only. Layout, colors, branding, logo upload, optional fields → all deferred to the future document designer sub-project.
- **No tenant branding** (logo, custom colors) — falls under document designer scope.
- **No QuickBooks sync** — future integration, separate project.
- **No SendGrid delivery tracking** — deferred to later 2a.6 polish.
- **No customer portal re-download** — future feature; today's endpoints serve via session auth only.

## Context (current state)

- Codebase has no PDF library. `package.json` lacks puppeteer / jsPDF / pdfkit / @react-pdf / pdfmake.
- Email infrastructure exists (`lib/email-dispatch/`, SendGrid provider) but is purely event/automation-driven; no manual-trigger email path and no PDF attachment capability.
- `order_charge_sets` tracks `status='rate_con_sent'`; the button that flips it (`components/loads/tabs/BillingTab.js:740`) does not send an email and does not produce any document.
- `/api/tenant/ar/invoices/*` endpoints exist and produce real `invoices` rows (fixed in the yesterday + today AR hardening pass). No PDF is generated at invoice creation.
- Supabase Storage is available but no bucket has been created for documents yet.
- Prior migrations `064_ar_module_expansion.sql:50` reference `current_tenant_id()` helper in RLS policies, so it's available for 2a.1's bucket policies.

## Architecture

**Library:** `@react-pdf/renderer` (~500KB dep). React components compile to PDF Buffer. Server-side rendering only. No Chromium binary; serverless-safe.

**Runtime:** Next.js API routes running on Node (explicit `export const runtime = 'nodejs'`). Not Edge — @react-pdf needs Node APIs.

**Render strategy:** **Hybrid** — re-render on demand for draft documents; serve archived Storage file for already-sent documents. Endpoint checks the DB column (`invoices.pdf_url` or `order_charge_sets.rate_con_pdf_url`); if populated, redirects to a short-lived signed URL; else renders in-process and streams bytes.

**Archival timing:** happens at email-send time (in 2a.2), not in 2a.1. 2a.1 ships the `archiveInvoicePdf` and `archiveRateConPdf` helpers exported and ready — the archival CALL lives in the future email popup code.

## File structure

```
lib/pdf/
  render-invoice.js     — fetch invoice + joins, call <InvoiceTemplate>, return Buffer
  render-rate-con.js    — same shape for rate con (charge set + load + equipment + lines)
  storage.js            — Supabase Storage helpers: uploadPdfBuffer, getSignedUrl
  archive.js            — render + upload + DB update orchestrators (exported; unused until 2a.2)

components/pdf/
  InvoiceTemplate.js    — React-PDF default invoice layout
  RateConTemplate.js    — React-PDF default rate-con layout
  shared/
    Header.js           — tenant-name text block (no logo in 2a.1)
    LineItemsTable.js   — Description / Quantity / Rate / Amount table
    typography.js       — font + color constants

pages/api/tenant/pdf/
  invoice/[id].js       — GET, requires ACCOUNTS_RECEIVABLE|ALL
  rate-con/[id].js      — GET, requires ORDER_ENTRY|DISPATCHING|ACCOUNTS_RECEIVABLE|ALL

supabase/migrations/
  078_pdf_archive.sql   — adds invoices.pdf_url + order_charge_sets.rate_con_pdf_url;
                          creates `documents` Storage bucket; tenant-scoped RLS policies
```

## Render pipeline

**`renderInvoicePdf(svc, invoiceId, tenantId) → Promise<Buffer>`**

1. SELECT on `invoices` with joined customer, line_items, charge_sets → orders → reference_number.
2. SELECT tenant_name from `tenants` table for header.
3. Build props: `{ tenantName, invoiceNumber, invoiceDate, dueDate, referenceNumber, customer, lineItems, subtotal, total, notes }`.
4. `renderToBuffer(<InvoiceTemplate {...props} />)` → returns `Buffer`.
5. Throws `Error('Invoice not found')` if row missing.

**`renderRateConPdf(svc, chargeSetId, tenantId) → Promise<Buffer>`** — identical shape, different joins: fetches the charge set with `order → pickup_location, delivery_location, customer, container_number, chassis_number`, plus `bill_to` customer and line_items. Template renders confirmation # (using `charge_set_number`), equipment, pickup/delivery info, line items, signature line.

**Default template field set:**

*Invoice*: Tenant name + contact • "INVOICE" • Invoice # • Invoice Date • Due Date • PO# / Reference # (from `orders.reference_number`) • Bill To (name + billing address) • Line items table (Description, Qty, Rate, Amount) • Totals (Subtotal, Total Due) • Notes footer.

*Rate confirmation*: Tenant name + contact • "RATE CONFIRMATION" • Confirmation # (charge_set_number) • Issue Date • PO# / Reference # • Equipment (container #, chassis #) • Pickup (location + date) • Delivery (location + date) • Line items table • Signature line.

Everything is monochrome black text on white, Letter size (8.5×11), 0.5" margins, system-safe sans-serif (React-PDF's bundled Helvetica). No branding colors in 2a.1.

## Storage + archival

**`uploadPdfBuffer(svc, buffer, path)`** — uploads to `documents` bucket at `{tenant_id}/{doc_type}/{id}.pdf`. Uses `upsert: true` (supports rebill scenarios). Returns `{ storagePath }`.

**`getSignedUrl(svc, storagePath, ttlSeconds = 900)`** — generates 15-min signed URL for tenant-scoped file access. Throws on failure.

**`archiveInvoicePdf(svc, invoiceId, tenantId)`** — orchestrates: render → upload → update `invoices.pdf_url = path`. Exported but not invoked by any 2a.1 code path. 2a.2 calls this in the email popup's "Send" action.

**`archiveRateConPdf(svc, chargeSetId, tenantId)`** — mirror for rate cons, writes to `order_charge_sets.rate_con_pdf_url`.

## API endpoint contract

Both `/api/tenant/pdf/invoice/[id]` and `/api/tenant/pdf/rate-con/[id]` follow the same pattern:

1. `requireTenantUser(req, res)` — cookie session auth
2. `requirePermission(ctx, <perms>, res)` — invoice requires `ACCOUNTS_RECEIVABLE|ALL`; rate con requires `ORDER_ENTRY|DISPATCHING|ACCOUNTS_RECEIVABLE|ALL`
3. Fetch the row by id (scoped to tenant)
4. 404 if not found
5. If pdf_url column populated → `getSignedUrl` → `res.redirect(302, signedUrl)`. On signed-URL failure, fall through to re-render.
6. Else render on demand:
   - `Content-Type: application/pdf`
   - `Content-Disposition: inline; filename="invoice-{id}.pdf"` (or `rate-con-{id}.pdf`)
   - `res.send(buffer)`
7. Any render error → 500 `{ error: message }`.

## Migration 078

Single migration file adds two nullable TEXT columns (`invoices.pdf_url`, `order_charge_sets.rate_con_pdf_url`), creates the `documents` Storage bucket (private, PDF-only, 50MB cap), and adds four tenant-scoped RLS policies on `storage.objects` (select/insert/update/delete) that check `split_part(name, '/', 1)::uuid = current_tenant_id()`.

Uses `BEGIN` / `COMMIT` wrapper, `IF NOT EXISTS` on column adds, `ON CONFLICT DO NOTHING` on the bucket row. Ends with `NOTIFY pgrst, 'reload schema'` per codebase convention. Safe to re-run.

Applied via Supabase Studio SQL editor (same pattern as migrations 076 + 077 earlier this session).

## Permission mapping

| Endpoint | Required permissions |
|---|---|
| `GET /api/tenant/pdf/invoice/[id]` | `ACCOUNTS_RECEIVABLE \| ALL` (matches `/ar/invoices/*`) |
| `GET /api/tenant/pdf/rate-con/[id]` | `ORDER_ENTRY \| DISPATCHING \| ACCOUNTS_RECEIVABLE \| ALL` (matches charge-set endpoints) |

Service role client used internally for render (for join fetches). Signed URLs short-lived (15 min).

## Edge cases

1. **Row not found** → 404 `{ error: 'Not found' }`.
2. **`pdf_url` set but file missing** → `getSignedUrl` throws; endpoint falls through to re-render. Server logs inconsistency. DB row is NOT silently reset.
3. **Template render fails** → caught, 500 with stack logged server-side.
4. **Customer row is null** (orphan FK) → template renders "(unknown customer)" placeholder, doesn't throw.
5. **0 line items** → empty table with explicit "(No line items)" row, totals still computed ($0.00).
6. **Very long text** → React-PDF auto-wraps; table columns have fixed widths.
7. **Multi-page invoice (50+ items)** → React-PDF paginates; footer on every page, header on page 1 only.
8. **Null tenant name** → "Company" placeholder.
9. **Concurrent archive calls** → Storage `upsert: true`, DB update idempotent. Last write wins; both produce identical bytes for same sent invoice.
10. **Draft invoice endpoint call** → `pdf_url` null → re-renders from current DB state (drafts are editable).
11. **Voided invoice** → if archived, still served as-is (audit preservation).
12. **Missing Storage bucket at runtime** → archive helper throws clear "Bucket not found"; migration is the source of truth.
13. **Rate con with no line items** → same as #5.
14. **Load without locations** → "(TBD)" placeholders in pickup/delivery sections.
15. **Invoice date display** — uses `sent_at` if set, else `created_at`; labelled "Invoice Date" uniformly (not "Sent Date" for drafts).

## Verification (manual — codebase has no automated tests)

**Gate 1 — Smoke:** `@react-pdf/renderer` in `package.json`. `curl` against both endpoints with a browser session returns valid PDF bytes with `Content-Type: application/pdf`. Downloaded PDFs display in a viewer. Test fixture: invoice `TES001004` (exists, 2 lines, $287.50).

**Gate 2 — Archival mock:** Throwaway script calls `archiveInvoicePdf()` on a test invoice → `pdf_url` column populated → next endpoint hit returns 302 to signed URL → downloading via that URL yields the same PDF. Delete script after.

**Gate 3 — Migration audit (via Studio):** Columns exist, `documents` bucket exists (private, 50MB), 4 RLS policies exist on `storage.objects` named `documents_tenant_*`.

**Gate 4 — Permissions:** `DISPATCHING`-only user gets 403 on invoice endpoint, 200 on rate con. Super admin gets 200 on both.

**Gate 5 — Visual quality:** Open rendered invoice + rate con side-by-side. Eyeball: text fits margins, table borders or spacing consistent, totals right-aligned, dates human-readable, signature line renders as an actual line. Plain-but-intentional, not broken.

## Branch discipline

Main workspace at `C:\Users\bento\app-drayagedirect`. Before each commit: `git branch --show-current` must return `main`. Parallel Advanced Route Cowork session has intermittently swapped branches. Recovery pattern in `session_2026_04_17_handoff.md`.

## Risks

**Low-medium.** New library install but @react-pdf/renderer is mature and stable. No existing consumers, no breaking changes to other endpoints.

- **Storage bucket + RLS misconfig** — if `current_tenant_id()` isn't available in the tenant's DB context, policies might fail to apply. Migration fails loudly → fix in place.
- **Template data shape mismatches** — defensive fallbacks on every optional field (customer null, line items empty, dates missing).
- **Node-runtime requirement** — explicit `export const runtime = 'nodejs'` on endpoints. If the project later adopts Edge runtime, these endpoints are pinned to Node (fine).
- **@react-pdf version pinning** — `^` caret for minor updates OK; future 2.x major bump will need re-test. Document in the install task.

## Out of scope (future sub-projects)

- **2a.2** — Invoice email popup UX + single-send flow (uses this sub-project's archive helper)
- **2a.3** — Rate confirmation email popup
- **2a.4** — Bulk email actions with grouping modal
- **2a.5** — "Invoice + date picker" backdating button
- **2a.6** — SendGrid delivery webhook tracking
- **Document designer** — replaces the hardcoded default templates with tenant-authored designs
- **Customer portal re-download** — signed-URL share links, public-facing PDF delivery
- **QuickBooks sync** — invoice → QB record integration

## Success criteria

- Both endpoints return valid PDFs on-demand for real data (invoice TES001004 + a draft charge set).
- Archive helper successfully writes to Storage + populates `pdf_url` when called manually.
- Endpoint redirects to Storage when `pdf_url` set; re-renders when null.
- Migration 078 applied cleanly; bucket + RLS policies live.
- All 5 verification gates pass.
- 2a.2 can import `archiveInvoicePdf` from `lib/pdf/archive.js` and call it with no 2a.1 changes needed.
