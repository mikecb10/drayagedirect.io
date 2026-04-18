# PDF Generation Infrastructure (2a.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install `@react-pdf/renderer`, ship two on-demand PDF endpoints (invoice + rate con) with minimal default templates, plus the archival plumbing (DB columns, Storage bucket, serve-archived-or-render logic) for future email-send flows (sub-project 2a.2) to consume.

**Architecture:** React-PDF components compile to Buffer server-side. Hybrid render strategy — endpoints check a DB `pdf_url` column; if populated, redirect to a short-lived signed Storage URL; else render on demand from current DB state. Archival itself (write to Storage + populate pdf_url) lives in an exported helper that 2a.2 will call on email send; 2a.1 ships the helper but doesn't trigger it.

**Tech Stack:** Next.js Pages Router API routes (Node runtime), React 19, `@react-pdf/renderer`, Supabase service-role client for DB + Storage.

**Spec:** `docs/superpowers/specs/2026-04-18-pdf-generation-infrastructure-design.md`

**Branch:** `main`. Before each commit: `git branch --show-current` must return `main`.

**No automated tests in this plan.** Codebase uses manual QA + targeted verification. Each task has grep + smoke checks before commit.

**Do NOT run `npm run build`** — wipes `.next/` and breaks any running dev server.

---

## Task 1: Migration 078 — DB columns + Storage bucket + RLS

**Files:**
- Create: `supabase/migrations/078_pdf_archive.sql`

**Context:**
- Follows the migration template pattern: `BEGIN` / `COMMIT`, `IF NOT EXISTS` guards, ends with `NOTIFY pgrst, 'reload schema'`.
- `current_tenant_id()` helper exists — migration `064_ar_module_expansion.sql:50` uses the same in its RLS policies.
- User applies via Supabase Studio SQL editor (per prior session pattern for migrations 076, 077).

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

Expected: `main`. If anything else, STOP and report BLOCKED.

- [ ] **Step 2: Create the migration file**

Write this content to `supabase/migrations/078_pdf_archive.sql`:

```sql
-- ============================================================
-- Migration 078: PDF archival infrastructure
-- ============================================================
-- Adds columns to track archived PDFs for invoices and rate
-- confirmations. Creates the `documents` Storage bucket with
-- tenant-scoped RLS so each tenant's PDFs are isolated.
--
-- Supports sub-project 2a.1 (PDF generation infrastructure).
-- ============================================================

BEGIN;

-- ── Columns ──────────────────────────────────────────────
-- Storage path (not signed URL). Signed URLs expire; we
-- regenerate them on demand when serving the document.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pdf_url TEXT;

ALTER TABLE order_charge_sets
  ADD COLUMN IF NOT EXISTS rate_con_pdf_url TEXT;

-- ── Storage bucket ───────────────────────────────────────
-- Private bucket (public=false), PDFs only, 50MB cap per file.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies ─────────────────────────────────────────
-- Path convention: {tenant_id}/{doc_type}/{id}.pdf
-- Policies check the first path segment against the caller's
-- tenant. Service role bypasses RLS anyway; these are
-- defense-in-depth for any future non-service-role access.

DROP POLICY IF EXISTS documents_tenant_select ON storage.objects;
CREATE POLICY documents_tenant_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents'
    AND (split_part(name, '/', 1))::uuid = current_tenant_id()
  );

DROP POLICY IF EXISTS documents_tenant_insert ON storage.objects;
CREATE POLICY documents_tenant_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documents'
    AND (split_part(name, '/', 1))::uuid = current_tenant_id()
  );

DROP POLICY IF EXISTS documents_tenant_update ON storage.objects;
CREATE POLICY documents_tenant_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'documents'
    AND (split_part(name, '/', 1))::uuid = current_tenant_id()
  );

DROP POLICY IF EXISTS documents_tenant_delete ON storage.objects;
CREATE POLICY documents_tenant_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documents'
    AND (split_part(name, '/', 1))::uuid = current_tenant_id()
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 3: Verify the file was created correctly**

```bash
grep -c "CREATE POLICY documents_tenant" supabase/migrations/078_pdf_archive.sql
```

Expected: `4` (select + insert + update + delete policies).

- [ ] **Step 4: Commit the migration file (user applies separately via Studio)**

```bash
git add supabase/migrations/078_pdf_archive.sql
git commit -m "$(cat <<'EOF'
feat(migration): add PDF archival infrastructure (078)

Adds invoices.pdf_url and order_charge_sets.rate_con_pdf_url
nullable columns. Creates the documents Storage bucket with
tenant-scoped RLS (path prefix check on storage.objects).

User applies via Supabase Studio SQL editor. Ships as part of
sub-project 2a.1 PDF generation infrastructure.

Spec: docs/superpowers/specs/2026-04-18-pdf-generation-infrastructure-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Install @react-pdf/renderer + shared PDF components + storage helpers

**Files:**
- Modify: `package.json` (new dependency)
- Create: `components/pdf/shared/typography.js`
- Create: `components/pdf/shared/Header.js`
- Create: `components/pdf/shared/LineItemsTable.js`
- Create: `lib/pdf/storage.js`

**Context:**
- `@react-pdf/renderer` supports React-like components with styled elements. Uses `StyleSheet.create` for styling.
- Shared components will be reused by both InvoiceTemplate and RateConTemplate (next tasks).
- `lib/pdf/storage.js` is a thin Supabase Storage wrapper. No PDF rendering here; used by archive.js later and by endpoints (for serving archived files).

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

- [ ] **Step 2: Install the library**

```bash
npm install @react-pdf/renderer
```

Expected output: `added N packages in Xs`. No warnings about peer deps that break the build.

- [ ] **Step 3: Verify install**

```bash
grep -n "@react-pdf/renderer" package.json
```

Expected: 1 match in dependencies block.

- [ ] **Step 4: Create the typography constants**

Write `components/pdf/shared/typography.js`:

```js
import { StyleSheet } from '@react-pdf/renderer';

// Minimal default styling — intentionally plain. The document
// designer sub-project (future) will replace all of this with
// tenant-authored templates.
export const colors = {
  text: '#000000',
  muted: '#666666',
  border: '#cccccc',
  tableHeader: '#f3f4f6',
};

export const typography = StyleSheet.create({
  page: {
    padding: 36, // 0.5" margin
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: colors.text,
  },
  h1: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  h2: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  label: {
    fontSize: 9,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  value: {
    fontSize: 10,
    marginBottom: 6,
  },
  muted: {
    color: colors.muted,
  },
});
```

- [ ] **Step 5: Create the Header component**

Write `components/pdf/shared/Header.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from './typography';

/**
 * Header renders the tenant name + document title side by side.
 * No logo in 2a.1 — the document designer sub-project will add
 * logo support later.
 */
export default function Header({ tenantName, title, contactLine }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
      <View>
        <Text style={typography.h2}>{tenantName || 'Company'}</Text>
        {contactLine ? <Text style={typography.muted}>{contactLine}</Text> : null}
      </View>
      <Text style={typography.h1}>{title}</Text>
    </View>
  );
}
```

- [ ] **Step 6: Create the LineItemsTable component**

Write `components/pdf/shared/LineItemsTable.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { colors } from './typography';

const styles = {
  table: { marginTop: 12, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: colors.tableHeader,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  colDescription: { flex: 3, fontSize: 10 },
  colQty: { flex: 1, fontSize: 10, textAlign: 'right' },
  colRate: { flex: 1, fontSize: 10, textAlign: 'right' },
  colAmount: { flex: 1, fontSize: 10, textAlign: 'right' },
  headerText: { fontWeight: 'bold', fontSize: 9, color: colors.muted, textTransform: 'uppercase' },
  emptyRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 4,
    color: colors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
  },
};

function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function LineItemsTable({ items }) {
  if (!items || items.length === 0) {
    return (
      <View style={styles.table}>
        <View style={styles.headerRow}>
          <Text style={[styles.colDescription, styles.headerText]}>Description</Text>
          <Text style={[styles.colQty, styles.headerText]}>Qty</Text>
          <Text style={[styles.colRate, styles.headerText]}>Rate</Text>
          <Text style={[styles.colAmount, styles.headerText]}>Amount</Text>
        </View>
        <Text style={styles.emptyRow}>(No line items)</Text>
      </View>
    );
  }

  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.colDescription, styles.headerText]}>Description</Text>
        <Text style={[styles.colQty, styles.headerText]}>Qty</Text>
        <Text style={[styles.colRate, styles.headerText]}>Rate</Text>
        <Text style={[styles.colAmount, styles.headerText]}>Amount</Text>
      </View>
      {items.map((item, idx) => (
        <View key={item.id || idx} style={styles.row}>
          <Text style={styles.colDescription}>{item.description || item.name || '—'}</Text>
          <Text style={styles.colQty}>{item.quantity || item.unit_count || 1}</Text>
          <Text style={styles.colRate}>
            {formatCents(item.unit_amount_cents ?? item.per_unit_price_cents ?? 0)}
          </Text>
          <Text style={styles.colAmount}>
            {formatCents(item.total_amount_cents ?? item.total_cents ?? 0)}
          </Text>
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 7: Create the storage helper**

Write `lib/pdf/storage.js`:

```js
/**
 * Thin Supabase Storage wrapper for PDF archival.
 * Used by:
 *   - lib/pdf/archive.js: writes rendered PDFs on email send (via 2a.2)
 *   - pages/api/tenant/pdf/invoice/[id].js: serves archived PDFs via signed URL
 *   - pages/api/tenant/pdf/rate-con/[id].js: same
 */

const BUCKET = 'documents';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 900; // 15 min

/**
 * Upload a PDF Buffer to the tenant's Storage bucket.
 * @param {SupabaseClient} svc - service-role client
 * @param {Buffer} buffer - rendered PDF bytes
 * @param {string} path - full storage path, e.g. "{tenant_id}/invoices/{invoice_id}.pdf"
 * @returns {Promise<{ storagePath: string }>}
 */
export async function uploadPdfBuffer(svc, buffer, path) {
  const { error } = await svc.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true, // support rebill + re-archive
    });
  if (error) {
    throw new Error(`PDF upload failed: ${error.message}`);
  }
  return { storagePath: path };
}

/**
 * Generate a short-lived signed URL for a stored PDF.
 * @param {SupabaseClient} svc
 * @param {string} storagePath - value from invoices.pdf_url or order_charge_sets.rate_con_pdf_url
 * @param {number} [ttlSeconds=900]
 * @returns {Promise<string>} signed URL
 */
export async function getSignedUrl(svc, storagePath, ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) {
  const { data, error } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Signed URL generation failed: ${error?.message || 'unknown error'}`);
  }
  return data.signedUrl;
}
```

- [ ] **Step 8: Sanity-check all files present**

```bash
grep -c "export " components/pdf/shared/typography.js components/pdf/shared/Header.js components/pdf/shared/LineItemsTable.js lib/pdf/storage.js
```

Expected: 1+ exports in each file (total ≥ 4).

- [ ] **Step 9: Verify branch is still main**

```bash
git branch --show-current
```

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json components/pdf/shared/ lib/pdf/storage.js
git commit -m "$(cat <<'EOF'
feat(pdf): install @react-pdf/renderer + shared components + storage helpers

Foundation for the PDF generation pipeline (sub-project 2a.1):
- @react-pdf/renderer dependency installed
- components/pdf/shared/typography.js — minimal default styles
- components/pdf/shared/Header.js — tenant-name + document-title block
- components/pdf/shared/LineItemsTable.js — shared line-items table
- lib/pdf/storage.js — uploadPdfBuffer + getSignedUrl helpers

No endpoints or templates yet — those land in the next two commits
for invoice and rate-con pipelines respectively.

Spec: docs/superpowers/specs/2026-04-18-pdf-generation-infrastructure-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Invoice pipeline (template + render + endpoint)

**Files:**
- Create: `components/pdf/InvoiceTemplate.js`
- Create: `lib/pdf/render-invoice.js`
- Create: `pages/api/tenant/pdf/invoice/[id].js`

**Context:**
- Full vertical slice. After this task, hitting `/api/tenant/pdf/invoice/<id>` returns a real PDF.
- Template imports shared Header + LineItemsTable from Task 2.
- Render function fetches invoice data and calls `renderToBuffer`.
- Endpoint does permission check, tries archive, falls through to render.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

- [ ] **Step 2: Create InvoiceTemplate**

Write `components/pdf/InvoiceTemplate.js`:

```js
import { Document, Page, View, Text } from '@react-pdf/renderer';
import Header from './shared/Header';
import LineItemsTable from './shared/LineItemsTable';
import { typography, colors } from './shared/typography';

function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(input) {
  if (!input) return '—';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Minimal default invoice template.
 * Data shape is documented at lib/pdf/render-invoice.js.
 *
 * IMPORTANT: this is an intentionally plain default. The document
 * designer sub-project (future) will replace all of this.
 */
export default function InvoiceTemplate({
  tenantName,
  invoiceNumber,
  invoiceDate,
  dueDate,
  referenceNumber,
  customer,
  lineItems,
  subtotal,
  total,
  notes,
}) {
  const customerAddress = customer
    ? [customer.address_line1, customer.address_line2, [customer.city, customer.state, customer.zip].filter(Boolean).join(', ')]
        .filter(Boolean).join('\n')
    : '';

  return (
    <Document>
      <Page size="LETTER" style={typography.page}>
        <Header tenantName={tenantName} title="INVOICE" />

        {/* Metadata block */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          <View>
            <Text style={typography.label}>Bill To</Text>
            <Text style={typography.value}>{customer?.name || '(unknown customer)'}</Text>
            <Text style={[typography.value, typography.muted]}>{customerAddress}</Text>
          </View>
          <View style={{ minWidth: 180 }}>
            <Text style={typography.label}>Invoice #</Text>
            <Text style={typography.value}>{invoiceNumber || '—'}</Text>
            <Text style={typography.label}>Invoice Date</Text>
            <Text style={typography.value}>{formatDate(invoiceDate)}</Text>
            <Text style={typography.label}>Due Date</Text>
            <Text style={typography.value}>{formatDate(dueDate)}</Text>
            {referenceNumber ? (
              <>
                <Text style={typography.label}>PO / Reference #</Text>
                <Text style={typography.value}>{referenceNumber}</Text>
              </>
            ) : null}
          </View>
        </View>

        <LineItemsTable items={lineItems} />

        {/* Totals */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
          <View style={{ minWidth: 180 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={typography.muted}>Subtotal</Text>
              <Text>{formatCents(subtotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontWeight: 'bold' }}>Total Due</Text>
              <Text style={{ fontWeight: 'bold' }}>{formatCents(total)}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {notes ? (
          <View style={{ marginTop: 24 }}>
            <Text style={typography.label}>Notes</Text>
            <Text style={typography.value}>{notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: Create render-invoice helper**

Write `lib/pdf/render-invoice.js`:

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import InvoiceTemplate from '../../components/pdf/InvoiceTemplate';

/**
 * Fetch invoice data and render as PDF Buffer.
 * @param {SupabaseClient} svc - service-role client
 * @param {string} invoiceId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Invoice not found' if missing or wrong tenant
 */
export async function renderInvoicePdf(svc, invoiceId, tenantId) {
  // Fetch invoice + joins
  const { data: invoice, error } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, sent_at, created_at, due_date, subtotal_cents, total_amount_cents, notes,
      customer:customers!customer_id(id, name, billing_email, address_line1, address_line2, city, state, zip, payment_terms),
      line_items:invoice_line_items(id, description, quantity, unit_amount_cents, total_amount_cents, sort_order),
      charge_sets:invoice_charge_sets(
        charge_set:order_charge_sets(
          charge_set_number,
          order:orders(order_number, reference_number)
        )
      )
    `)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(`Invoice query failed: ${error.message}`);
  if (!invoice) throw new Error('Invoice not found');

  // Fetch tenant name for header
  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  // Reference number: first non-null reference_number from linked charge sets, else first order_number
  const cs = invoice.charge_sets?.[0]?.charge_set;
  const referenceNumber = cs?.order?.reference_number || cs?.order?.order_number || null;

  // Sort line items
  const lineItems = (invoice.line_items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Build props
  const props = {
    tenantName: tenant?.name || 'Company',
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.sent_at || invoice.created_at,
    dueDate: invoice.due_date,
    referenceNumber,
    customer: invoice.customer,
    lineItems,
    subtotal: invoice.subtotal_cents,
    total: invoice.total_amount_cents,
    notes: invoice.notes,
  };

  return await renderToBuffer(React.createElement(InvoiceTemplate, props));
}
```

- [ ] **Step 4: Create the API endpoint**

Write `pages/api/tenant/pdf/invoice/[id].js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderInvoicePdf } from '../../../../../lib/pdf/render-invoice';
import { getSignedUrl } from '../../../../../lib/pdf/storage';

export const config = {
  // React-PDF needs Node APIs. Explicit pin against future Edge defaults.
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  // Check if archived
  const { data: row, error: fetchErr } = await svc
    .from('invoices')
    .select('id, pdf_url')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!row) return res.status(404).json({ error: 'Invoice not found' });

  if (row.pdf_url) {
    try {
      const signedUrl = await getSignedUrl(svc, row.pdf_url);
      return res.redirect(302, signedUrl);
    } catch (e) {
      // Archived file inaccessible (deleted, permissions, etc.) — fall
      // through to re-render from current DB state. DB row is NOT silently
      // reset; the inconsistency is logged for operator awareness.
      console.error(`Invoice ${id}: archived file unreachable, falling back to re-render:`, e.message);
    }
  }

  // Render on demand (drafts or fallback)
  try {
    const buffer = await renderInvoicePdf(svc, id, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${id}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    console.error(`Invoice ${id} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
```

- [ ] **Step 5: Sanity-check the files**

```bash
grep -c "renderInvoicePdf\|InvoiceTemplate\|runtime: 'nodejs'" components/pdf/InvoiceTemplate.js lib/pdf/render-invoice.js pages/api/tenant/pdf/invoice/[id].js
```

Expected: `renderInvoicePdf` referenced in both render-invoice.js and the endpoint, `InvoiceTemplate` in template and render-invoice, `runtime: 'nodejs'` in the endpoint. At least 4 total matches.

- [ ] **Step 6: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 7: Commit**

```bash
git add components/pdf/InvoiceTemplate.js lib/pdf/render-invoice.js pages/api/tenant/pdf/invoice/\[id\].js
git commit -m "$(cat <<'EOF'
feat(pdf): invoice render pipeline + endpoint

Vertical slice for invoice PDF generation:
- components/pdf/InvoiceTemplate.js — minimal default layout
- lib/pdf/render-invoice.js — DB fetch + renderToBuffer
- pages/api/tenant/pdf/invoice/[id].js — Node-runtime endpoint with
  archived-pdf-first, render-on-demand fallback logic

Hitting /api/tenant/pdf/invoice/<id> as an AR user now returns a
real PDF. Archive path ready to be populated by 2a.2 on email send.

Spec: docs/superpowers/specs/2026-04-18-pdf-generation-infrastructure-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rate-con pipeline (template + render + endpoint)

**Files:**
- Create: `components/pdf/RateConTemplate.js`
- Create: `lib/pdf/render-rate-con.js`
- Create: `pages/api/tenant/pdf/rate-con/[id].js`

**Context:**
- Mirrors Task 3's shape. Reuses Header + LineItemsTable from Task 2.
- Rate con is tied to a charge set (not an invoice). Different data joins.
- Endpoint permission is broader — dispatchers need to pull rate cons.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

- [ ] **Step 2: Create RateConTemplate**

Write `components/pdf/RateConTemplate.js`:

```js
import { Document, Page, View, Text } from '@react-pdf/renderer';
import Header from './shared/Header';
import LineItemsTable from './shared/LineItemsTable';
import { typography, colors } from './shared/typography';

function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(input) {
  if (!input) return 'TBD';
  const d = new Date(input);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatLocation(loc) {
  if (!loc) return '(TBD)';
  const cityLine = [loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
  return [loc.name, loc.address_line1, cityLine].filter(Boolean).join('\n');
}

export default function RateConTemplate({
  tenantName,
  confirmationNumber,
  issueDate,
  referenceNumber,
  containerNumber,
  chassisNumber,
  pickup,
  delivery,
  lineItems,
  total,
}) {
  return (
    <Document>
      <Page size="LETTER" style={typography.page}>
        <Header tenantName={tenantName} title="RATE CONFIRMATION" />

        {/* Metadata */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          <View>
            <Text style={typography.label}>Confirmation #</Text>
            <Text style={typography.value}>{confirmationNumber || '—'}</Text>
            <Text style={typography.label}>Issue Date</Text>
            <Text style={typography.value}>{formatDate(issueDate)}</Text>
            {referenceNumber ? (
              <>
                <Text style={typography.label}>PO / Reference #</Text>
                <Text style={typography.value}>{referenceNumber}</Text>
              </>
            ) : null}
          </View>
          <View style={{ minWidth: 180 }}>
            <Text style={typography.label}>Container #</Text>
            <Text style={typography.value}>{containerNumber || '—'}</Text>
            <Text style={typography.label}>Chassis #</Text>
            <Text style={typography.value}>{chassisNumber || '—'}</Text>
          </View>
        </View>

        {/* Pickup / Delivery */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={typography.label}>Pickup</Text>
            <Text style={typography.value}>{formatLocation(pickup?.location)}</Text>
            <Text style={[typography.value, typography.muted]}>Date: {formatDate(pickup?.date)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={typography.label}>Delivery</Text>
            <Text style={typography.value}>{formatLocation(delivery?.location)}</Text>
            <Text style={[typography.value, typography.muted]}>Date: {formatDate(delivery?.date)}</Text>
          </View>
        </View>

        <LineItemsTable items={lineItems} />

        {/* Total */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
          <View style={{ minWidth: 180 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontWeight: 'bold' }}>Total</Text>
              <Text style={{ fontWeight: 'bold' }}>{formatCents(total)}</Text>
            </View>
          </View>
        </View>

        {/* Signature block */}
        <View style={{ marginTop: 48, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 2, borderTopWidth: 1, borderTopColor: colors.text, marginRight: 12 }}>
            <Text style={[typography.label, { marginTop: 4 }]}>Signature</Text>
          </View>
          <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: colors.text }}>
            <Text style={[typography.label, { marginTop: 4 }]}>Date</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: Create render-rate-con helper**

Write `lib/pdf/render-rate-con.js`:

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import RateConTemplate from '../../components/pdf/RateConTemplate';

/**
 * Fetch rate-con data (charge set + load + equipment + locations)
 * and render as PDF Buffer.
 * @param {SupabaseClient} svc - service-role client
 * @param {string} chargeSetId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Charge set not found' if missing or wrong tenant
 */
export async function renderRateConPdf(svc, chargeSetId, tenantId) {
  const { data: cs, error } = await svc
    .from('order_charge_sets')
    .select(`
      id, charge_set_number, created_at, total_cents,
      order:orders(
        order_number, reference_number, container_number, chassis_number,
        pickup_location:locations!orders_pickup_location_id_fkey(id, name, address_line1, city, state, zip),
        delivery_location:locations!orders_delivery_location_id_fkey(id, name, address_line1, city, state, zip),
        pickup_appt_from, delivery_appt_from
      ),
      line_items:order_charge_set_line_items(id, name, description, unit_count, per_unit_price_cents, total_cents)
    `)
    .eq('id', chargeSetId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Charge set query failed: ${error.message}`);
  if (!cs) throw new Error('Charge set not found');

  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const lineItems = (cs.line_items || []).map((li) => ({
    id: li.id,
    description: li.description || li.name,
    quantity: li.unit_count || 1,
    unit_amount_cents: li.per_unit_price_cents,
    total_amount_cents: li.total_cents,
  }));

  const props = {
    tenantName: tenant?.name || 'Company',
    confirmationNumber: cs.charge_set_number,
    issueDate: cs.created_at,
    referenceNumber: cs.order?.reference_number || cs.order?.order_number || null,
    containerNumber: cs.order?.container_number,
    chassisNumber: cs.order?.chassis_number,
    pickup: {
      location: cs.order?.pickup_location,
      date: cs.order?.pickup_appt_from,
    },
    delivery: {
      location: cs.order?.delivery_location,
      date: cs.order?.delivery_appt_from,
    },
    lineItems,
    total: cs.total_cents,
  };

  return await renderToBuffer(React.createElement(RateConTemplate, props));
}
```

**Note on FK hint names:** The joins above use `orders_pickup_location_id_fkey` and `orders_delivery_location_id_fkey`. Before committing, verify these FK names match the schema. If they differ, grep an existing consumer:

```bash
grep -rn "orders_pickup_location\|orders_delivery_location\|pickup_location.*locations\|delivery_location.*locations" pages/api/tenant/loads --include='*.js' | head -5
```

Use whatever FK hint names appear in the existing codebase. If none found, the implementer should check the `orders` table definition or infer from column name (`orders_{column}_fkey` is the Postgres default).

- [ ] **Step 4: Create the rate-con endpoint**

Write `pages/api/tenant/pdf/rate-con/[id].js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderRateConPdf } from '../../../../../lib/pdf/render-rate-con';
import { getSignedUrl } from '../../../../../lib/pdf/storage';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res
  )) return;

  const { id } = req.query;
  const svc = getServiceClient();

  // Check if archived
  const { data: row, error: fetchErr } = await svc
    .from('order_charge_sets')
    .select('id, rate_con_pdf_url')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!row) return res.status(404).json({ error: 'Charge set not found' });

  if (row.rate_con_pdf_url) {
    try {
      const signedUrl = await getSignedUrl(svc, row.rate_con_pdf_url);
      return res.redirect(302, signedUrl);
    } catch (e) {
      console.error(`Rate con ${id}: archived file unreachable, falling back to re-render:`, e.message);
    }
  }

  // Render on demand
  try {
    const buffer = await renderRateConPdf(svc, id, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="rate-con-${id}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    console.error(`Rate con ${id} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
```

- [ ] **Step 5: Sanity-check**

```bash
grep -c "renderRateConPdf\|RateConTemplate" components/pdf/RateConTemplate.js lib/pdf/render-rate-con.js pages/api/tenant/pdf/rate-con/[id].js
```

Expected: at least 4 matches.

- [ ] **Step 6: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 7: Commit**

```bash
git add components/pdf/RateConTemplate.js lib/pdf/render-rate-con.js pages/api/tenant/pdf/rate-con/\[id\].js
git commit -m "$(cat <<'EOF'
feat(pdf): rate confirmation render pipeline + endpoint

Mirror of the invoice pipeline for rate confirmations:
- components/pdf/RateConTemplate.js — default rate con layout with
  pickup/delivery, equipment info, and signature block
- lib/pdf/render-rate-con.js — DB fetch (charge set + load + lines)
  and renderToBuffer
- pages/api/tenant/pdf/rate-con/[id].js — Node-runtime endpoint,
  broader permission (dispatchers need rate con access), same
  archived-first/render-fallback pattern

Reuses shared Header + LineItemsTable from Task 2.

Spec: docs/superpowers/specs/2026-04-18-pdf-generation-infrastructure-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Archive helper (unused by 2a.1, ready for 2a.2)

**Files:**
- Create: `lib/pdf/archive.js`

**Context:**
- Orchestrates render → upload → DB update for both invoice and rate con.
- Exported but NOT called by any 2a.1 code path. This is the hook 2a.2 will use inside the email popup's "Send" action.
- Touches both render helpers (Tasks 3 + 4) and the storage helper (Task 2).

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

- [ ] **Step 2: Create archive.js**

Write `lib/pdf/archive.js`:

```js
/**
 * PDF archive orchestrators.
 *
 * Called by sub-project 2a.2 (email popup) on "Send" action to:
 *   1. Render the PDF from current DB state
 *   2. Upload to the tenant's Storage bucket
 *   3. Write the storage path to the DB column (invoices.pdf_url
 *      or order_charge_sets.rate_con_pdf_url)
 *
 * After archive, subsequent calls to /api/tenant/pdf/*/[id] serve
 * the archived file rather than re-rendering from (potentially
 * changed) DB state — preserving the audit record of "what was sent".
 *
 * 2a.1 ships these helpers EXPORTED BUT UNCALLED. No 2a.1 code path
 * triggers archival; this is infrastructure for 2a.2 to consume.
 */

import { renderInvoicePdf } from './render-invoice';
import { renderRateConPdf } from './render-rate-con';
import { uploadPdfBuffer } from './storage';

/**
 * Render, upload, and record an invoice PDF.
 * @param {SupabaseClient} svc - service-role client
 * @param {string} invoiceId
 * @param {string} tenantId
 * @returns {Promise<string>} the storage path written to invoices.pdf_url
 */
export async function archiveInvoicePdf(svc, invoiceId, tenantId) {
  const buffer = await renderInvoicePdf(svc, invoiceId, tenantId);
  const path = `${tenantId}/invoices/${invoiceId}.pdf`;
  await uploadPdfBuffer(svc, buffer, path);

  const { error } = await svc
    .from('invoices')
    .update({ pdf_url: path })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`DB update after archive failed: ${error.message}`);

  return path;
}

/**
 * Render, upload, and record a rate confirmation PDF.
 * @param {SupabaseClient} svc - service-role client
 * @param {string} chargeSetId
 * @param {string} tenantId
 * @returns {Promise<string>} the storage path written to order_charge_sets.rate_con_pdf_url
 */
export async function archiveRateConPdf(svc, chargeSetId, tenantId) {
  const buffer = await renderRateConPdf(svc, chargeSetId, tenantId);
  const path = `${tenantId}/rate-cons/${chargeSetId}.pdf`;
  await uploadPdfBuffer(svc, buffer, path);

  const { error } = await svc
    .from('order_charge_sets')
    .update({ rate_con_pdf_url: path })
    .eq('id', chargeSetId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`DB update after archive failed: ${error.message}`);

  return path;
}
```

- [ ] **Step 3: Sanity-check**

```bash
grep -c "archiveInvoicePdf\|archiveRateConPdf" lib/pdf/archive.js
```

Expected: at least 2 matches (one definition each).

- [ ] **Step 4: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/archive.js
git commit -m "$(cat <<'EOF'
feat(pdf): archive helpers (unused by 2a.1, ready for 2a.2)

archiveInvoicePdf and archiveRateConPdf orchestrate render + upload
+ DB column write. Exported from lib/pdf/archive.js but not yet
invoked by any 2a.1 code path — this is the hook sub-project 2a.2
(invoice email popup) will call inside the Send action.

After archive, the existing pipeline endpoints serve the archived
file via short-lived signed URL instead of re-rendering — preserving
the audit record of what was actually sent.

Spec: docs/superpowers/specs/2026-04-18-pdf-generation-infrastructure-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Push + full verification gates

**Files:** (none)

**Context:** After the 5 implementation commits, user has already applied migration 078 via Studio. Push to origin and walk all 5 verification gates.

- [ ] **Step 1: Verify local main has the 5 new commits**

```bash
git log --oneline -7
```

Expected: top 5 commits are the PDF infrastructure series (migration → library+shared → invoice → rate con → archive) plus recent commits before.

- [ ] **Step 2: Push to origin**

```bash
git push origin main
```

Expected: push succeeds, no rejections.

- [ ] **Step 3: Confirm migration 078 is applied**

Reminder to user: if not yet applied, paste migration SQL into Supabase Studio SQL editor and run. Verify:

```sql
-- Should return 1 row each
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'invoices' AND column_name = 'pdf_url';
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'order_charge_sets' AND column_name = 'rate_con_pdf_url';
SELECT id FROM storage.buckets WHERE id = 'documents';
SELECT COUNT(*) FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'documents_tenant_%';
-- Should return 4
```

- [ ] **Step 4: Gate 1 — Smoke test the invoice endpoint**

Dev server running on localhost:3000 (from prior session). Log in as a user with ACCOUNTS_RECEIVABLE or ALL permission.

Open in browser:
```
http://localhost:3000/api/tenant/pdf/invoice/e4310b3a-3598-47e0-a066-38443467030c
```

(That's the TES001004 invoice from the prior hardening session — 2 line items, $287.50.)

Expected: browser prompts to view or download a PDF with `Content-Type: application/pdf`. Open it. Should see:
- "Company" or tenant name in header
- "INVOICE" title
- Bill To: customer name + address
- Invoice #, Invoice Date, Due Date, possibly PO/Reference #
- 2 line items in the table
- Subtotal $287.50, Total Due $287.50

- [ ] **Step 5: Gate 1b — Smoke test the rate-con endpoint**

Pick any charge set ID from the test tenant. Run:

```bash
node -e "
const fs = require('fs');
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const [k, ...v] = line.split('='); if (k && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^[\"']|[\"']\$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
(async () => {
  const { data } = await svc.from('order_charge_sets')
    .select('id, charge_set_number, order:orders(order_number)')
    .eq('tenant_id', 'c7c483bf-f602-4702-92f2-9bee8366cd50')
    .limit(3);
  for (const cs of data || []) console.log(cs.id, cs.charge_set_number, '— load', cs.order?.order_number);
})();
"
```

Take any returned charge set id, open in browser:
```
http://localhost:3000/api/tenant/pdf/rate-con/<id>
```

Expected: rate con PDF with tenant name, "RATE CONFIRMATION", confirmation #, pickup/delivery, container #, line items, signature line.

- [ ] **Step 6: Gate 2 — Archival mock test**

Create `scripts/test-pdf-archive.js` (THROWAWAY — delete after):

```js
const fs = require('fs');
const path = require('path');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const [k, ...v] = line.split('=');
  if (k && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { archiveInvoicePdf } = await import('../lib/pdf/archive.js');
  const tenantId = 'c7c483bf-f602-4702-92f2-9bee8366cd50';
  const invoiceId = 'e4310b3a-3598-47e0-a066-38443467030c'; // TES001004

  const storagePath = await archiveInvoicePdf(svc, invoiceId, tenantId);
  console.log('Archived to:', storagePath);

  const { data } = await svc.from('invoices').select('pdf_url').eq('id', invoiceId).maybeSingle();
  console.log('DB pdf_url:', data?.pdf_url);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
```

Run it:

```bash
node scripts/test-pdf-archive.js
```

Expected output:
```
Archived to: c7c483bf-f602-4702-92f2-9bee8366cd50/invoices/e4310b3a-3598-47e0-a066-38443467030c.pdf
DB pdf_url: c7c483bf-f602-4702-92f2-9bee8366cd50/invoices/e4310b3a-3598-47e0-a066-38443467030c.pdf
```

Then re-open `http://localhost:3000/api/tenant/pdf/invoice/e4310b3a-3598-47e0-a066-38443467030c` in browser. Should now 302 redirect to a `supabase.co/storage/...` signed URL (visible in dev tools Network tab or by disabling automatic redirects).

In Supabase Studio:
- Storage → documents bucket → navigate to `c7c483bf-.../invoices/` → file exists
- Running the same query on `invoices.pdf_url` returns the path

After verification:

```bash
rm scripts/test-pdf-archive.js
```

Don't commit the throwaway script.

- [ ] **Step 7: Gate 3 — Migration audit**

Re-run the SQL queries from Step 3 against the DB. All 4 expected values present.

- [ ] **Step 8: Gate 4 — Permission enforcement**

Log out. Log in as a user with ONLY `DISPATCHING` permission (we have `gate1-dispatcher@testtruck.com` from prior session setup).

Visit:
```
http://localhost:3000/api/tenant/pdf/invoice/e4310b3a-3598-47e0-a066-38443467030c
```

Expected: 403 response. Content-Type will be JSON (`{ error: '...' }`) — either via browser's raw display or a JSON-viewer.

Visit rate con URL with same user:
```
http://localhost:3000/api/tenant/pdf/rate-con/<any-charge-set-id>
```

Expected: 200 (dispatchers CAN pull rate cons).

Log back in as super admin / ALL / test@testtruck.com.

Visit invoice URL — expected 200.
Visit rate con URL — expected 200.

- [ ] **Step 9: Gate 5 — Visual quality**

Open one invoice PDF and one rate con PDF side by side.

Eyeball checklist:
- Text fits within page margins, nothing cut off at edges
- Line items table has consistent row spacing, visible borders on header
- Totals are right-aligned, formatted with $ and 2 decimals, "Total Due" is bold
- Dates render human-readable (e.g., "Apr 17, 2026", not "2026-04-17T00:00:00Z")
- Signature line on rate con renders as an actual line (not blank space)
- "RATE CONFIRMATION" and "INVOICE" are visually distinct headings
- No broken layout, no overlapping text, no missing fields showing as `undefined`

Intentionally plain — not beautiful, but intentionally plain, not broken. If anything looks outright wrong, file a bug and fix before moving on.

- [ ] **Step 10: Mark complete**

If all 5 gates pass, the 2a.1 infrastructure is shipped. Sub-project 2a.2 (email popup) can now import `archiveInvoicePdf` from `lib/pdf/archive.js` and invoke it on Send action, and attach the resulting PDF (rendered via the render helpers) to the outbound email.

---

## Self-review (plan author)

### Spec coverage

| Spec requirement | Implementing task |
|---|---|
| Install `@react-pdf/renderer` | Task 2 |
| Add `invoices.pdf_url` column | Task 1 |
| Add `order_charge_sets.rate_con_pdf_url` column | Task 1 |
| Create `documents` Storage bucket | Task 1 |
| RLS policies on `storage.objects` | Task 1 |
| `components/pdf/shared/Header.js` | Task 2 |
| `components/pdf/shared/LineItemsTable.js` | Task 2 |
| `components/pdf/shared/typography.js` | Task 2 |
| `lib/pdf/storage.js` (uploadPdfBuffer + getSignedUrl) | Task 2 |
| `components/pdf/InvoiceTemplate.js` | Task 3 |
| `lib/pdf/render-invoice.js` | Task 3 |
| `pages/api/tenant/pdf/invoice/[id].js` (Node runtime, permissions, archived-first) | Task 3 |
| `components/pdf/RateConTemplate.js` | Task 4 |
| `lib/pdf/render-rate-con.js` | Task 4 |
| `pages/api/tenant/pdf/rate-con/[id].js` (broader permissions) | Task 4 |
| `lib/pdf/archive.js` (archiveInvoicePdf + archiveRateConPdf) | Task 5 |
| Serve-archived-or-render logic | Tasks 3 + 4 (endpoint bodies) |
| Gate 1 (endpoint smoke) | Task 6 Steps 4-5 |
| Gate 2 (archival mock) | Task 6 Step 6 |
| Gate 3 (migration audit) | Task 6 Steps 3 + 7 |
| Gate 4 (permissions) | Task 6 Step 8 |
| Gate 5 (visual quality) | Task 6 Step 9 |
| Branch discipline check | All tasks, Step 1 |

No gaps detected.

### Placeholder scan

Scanned for: "TBD", "TODO", "implement later", "similar to Task N", "add appropriate error handling". No matches. Every code step has complete, concrete code blocks.

One intentional flex: Task 4 Step 3 notes that the FK hint names (`orders_pickup_location_id_fkey`) may need verification via grep — the alternative names aren't literally written, but the grep command pattern is exact. Implementer is directed to use whatever appears in existing consumers. Not a placeholder; an explicit verification step.

### Type consistency

- `renderInvoicePdf(svc, invoiceId, tenantId)` — defined Task 3, consumed in Tasks 3 endpoint and Task 5 archive.js.
- `renderRateConPdf(svc, chargeSetId, tenantId)` — defined Task 4, consumed in Task 4 endpoint and Task 5.
- `uploadPdfBuffer(svc, buffer, path)` — defined Task 2, consumed in Task 5.
- `getSignedUrl(svc, storagePath, ttlSeconds)` — defined Task 2, consumed in Tasks 3 + 4.
- `archiveInvoicePdf` / `archiveRateConPdf` — defined Task 5; consumed by nothing in 2a.1 (reserved for 2a.2).
- Storage paths: `{tenant_id}/invoices/{invoice_id}.pdf` and `{tenant_id}/rate-cons/{charge_set_id}.pdf` — consistent across Task 5 + endpoint logic + Gate 2 verification.
- DB column names: `invoices.pdf_url`, `order_charge_sets.rate_con_pdf_url` — consistent across migration, render helpers, endpoints, and archive helpers.

No inconsistencies.
