# AR Email Single-Send (2a.2 + 2a.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an end-to-end "click Approve & Invoice / Send Rate Con → email popup opens pre-populated with PDF attached → user reviews, hits Send or Skip → email dispatched + PDF archived + status flipped" workflow, plus an AR Configuration settings page for editing the subject/body templates.

**Architecture:** One shared right-side slide-over component (`EmailComposeSlideOver`), parameterized by `docType: 'invoice' | 'rate_con'`. Two new system `email_templates` rows (`invoice_send`, `rate_con_send`) with a new `category='ar'` column that keeps them out of the operational-templates list. Three GET endpoints feed the popup (email-defaults per doc type + templates read); three POST endpoints dispatch (send-email per doc type + invoice skip). Existing `lib/email-dispatch/dispatcher.js` + `providers/sendgrid.js` extended to forward attachments through to SendGrid's native `attachments` property. `email_trigger_log` + `email_messages` (existing two-table model from migration 053) receive the audit rows with `trigger_id=NULL` marking manual sends.

**Tech Stack:** Next.js Pages Router API routes (Node runtime for send endpoints, per 2a.1 precedent), React 19 + hooks, Tailwind (dark mode variants mandatory), Supabase service-role client for DB + Storage, `@react-pdf/renderer` (already installed from 2a.1), `@sendgrid/mail`.

**Spec:** [`docs/superpowers/specs/2026-04-18-ar-email-single-send-design.md`](../specs/2026-04-18-ar-email-single-send-design.md)

**Branch:** `main`. Before each commit: `git branch --show-current` must return `main`. If it ever returns anything else, STOP and report blocked — parallel Cowork sessions have been swapping branches mid-session (per `session_2026_04_17_handoff.md`).

**Testing:** Manual QA + targeted grep verification per task, matching the 2a.1 precedent. **Do NOT run `npm run build`** — wipes `.next/` and breaks the running dev server. A dev server is expected to already be running on port 3000 via `preview_start next-dev` — use `preview_logs` to watch for errors, don't spawn a second instance.

---

## Task 1: Migration 079 — schema changes + seeded AR templates

**Files:**
- Create: `supabase/migrations/079_ar_email_config.sql`

**Context:**
- Follows migration template: `BEGIN` / `COMMIT`, `IF NOT EXISTS` guards, ends with `NOTIFY pgrst, 'reload schema'` (per `dev_migration_template.md`).
- Extends `seed_system_email_templates_for_tenant()` (defined in migration 056) rather than replacing it — adds two more `INSERT ON CONFLICT DO NOTHING` blocks.
- User applies via Supabase Studio SQL editor (per the pattern used for migrations 076-078).

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

Expected: `main`.

- [ ] **Step 2: Create the migration file**

Write `supabase/migrations/079_ar_email_config.sql`:

```sql
-- ============================================================
-- Migration 079: AR email configuration
-- ============================================================
-- Adds the category column to email_templates so AR-specific
-- templates (invoice, rate confirmation) can be routed to a
-- dedicated settings section instead of the operational-templates
-- list. Seeds two new system templates per tenant and backfills
-- existing tenants. Adds optional audit columns on invoices for
-- tracking deliberate "Skip email" actions.
--
-- Supports sub-projects 2a.2 (invoice email popup) + 2a.3 (rate
-- confirmation email popup).
-- ============================================================

BEGIN;

-- ── email_templates.category ─────────────────────────────────
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'operational';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'email_templates'::regclass
      AND conname = 'email_templates_category_check'
  ) THEN
    ALTER TABLE email_templates
      ADD CONSTRAINT email_templates_category_check
      CHECK (category IN ('operational', 'ar'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_templates_tenant_category
  ON email_templates(tenant_id, category);

-- ── invoices.email_skipped_* audit columns ──────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS email_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_skipped_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ── Extend seed function to include invoice + rate-con ──────
CREATE OR REPLACE FUNCTION seed_system_email_templates_for_tenant(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  -- (Original 13 templates remain — see migration 056.
  --  We delegate to that function for the existing 13 and
  --  only add the two new AR-category rows here.)

  -- The previous definition of this function already inserts the
  -- 13 operational templates. Re-executing it before adding the
  -- new rows keeps them idempotent.
  -- We need to include the full original function body here OR
  -- call a sub-function. For safety, we keep this as an additive
  -- function that ONLY seeds the new AR rows — the operational
  -- seed continues to be owned by migration 056.

  -- ── AR #1: Invoice Send ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug, category,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Invoice Send',
    'Sent when an AR user dispatches an invoice to a customer via the email popup. Editable in Settings → AR Configuration → Invoice Email.',
    true,
    'invoice_send',
    'ar',
    'Invoice {{invoice.number}} from {{tenant.name}}',
    E'Hi {{customer.primary_contact_name}},\n\nPlease find attached invoice {{invoice.number}} for {{invoice.total}}, covering order {{load.order_number}} (reference {{invoice.reference_number}}).\n\nDue date: {{invoice.due_date}}.\n\nReply to this email to confirm receipt.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Please find attached invoice <strong>{{invoice.number}}</strong> for <strong>{{invoice.total}}</strong>, covering order <strong>{{load.order_number}}</strong> (reference {{invoice.reference_number}}).</p><p><strong>Due date:</strong> {{invoice.due_date}}</p><p>Reply to this email to confirm receipt.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── AR #2: Rate Confirmation Send ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug, category,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Rate Confirmation Send',
    'Sent when a dispatcher delivers a rate confirmation to a customer via the email popup. Editable in Settings → AR Configuration → Rate Con Email.',
    true,
    'rate_con_send',
    'ar',
    'Rate Confirmation {{charge_set.number}} — Order {{load.order_number}}',
    E'Hi {{customer.primary_contact_name}},\n\nAttached is the rate confirmation for order {{load.order_number}} (container {{container.number}}).\n\nPickup: {{pickup.name}}\nDelivery: {{delivery.name}}\nTotal: {{charge_set.total}}\n\nPlease reply to confirm.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Attached is the rate confirmation for order <strong>{{load.order_number}}</strong> (container {{container.number}}).</p><p><strong>Pickup:</strong> {{pickup.name}}<br/><strong>Delivery:</strong> {{delivery.name}}<br/><strong>Total:</strong> {{charge_set.total}}</p><p>Please reply to confirm.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- NOTE: The function above is REDEFINED (not just extended) because
-- CREATE OR REPLACE FUNCTION replaces the whole body. To avoid
-- losing the 13 operational templates from migration 056, we keep
-- that function's body intact and define our AR-specific seeding
-- as a separate function:

CREATE OR REPLACE FUNCTION seed_ar_email_templates_for_tenant(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  -- ── AR #1: Invoice Send ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug, category,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Invoice Send',
    'Sent when an AR user dispatches an invoice to a customer via the email popup. Editable in Settings → AR Configuration → Invoice Email.',
    true,
    'invoice_send',
    'ar',
    'Invoice {{invoice.number}} from {{tenant.name}}',
    E'Hi {{customer.primary_contact_name}},\n\nPlease find attached invoice {{invoice.number}} for {{invoice.total}}, covering order {{load.order_number}} (reference {{invoice.reference_number}}).\n\nDue date: {{invoice.due_date}}.\n\nReply to this email to confirm receipt.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Please find attached invoice <strong>{{invoice.number}}</strong> for <strong>{{invoice.total}}</strong>, covering order <strong>{{load.order_number}}</strong> (reference {{invoice.reference_number}}).</p><p><strong>Due date:</strong> {{invoice.due_date}}</p><p>Reply to this email to confirm receipt.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── AR #2: Rate Confirmation Send ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug, category,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Rate Confirmation Send',
    'Sent when a dispatcher delivers a rate confirmation to a customer via the email popup. Editable in Settings → AR Configuration → Rate Con Email.',
    true,
    'rate_con_send',
    'ar',
    'Rate Confirmation {{charge_set.number}} — Order {{load.order_number}}',
    E'Hi {{customer.primary_contact_name}},\n\nAttached is the rate confirmation for order {{load.order_number}} (container {{container.number}}).\n\nPickup: {{pickup.name}}\nDelivery: {{delivery.name}}\nTotal: {{charge_set.total}}\n\nPlease reply to confirm.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Attached is the rate confirmation for order <strong>{{load.order_number}}</strong> (container {{container.number}}).</p><p><strong>Pickup:</strong> {{pickup.name}}<br/><strong>Delivery:</strong> {{delivery.name}}<br/><strong>Total:</strong> {{charge_set.total}}</p><p>Please reply to confirm.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Auto-seed trigger for new tenants (AR templates) ────────
CREATE OR REPLACE FUNCTION trg_seed_ar_email_templates_fn()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_ar_email_templates_for_tenant(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_seed_ar_email_templates ON tenants;
CREATE TRIGGER trg_seed_ar_email_templates
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION trg_seed_ar_email_templates_fn();

-- ── Backfill existing active tenants with AR templates ──────
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants WHERE deleted_at IS NULL LOOP
    PERFORM seed_ar_email_templates_for_tenant(t.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**NOTE:** The first `CREATE OR REPLACE FUNCTION seed_system_email_templates_for_tenant` block in the file above is present for documentation only — it is NOT needed because we introduce a SEPARATE function `seed_ar_email_templates_for_tenant` so the 13-row operational function stays untouched. The implementer should DELETE the first block (the one between the "Extend seed function to include invoice + rate-con" comment and the "NOTE:" comment) before committing, keeping only:

1. Column additions (category + email_skipped_*)
2. `seed_ar_email_templates_for_tenant` function
3. `trg_seed_ar_email_templates_fn` trigger function
4. Trigger binding
5. Backfill DO block
6. `NOTIFY pgrst`
7. `COMMIT`

- [ ] **Step 3: Verify the migration file was written correctly**

```bash
grep -c "CREATE OR REPLACE FUNCTION seed_ar_email_templates_for_tenant" supabase/migrations/079_ar_email_config.sql
grep -c "ADD COLUMN IF NOT EXISTS category" supabase/migrations/079_ar_email_config.sql
grep -c "ADD COLUMN IF NOT EXISTS email_skipped_at" supabase/migrations/079_ar_email_config.sql
grep -c "ON CONFLICT (tenant_id, system_slug) DO NOTHING" supabase/migrations/079_ar_email_config.sql
```

Expected: `1`, `1`, `1`, `2` (two ON CONFLICT lines — one per INSERT).

- [ ] **Step 4: Commit the migration file**

User applies separately via Supabase Studio — we just commit the file.

```bash
git add supabase/migrations/079_ar_email_config.sql
git commit -m "$(cat <<'EOF'
feat(migration): AR email configuration — category + seeded templates (079)

Adds email_templates.category column (operational | ar) with CHECK
constraint so AR-specific templates can be filtered out of the
operational templates list. Adds invoices.email_skipped_at and
email_skipped_by for deliberate "Skip email" audit. Seeds two new
system templates per tenant (invoice_send, rate_con_send) via a
dedicated seed_ar_email_templates_for_tenant() function with
AFTER INSERT trigger on tenants + backfill for existing tenants.

Operational seed function (migration 056) remains untouched —
AR seeding is an additive, isolated flow.

User applies via Supabase Studio SQL editor. Spec: 
docs/superpowers/specs/2026-04-18-ar-email-single-send-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: AR template defaults + recipient resolver

**Files:**
- Create: `lib/email-dispatch/ar-template-defaults.js`
- Create: `lib/email-dispatch/recipient-resolver.js`

**Context:**
- `ar-template-defaults.js` holds the exact subject/body strings used by the migration's seed function, also used by the "Reset to default" action in the AR Configuration page.
- `recipient-resolver.js` implements the `customer_billing_emails` → `customers.billing_email` → empty fallback chain.
- Both are pure library files — no React, no endpoints, trivial to test with a node script if needed.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

- [ ] **Step 2: Write `lib/email-dispatch/ar-template-defaults.js`**

```js
/**
 * Default subject + body for AR email templates (invoice, rate con).
 *
 * These are the source of truth for:
 *   1. What migration 079 seeds into email_templates (invoice_send + rate_con_send rows)
 *   2. What the AR Configuration "Reset to default" action writes back
 *
 * Keep strings in this file byte-identical with the migration's seed INSERTs.
 * If either drifts, Reset behaves unexpectedly.
 */

export const AR_TEMPLATE_DEFAULTS = {
  invoice_send: {
    name: 'Invoice Send',
    description: 'Sent when an AR user dispatches an invoice to a customer via the email popup. Editable in Settings → AR Configuration → Invoice Email.',
    subject: 'Invoice {{invoice.number}} from {{tenant.name}}',
    body_text:
      'Hi {{customer.primary_contact_name}},\n\n' +
      'Please find attached invoice {{invoice.number}} for {{invoice.total}}, ' +
      'covering order {{load.order_number}} (reference {{invoice.reference_number}}).\n\n' +
      'Due date: {{invoice.due_date}}.\n\n' +
      'Reply to this email to confirm receipt.\n\n' +
      'Thank you,\n{{tenant.name}}',
    body_html:
      '<p>Hi {{customer.primary_contact_name}},</p>' +
      '<p>Please find attached invoice <strong>{{invoice.number}}</strong> for <strong>{{invoice.total}}</strong>, ' +
      'covering order <strong>{{load.order_number}}</strong> (reference {{invoice.reference_number}}).</p>' +
      '<p><strong>Due date:</strong> {{invoice.due_date}}</p>' +
      '<p>Reply to this email to confirm receipt.</p>' +
      '<p>Thank you,<br/>{{tenant.name}}</p>',
    body_format: 'plain',
  },

  rate_con_send: {
    name: 'Rate Confirmation Send',
    description: 'Sent when a dispatcher delivers a rate confirmation to a customer via the email popup. Editable in Settings → AR Configuration → Rate Con Email.',
    subject: 'Rate Confirmation {{charge_set.number}} — Order {{load.order_number}}',
    body_text:
      'Hi {{customer.primary_contact_name}},\n\n' +
      'Attached is the rate confirmation for order {{load.order_number}} ' +
      '(container {{container.number}}).\n\n' +
      'Pickup: {{pickup.name}}\n' +
      'Delivery: {{delivery.name}}\n' +
      'Total: {{charge_set.total}}\n\n' +
      'Please reply to confirm.\n\n' +
      'Thank you,\n{{tenant.name}}',
    body_html:
      '<p>Hi {{customer.primary_contact_name}},</p>' +
      '<p>Attached is the rate confirmation for order <strong>{{load.order_number}}</strong> ' +
      '(container {{container.number}}).</p>' +
      '<p><strong>Pickup:</strong> {{pickup.name}}<br/>' +
      '<strong>Delivery:</strong> {{delivery.name}}<br/>' +
      '<strong>Total:</strong> {{charge_set.total}}</p>' +
      '<p>Please reply to confirm.</p>' +
      '<p>Thank you,<br/>{{tenant.name}}</p>',
    body_format: 'plain',
  },
};

export const AR_SYSTEM_SLUGS = Object.keys(AR_TEMPLATE_DEFAULTS);

export function isArSystemSlug(slug) {
  return AR_SYSTEM_SLUGS.includes(slug);
}
```

- [ ] **Step 3: Write `lib/email-dispatch/recipient-resolver.js`**

```js
/**
 * Resolves the default recipient list for AR emails.
 *
 * Looks up per-type billing recipients first (customer_billing_emails
 * filtered by email_type) and falls back to the single-text
 * customers.billing_email column if no per-type rows exist.
 *
 * Used by the popup pre-fill endpoints (email-defaults) to populate
 * the To field when the slide-over opens.
 */

/**
 * @param {SupabaseClient} svc - service-role client
 * @param {string} customerId
 * @param {string} tenantId
 * @param {'invoice' | 'rate_confirmation'} emailType
 * @returns {Promise<{ to: string[], source: 'customer_billing_emails' | 'customer.billing_email' | 'none' }>}
 */
export async function resolveBillingRecipients(svc, customerId, tenantId, emailType) {
  if (!customerId) {
    return { to: [], source: 'none' };
  }

  // 1. Per-type rows
  const { data: typed, error: typedErr } = await svc
    .from('customer_billing_emails')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('email_type', emailType)
    .eq('is_active', true);

  if (typedErr) {
    throw new Error(`customer_billing_emails lookup failed: ${typedErr.message}`);
  }

  if (typed && typed.length > 0) {
    return {
      to: typed.map((r) => r.email).filter(Boolean),
      source: 'customer_billing_emails',
    };
  }

  // 2. Fallback to single-text column
  const { data: customer, error: custErr } = await svc
    .from('customers')
    .select('billing_email')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (custErr) {
    throw new Error(`customer fallback lookup failed: ${custErr.message}`);
  }

  if (customer?.billing_email) {
    return { to: [customer.billing_email], source: 'customer.billing_email' };
  }

  return { to: [], source: 'none' };
}
```

- [ ] **Step 4: Verify files**

```bash
grep -c "export" lib/email-dispatch/ar-template-defaults.js lib/email-dispatch/recipient-resolver.js
```

Expected: at least 4 exports total (3 from defaults, 1 from resolver).

- [ ] **Step 5: Commit**

```bash
git add lib/email-dispatch/ar-template-defaults.js lib/email-dispatch/recipient-resolver.js
git commit -m "$(cat <<'EOF'
feat(ar-email): AR template defaults + recipient resolver

Two small pure-library pieces feeding sub-project 2a.2/2a.3:

- ar-template-defaults.js: subject+body+body_format constants for
  invoice_send and rate_con_send. Source of truth for both the
  migration 079 seed and the "Reset to default" action.
- recipient-resolver.js: resolveBillingRecipients() implements the
  customer_billing_emails (per-type) → customers.billing_email
  (fallback) → empty chain used to pre-populate the To field in
  the email popup.

No endpoints or UI yet — those land in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Variable resolver + context builder extensions

**Files:**
- Modify: `lib/email-variable-resolver.js`
- Modify: `lib/email-dispatch/context-builder.js`

**Context:**
- The resolver currently handles `{{load.*}}`, `{{customer.*}}`, `{{driver.*}}`, `{{container.*}}`, `{{pickup.*}}`, `{{delivery.*}}`, `{{return.*}}`, `{{tenant.*}}`. We add `{{invoice.*}}` and `{{charge_set.*}}`.
- The context builder currently builds from a load id. We add builders that start from an invoice id or charge-set id, internally reusing the existing load context assembly to avoid SQL duplication.
- `{{invoice.total}}` / `{{charge_set.total}}` are formatted (`$1,234.56`), not raw integers. Match the formatting used by the existing invoice PDF template (`formatCents` helper).

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Read the current variable resolver**

```bash
grep -n "export " lib/email-variable-resolver.js | head -10
```

This surfaces the existing public API. The implementer MUST preserve existing exports and only ADD new ones. If the resolver uses a dispatch-style pattern (e.g., `resolveTokens(context, template)`), add the two new families via the same pattern.

- [ ] **Step 3: Add `{{invoice.*}}` + `{{charge_set.*}}` resolvers**

Find the existing token resolver in `lib/email-variable-resolver.js` — it is a dispatch from `family` (e.g., `load`, `customer`) to a `resolveX(context, field)` function OR a flat key-lookup on the context. Add:

```js
// Helper (place near other format helpers in this file)
function formatCents(cents) {
  if (cents == null) return '—';
  const num = Number(cents) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// {{invoice.*}} resolver
function resolveInvoiceToken(context, field) {
  const inv = context.invoice;
  if (!inv) return '';
  switch (field) {
    case 'number': return inv.invoice_number || '';
    case 'total': return formatCents(inv.total_amount_cents);
    case 'subtotal': return formatCents(inv.subtotal_cents);
    case 'due_date': return formatDate(inv.due_date);
    case 'issue_date': return formatDate(inv.sent_at || inv.created_at);
    case 'reference_number': return inv.reference_number || '';
    default: return '';
  }
}

// {{charge_set.*}} resolver
function resolveChargeSetToken(context, field) {
  const cs = context.charge_set;
  if (!cs) return '';
  switch (field) {
    case 'number': return cs.charge_set_number || '';
    case 'total': return formatCents(cs.total_cents);
    case 'reference_number': return cs.reference_number || '';
    default: return '';
  }
}
```

Then wire them into the existing dispatch (search for where `load`, `customer`, `driver` etc. are dispatched — add `invoice` and `charge_set` entries the same way).

- [ ] **Step 4: Extend `lib/email-dispatch/context-builder.js`**

Read the existing file first:

```bash
grep -n "export " lib/email-dispatch/context-builder.js | head -10
```

Identify the existing `buildLoadContext` (or equivalent) function. Then append:

```js
/**
 * Build a full variable-resolver context starting from an invoice id.
 * Hydrates: invoice, linked charge set(s), linked order, customer,
 * container, pickup/delivery locations, tenant.
 */
export async function buildInvoiceContext(svc, invoiceId, tenantId) {
  const { data: invoice, error } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, sent_at, created_at, due_date,
      subtotal_cents, total_amount_cents,
      customer_id,
      customer:customers!customer_id(id, name, billing_email, address_line1, address_line2, city, state, zip, payment_terms),
      charge_sets:invoice_charge_sets(
        charge_set:order_charge_sets(
          id, charge_set_number, total_cents,
          order:orders(id, order_number, customer_reference)
        )
      )
    `)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(`Invoice fetch failed: ${error.message}`);
  if (!invoice) throw new Error('Invoice not found');

  // Derive reference_number the same way the invoice PDF renderer does:
  // first non-null customer_reference from linked charge sets, else first order_number.
  const firstCs = invoice.charge_sets?.[0]?.charge_set;
  const referenceNumber =
    firstCs?.order?.customer_reference ||
    firstCs?.order?.order_number ||
    null;

  // Build a load-level context from the first linked order (if any).
  // Reuses existing buildLoadContext so token coverage matches non-AR sends.
  let loadContext = {};
  if (firstCs?.order?.id) {
    loadContext = await buildLoadContext(svc, firstCs.order.id, tenantId);
  }

  return {
    ...loadContext,
    invoice: {
      ...invoice,
      reference_number: referenceNumber,
    },
    charge_set: firstCs
      ? {
          ...firstCs,
          reference_number: referenceNumber,
        }
      : null,
  };
}

/**
 * Build a context starting from a charge-set id.
 */
export async function buildChargeSetContext(svc, chargeSetId, tenantId) {
  const { data: cs, error } = await svc
    .from('order_charge_sets')
    .select(`
      id, charge_set_number, total_cents, created_at,
      order_id,
      order:orders(id, order_number, customer_reference, customer_id)
    `)
    .eq('id', chargeSetId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Charge set fetch failed: ${error.message}`);
  if (!cs) throw new Error('Charge set not found');

  const referenceNumber = cs.order?.customer_reference || cs.order?.order_number || null;

  let loadContext = {};
  if (cs.order?.id) {
    loadContext = await buildLoadContext(svc, cs.order.id, tenantId);
  }

  return {
    ...loadContext,
    charge_set: {
      ...cs,
      reference_number: referenceNumber,
    },
  };
}
```

**If `buildLoadContext` is not exported from the current file**, either add an `export` to it OR inline its query here (preferring the former). The implementer chooses based on what minimizes risk.

- [ ] **Step 5: Sanity-check**

```bash
grep -c "buildInvoiceContext\|buildChargeSetContext" lib/email-dispatch/context-builder.js
grep -c "resolveInvoiceToken\|resolveChargeSetToken" lib/email-variable-resolver.js
```

Expected: `2` and `2` (one definition + one dispatch-registration each).

- [ ] **Step 6: Smoke check via node**

Throwaway script to verify the resolver works without blowing up. Create `tmp/smoke-resolver.mjs`:

```js
import { AR_TEMPLATE_DEFAULTS } from '../lib/email-dispatch/ar-template-defaults.js';
console.log('invoice subject template:', AR_TEMPLATE_DEFAULTS.invoice_send.subject);
console.log('rate_con subject template:', AR_TEMPLATE_DEFAULTS.rate_con_send.subject);
```

Run:

```bash
node tmp/smoke-resolver.mjs
```

Expected: prints the two subject templates. If import errors, fix them before proceeding. Delete `tmp/smoke-resolver.mjs` after.

- [ ] **Step 7: Commit**

```bash
git add lib/email-variable-resolver.js lib/email-dispatch/context-builder.js
git commit -m "$(cat <<'EOF'
feat(ar-email): variable resolver + context builder extensions

Adds {{invoice.*}} and {{charge_set.*}} token families to the
email variable resolver. Adds buildInvoiceContext and
buildChargeSetContext helpers that hydrate the full context tree
starting from an invoice id or charge-set id (both reuse the
existing buildLoadContext internally to share SQL).

Tokens exposed:
  {{invoice.number}} {{invoice.total}} {{invoice.subtotal}}
  {{invoice.due_date}} {{invoice.issue_date}} {{invoice.reference_number}}
  {{charge_set.number}} {{charge_set.total}} {{charge_set.reference_number}}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Attachment plumbing (dispatcher + SendGrid provider)

**Files:**
- Modify: `lib/email-dispatch/providers/sendgrid.js`
- Modify: `lib/email-dispatch/dispatcher.js`

**Context:**
- `@sendgrid/mail` accepts `attachments: [{ content: base64String, filename, type, disposition }]` on the msg passed to `send()`.
- The dispatcher currently passes a resolved `{ to, from, subject, text, html }` shape (or similar) to the provider. Add an optional `attachments` parameter that passes through unchanged — the provider handles the SendGrid-specific base64 encoding.

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Read current provider signature**

```bash
grep -n "async function send\|export async function\|exports.send" lib/email-dispatch/providers/sendgrid.js | head -5
```

Identify the current `send(msg, config)` signature. The implementer will add `attachments` to the `msg` shape OR as a separate parameter, matching whichever pattern the existing code uses.

- [ ] **Step 3: Extend `providers/sendgrid.js` to accept attachments**

Inside the provider's send function, after the existing msg construction, add:

```js
// Accept attachments from caller. Shape:
//   [{ content: Buffer, filename: string, type: string, disposition?: string }]
// SendGrid wants content as base64. Map in-place.
if (attachments && Array.isArray(attachments) && attachments.length > 0) {
  msg.attachments = attachments.map((a) => {
    const contentBuf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content);
    return {
      content: contentBuf.toString('base64'),
      filename: a.filename,
      type: a.type || 'application/octet-stream',
      disposition: a.disposition || 'attachment',
    };
  });
}
```

Make sure `attachments` is destructured from the function arg (or added to the function signature). If the current signature is `send(msg, config)`, change to `send(msg, config, attachments = [])` OR accept `msg.attachments` and process it — implementer picks based on call-site ergonomics.

- [ ] **Step 4: Thread attachments through `dispatcher.js`**

Find the call from dispatcher → provider (search for `providers.send(` or `provider.send(`). Add `attachments` forwarding. If the dispatcher's public entry point is `dispatchEmail({ templateId, context, recipients })`, extend to `dispatchEmail({ templateId, context, recipients, attachments })`.

Default parameter: `attachments = []`. Existing callers pass nothing → no change in behavior.

- [ ] **Step 5: Sanity-check**

```bash
grep -c "attachments" lib/email-dispatch/providers/sendgrid.js
grep -c "attachments" lib/email-dispatch/dispatcher.js
```

Expected: at least 3 matches in each (param + shape handling + pass-through).

- [ ] **Step 6: Smoke check — operational emails still work**

The existing operational templates (load_dispatched, etc.) pass NO attachments. With this change backward-compat should be preserved. Manual verification: open the app, trigger an operational event (e.g., dispatch a load if the test data has a configured trigger), confirm the email still renders in the preview/mock dispatcher (no errors in `preview_logs` filtered to `email-dispatch`).

Alternatively, add a unit-esque check — create `tmp/smoke-attachments.mjs`:

```js
// Verifies the attachment mapper handles both Buffer and string content
// without throwing. Does NOT call SendGrid.
const mapper = (a) => {
  const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content);
  return {
    content: buf.toString('base64'),
    filename: a.filename,
    type: a.type || 'application/octet-stream',
    disposition: a.disposition || 'attachment',
  };
};

const test1 = mapper({ content: Buffer.from('hello'), filename: 'a.pdf', type: 'application/pdf' });
const test2 = mapper({ content: 'world', filename: 'b.txt' });
console.log('buffer case:', test1);
console.log('string case:', test2);
console.log(test1.content === 'aGVsbG8=' ? 'OK: buffer encoded' : 'FAIL: buffer');
console.log(test2.disposition === 'attachment' ? 'OK: default disposition' : 'FAIL: disposition');
```

```bash
node tmp/smoke-attachments.mjs
```

Expected: both test cases print, both "OK" lines appear. Delete `tmp/smoke-attachments.mjs` after.

- [ ] **Step 7: Commit**

```bash
git add lib/email-dispatch/providers/sendgrid.js lib/email-dispatch/dispatcher.js
git commit -m "$(cat <<'EOF'
feat(ar-email): dispatcher + SendGrid provider attachment support

Extends the email dispatch chain to forward attachments through to
@sendgrid/mail's native attachments parameter:

- providers/sendgrid.js: accepts { content: Buffer | string,
  filename, type, disposition } and base64-encodes content for
  the wire format
- dispatcher.js: passes an optional attachments array from caller
  to provider with default=[] to preserve backward compatibility

Used by sub-project 2a.2/2a.3 to attach generated invoice/rate-con
PDFs. Operational email triggers remain unaffected (they pass no
attachments).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Template management endpoints

**Files:**
- Create: `pages/api/tenant/ar/config/email-templates/index.js`
- Create: `pages/api/tenant/ar/config/email-templates/[slug].js`
- Create: `pages/api/tenant/ar/config/email-templates/[slug]/reset.js`

**Context:**
- All three endpoints require permission `ACCOUNTS_RECEIVABLE` or `ALL`.
- The `[slug]` routes accept only `'invoice_send'` or `'rate_con_send'` — reject anything else with 400.
- Uses the existing `getServiceClient()` from `lib/tenant-api`.

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Create `index.js` (GET both rows)**

Write `pages/api/tenant/ar/config/email-templates/index.js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { AR_SYSTEM_SLUGS } from '../../../../../../lib/email-dispatch/ar-template-defaults';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  const { data, error } = await svc
    .from('email_templates')
    .select('id, system_slug, name, description, subject, body_text, body_html, body_format, updated_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('category', 'ar')
    .in('system_slug', AR_SYSTEM_SLUGS);

  if (error) return res.status(500).json({ error: error.message });

  // Shape: { invoice_send: {...}, rate_con_send: {...} }
  const byslug = {};
  for (const row of data || []) {
    byslug[row.system_slug] = row;
  }
  return res.status(200).json(byslug);
}
```

- [ ] **Step 3: Create `[slug].js` (PUT single row)**

Write `pages/api/tenant/ar/config/email-templates/[slug].js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { isArSystemSlug } from '../../../../../../lib/email-dispatch/ar-template-defaults';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { slug } = req.query;
  if (!isArSystemSlug(slug)) return res.status(400).json({ error: 'Unknown AR template slug' });

  const { subject, body_text, body_html, body_format } = req.body || {};
  if (typeof subject !== 'string' || typeof body_text !== 'string' || typeof body_html !== 'string') {
    return res.status(400).json({ error: 'subject, body_text, body_html are required' });
  }
  if (!['plain', 'html'].includes(body_format)) {
    return res.status(400).json({ error: 'body_format must be plain or html' });
  }

  const svc = getServiceClient();
  const { data, error } = await svc
    .from('email_templates')
    .update({ subject, body_text, body_html, body_format, updated_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId)
    .eq('system_slug', slug)
    .eq('category', 'ar')
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'AR template row not found' });
  return res.status(200).json(data);
}
```

- [ ] **Step 4: Create `[slug]/reset.js` (POST reset)**

Write `pages/api/tenant/ar/config/email-templates/[slug]/reset.js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../../lib/permissions';
import { AR_TEMPLATE_DEFAULTS, isArSystemSlug } from '../../../../../../../lib/email-dispatch/ar-template-defaults';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { slug } = req.query;
  if (!isArSystemSlug(slug)) return res.status(400).json({ error: 'Unknown AR template slug' });

  const defaults = AR_TEMPLATE_DEFAULTS[slug];

  const svc = getServiceClient();
  const { data, error } = await svc
    .from('email_templates')
    .update({
      subject: defaults.subject,
      body_text: defaults.body_text,
      body_html: defaults.body_html,
      body_format: defaults.body_format,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', ctx.tenantId)
    .eq('system_slug', slug)
    .eq('category', 'ar')
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'AR template row not found' });
  return res.status(200).json(data);
}
```

- [ ] **Step 5: Sanity-check**

```bash
grep -rn "isArSystemSlug\|AR_TEMPLATE_DEFAULTS" pages/api/tenant/ar/config/ | wc -l
```

Expected: at least 3 usages across the three files.

- [ ] **Step 6: Smoke check via curl (dev server must be running)**

```bash
# Replace COOKIE with a valid dev session cookie. Easiest path: open
# the browser devtools, Application → Cookies → copy the session cookie
# into a local shell var.
# This is a sanity curl, not a full test — just confirms the endpoint
# responds without crashing.
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tenant/ar/config/email-templates
```

Expected: 401 (if not authenticated) or 200 (if session cookie provided via the browser OR via `-H 'Cookie: ...'`). A 500 means something is wrong in the endpoint — fix before committing.

- [ ] **Step 7: Commit**

```bash
git add pages/api/tenant/ar/config/
git commit -m "$(cat <<'EOF'
feat(ar-email): template management endpoints

Three endpoints for the AR Configuration page to read/edit the
invoice_send and rate_con_send templates:

- GET  /api/tenant/ar/config/email-templates
  Returns both rows as { invoice_send: {...}, rate_con_send: {...} }
- PUT  /api/tenant/ar/config/email-templates/[slug]
  Updates subject/body_text/body_html/body_format on one row
- POST /api/tenant/ar/config/email-templates/[slug]/reset
  Overwrites row with AR_TEMPLATE_DEFAULTS (reuses the same
  constants the migration seeded)

Permission gate: ACCOUNTS_RECEIVABLE | ALL. Slug must be
invoice_send or rate_con_send (via isArSystemSlug).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: AR Configuration page + TemplateEditor component

**Files:**
- Create: `pages/settings/ar/configuration/index.js`
- Create: `components/settings/ar/TemplateEditor.js`

**Context:**
- Page has two tabs: "Invoice Email" and "Rate Con Email". Each tab renders `<TemplateEditor systemSlug="invoice_send" />` or `<TemplateEditor systemSlug="rate_con_send" />`.
- TemplateEditor is a self-contained form: fetches its own row, maintains dirty state, save button calls PUT, reset button shows confirm then calls POST reset.
- Variable picker shows the tokens relevant to the current doc type (invoice + shared, or charge_set + shared).
- Dark mode: every gray/white/border class must have a dark: variant per `dev_dark_mode_convention.md`.

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Write `components/settings/ar/TemplateEditor.js`**

```jsx
import { useEffect, useState } from 'react';

const INVOICE_TOKENS = [
  '{{invoice.number}}', '{{invoice.total}}', '{{invoice.subtotal}}',
  '{{invoice.due_date}}', '{{invoice.issue_date}}', '{{invoice.reference_number}}',
];
const RATE_CON_TOKENS = [
  '{{charge_set.number}}', '{{charge_set.total}}', '{{charge_set.reference_number}}',
];
const SHARED_TOKENS = [
  '{{customer.name}}', '{{customer.primary_contact_name}}',
  '{{load.order_number}}', '{{load.customer_reference}}',
  '{{container.number}}', '{{pickup.name}}', '{{delivery.name}}',
  '{{tenant.name}}',
];

export default function TemplateEditor({ systemSlug }) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Fetch the single row on mount / slug change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/tenant/ar/config/email-templates')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) { setError(d.error); return; }
        setRow(d[systemSlug] || null);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [systemSlug]);

  function updateField(field, value) {
    setRow((r) => ({ ...r, [field]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/ar/config/email-templates/${systemSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: row.subject,
          body_text: row.body_text,
          body_html: row.body_html,
          body_format: row.body_format,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setRow(data);
      setDirty(false);
      setToast({ type: 'success', message: 'Template saved' });
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (!window.confirm('Reset this template to the default subject and body? Your customizations will be overwritten.')) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/ar/config/email-templates/${systemSlug}/reset`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setRow(data);
      setDirty(false);
      setToast({ type: 'success', message: 'Template reset to default' });
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-gray-500 dark:text-slate-400">Loading template...</div>;
  if (error && !row) return <div className="text-sm text-red-600 dark:text-red-400">Error: {error}</div>;
  if (!row) return <div className="text-sm text-gray-500 dark:text-slate-400">Template not found. Did migration 079 run?</div>;

  const tokens = systemSlug === 'invoice_send' ? INVOICE_TOKENS : RATE_CON_TOKENS;

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`text-sm px-3 py-2 rounded ${toast.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'}`}>
          {toast.message}
        </div>
      )}
      {error && (
        <div className="text-sm px-3 py-2 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Subject</label>
        <input
          type="text"
          value={row.subject}
          onChange={(e) => updateField('subject', e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Body</label>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => updateField('body_format', 'plain')}
              className={`px-2 py-0.5 rounded ${row.body_format === 'plain' ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-slate-400'}`}
            >Plain</button>
            <button
              type="button"
              onClick={() => updateField('body_format', 'html')}
              className={`px-2 py-0.5 rounded ${row.body_format === 'html' ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-slate-400'}`}
            >HTML</button>
          </div>
        </div>
        <textarea
          rows={10}
          value={row.body_format === 'html' ? row.body_html : row.body_text}
          onChange={(e) => {
            if (row.body_format === 'html') updateField('body_html', e.target.value);
            else updateField('body_text', e.target.value);
          }}
          className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm font-mono"
        />
      </div>

      <div className="bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded p-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Available variables (click to copy)</div>
        <div className="flex flex-wrap gap-1.5">
          {[...tokens, ...SHARED_TOKENS].map((tok) => (
            <button
              key={tok}
              type="button"
              onClick={() => { navigator.clipboard?.writeText(tok); }}
              className="text-xs font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
            >{tok}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-slate-700">
        <button
          type="button"
          onClick={resetToDefault}
          disabled={saving}
          className="text-xs text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 disabled:opacity-50"
        >Reset to default</button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `pages/settings/ar/configuration/index.js`**

```jsx
import { useState } from 'react';
import Head from 'next/head';
import TemplateEditor from '../../../../components/settings/ar/TemplateEditor';
import TenantLayout from '../../../../components/layout/TenantLayout';

export default function ArConfigurationPage() {
  const [tab, setTab] = useState('invoice_send');

  return (
    <TenantLayout>
      <Head><title>AR Configuration · DrayageDirect</title></Head>

      <div className="max-w-3xl mx-auto py-6 px-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1">AR Configuration</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          Edit the default email templates used by the Send Invoice and Send Rate Confirmation popups.
        </p>

        <div className="border-b border-gray-200 dark:border-slate-700 mb-4 flex gap-4">
          <button
            type="button"
            onClick={() => setTab('invoice_send')}
            className={`pb-2 text-sm font-medium border-b-2 ${tab === 'invoice_send' ? 'border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 dark:text-slate-400'}`}
          >Invoice Email</button>
          <button
            type="button"
            onClick={() => setTab('rate_con_send')}
            className={`pb-2 text-sm font-medium border-b-2 ${tab === 'rate_con_send' ? 'border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 dark:text-slate-400'}`}
          >Rate Con Email</button>
        </div>

        <TemplateEditor key={tab} systemSlug={tab} />
      </div>
    </TenantLayout>
  );
}
```

**NOTE on TenantLayout import path:** verify the path for the existing layout wrapper used by other `/settings/*` pages. If the import above is wrong, match whatever `pages/settings/communications/templates/index.js` uses.

- [ ] **Step 4: Permission gating on the page**

The endpoints already gate by permission. The page also needs gating so non-AR users don't see a broken 403-heavy screen. Look at how other permission-gated settings pages do this (e.g., `pages/settings/communications/templates/index.js`'s permission check wrapper, if any) and match the pattern.

If the project uses a `<PermissionGate permissions={[...]}>` wrapper or equivalent, wrap the page. If the pattern is inline (`useMe`/`usePermission` hook + conditional redirect), use that.

- [ ] **Step 5: Sanity-check**

```bash
grep -c "TemplateEditor\|systemSlug" pages/settings/ar/configuration/index.js components/settings/ar/TemplateEditor.js
```

Expected: at least 4 total matches.

- [ ] **Step 6: Browser smoke check via preview tools**

Dev server should be running. Visit the new page:

```
http://localhost:3000/settings/ar/configuration
```

Expected: page renders with both tabs visible. Click Invoice Email tab → form populates from the DB row (subject + body showing). Click Rate Con Email tab → other form populates. Type a character → Save Changes button activates. Click Save → toast appears → button returns to "Saved" state. Click Reset to default → confirm → fields revert to migration defaults.

Use `preview_logs` filtered for errors after clicking around to make sure no server 500s happened:

```
preview_logs serverId=<next-dev-id> level=error lines=20
```

Expected: clean log, no `/api/tenant/ar/config` 500s.

- [ ] **Step 7: Commit**

```bash
git add pages/settings/ar/configuration/ components/settings/ar/TemplateEditor.js
git commit -m "$(cat <<'EOF'
feat(ar-email): AR Configuration settings page + TemplateEditor

New /settings/ar/configuration page with Invoice Email / Rate Con
Email tabs. Each tab hosts a TemplateEditor form that fetches,
edits, saves, and can reset its template row. Variable picker
sidebar shows doc-type-specific tokens plus universal tokens.
Plain/HTML body format toggle.

Dark mode variants on every gray/white/border class per
dev_dark_mode_convention.md. Permission gate at both the page
and the API layer (ACCOUNTS_RECEIVABLE | ALL).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Email-defaults endpoints (pre-fill for the popup)

**Files:**
- Create: `pages/api/tenant/ar/invoices/[id]/email-defaults.js`
- Create: `pages/api/tenant/ar/charge-sets/[id]/email-defaults.js`

**Context:**
- Called by the slide-over on open to populate To/Subject/Body in one round-trip.
- Each resolves: template row → variable context → resolved subject/body → recipient list → attachment metadata.
- Does NOT render the PDF here — that happens at send time. Attachment metadata is just filename + preview URL.

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Create `pages/api/tenant/ar/invoices/[id]/email-defaults.js`**

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { resolveBillingRecipients } from '../../../../../../lib/email-dispatch/recipient-resolver';
import { buildInvoiceContext } from '../../../../../../lib/email-dispatch/context-builder';
import { resolveTemplate } from '../../../../../../lib/email-variable-resolver';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  try {
    // 1. Build context (throws 'Invoice not found' if missing)
    const context = await buildInvoiceContext(svc, id, ctx.tenantId);

    // 2. Recipients
    const recipients = await resolveBillingRecipients(
      svc,
      context.invoice.customer_id,
      ctx.tenantId,
      'invoice'
    );

    // 3. Template
    const { data: template, error: tplErr } = await svc
      .from('email_templates')
      .select('subject, body_text, body_html, body_format')
      .eq('tenant_id', ctx.tenantId)
      .eq('system_slug', 'invoice_send')
      .eq('category', 'ar')
      .maybeSingle();
    if (tplErr) throw new Error(`Template lookup: ${tplErr.message}`);
    if (!template) throw new Error('invoice_send template not seeded — run migration 079');

    // 4. Resolve variables. `resolveTemplate` is the existing
    //    public API — confirm name in lib/email-variable-resolver.js
    //    if different, adjust below. Signature assumed:
    //    resolveTemplate(template, context) -> { subject, body_text, body_html }
    const resolved = resolveTemplate(template, context);

    return res.status(200).json({
      to: recipients.to,
      cc: [],
      bcc: [],
      subject: resolved.subject,
      body_text: resolved.body_text,
      body_html: resolved.body_html,
      body_format: template.body_format,
      recipients_source: recipients.source,
      attachment: {
        filename: `invoice-${context.invoice.invoice_number || id}.pdf`,
        preview_url: `/api/tenant/pdf/invoice/${id}`,
      },
    });
  } catch (e) {
    const status = e.message === 'Invoice not found' ? 404 : 500;
    return res.status(status).json({ error: e.message });
  }
}
```

**IMPORTANT:** the import `resolveTemplate` is illustrative. Before committing, grep `lib/email-variable-resolver.js` for its actual public API — it may be named `resolve`, `resolveTokens`, `renderTemplate`, etc. Use the real name.

- [ ] **Step 3: Create `pages/api/tenant/ar/charge-sets/[id]/email-defaults.js`**

Mirror of the invoice file, with the following swaps:

- Import `buildChargeSetContext` instead of `buildInvoiceContext`
- Permission set: `[PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL]`
- Recipient type: `'rate_confirmation'` (note the enum value is spelled with underscore, matching `billing_email_type_enum` from migration 001)
- Template slug: `'rate_con_send'`
- Error not-found message: `'Charge set not found'`
- Attachment filename: `rate-con-${context.charge_set.charge_set_number || id}.pdf`
- Attachment preview_url: `/api/tenant/pdf/rate-con/${id}`
- Recipient resolution starts from `context.charge_set?.order?.customer_id` (not invoice.customer_id). Verify path by reading the context-builder's return shape.

Write the complete file, don't reference "same as invoice" — the engineer may read tasks out of order.

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { resolveBillingRecipients } from '../../../../../../lib/email-dispatch/recipient-resolver';
import { buildChargeSetContext } from '../../../../../../lib/email-dispatch/context-builder';
import { resolveTemplate } from '../../../../../../lib/email-variable-resolver';

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

  try {
    const context = await buildChargeSetContext(svc, id, ctx.tenantId);

    const customerId = context.charge_set?.order?.customer_id || null;
    const recipients = await resolveBillingRecipients(
      svc, customerId, ctx.tenantId, 'rate_confirmation'
    );

    const { data: template, error: tplErr } = await svc
      .from('email_templates')
      .select('subject, body_text, body_html, body_format')
      .eq('tenant_id', ctx.tenantId)
      .eq('system_slug', 'rate_con_send')
      .eq('category', 'ar')
      .maybeSingle();
    if (tplErr) throw new Error(`Template lookup: ${tplErr.message}`);
    if (!template) throw new Error('rate_con_send template not seeded — run migration 079');

    const resolved = resolveTemplate(template, context);

    return res.status(200).json({
      to: recipients.to,
      cc: [],
      bcc: [],
      subject: resolved.subject,
      body_text: resolved.body_text,
      body_html: resolved.body_html,
      body_format: template.body_format,
      recipients_source: recipients.source,
      attachment: {
        filename: `rate-con-${context.charge_set.charge_set_number || id}.pdf`,
        preview_url: `/api/tenant/pdf/rate-con/${id}`,
      },
    });
  } catch (e) {
    const status = e.message === 'Charge set not found' ? 404 : 500;
    return res.status(status).json({ error: e.message });
  }
}
```

- [ ] **Step 4: Sanity-check**

```bash
grep -c "buildInvoiceContext\|buildChargeSetContext\|resolveBillingRecipients" pages/api/tenant/ar/invoices/\[id\]/email-defaults.js pages/api/tenant/ar/charge-sets/\[id\]/email-defaults.js
```

Expected: at least 4 total matches.

- [ ] **Step 5: Browser smoke check**

With a valid AR session, open in browser:

```
http://localhost:3000/api/tenant/ar/invoices/e4310b3a-3598-47e0-a066-38443467030c/email-defaults
```

(The TES001004 fixture from 2a.1 verification.) Expected: JSON response with `to`, `subject`, `body_text`, `recipients_source`, `attachment.filename`, `attachment.preview_url`. Subject should contain the resolved invoice number (not `{{invoice.number}}` raw).

Check `preview_logs` for any errors.

- [ ] **Step 6: Commit**

```bash
git add pages/api/tenant/ar/invoices/\[id\]/email-defaults.js pages/api/tenant/ar/charge-sets/\[id\]/email-defaults.js
git commit -m "$(cat <<'EOF'
feat(ar-email): popup pre-fill endpoints

Two GET endpoints feed the email compose slide-over with everything
it needs on open in one round-trip:

- /api/tenant/ar/invoices/[id]/email-defaults
- /api/tenant/ar/charge-sets/[id]/email-defaults

Each resolves: the AR template row (by system_slug + category='ar'),
recipient list via recipient-resolver (customer_billing_emails by
type → customers.billing_email fallback → empty), full variable
context, and attachment metadata (filename + preview URL pointing
at the 2a.1 PDF endpoint).

Permission gates: invoice endpoint is AR | ALL; charge-set endpoint
is ORDER_ENTRY | DISPATCHING | AR | ALL (mirrors the corresponding
PDF-serve endpoints).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Send + Skip endpoints

**Files:**
- Create: `pages/api/tenant/ar/invoices/[id]/send-email.js`
- Create: `pages/api/tenant/ar/invoices/[id]/skip-email.js`
- Create: `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`

**Context:**
- Send endpoints: archive → dispatch → status flip → log. All-or-nothing per spec section 9 (error handling matrix).
- Uses 2a.1's `archiveInvoicePdf` / `archiveRateConPdf` + the dispatcher's new `attachments` parameter.
- Node runtime explicitly — React-PDF render lives inside the archive helpers.
- Writes `email_trigger_log` + `email_messages` rows with `trigger_id=NULL` per spec section 10.

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Create `pages/api/tenant/ar/invoices/[id]/send-email.js`**

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { archiveInvoicePdf } from '../../../../../../lib/pdf/archive';
import { renderInvoicePdf } from '../../../../../../lib/pdf/render-invoice';
import { dispatchEmail } from '../../../../../../lib/email-dispatch/dispatcher';
import crypto from 'crypto';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { id: invoiceId } = req.query;
  const { to, cc, bcc, subject, body_text, body_html, body_format } = req.body || {};

  if (!Array.isArray(to) || to.length === 0) {
    return res.status(400).json({ error: 'At least one To recipient is required' });
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ error: 'Subject is required' });
  }

  const svc = getServiceClient();

  // Verify invoice exists + tenant-scoped + not already sent
  const { data: invoice, error: fetchErr } = await svc
    .from('invoices')
    .select('id, invoice_number, status, customer_id, sent_at')
    .eq('id', invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.sent_at) return res.status(409).json({ error: 'Invoice already sent' });

  // Render fresh buffer for the attachment (also populates archive)
  let pdfBuffer;
  let pdfStoragePath;
  try {
    pdfBuffer = await renderInvoicePdf(svc, invoiceId, ctx.tenantId);
    pdfStoragePath = await archiveInvoicePdf(svc, invoiceId, ctx.tenantId);
  } catch (e) {
    return res.status(500).json({ error: `Archive failed: ${e.message}`, stage: 'archive' });
  }

  // Dispatch email with attachment
  let dispatchResult;
  try {
    dispatchResult = await dispatchEmail({
      svc,
      tenantId: ctx.tenantId,
      templateSlug: 'invoice_send',
      resolvedSubject: subject,
      resolvedBodyText: body_text,
      resolvedBodyHtml: body_html,
      bodyFormat: body_format || 'plain',
      recipients: { to, cc: cc || [], bcc: bcc || [] },
      attachments: [{
        content: pdfBuffer,
        filename: `invoice-${invoice.invoice_number || invoiceId}.pdf`,
        type: 'application/pdf',
      }],
      relatedEntity: { type: 'invoice', id: invoiceId },
      sentByUserId: ctx.userId,
    });
  } catch (e) {
    // Archive succeeded (pdf_url set) but send failed.
    // Do NOT flip status. Return error so client can retry.
    return res.status(500).json({
      error: `Email dispatch failed: ${e.message}`,
      stage: 'dispatch',
      pdf_url: pdfStoragePath,
    });
  }

  // Flip status + sent_at
  const { error: updErr } = await svc
    .from('invoices')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .eq('tenant_id', ctx.tenantId);
  if (updErr) {
    // Email delivered but DB write failed — rare. Log for operator follow-up.
    console.error(`Invoice ${invoiceId}: email sent but status update failed:`, updErr.message);
    return res.status(500).json({
      error: `Email sent but status update failed: ${updErr.message}`,
      stage: 'status_update',
    });
  }

  return res.status(200).json({
    ok: true,
    sent_at: new Date().toISOString(),
    pdf_url: pdfStoragePath,
    message_ids: dispatchResult?.message_ids || [],
  });
}
```

**`dispatchEmail` contract note:** this plan assumes the dispatcher exposes a function matching the signature above (named/unnamed params, Buffer-typed attachments, returns message_ids). The actual `lib/email-dispatch/dispatcher.js` may use a different shape. Before committing, read the file and either (a) adjust the endpoint to match the real signature, or (b) add a small wrapper function `dispatchAdHoc(...)` to `dispatcher.js` that matches the shape above and delegates to the real internal.

Logging — the dispatcher is responsible for writing `email_trigger_log` + `email_messages`. If the current dispatcher only writes logs for triggered (not ad-hoc) sends, extend it to accept a `relatedEntity` parameter and write the log with `trigger_id=NULL`, `event_name='manual:invoice_send'`, and `decision_snapshot` including `{ invoice_id: ... }`. Keep this inside the dispatcher to centralize logging.

- [ ] **Step 3: Create `pages/api/tenant/ar/invoices/[id]/skip-email.js`**

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { logManualSkip } from '../../../../../../lib/email-dispatch/dispatcher';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { id: invoiceId } = req.query;
  const svc = getServiceClient();

  // Verify + audit columns
  const { data, error } = await svc
    .from('invoices')
    .update({
      email_skipped_at: new Date().toISOString(),
      email_skipped_by: ctx.userId,
    })
    .eq('id', invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .select('id, email_skipped_at, email_skipped_by, status')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Invoice not found' });

  // Log with outcome='skipped' (centralized logger so the behavior
  // matches Trigger Activity expectations).
  try {
    await logManualSkip({
      svc,
      tenantId: ctx.tenantId,
      templateSlug: 'invoice_send',
      relatedEntity: { type: 'invoice', id: invoiceId },
      sentByUserId: ctx.userId,
    });
  } catch (e) {
    // Audit-log failure is non-blocking. Record to server logs.
    console.error(`Invoice ${invoiceId} skip-log failed (non-blocking):`, e.message);
  }

  return res.status(200).json({ ok: true, ...data });
}
```

`logManualSkip` is a new export from `lib/email-dispatch/dispatcher.js` that writes a single `email_trigger_log` row with `outcome='skipped'`, `trigger_id=NULL`, no `email_messages` rows. Add it to the dispatcher file.

- [ ] **Step 4: Create `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`**

Mirror of the invoice send endpoint:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { archiveRateConPdf } from '../../../../../../lib/pdf/archive';
import { renderRateConPdf } from '../../../../../../lib/pdf/render-rate-con';
import { dispatchEmail } from '../../../../../../lib/email-dispatch/dispatcher';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res
  )) return;

  const { id: chargeSetId } = req.query;
  const { to, cc, bcc, subject, body_text, body_html, body_format } = req.body || {};

  if (!Array.isArray(to) || to.length === 0) return res.status(400).json({ error: 'At least one To recipient is required' });
  if (typeof subject !== 'string' || !subject.trim()) return res.status(400).json({ error: 'Subject is required' });

  const svc = getServiceClient();

  const { data: cs, error: fetchErr } = await svc
    .from('order_charge_sets')
    .select('id, charge_set_number, status')
    .eq('id', chargeSetId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!cs) return res.status(404).json({ error: 'Charge set not found' });

  let pdfBuffer;
  let pdfStoragePath;
  try {
    pdfBuffer = await renderRateConPdf(svc, chargeSetId, ctx.tenantId);
    pdfStoragePath = await archiveRateConPdf(svc, chargeSetId, ctx.tenantId);
  } catch (e) {
    return res.status(500).json({ error: `Archive failed: ${e.message}`, stage: 'archive' });
  }

  let dispatchResult;
  try {
    dispatchResult = await dispatchEmail({
      svc,
      tenantId: ctx.tenantId,
      templateSlug: 'rate_con_send',
      resolvedSubject: subject,
      resolvedBodyText: body_text,
      resolvedBodyHtml: body_html,
      bodyFormat: body_format || 'plain',
      recipients: { to, cc: cc || [], bcc: bcc || [] },
      attachments: [{
        content: pdfBuffer,
        filename: `rate-con-${cs.charge_set_number || chargeSetId}.pdf`,
        type: 'application/pdf',
      }],
      relatedEntity: { type: 'charge_set', id: chargeSetId },
      sentByUserId: ctx.userId,
    });
  } catch (e) {
    return res.status(500).json({
      error: `Email dispatch failed: ${e.message}`,
      stage: 'dispatch',
      rate_con_pdf_url: pdfStoragePath,
    });
  }

  const { error: updErr } = await svc
    .from('order_charge_sets')
    .update({ status: 'rate_con_sent' })
    .eq('id', chargeSetId)
    .eq('tenant_id', ctx.tenantId);
  if (updErr) {
    console.error(`Charge set ${chargeSetId}: email sent but status update failed:`, updErr.message);
    return res.status(500).json({
      error: `Email sent but status update failed: ${updErr.message}`,
      stage: 'status_update',
    });
  }

  return res.status(200).json({
    ok: true,
    rate_con_pdf_url: pdfStoragePath,
    message_ids: dispatchResult?.message_ids || [],
  });
}
```

- [ ] **Step 5: Sanity-check**

```bash
grep -c "archiveInvoicePdf\|archiveRateConPdf\|dispatchEmail\|logManualSkip" pages/api/tenant/ar/invoices/\[id\]/send-email.js pages/api/tenant/ar/invoices/\[id\]/skip-email.js pages/api/tenant/ar/charge-sets/\[id\]/send-rate-con-email.js
```

Expected: at least 6 total matches.

- [ ] **Step 6: Commit**

```bash
git add pages/api/tenant/ar/invoices/\[id\]/send-email.js pages/api/tenant/ar/invoices/\[id\]/skip-email.js pages/api/tenant/ar/charge-sets/\[id\]/send-rate-con-email.js lib/email-dispatch/dispatcher.js
git commit -m "$(cat <<'EOF'
feat(ar-email): send + skip endpoints

Three new endpoints:
- POST /api/tenant/ar/invoices/[id]/send-email
- POST /api/tenant/ar/invoices/[id]/skip-email
- POST /api/tenant/ar/charge-sets/[id]/send-rate-con-email

Send path: render PDF → archive to Storage (populates pdf_url /
rate_con_pdf_url) → dispatch email with attachment → flip status
(invoice.status='sent' + sent_at=now() OR charge_set.status=
'rate_con_sent'). All-or-nothing: archive failure aborts before
dispatch; dispatch failure preserves pdf_url but doesn't flip
status; status failure after successful send is logged for
operator follow-up.

Skip path (invoice only): sets invoices.email_skipped_at /
email_skipped_by. Stays in draft. Non-blocking trigger-log write
for Trigger Activity visibility.

Dispatcher extended with dispatchEmail + logManualSkip exports
so logging stays centralized.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: EmailComposeSlideOver component + useEmailCompose hook

**Files:**
- Create: `components/ar/EmailComposeSlideOver.js`
- Create: `hooks/useEmailCompose.js`

**Context:**
- Shared slide-over, parameterized by `docType`.
- Handles all four form states per spec: loading, ready, sending, error.
- ESC/click-outside closes — confirm if dirty.
- Recipient chips parsed on comma/Enter/paste.

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Write `hooks/useEmailCompose.js`**

```jsx
import { useState, useCallback } from 'react';

export function useEmailCompose() {
  const [state, setState] = useState({ open: false, docType: null, contextId: null });

  const open = useCallback((docType, contextId) => {
    setState({ open: true, docType, contextId });
  }, []);

  const close = useCallback(() => {
    setState({ open: false, docType: null, contextId: null });
  }, []);

  return { ...state, open, close };
}
```

- [ ] **Step 3: Write `components/ar/EmailComposeSlideOver.js`**

```jsx
import { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';

function RecipientInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');

  function commit(text) {
    const parts = text
      .split(/[,\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange([...value, ...parts]);
    setDraft('');
  }

  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap gap-1 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded px-2 py-1.5 min-h-[36px]">
      {value.map((addr, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs">
          {addr}
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="hover:text-blue-900 dark:hover:text-blue-100">×</button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,;\n]/.test(text)) { e.preventDefault(); commit(text); }
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-gray-900 dark:text-slate-100"
      />
    </div>
  );
}

export default function EmailComposeSlideOver({
  open,
  onClose,
  docType,             // 'invoice' | 'rate_con'
  contextId,
  onSent,
  onSkipped,
}) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState(null);
  const [fetchError, setFetchError] = useState(null);

  const [to, setTo] = useState([]);
  const [cc, setCc] = useState([]);
  const [bcc, setBcc] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bodyFormat, setBodyFormat] = useState('plain');
  const [attachment, setAttachment] = useState(null);
  const [recipientsSource, setRecipientsSource] = useState('none');

  const [ccVisible, setCcVisible] = useState(false);
  const [bccVisible, setBccVisible] = useState(false);
  const [dirty, setDirty] = useState(false);

  const initialLoadDoneRef = useRef(false);

  // Load defaults on open
  useEffect(() => {
    if (!open || !contextId) return;
    initialLoadDoneRef.current = false;
    setLoading(true);
    setError(null);
    setFetchError(null);
    setDirty(false);

    const url = docType === 'invoice'
      ? `/api/tenant/ar/invoices/${contextId}/email-defaults`
      : `/api/tenant/ar/charge-sets/${contextId}/email-defaults`;

    fetch(url)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Load failed');
        setTo(d.to || []);
        setCc([]);
        setBcc([]);
        setSubject(d.subject || '');
        setBody(d.body_format === 'html' ? d.body_html : d.body_text);
        setBodyFormat(d.body_format || 'plain');
        setAttachment(d.attachment || null);
        setRecipientsSource(d.recipients_source || 'none');
        initialLoadDoneRef.current = true;
      })
      .catch((e) => setFetchError(e.message))
      .finally(() => setLoading(false));
  }, [open, contextId, docType]);

  // Dirty-state tracker. Any change after initial load marks dirty.
  function markDirty() {
    if (initialLoadDoneRef.current) setDirty(true);
  }

  // Attempted close — confirm if dirty
  function attemptClose() {
    if (dirty && !window.confirm('Discard changes?')) return;
    onClose();
  }

  // ESC key closes (with dirty confirm)
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') attemptClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const hasValidTo = to.length > 0 && to.every((e) => /^\S+@\S+\.\S+$/.test(e));
  const canSend = hasValidTo && subject.trim() !== '' && !sending && !skipping;

  async function doSend() {
    setSending(true);
    setError(null);
    const url = docType === 'invoice'
      ? `/api/tenant/ar/invoices/${contextId}/send-email`
      : `/api/tenant/ar/charge-sets/${contextId}/send-rate-con-email`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to, cc, bcc, subject,
          body_text: bodyFormat === 'plain' ? body : '',
          body_html: bodyFormat === 'html' ? body : '',
          body_format: bodyFormat,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      onSent?.(data);
      setDirty(false);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function doSkip() {
    if (docType !== 'invoice') return; // guard
    setSkipping(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/ar/invoices/${contextId}/skip-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Skip failed');
      onSkipped?.(data);
      setDirty(false);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSkipping(false);
    }
  }

  if (!open) return null;

  const title = docType === 'invoice' ? 'Send Invoice' : 'Send Rate Confirmation';

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={attemptClose} />

      {/* Drawer */}
      <div className="absolute top-0 right-0 bottom-0 w-full max-w-[540px] bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
          <button type="button" onClick={attemptClose} className="text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading && <div className="text-sm text-gray-500 dark:text-slate-400">Loading…</div>}
          {fetchError && <div className="text-sm text-red-600 dark:text-red-400">Failed to load: {fetchError}</div>}

          {!loading && !fetchError && (
            <>
              {recipientsSource === 'none' && (
                <div className="text-xs px-3 py-2 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
                  No billing email on file for this customer. Type a recipient to send, or skip to save as draft.
                </div>
              )}
              {recipientsSource === 'customer.billing_email' && (
                <div className="text-xs px-3 py-2 rounded bg-gray-50 dark:bg-slate-800/50 text-gray-600 dark:text-slate-400">
                  Using fallback billing email. Add {docType === 'invoice' ? 'invoice' : 'rate-confirmation'}-specific recipients in customer settings.
                </div>
              )}

              <div>
                <label className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">To</label>
                <RecipientInput value={to} onChange={(v) => { setTo(v); markDirty(); }} placeholder="customer@example.com" />
              </div>

              <div className="flex gap-3 text-xs">
                {!ccVisible && <button type="button" onClick={() => setCcVisible(true)} className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300">+ Add CC</button>}
                {!bccVisible && <button type="button" onClick={() => setBccVisible(true)} className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300">+ Add BCC</button>}
              </div>

              {ccVisible && (
                <div>
                  <label className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">CC</label>
                  <RecipientInput value={cc} onChange={(v) => { setCc(v); markDirty(); }} placeholder="cc@example.com" />
                </div>
              )}

              {bccVisible && (
                <div>
                  <label className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">BCC</label>
                  <RecipientInput value={bcc} onChange={(v) => { setBcc(v); markDirty(); }} placeholder="bcc@example.com" />
                </div>
              )}

              <div>
                <label className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => { setSubject(e.target.value); markDirty(); }}
                  className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Body</label>
                <textarea
                  rows={10}
                  value={body}
                  onChange={(e) => { setBody(e.target.value); markDirty(); }}
                  className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
                />
              </div>

              {attachment && (
                <div className="flex items-center justify-between px-3 py-2 rounded bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-xs">
                  <span className="text-gray-700 dark:text-slate-300">📎 {attachment.filename}</span>
                  <a href={attachment.preview_url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Preview ↗</a>
                </div>
              )}

              {error && (
                <div className="text-xs px-3 py-2 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">{error}</div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
          {docType === 'invoice' ? (
            <button
              type="button"
              onClick={doSkip}
              disabled={sending || skipping}
              className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 disabled:opacity-50"
            >{skipping ? 'Skipping…' : 'Skip'}</button>
          ) : (
            <button
              type="button"
              onClick={attemptClose}
              disabled={sending}
              className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 disabled:opacity-50"
            >Cancel</button>
          )}
          <button
            type="button"
            onClick={doSend}
            disabled={!canSend}
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Sanity-check**

```bash
grep -c "EmailComposeSlideOver\|useEmailCompose" components/ar/EmailComposeSlideOver.js hooks/useEmailCompose.js
```

Expected: at least 2 matches.

- [ ] **Step 5: Commit**

```bash
git add components/ar/EmailComposeSlideOver.js hooks/useEmailCompose.js
git commit -m "$(cat <<'EOF'
feat(ar-email): EmailComposeSlideOver + useEmailCompose hook

Shared right-anchored slide-over for single-send email compose.
Parameterized by docType ('invoice' | 'rate_con') + contextId.
Fetches defaults from the new email-defaults endpoint on open,
calls the matching send/skip endpoint on action.

Features:
- Chip-based recipient inputs (parse comma/Enter/paste, backspace
  to remove, blur commits)
- Collapsed CC / BCC behind "+ Add" chips
- Plain / HTML body toggle (reuses template's format by default)
- Attachment chip with Preview link
- Dirty-state protection (confirm-to-close if user has edited)
- ESC closes
- Amber banner for no-recipients-on-file, grey banner for fallback
- Invoice variant shows Skip; rate-con variant shows Cancel
- Send disabled until at least one valid-looking To address

Dark mode variants on every gray/white/border class per
dev_dark_mode_convention.md.

useEmailCompose hook is a thin { open, close, state } wrapper so
entry points can open the slide-over with one line.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire BillingTab entry points

**Files:**
- Modify: `components/loads/tabs/BillingTab.js`

**Context:**
- Two buttons on the load Billing tab: "Approve & Invoice" (creates invoice, today no popup) and "Send Rate Con" (today status-flip only). Both now open the slide-over.
- After Approve & Invoice succeeds (creates the invoice record), we have the new invoice id → feed it to `openEmailCompose('invoice', invoiceId)`.
- Send Rate Con no longer flips status client-side — the server handles it inside `/send-rate-con-email` on Send. If user Cancels, nothing changes (by design, per spec).

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Read BillingTab.js to identify the two buttons + surrounding state**

```bash
grep -n "Approve & Invoice\|approve.*invoice\|Send Rate Con\|updateStatus.*rate_con" components/loads/tabs/BillingTab.js
```

Note the line numbers and the functions that handle each click. Also identify how the tab currently invalidates/refreshes its data (React Query / SWR / manual refetch) so after Sent/Skipped the UI updates.

- [ ] **Step 3: Import the slide-over and hook at the top of BillingTab.js**

```jsx
import EmailComposeSlideOver from '../../ar/EmailComposeSlideOver';
import { useEmailCompose } from '../../../hooks/useEmailCompose';
```

Adjust relative paths based on the actual file location.

- [ ] **Step 4: Add hook state inside the component**

Near other `useState` declarations:

```jsx
const emailCompose = useEmailCompose();
```

- [ ] **Step 5: Upgrade the Approve & Invoice handler**

Find the existing handler (likely `handleApproveAndInvoice` or inline). After the existing success path that creates the invoice record and returns the new invoice id:

```jsx
// After existing invoice-creation success:
emailCompose.open('invoice', newInvoiceId);
```

The tab refresh should happen `onSent` / `onSkipped` rather than synchronously — the user may still cancel. Keep the invoice created regardless of popup outcome (matches today's no-popup behavior).

- [ ] **Step 6: Upgrade the Send Rate Con handler**

Find the existing handler (likely `onClick={() => updateStatus('rate_con_sent')}`). Replace with:

```jsx
onClick={() => emailCompose.open('rate_con', chargeSet.id)}
```

Leave the old `updateStatus('rate_con_sent')` function available in case another code path still uses it (grep first to check).

- [ ] **Step 7: Render the slide-over at the bottom of the component's return**

```jsx
<EmailComposeSlideOver
  open={emailCompose.open}
  onClose={emailCompose.close}
  docType={emailCompose.docType}
  contextId={emailCompose.contextId}
  onSent={() => {
    emailCompose.close();
    refreshBilling(); // call the tab's existing refresh hook
  }}
  onSkipped={() => {
    emailCompose.close();
    refreshBilling();
  }}
/>
```

**CAREFUL:** `emailCompose.open` is both the state boolean AND the action function — rename one to avoid the conflict. Example:

```jsx
const { open: isOpen, docType, contextId, open: openCompose, close: closeCompose } = useEmailCompose();
```

Rename the hook's returned keys for clarity. This is worth doing cleanly — ambiguity here is a recipe for silent bugs.

- [ ] **Step 8: Smoke check in browser**

Open a test load's Billing tab with a charge set in a pre-invoice status. Click Send Rate Con → drawer slides in → Cancel → drawer closes, nothing changed. Click Send Rate Con → Send → toast + status flips to rate_con_sent. Click Approve & Invoice → drawer opens on the new invoice → Skip → invoice stays draft. Re-open, Send → invoice status=sent.

Check `preview_logs` for errors.

- [ ] **Step 9: Commit**

```bash
git add components/loads/tabs/BillingTab.js
git commit -m "$(cat <<'EOF'
feat(ar-email): wire BillingTab Approve & Invoice + Send Rate Con

Load detail's Billing tab now opens the EmailComposeSlideOver on:
- Approve & Invoice (after invoice record is created, feeds the
  new invoice id to the popup in docType='invoice' mode)
- Send Rate Con (replaces the bare client-side status flip — the
  server-side /send-rate-con-email handler flips status only on
  successful Send; Cancel leaves the charge set unchanged)

Billing tab refreshes after Sent or Skipped so the UI reflects the
new invoice status / charge-set status without a manual reload.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire AR Invoices tab Send button + AR Pipeline per-row action

**Files:**
- Modify: the AR Invoices tab file (grep to find — likely `components/ar/InvoicesTab.js` or `pages/ar/invoices/index.js`)
- Modify: `components/ar/BillingPipelineTab.js` (per-row Approve & Invoice action for single rows)

**Context:**
- AR Invoices tab has a `Send` button that today flips status to `sent` with no email. Replace with slide-over invocation.
- AR Pipeline's single-row "Approve & Invoice" action (per-row menu or row-level button) also opens the slide-over. Bulk action (multi-row) is UNCHANGED — that's 2a.4 scope.

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Locate the AR Invoices tab Send button**

```bash
grep -rn "Send\|send_invoice\|updateInvoiceStatus.*sent" components/ar/ pages/ar/ --include='*.js' | head -20
```

Identify the file with the button. If it's a table row action, the import path may need adjusting for `useEmailCompose` and `EmailComposeSlideOver`.

- [ ] **Step 3: Wire the Send button**

Same pattern as BillingTab:

```jsx
import EmailComposeSlideOver from '../../components/ar/EmailComposeSlideOver';
import { useEmailCompose } from '../../hooks/useEmailCompose';

// Inside component:
const emailCompose = useEmailCompose();

// Replace old Send handler:
onClick={() => emailCompose.open('invoice', invoice.id)}

// Render drawer near component root:
<EmailComposeSlideOver
  open={emailCompose.isOpen}  // (use whatever rename you picked in Task 10)
  ...
/>
```

- [ ] **Step 4: Locate the AR Pipeline per-row Approve & Invoice action**

```bash
grep -n "Approve.*Invoice\|approveAndInvoice" components/ar/BillingPipelineTab.js
```

Find the single-row (not bulk) handler. The bulk path processes N rows in a loop without the popup — leave alone.

- [ ] **Step 5: Wire the per-row Approve & Invoice**

After the existing single-row invoice-creation success path:

```jsx
emailCompose.open('invoice', newInvoiceId);
```

- [ ] **Step 6: Render the drawer in BillingPipelineTab**

Same pattern.

- [ ] **Step 7: Smoke check**

Open `/ar/invoices` → click Send on a draft invoice → drawer opens → Skip → closes without status change, toast. Send → status flips to sent.

Open `/ar` pipeline → click Approve & Invoice on a single approved charge set row → drawer opens on the new invoice.

- [ ] **Step 8: Commit**

```bash
git add <the-modified-files>
git commit -m "$(cat <<'EOF'
feat(ar-email): wire AR Invoices Send + Pipeline per-row Approve & Invoice

AR Invoices tab: the Send button on each draft invoice row now
opens EmailComposeSlideOver instead of silently flipping status.

AR Pipeline (BillingPipelineTab): the per-row Approve & Invoice
action opens the slide-over after invoice creation. Bulk action
(multi-row selection) path unchanged — that's 2a.4 scope.

Both refresh their parent list / pipeline after Sent or Skipped
so card counts and status chips update live.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Filter existing communications templates list

**Files:**
- Modify: `pages/settings/communications/templates/index.js` (OR the API that feeds it — likely `pages/api/tenant/emails/templates/index.js`)
- Modify: `pages/settings/communications/templates/[id].js` (redirect or 404 for AR-category rows)

**Context:**
- AR templates should NOT appear in the operational-templates list at `/settings/communications/templates`. They're managed separately at `/settings/ar/configuration`.
- Two change points: the list query adds `.eq('category', 'operational')`; the detail page checks `category === 'ar'` and redirects / 404s.

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```

- [ ] **Step 2: Add category filter to list API**

```bash
grep -n "from('email_templates')" pages/api/tenant/emails/templates/index.js
```

Find the `.select(...)` / `.eq(...)` chain. Add `.eq('category', 'operational')` to it.

- [ ] **Step 3: Update detail page to block AR rows**

In `pages/settings/communications/templates/[id].js`, after fetching the row, add:

```jsx
if (template.category === 'ar') {
  // Redirect to the AR Configuration page
  return { redirect: { destination: '/settings/ar/configuration', permanent: false } };
}
```

If the page uses client-side fetching instead of getServerSideProps, do the equivalent client-side redirect via `router.replace('/settings/ar/configuration')`.

- [ ] **Step 4: Smoke check**

Load `/settings/communications/templates` — confirm 13 operational templates appear, no `Invoice Send` / `Rate Confirmation Send` rows. Then try to navigate directly to `/settings/communications/templates/<invoice_send_id>` — should redirect to `/settings/ar/configuration`.

- [ ] **Step 5: Commit**

```bash
git add pages/api/tenant/emails/templates/index.js pages/settings/communications/templates/\[id\].js
git commit -m "$(cat <<'EOF'
feat(ar-email): hide AR templates from operational templates list

Operational /settings/communications/templates list filters to
category='operational', so the two new AR system templates
(invoice_send, rate_con_send) only appear in the dedicated
/settings/ar/configuration page.

Detail page /settings/communications/templates/[id] redirects to
AR Configuration if someone deep-links an AR row (prevents two
editors pointing at the same row).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Push + full verification gates

**Files:** (none)

**Context:** All 11 code commits land. User has applied migration 079. Push to origin and walk the gates.

- [ ] **Step 1: Verify local main has the new commits**

```bash
git log --oneline -15
```

Expected: top commits are migration 079, AR template defaults, resolver extensions, attachment plumbing, template endpoints, AR Configuration page, email-defaults endpoints, send/skip endpoints, slide-over, BillingTab wiring, AR tabs wiring, list filter.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Confirm migration 079 applied**

Ask user to run in Supabase Studio if not already:

```sql
-- Expected: 1 row — category column exists with CHECK
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='email_templates' AND column_name='category';

-- Expected: 2 rows
SELECT column_name FROM information_schema.columns
  WHERE table_name='invoices' AND column_name IN ('email_skipped_at','email_skipped_by');

-- Expected: 2 rows per tenant (minimum N×2 if N tenants)
SELECT system_slug, category, COUNT(*) FROM email_templates
  WHERE system_slug IN ('invoice_send','rate_con_send')
  GROUP BY system_slug, category;

-- Expected: operational = 13 per tenant, ar = 2 per tenant (for tenants backfilled)
SELECT category, COUNT(*) FROM email_templates
  GROUP BY category;
```

- [ ] **Step 4: Gate 1 — AR Configuration page loads + edits**

Browse to `http://localhost:3000/settings/ar/configuration` as an AR user:
- Both tabs render with defaults
- Edit subject → Save → success toast → reload page → change persisted
- Reset to default → confirm → subject reverts
- Variable picker chips visible and match doc type

Expected: all pass.

- [ ] **Step 5: Gate 2 — Invoice Send end-to-end**

As an AR user on a load with an approved charge set:
- Click Approve & Invoice → invoice created, slide-over opens
- `To` pre-populated with customer's invoice-type billing email (or fallback, or amber banner)
- Subject contains the resolved invoice number
- Body contains resolved customer name, total, due date
- Attachment chip shows `invoice-<number>.pdf` with working Preview link
- Edit the subject → dirty state → close → confirm prompt
- Reopen, hit Send → drawer closes, toast
- Reload Billing tab → charge set + invoice show `sent`, `sent_at` populated
- Check Storage in Supabase Studio → `{tenant_id}/invoices/<id>.pdf` exists
- Check Trigger Activity → one new `email_trigger_log` row with `trigger_id=NULL`, `outcome='fired'`, linked `email_messages` row(s)

- [ ] **Step 6: Gate 3 — Invoice Skip**

Create another draft invoice. Click Send from AR Invoices tab → drawer opens → click Skip.

Expected:
- Drawer closes, toast "Invoice saved as draft"
- `invoices.email_skipped_at` populated, `status` still `draft`
- No new `email_messages` rows (Skip doesn't send)
- One `email_trigger_log` row with `outcome='skipped'`

- [ ] **Step 7: Gate 4 — Rate Con Send end-to-end**

As a dispatcher on a load with a pre-invoice charge set:
- Click Send Rate Con → drawer opens in rate-con mode
- Attachment chip shows `rate-con-<number>.pdf`
- Send → charge set status flips to `rate_con_sent`
- Check Storage → `{tenant_id}/rate-cons/<id>.pdf` exists
- Trigger Activity shows the new row

- [ ] **Step 8: Gate 5 — Rate Con Cancel**

Same flow but click Cancel (or ESC).

Expected: charge set status UNCHANGED. No Storage file written. No trigger_log row.

- [ ] **Step 9: Gate 6 — Null billing_email**

Create a test customer with `billing_email = NULL` and no `customer_billing_emails` rows. Create a load + charge set + invoice for that customer. Open the send popup.

Expected:
- Amber banner visible
- To field empty with placeholder
- Send disabled
- Type a valid email → Send enables
- Skip still works (for invoice)

- [ ] **Step 10: Gate 7 — SendGrid failure preserves state**

Temporarily break the SendGrid config (e.g., set an invalid API key via env var override or in a `.env.local.override`). Attempt Send on an invoice.

Expected:
- Error banner shown in drawer
- `invoices.pdf_url` IS set (archive succeeded)
- `invoices.status` still `draft`, `sent_at` still null
- User can restore SendGrid, re-click Send, succeed without double-archive

Restore SendGrid config after.

- [ ] **Step 11: Gate 8 — Permission enforcement**

Log in as dispatcher-only (`gate1-dispatcher@testtruck.com`).
- Visit `/settings/ar/configuration` → expect 403 or redirect
- Click Send Rate Con on a load → expect drawer opens and Send succeeds (dispatchers CAN send rate cons)
- If dispatcher somehow accesses Send Invoice endpoint (via URL manipulation): expect 403

Log back in as AR user to restore normal operation.

- [ ] **Step 12: Mark complete**

If all 8 gates pass, sub-projects 2a.2 + 2a.3 are shipped.

---

## Self-review

### Spec coverage

| Spec requirement | Implementing task |
|---|---|
| Add `email_templates.category` | Task 1 |
| Seed `invoice_send` + `rate_con_send` | Task 1 |
| Add `invoices.email_skipped_*` | Task 1 |
| AR template default constants | Task 2 |
| Recipient resolver | Task 2 |
| `{{invoice.*}}` + `{{charge_set.*}}` tokens | Task 3 |
| `buildInvoiceContext` + `buildChargeSetContext` | Task 3 |
| Dispatcher attachment support | Task 4 |
| SendGrid provider attachment support | Task 4 |
| `GET /api/tenant/ar/config/email-templates` | Task 5 |
| `PUT /api/tenant/ar/config/email-templates/[slug]` | Task 5 |
| `POST /.../reset` | Task 5 |
| AR Configuration page | Task 6 |
| TemplateEditor component | Task 6 |
| `GET /.../email-defaults` (invoice) | Task 7 |
| `GET /.../email-defaults` (charge set) | Task 7 |
| `POST /.../send-email` | Task 8 |
| `POST /.../skip-email` | Task 8 |
| `POST /.../send-rate-con-email` | Task 8 |
| `email_trigger_log` write with `trigger_id=NULL` | Task 8 (inside dispatcher) |
| EmailComposeSlideOver component | Task 9 |
| useEmailCompose hook | Task 9 |
| BillingTab Approve & Invoice wiring | Task 10 |
| BillingTab Send Rate Con wiring | Task 10 |
| AR Invoices Send wiring | Task 11 |
| AR Pipeline per-row Approve & Invoice | Task 11 |
| Filter operational templates list | Task 12 |
| Redirect for deep-linked AR template rows | Task 12 |
| Gate 1 (AR Config page) | Task 13 |
| Gates 2, 3 (Invoice Send, Skip) | Task 13 |
| Gates 4, 5 (Rate Con Send, Cancel) | Task 13 |
| Gate 6 (null billing_email) | Task 13 |
| Gate 7 (SendGrid failure) | Task 13 |
| Gate 8 (permissions) | Task 13 |

No gaps detected.

### Placeholder scan

Scanned: "TBD", "TODO", "implement later", "add appropriate error handling", "similar to Task N", "fill in details".

- Task 1 Step 2 contains a deliberate two-function layout with a "NOTE" block directing the implementer to delete the first function and keep the second. This is an explicit instruction, not a placeholder. Kept as-is because the alternative (replacing the 13-row function inline) is higher-risk.
- Task 3 Step 4 says "If `buildLoadContext` is not exported from the current file, either add an `export` to it OR inline its query here (preferring the former)." — this is an explicit branch based on what the implementer finds. Not a placeholder; a decision rule.
- Task 7 Step 2 has an IMPORTANT note about `resolveTemplate` possibly being named differently, with a grep to find the real name. Explicit verification step, not a placeholder.
- Task 8 Step 2 has a `dispatchEmail` contract note flagging that the dispatcher's real API may differ, with direction to adjust or add a wrapper. Explicit scope flag.
- Task 10 Step 7 CAREFUL block flags an ambiguity in hook naming and mandates rename. Explicit fix.

All other steps have complete code blocks.

### Type consistency

- `AR_SYSTEM_SLUGS` / `AR_TEMPLATE_DEFAULTS` / `isArSystemSlug` — defined Task 2, consumed Tasks 5, 7.
- `resolveBillingRecipients(svc, customerId, tenantId, emailType)` — defined Task 2, consumed Task 7.
- `buildInvoiceContext` / `buildChargeSetContext` — defined Task 3, consumed Task 7.
- `dispatchEmail` / `logManualSkip` — defined in Task 4 / Task 8 (inside dispatcher.js), consumed Task 8.
- `archiveInvoicePdf` / `archiveRateConPdf` / `renderInvoicePdf` / `renderRateConPdf` — defined in sub-project 2a.1, consumed Task 8.
- `useEmailCompose` — defined Task 9, consumed Tasks 10, 11.
- `EmailComposeSlideOver` — defined Task 9, consumed Tasks 10, 11.
- `recipients_source` values (`'customer_billing_emails'`, `'customer.billing_email'`, `'none'`) — consistent between Task 2 return, Task 7 forwarding, Task 9 banner logic.
- `docType` values (`'invoice'`, `'rate_con'`) — consistent across hook, component, and entry-point call sites.
- `email_type` enum values (`'invoice'`, `'rate_confirmation'`) — verified against `billing_email_type_enum` in migration 001.

No inconsistencies.
