# AR Email Single-Send (sub-projects 2a.2 + 2a.3) — Design Spec

**Status:** Approved by user 2026-04-18, ready for implementation planning.

**Scope:** Single-send email popup for invoices and rate confirmations. Combined into one spec because the two share ~90% of their code (same slide-over, same template table, same AR Configuration page, same email dispatch path). Bulk email (2a.4), backdate (2a.5), SendGrid delivery webhooks (2a.6), document designer, and QuickBooks sync are explicitly out of scope and tracked as separate sub-projects.

**Builds on:** Sub-project 2a.1 (PDF generation infrastructure, shipped 2026-04-18). That sub-project exported `archiveInvoicePdf` and `archiveRateConPdf` from `lib/pdf/archive.js` — this sub-project is the first consumer.

---

## 1. Goal

After 2a.2/2a.3 ship, dispatchers and AR users can:

1. Click **Approve & Invoice** on a load's Billing tab → invoice created → email popup opens with all fields pre-populated and the invoice PDF attached → user reviews, edits if needed, hits **Send** (email goes out, PDF archived, invoice marked sent) or **Skip** (invoice stays in draft for out-of-band delivery).
2. Click **Send Rate Con** on a load's Billing tab → email popup opens pre-populated with the rate confirmation PDF → user reviews, hits **Send** (charge set status flips to `rate_con_sent`, PDF archived, email dispatched).
3. Click **Send** on an invoice in the AR Invoices tab or AR Pipeline → same invoice popup as above.
4. Go to **Settings → AR Configuration** to edit the subject + body templates that populate the popups.

Dispatchers can't accidentally forget to invoice — the popup opens immediately on Approve & Invoice. Dispatchers can't accidentally send the wrong copy — they see the rendered PDF (via Preview link) and the full email body before pressing Send. AR managers edit email text without needing a developer.

---

## 2. Architecture overview

```
  ┌───────────────────────────────────────────────────────────────┐
  │ Load detail → Billing tab                                     │
  │   [Approve & Invoice] ──┐                                     │
  │   [Send Rate Con] ──────┼──────────┐                          │
  └───────────────────────────────────┼──┴──────┐                 │
  ┌──────────────────────────────────┼─────────┼──┐              │
  │ AR module → Invoices tab / Pipeline           │              │
  │   [Send] ─────────────────────────┤              │              │
  └──────────────────────────────────┘               │              │
                                                     ▼              ▼
                            ┌────────────────────────────────────┐
                            │  EmailComposeSlideOver             │
                            │   props: docType, contextId        │
                            │   reads: email_templates row by    │
                            │          system_slug               │
                            │   renders: To/CC/BCC/Subj/Body/📎  │
                            └──────┬────────────────────┬────────┘
                                   │ Send               │ Skip (invoice only)
                                   ▼                    ▼
              ┌────────────────────────┐   ┌─────────────────────────┐
              │ POST .../send-email    │   │ POST .../skip-email     │
              │  1. archive{Invoice|   │   │  (invoice only)         │
              │     RateCon}Pdf        │   │  Writes email_skipped_at│
              │  2. dispatch SendGrid  │   │  for audit. No email.   │
              │  3. update status +    │   │                         │
              │     sent_at / log      │   │                         │
              │  All or nothing        │   │                         │
              └────────────────────────┘   └─────────────────────────┘

  Settings → AR Configuration → Invoice Email / Rate Con Email
    ────── reads/writes the same email_templates rows ──────
```

Separation of concerns:

- **Persistence layer** — `email_templates` rows with `category='ar'` + system_slugs `invoice_send` and `rate_con_send`. Identical schema as the operational templates; just flagged so they don't clutter the communications templates list.
- **Rendering layer** — 2a.1's existing render helpers, unchanged.
- **Archive layer** — 2a.1's existing `archiveInvoicePdf` / `archiveRateConPdf`, unchanged.
- **Dispatch layer** — existing `lib/email-dispatch/dispatcher.js` + `lib/email-dispatch/providers/sendgrid.js`, extended to pass attachments through to `@sendgrid/mail` (the provider is currently attachment-agnostic; this sub-project adds ~20 lines). Variable resolution, plain/html body, dedupe, and umbrella/configuration routing are unchanged.
- **Variable resolver** — existing `lib/email-variable-resolver.js`, extended with two new token families: `{{invoice.*}}` and `{{charge_set.*}}`.
- **Recipient resolution** — reads `customer_billing_emails` filtered by `email_type` (`invoice` or `rate_confirmation`) with `is_active=true`. Falls back to `customers.billing_email` single-text column if no active rows exist.
- **UI layer** — one shared slide-over component, two entry-point hooks, one AR Configuration page.

---

## 3. Data model changes

### 3.1 New column: `email_templates.category`

```sql
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'operational';

ALTER TABLE email_templates
  ADD CONSTRAINT email_templates_category_check
  CHECK (category IN ('operational', 'ar'));
```

All existing rows get `category='operational'` by default (no data migration needed; they are operational templates).

### 3.2 New seeded rows

Extend `seed_system_email_templates_for_tenant(p_tenant_id)` (defined in migration 056) with two more `INSERT ... ON CONFLICT DO NOTHING` statements:

| `system_slug`    | `category` | `subject` (default)                                                  | `body_text` (default, excerpt)                                                                                 |
| ---------------- | ---------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `invoice_send`   | `ar`       | `Invoice {{invoice.number}} from {{tenant.name}}`                    | `Hi {{customer.primary_contact_name}},\n\nPlease find attached invoice {{invoice.number}} for {{invoice.total}}... Reply to this email to confirm receipt.\n\nThank you,\n{{tenant.name}}` |
| `rate_con_send`  | `ar`       | `Rate Confirmation {{charge_set.number}} — Order {{load.order_number}}` | `Hi {{customer.primary_contact_name}},\n\nAttached is the rate confirmation for order {{load.order_number}}...\n\nReply to confirm.\n\n{{tenant.name}}` |

Both get `is_system=true`. Both get `body_format='plain'` by default, parallel `body_html` that wraps the plain text in `<p>` tags. User can switch format + edit freely in the AR Configuration editor.

Backfill: re-run `seed_system_email_templates_for_tenant` for every existing active tenant in the same migration (same pattern migration 056 uses in its SECTION 4).

### 3.3 Audit columns (optional, for Skip tracking)

```sql
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS email_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_skipped_by UUID REFERENCES auth.users(id);
```

Populated when Skip is clicked. Answers "did the user deliberately skip, or did they never open the popup?" — useful for AR manager reports. Not populated for rate-con (no Skip on rate-con).

### 3.4 Logging — reuses `email_trigger_log` + `email_messages` (no schema change)

Migration 053 established a two-table logging model that fits manual sends with no schema change:

- `email_trigger_log` — one row per send attempt. `trigger_id UUID REFERENCES email_template_triggers(id) ON DELETE SET NULL` is nullable, so manual sends set `trigger_id = NULL`. The row records `template_id` (our `invoice_send` or `rate_con_send` row), `load_id`, `sent_by_user_id`, `outcome` (existing enum: `fired` | `skipped` | `deduped` | `errored` | `disabled`), and a full decision snapshot.
- `email_messages` — one row per resolved recipient. Links back to `email_trigger_log` via log id. Carries the provider's `message_id`, final subject/body/recipients, delivery status.

**Outcome mapping for 2a.2/2a.3:**

| User action | Server outcome | DB effect |
|---|---|---|
| Send succeeds | `fired` | `email_trigger_log` row + N `email_messages` rows (one per recipient); `invoices.sent_at` or charge-set status flip |
| Send fails (archive or dispatch) | `errored` | `email_trigger_log` row with error snapshot; no invoice/charge-set state change |
| Skip (invoice only) | `skipped` | `email_trigger_log` row; `invoices.email_skipped_at` populated; no `email_messages` row |

Trigger Activity page (`/settings/communications/trigger-activity`) already queries `email_trigger_log` — these manual sends will appear there alongside the event-driven ones, distinguishable by `trigger_id IS NULL`. Future improvement: add a `manual` filter chip to the Trigger Activity UI (not 2a.2 scope).

---

## 4. Variable resolver extension

`lib/email-variable-resolver.js` currently resolves: `{{load.*}}`, `{{customer.*}}`, `{{driver.*}}`, `{{container.*}}`, `{{pickup.*}}`, `{{delivery.*}}`, `{{return.*}}`, `{{tenant.*}}`. Add:

### 4.1 `{{invoice.*}}`

| Token | Source |
|---|---|
| `{{invoice.number}}` | `invoices.invoice_number` |
| `{{invoice.total}}` | formatted `invoices.total_amount_cents` (`$X,XXX.XX`) |
| `{{invoice.subtotal}}` | formatted `invoices.subtotal_cents` |
| `{{invoice.due_date}}` | `invoices.due_date`, human format |
| `{{invoice.issue_date}}` | `invoices.sent_at` if set, else `created_at` |
| `{{invoice.reference_number}}` | Derived from linked charge set's order (same logic as the invoice PDF template — first non-null `customer_reference` or `order_number`) |

### 4.2 `{{charge_set.*}}`

| Token | Source |
|---|---|
| `{{charge_set.number}}` | `order_charge_sets.charge_set_number` |
| `{{charge_set.total}}` | formatted `order_charge_sets.total_cents` |
| `{{charge_set.reference_number}}` | same derivation as invoice's |

### 4.3 Context builder extension

`lib/email-dispatch/context-builder.js` currently builds the context from a load id. Add:

- `buildInvoiceContext(svc, invoiceId, tenantId)` — fetches invoice + linked charge set + linked order + customer, returns the variable-resolver-shaped context including `invoice`, `charge_set`, and the full load/customer tree.
- `buildChargeSetContext(svc, chargeSetId, tenantId)` — same for rate-con, without the invoice wrapper.

Both reuse the existing load context builder internally to avoid duplicated SQL.

### 4.4 Recipient resolver (new)

New helper `lib/email-dispatch/recipient-resolver.js` exports `resolveBillingRecipients(svc, customerId, tenantId, emailType)` where `emailType` is `'invoice'` or `'rate_confirmation'`. Logic:

1. Query `customer_billing_emails` WHERE `tenant_id` + `customer_id` + `email_type` match + `is_active = true`.
2. If ≥ 1 row returned: return `{ to: [all matching emails], source: 'customer_billing_emails' }`.
3. Else if `customers.billing_email` is non-null: return `{ to: [that email], source: 'customer.billing_email' }`.
4. Else: return `{ to: [], source: 'none' }` → popup renders the null-recipient banner (see section 7.4).

CC/BCC are never auto-populated — they're opt-in via the "+ Add CC / BCC" chips.

### 4.5 Attachment plumbing (new)

`lib/email-dispatch/providers/sendgrid.js` currently doesn't forward attachments to `@sendgrid/mail`. Extend:

- Provider's send function accepts an optional `attachments: Array<{ content: Buffer | string, filename: string, type: string, disposition?: string }>` parameter.
- Internally maps to SendGrid's native shape: `{ content: base64(buffer), filename, type, disposition: 'attachment' }`.
- `lib/email-dispatch/dispatcher.js` accepts the same parameter and passes it through.

Backward compat: existing callers pass no `attachments` → nothing changes. Only the new AR send endpoints use the parameter.

Attachment buffer sourcing: the AR send endpoint calls `renderInvoicePdf` or `renderRateConPdf` to get the Buffer in-process, then passes it directly to the dispatcher. The archived Storage file is a separate persistence concern (audit trail) — the dispatched email carries a fresh in-memory copy of the same bytes.

---

## 5. Component structure

### 5.1 `components/ar/EmailComposeSlideOver.js` (new)

Shared slide-over. Props:

```js
{
  open: boolean,
  onClose: () => void,
  docType: 'invoice' | 'rate_con',
  contextId: string,       // invoiceId or chargeSetId
  onSent: (result) => void,     // called after successful send
  onSkipped: () => void,        // invoice only; optional for rate_con
}
```

Internal state:
- `template` — fetched by system_slug on open
- `resolvedContext` — from context-builder
- `to`, `cc`, `bcc`, `subject`, `body` — form fields, initialized from resolved template
- `ccVisible`, `bccVisible` — collapse state
- `sending` — loading flag
- `error` — any dispatch error

Rendering:
- Right-anchored drawer, ~500px wide, full viewport height
- Focus trap + ESC to close
- Click-outside-to-close — **disabled** if form has been edited (dirty state), prevent accidental data loss
- Sticky header (title + close X) and sticky footer (action buttons)
- Body scrollable between

Dark mode: follow `dev_dark_mode_convention.md` — every gray/white/border class gets its `dark:` variant.

### 5.2 `hooks/useEmailCompose.js` (new)

Thin hook that opens/closes the slide-over and manages the single-at-a-time invariant. Exposes `{ open(docType, contextId), close }`. Consumed by the three entry points.

### 5.3 `pages/settings/ar/configuration/index.js` (new)

AR Configuration page. Permission gate: `ACCOUNTS_RECEIVABLE` or `ALL`. Layout: two tabs ("Invoice Email" / "Rate Con Email"). Each tab renders a template editor component:

### 5.4 `components/settings/ar/TemplateEditor.js` (new, reusable)

Props: `{ systemSlug: 'invoice_send' | 'rate_con_send' }`. Reuses the existing communications template editor's form shape (subject, body, body_format toggle, variable picker sidebar, preview panel) but scopes to a single row and omits trigger-binding UI (AR templates don't bind to events — they're dispatcher-triggered).

Variable picker: surfaces the `{{invoice.*}}` or `{{charge_set.*}}` families plus the universal ones (`{{customer.*}}`, `{{load.*}}`, `{{tenant.*}}`). Click-to-insert into subject or body.

Preview panel: renders the template with a sample fixture (first eligible invoice/charge_set in the tenant) so AR managers see what the email will look like before saving.

"Reset to default" link: fetches the seed default from a new API endpoint and overwrites subject + body. Confirmation toast before applying.

### 5.5 Filter for the existing `/settings/communications/templates` list

`pages/settings/communications/templates/index.js` and the corresponding API must add a `.eq('category', 'operational')` clause so AR templates don't appear in both places. The detail page `/settings/communications/templates/[id]` should 404 (or redirect to the AR Configuration page) if the requested row has `category='ar'`.

---

## 6. API endpoints

### 6.1 Templates (extensions)

- `GET /api/tenant/ar/config/email-templates` — returns both `invoice_send` and `rate_con_send` rows for the tenant in one shot (AR Configuration page loads both tabs).
- `PUT /api/tenant/ar/config/email-templates/[slug]` — updates subject/body/body_format for a single AR template. Permission: `ACCOUNTS_RECEIVABLE` or `ALL`. Slug must be `invoice_send` or `rate_con_send`.
- `POST /api/tenant/ar/config/email-templates/[slug]/reset` — overwrites the row's subject + body from the hardcoded defaults (stored as constants in `lib/email-dispatch/ar-template-defaults.js`). Requires confirmation client-side.

### 6.1.5 Popup pre-fill endpoints (new)

The slide-over opens and needs all its pre-fill data in one round-trip. Two GET endpoints (one per doc type) feed it:

- `GET /api/tenant/ar/invoices/[id]/email-defaults` — permission `ACCOUNTS_RECEIVABLE | ALL`. Returns `{ to: string[], cc: [], bcc: [], subject: string, body: string, body_format: 'plain'|'html', recipients_source: 'customer_billing_emails'|'customer.billing_email'|'none', attachment: { filename, preview_url } }`. Internally: fetch invoice → resolve recipients via `resolveBillingRecipients(..., 'invoice')` → fetch + resolve `invoice_send` template against invoice context → return.
- `GET /api/tenant/ar/charge-sets/[id]/email-defaults` — same shape, permission `ORDER_ENTRY | DISPATCHING | ACCOUNTS_RECEIVABLE | ALL`. Uses `rate_confirmation` email type and `rate_con_send` template.

Why separate GET endpoints (vs returning pre-fills from the page load): keeps the slide-over component data-source-agnostic — it just calls one endpoint on open and populates its form state. Also keeps the Send POST endpoint's contract clean (accepts final edited values; doesn't need to know about defaults).

### 6.2 Send actions

**`POST /api/tenant/ar/invoices/[id]/send-email`**
- Permission: `ACCOUNTS_RECEIVABLE` or `ALL`
- Body: `{ to: string[], cc: string[], bcc: string[], subject: string, body: string, body_format: 'plain' | 'html' }` — overrides from the popup's edited state
- Flow:
  1. Fetch invoice + verify tenant scoping + verify not already sent
  2. `archiveInvoicePdf(svc, invoiceId, tenantId)` — populates `invoices.pdf_url`
  3. `getSignedUrl(svc, path, 3600)` for the attachment — SendGrid needs a URL or buffer; we'll pass the buffer from render-invoice since it's cheap
  4. Dispatch via `lib/email-dispatch/dispatcher.js` with override body, attachment buffer
  5. If dispatch OK: `UPDATE invoices SET sent_at = now(), status = 'sent' WHERE id = $1`
  6. Insert `email_logs` row with `trigger_type='invoice_send'`, invoice_id, recipient list, status='sent'
  7. Return `{ ok: true, sent_at, pdf_url }`
- Atomicity: steps 2 and 4 each wrap in try/catch. If archive succeeds but dispatch fails: `pdf_url` stays set (archive is valid), status stays unchanged, return `{ ok: false, stage: 'dispatch', error }`. Client shows error banner, retry re-runs from step 4.
- Rate-limit: none specific for single-send (SendGrid handles rate limiting on their end). Bulk will need queueing — out of scope here.

**`POST /api/tenant/ar/invoices/[id]/skip-email`**
- Permission: `ACCOUNTS_RECEIVABLE` or `ALL`
- Body: `{}` — no payload needed
- Flow: `UPDATE invoices SET email_skipped_at = now(), email_skipped_by = $user WHERE id = $1 AND tenant_id = $tenant`. Returns 200 + the updated row.
- No email, no archive, no status flip (invoice stays `draft`). Invoice can still be sent later (either via the popup again or via AR Invoices tab Send button) — the skip is recorded for audit, not terminal.

**`POST /api/tenant/ar/charge-sets/[id]/send-rate-con-email`**
- Permission: `ORDER_ENTRY` | `DISPATCHING` | `ACCOUNTS_RECEIVABLE` | `ALL` (same as the rate-con PDF endpoint)
- Body: same shape as invoice send
- Flow: same pattern as invoice send, calling `archiveRateConPdf`. On success, `UPDATE order_charge_sets SET status = 'rate_con_sent' WHERE id = $1`. Emits `email_logs` row with `trigger_type='rate_con_send'`.
- No Skip endpoint for rate-con; the current "Send Rate Con" button's status-flip behavior is subsumed entirely by the popup's Send action.

---

## 7. Lifecycle details

### 7.1 Invoice flow

| Step | State |
|---|---|
| User clicks **Approve & Invoice** on load Billing tab | charge set: `unapproved` → `approved`; invoice created in `draft` (existing behavior) |
| Popup opens immediately (new in 2a.2) | Invoice still `draft`; no `pdf_url` yet; no `sent_at` |
| User hits **Send** | Popup calls `/send-email` → archive → dispatch → invoice `status='sent'`, `sent_at=now()`, `pdf_url` set, email_log row. Popup closes, toast "Invoice sent to X". Billing tab refreshes. |
| User hits **Skip** | Popup calls `/skip-email` → `email_skipped_at` + `email_skipped_by` set. Invoice stays `draft`. Popup closes, toast "Invoice saved as draft — no email sent". Billing tab refreshes. |
| User hits **Cancel / X / ESC** | Popup closes. Invoice stays `draft`. No DB write. No toast. |

### 7.2 Rate-con flow

| Step | State |
|---|---|
| User clicks **Send Rate Con** | Charge set status **does not change yet** (unlike today). Popup opens. |
| User hits **Send** | Popup calls `/send-rate-con-email` → archive → dispatch → charge set `status='rate_con_sent'`, `rate_con_pdf_url` set, email_log row. Popup closes, toast "Rate confirmation sent to X". |
| User hits **Cancel / X / ESC** | Popup closes. Charge set status unchanged. |

**Breaking change note:** today's `Send Rate Con` button is a bare status flip (no email). After 2a.3, clicking it opens the popup. For tenants who were relying on the status flip for tracking without actually sending email, Cancel preserves the pre-2a.3 workflow (dispatcher can still manually flip status via the generic status controls if needed). We'll mention this in the release notes.

### 7.3 Dirty-state protection

The slide-over prevents accidental data loss:

- Click-outside on a clean form → close immediately
- Click-outside, ESC, or close X on a dirty form → inline confirm prompt: "Discard changes?"
- Hitting Send/Skip clears dirty state regardless of outcome

### 7.4 Null / empty recipient handling

Popup opens and calls the email-defaults endpoint. `recipients_source === 'none'` means no active `customer_billing_emails` rows AND no `customers.billing_email` fallback. In that case:

- `To` field is empty with placeholder "customer@example.com"
- Amber (not red — it's recoverable) banner above the form: "No billing email on file for {{customer.name}}. Type a recipient to send, or skip to save as draft."
- Send button disabled until `To` contains at least one email-shaped string
- Skip button remains enabled (invoice only)

When `recipients_source === 'customer.billing_email'` (fallback used because no per-type rows exist), show a subtle secondary notice: "Using fallback billing email. Add invoice-specific recipients in customer settings." — informational, not blocking.

### 7.5 Multiple To / CC / BCC recipients

Each field is a chip-based input: type comma or Enter to commit an email into a chip, Backspace on empty input removes the last chip. Paste handling splits on newlines + commas + semicolons. Simple regex validation (`/^\S+@\S+\.\S+$/`) per chip — invalid chips are flagged red but don't block (user might want to save a placeholder and edit).

---

## 8. Entry points (wiring checklist)

| Location | Today | After 2a.2/2a.3 |
|---|---|---|
| [components/loads/tabs/BillingTab.js](components/loads/tabs/BillingTab.js) — `Approve & Invoice` button | Creates invoice, toast, no popup | On success → `openEmailCompose({ docType: 'invoice', contextId: newInvoice.id })` |
| [components/loads/tabs/BillingTab.js](components/loads/tabs/BillingTab.js) — `Send Rate Con` button (line ~740) | `updateStatus('rate_con_sent')` | `openEmailCompose({ docType: 'rate_con', contextId: chargeSet.id })` — status flip now happens server-side inside `/send-rate-con-email`, not client-side |
| AR Invoices tab (`/ar/invoices`) — `Send` button on a draft invoice row | Status flip to `sent` (no email) | `openEmailCompose({ docType: 'invoice', contextId: invoice.id })` |
| AR Pipeline per-row `Approve & Invoice` | Bulk path that creates invoices without popup | For single-row action: same as the load detail button above. Bulk action (2+ rows) still goes through bulk path — no popup until 2a.4 ships. |

Sidebar/nav: the new `/settings/ar/configuration` page needs a link in the settings navigation. During the settings sidebar restructure (see `feature_settings_restructure.md`), this nests under an "AR" section alongside "Communications." For now (pre-restructure), add it to the card grid.

---

## 9. Error handling matrix

| Failure | User visible behavior | DB state | Recovery |
|---|---|---|---|
| Template fetch fails on open | Toast "Could not load template", popup closes | None | User re-tries action |
| Context-builder fetch fails (missing invoice, wrong tenant) | Toast "Invoice not found", popup closes | None | N/A (data error) |
| Null `customer.billing_email` | Red banner, Send disabled | None (popup open) | User types address or Skip |
| Archive fails (`renderInvoicePdf` throws) | Inline error banner in popup, Send button re-enabled | None (archive wrapper only writes after success) | User can retry Send |
| Archive succeeds, SendGrid fails | Inline error banner "Email failed to send — PDF archived but not delivered. Retry?" | `pdf_url` set, status unchanged | User clicks Send again; archive step is idempotent (upsert), dispatch is re-attempted |
| Status update fails after successful send (extremely rare) | Inline error banner | `pdf_url` set, email delivered, status unchanged | Client fetches fresh state on close; follow-up manual status flip possible via existing controls |
| Skip endpoint fails | Inline error banner, invoice stays exactly as before | None | User clicks Skip again or closes popup |

---

## 10. Email logging — write pattern

Reuses the existing two-table model (migration 053) with no schema change:

**`email_trigger_log`** — one row per send attempt:

```
tenant_id,
trigger_id: NULL,                 -- manual send indicator
template_id: <id of invoice_send or rate_con_send row>,
template_kind_snapshot: NULL,     -- (existing field; leave null for manual)
load_id: <the load this invoice/charge-set belongs to>,
event_name: 'manual:invoice_send' | 'manual:rate_con_send',
fire_key: <sha of (tenant_id, template_id, invoice_id or charge_set_id, now())>,
outcome: 'fired' | 'errored' | 'skipped',
sent_by_user_id: <auth user id>,
configuration_id: <active SendGrid config>,
umbrella_id: NULL,                -- not umbrella-routed
decision_snapshot: { ... },       -- full resolved template + recipients
error_snapshot: { ... } | NULL,
fired_at: now()
```

**`email_messages`** — zero rows if `outcome='skipped'`, else one row per final recipient:

```
log_id: <parent email_trigger_log.id>,
recipient_email,
recipient_type: 'to' | 'cc' | 'bcc',
subject_resolved, body_resolved, body_format,
provider_message_id: <from SendGrid response>,
delivery_status: 'sent',  -- bounce/open tracking is 2a.6 scope
sent_at: now()
```

The existing Trigger Activity page picks these up automatically. Filtering for manual sends uses `trigger_id IS NULL`. Linking back to the source invoice or charge set is done via `decision_snapshot.invoice_id` / `decision_snapshot.charge_set_id` — no new columns on the log table. **Verify during plan-write** whether `decision_snapshot`'s JSONB schema is flexible enough (it is per migration 053's description) or whether a lightweight helper is needed.

---

## 11. Security considerations

- All three send/skip endpoints check tenant scoping in both the fetch-invoice/charge-set query (`eq('tenant_id', ctx.tenantId)`) and in the linked PDF archive path.
- SendGrid dispatch uses the tenant's configured sender domain; no cross-tenant sender-domain leakage possible.
- Recipient input sanitization: strip leading/trailing whitespace, reject `\r\n` injection in subject (email header injection protection).
- Body is rendered as plain text OR HTML based on `body_format`; HTML path goes through the existing variable resolver's sanitization (whatever the current operational-template send path does — reuse exactly).
- Attachment URL is NEVER exposed to the client; the API route fetches the buffer server-side and passes it to the dispatcher directly.

---

## 12. Permissions summary

| Action | Required permission |
|---|---|
| Open invoice popup (Approve & Invoice, Send from Invoices tab) | `ACCOUNTS_RECEIVABLE` | `ALL` |
| Open rate-con popup (Send Rate Con) | `ORDER_ENTRY` | `DISPATCHING` | `ACCOUNTS_RECEIVABLE` | `ALL` |
| Edit AR Configuration email templates | `ACCOUNTS_RECEIVABLE` | `ALL` |
| View AR Configuration email templates | `ACCOUNTS_RECEIVABLE` | `ALL` |

Matches the permission matrix for the underlying PDF endpoints shipped in 2a.1.

---

## 13. Out of scope (deferred to future sub-projects)

- **Bulk email + grouping modal** → 2a.4. The slide-over shipped here must be designed so a future "email 2 of 5" navigator can wrap it without refactoring (e.g., controller component above the slide-over owns the list and drives `open/close/next`).
- **"Invoice + date picker" backdate button** → 2a.5. Popup's `sent_at` is always `now()` in 2a.2.
- **SendGrid delivery webhook tracking** (bounce, open, click) → 2a.6. We write `email_logs` with provider message id but don't update status based on webhooks in 2a.2.
- **Inline PDF preview (iframe in slide-over)** → deferred. Attachment chip + Preview link (opens the existing `/api/tenant/pdf/<type>/[id]` route in a new tab) is enough for now.
- **Additional attachments (BOL, POD, supporting docs)** → future. The attachment list is hard-coded to the one auto-generated PDF.
- **Rich-text body editor** (bold/italic/links) → deferred. Plain text + HTML format toggle (matches existing operational-template editor) is enough.
- **Per-customer recipient override lists** (AP contact, procurement contact, etc.) → future. Today's `customer.billing_email` is the only default.
- **Document designer for PDF visual customization** → Later. Email text customization ships here; PDF customization is its own sub-project.
- **QuickBooks sync** → separate project. 2a.2 does not gate or hook QB sync; that project will integrate on the `invoice.created` event regardless of email Send/Skip.

---

## 14. Rollout plan

1. Migration 079 — add `email_templates.category` + extend seed function + backfill + optional `invoices.email_skipped_*` columns. User applies via Supabase Studio (per the pattern used for migrations 076-078).
2. Variable resolver extension + context-builder extension — can ship behind the migration since existing templates don't use the new tokens.
3. AR Configuration page + template editor — functional without the popup. Ships first so users can preview their defaults.
4. Shared slide-over + send endpoints + wire one entry point (Load Billing tab "Approve & Invoice") — makes the full flow live end-to-end for a single trigger.
5. Wire remaining entry points (Send Rate Con, AR Invoices tab Send, AR Pipeline per-row) — mechanical.
6. Cut the `Send Rate Con` button's old status-flip code after the new path ships.

Each numbered step is a commit and a verification gate. Plan will own the ordering + gate definitions.

---

## 15. Open questions (resolved)

All the questions from `docs/superpowers/scratch/2a-bulk-invoice-email-design-notes.md` that applied to 2a.2/2a.3 are resolved:

- Popup form factor: **slide-over (B)**
- Grouping modal before/inside: **N/A — bulk is 2a.4**
- 10 emails queued: **N/A — bulk is 2a.4**
- Backdating validation: **N/A — 2a.5**
- Null `billing_email`: **red banner + Send disabled; Skip remains (invoice)**
- Skip-send-but-sync-to-QB: **Skip endpoint records audit; QB sync is a separate project hooking invoice creation, not send**
- Draft invoices awaiting-send dashboard count: **out of scope here**

Resolved via self-review audit (2026-04-18):

- ✅ Logging table is `email_trigger_log` + `email_messages` (two-table model from migration 053). No new columns needed. Manual sends set `trigger_id=NULL`.
- ✅ Recipient source is `customer_billing_emails` (per-type routing table, existing) with `customers.billing_email` as single-text fallback. Both confirmed in `supabase/migrations/001_initial_schema.sql`.
- ✅ Dispatcher/provider currently does NOT support attachments — scoped as a deliberate extension in section 4.5 (~20 lines in `providers/sendgrid.js`).

Remaining plan-time verifications (scope-level, not design-level):

- `email_trigger_log.decision_snapshot` JSONB shape — confirm flexibility for carrying `invoice_id` / `charge_set_id` without schema change (per migration 053 comments it should be fine; confirm on read).
- `invoices.status` enum values — confirm `'sent'` is a valid transition from `'draft'` and what other states exist (may affect Retry UX).
- `order_charge_sets.status` enum — confirm the transition `approved | unapproved | draft → rate_con_sent` is legal; today's bare-status-flip button already does it so this should be non-issue.

---

## 16. Success criteria

The sub-project is shipped when:

1. All four entry points open the popup end-to-end with valid pre-population.
2. Send flow produces: a valid email in the recipient's inbox with the correct PDF attached, an archived PDF at `{tenant_id}/invoices/{id}.pdf` or `{tenant_id}/rate-cons/{id}.pdf`, a correctly-written `email_logs` row visible in Trigger Activity, and a correct state transition on invoice/charge set.
3. Skip flow produces: `invoices.email_skipped_at` populated, invoice still in `draft`, toast shown.
4. AR Configuration page lets a user edit either template and save; change appears in the next popup open.
5. Null-billing-email case behaves per section 7.4.
6. SendGrid-failure case preserves `pdf_url` and allows retry without double-archive or double-send.
7. Existing `/settings/communications/templates` list does NOT show the two AR templates.
8. Permissions matrix (section 12) enforced — dispatcher-only user can open rate-con popup but not invoice popup.

Verification gates are defined in the implementation plan, not this spec.
