# Sub-Project 2a — Bulk Invoice/Rate-Con Email Design Notes

**Status:** Scratch. Not designed yet. Brainstormed only. Raw thinking to preserve between sessions.

**Created:** 2026-04-18 during the AR UI polish brainstorm, where email-related bulk actions were descoped to their own sub-project.

**When to open this:** The session after today's AR UI polish ships. Invoke `superpowers:brainstorming` and use these notes as the starting point — don't start from scratch.

---

## User's articulated vision

### "Approve & Invoice" lifecycle (future state — NOT yet built)

1. Dispatcher clicks "Approve & Invoice" on the load Billing tab
2. Charge set status → `approved`
3. Invoice record created (already works today)
4. **Email popup opens IMMEDIATELY** — this is the new UX
5. Popup pre-populated from tenant's Communications config:
   - To, CC, BCC (defaults from customer's billing_email + any saved recipient list)
   - Subject (from invoice email template)
   - Body (from invoice email template, with merge fields)
   - **PDF attachment** (the invoice itself, built from default template until doc designer exists)
6. Dispatcher reviews, can edit any field, hits **Send** OR skips
7. **Always**: QB sync happens (send/skip does NOT gate QB integration)
8. If Send: `sent_at = now`, invoice status → `sent`, aging counts from this date
9. If Skip: invoice stays in `draft` status; customer pulls it from their portal or sends via their SaaS; dispatcher can return to send later

### Key insight — skipping email is legitimate

> "not sending the email may pertain to invoicing really only - not sending the invoice may be because the customer will need to download the invoice and send it via a customer's saas or somethign outside of the scope of an 'email' - BUT, not sending the invoice doesn't stop the invoice from being integrated to quickbooks."

This means:
- **Send email** and **create invoice record** are separable concerns
- QB sync must NOT be gated on email send
- Draft invoices can legitimately live long-term (not just as "pending to send")

### Bulk email sends — grouping modal

Before sending N emails for N selected charge sets, show a grouping modal:

| Grouping option | Behavior |
|---|---|
| **1 email per customer** | All selected charge sets for the same customer consolidate into one email with all invoices attached |
| **1 email per reference #** | Charge sets sharing a reference # consolidate into one email |
| **Separate email per charge set** | One email per charge set (current implicit behavior if no grouping) |

After grouping option chosen → popup (or sequence of popups) for review/send.

### New "Invoice" button with date picker (NOT built)

Separate button from "Approve & Invoice", designed for backdating:
- Calendar icon adjacent to "Invoice" button
- Click calendar → date picker opens → dispatcher selects a backdate
- Click Invoice → invoice created with `sent_at = picked date`
- Default (no date picked): today's date
- Aging calculations use this `sent_at` value

**Use cases:** month-end catch-up, correcting missed invoicing, period-matching for QB.

**Open design question:** does this button also trigger the email popup, or is it a "silent backdate + status-flip" for cases where the customer already received the paper invoice? Probably: email popup opens with the backdate pre-filled in a "Send date" field, dispatcher can still skip.

---

## Infrastructure audit required before 2a brainstorm

These need verification, not assumptions:

1. **Does the Communications module log invoice emails today?**
   - Check `Trigger Activity` settings page
   - Check if `/api/tenant/communications/*` wires to invoices
   - May need to extend to cover invoice.sent events

2. **Does Communications' template editor support invoice/rate-con templates?**
   - If yes: email popup pulls template by type
   - If no: need to add invoice/rate-con as recognized template types

3. **Is there any existing PDF generation for invoices?**
   - Grep for `pdf`, `jsPDF`, `pdfkit`, `@react-pdf`, `puppeteer`
   - If nothing exists: hardcoded default HTML template + puppeteer or similar is the MVP path

4. **QB sync**
   - Is QB integration even wired yet? `feature_accounts_receivable.md` mentions QuickBooks-compatible invoice numbering but actual sync may not exist
   - If not: 2a may need to add a `qb_sync_required` flag on invoices, with the actual sync job being yet-another-subproject

5. **Current "Send Rate Con" button on load Billing tab**
   - User said "I don't believe it sends an email today"
   - Needs verification — what does the current button actually do?

6. **Email bounce/delivery tracking**
   - SendGrid (mentioned as `@sendgrid/mail` in package.json) has webhooks for delivery events
   - Does anything in the codebase listen to them today?
   - If not: 2a probably stubs this and adds later

7. **Per-customer recipient overrides**
   - Customer has `billing_email` column
   - Does anywhere let you configure multiple recipients (AP contact + procurement contact)?
   - May need new UI + schema if not

---

## Single-action flows (non-bulk) that 2a also owns

Not just about bulk. 2a owns the entire "email a document to a customer" UX:

- **Send Rate Con** (existing button on load Billing tab, currently only flips status)
- **Approve & Invoice** (existing button, currently creates draft invoice only)
- **Invoice + date** (new button proposed, not yet built)
- **Send Invoice** (button appears in /ar Invoices tab today, status-flip only — needs email popup upgrade)

All four open variants of the same email popup modal (differ in template choice + pre-fill logic).

---

## Dependencies on other sub-projects

- **Does NOT depend on** sub-project 2b (filter sidebar) — can ship in either order
- **Does NOT depend on** sub-project 3 (saved tabs) — independent
- **Does NOT depend on** sub-project 4 (dispatcher filter adoption) — independent
- **Should ship before** (or with) the Payments & Credits tab — because the Payments tab will reference invoices and ideally show "sent on X date" in the UI. If sent_at is unreliable or always equals created_at, Payments tab UX is impaired

**Recommended order:** 2a → 2b → 3 → 4. Same as before.

---

## Questions to resolve during 2a brainstorm (not today)

1. Popup modal vs slide-over vs full-page interstitial?
2. Grouping modal appears BEFORE the email popup or as a mode selector inside it?
3. What does the popup look like when 10 emails are queued? (sequential? one at a time?)
4. Backdating — any validation? (e.g., can't backdate before order completion date)
5. What happens if customer's `billing_email` is null? Block send or prompt for address?
6. Where does "Skip send but sync to QB" button live in the popup? Primary vs secondary action?
7. Should dispatchers see a "draft invoices awaiting send" dashboard count somewhere prominent (e.g., KPI card on dispatch board)?

---

## Things decided TODAY that 2a should respect

- **Today's "Approve & Invoice" button will remain as-is** (draft-invoice creation, no email popup). 2a upgrades its behavior.
- **Today's bulk actions (Approve / Unapprove / Export) do NOT send email.** 2a adds the two email-sending bulk actions (Approve & Invoice, Send Rate Con).
- **Today's polish pass does not add the "Invoice + date picker" button.** 2a adds it alongside the email popup.
- **Today's `/ar` → Invoices tab "Send" button remains status-flip-only.** 2a upgrades it.

---

## Sub-project naming nit

We've been calling this "2a" but that's just because it came up during the AR polish discussion. When it's actually brainstormed, name it something like: `bulk-invoice-email-delivery-design.md`. Date-stamped as appropriate.
