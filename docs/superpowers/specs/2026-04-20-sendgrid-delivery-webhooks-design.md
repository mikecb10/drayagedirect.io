# 2a.6 — SendGrid Delivery Webhooks (design)

**Status:** design approved 2026-04-20 · ready for implementation plan
**Builds on:** 2a.1 through 2a.5 + 2a.4b (full AR email pipeline shipped today)
**Next:** `writing-plans` → task-by-task implementation plan

---

## TL;DR

Replace the lie that "Sent" means "delivered." Subscribe to SendGrid webhook events (`delivered` / `bounced` / `dropped` / `spam_reported` / `deferred`) via a new public endpoint, stamp real delivery outcomes on each `email_messages` row, surface the result in `BulkEmailQueue` status pills. Idempotent against duplicate webhooks, signature-verified for security, no backfill of pre-2a.6 sends.

**Single-session scope.** 1 migration + 1 webhook endpoint + 1 poll endpoint + 1 UI pill expansion + signature verification util + operator SendGrid config.

---

## Context

Today (post-2a.4b) when an operator clicks Send, the UI says "Sent" the moment SendGrid returns 202. That 202 means **accepted for delivery** — not that the email reached the recipient. An invoice that bounces, spam-filters, or fails DMARC fails silently. For an AR module this is a credibility bug — you cannot honestly bill a customer if your invoice never landed in their inbox and nobody knew.

Gate 10 of 2a.4b validated real delivery happened (Mike's Gmail received the emails), but the UI badge would have said "Sent" either way. 2a.6 makes the badge honest.

---

## Schema model

### Columns added to `email_messages`

```sql
ALTER TABLE email_messages
  ADD COLUMN delivery_status        TEXT NULL,
  ADD COLUMN last_delivery_event_at TIMESTAMPTZ NULL,
  ADD COLUMN delivery_events        JSONB NOT NULL DEFAULT '[]'::jsonb;
```

**`delivery_status`** values (nullable):
- `null` — unknown (initial state; legacy rows; rows mid-flight between send and first webhook)
- `delivered` — SendGrid confirmed delivery
- `bounced` — hard bounce (domain rejected)
- `dropped` — SendGrid refused pre-send (suppression list, invalid sender, etc.)
- `spam_reported` — recipient flagged as spam
- `deferred` — soft bounce (transient; SendGrid may retry internally). Not terminal — may later transition to `delivered` or `bounced`.

**`delivery_events`** — append-only JSONB array. Each element:

```json
{
  "event": "delivered",
  "timestamp": 1713637200,
  "sg_event_id": "abc123...",
  "sg_message_id": "x.y",
  "email": "recipient@example.com",
  "response": "250 OK",
  "reason": null,
  "received_at": "2026-04-20T22:05:17.857Z"
}
```

Used for (a) idempotency via `sg_event_id` dedup, (b) forensic debugging when deliveries misbehave.

**`last_delivery_event_at`** — convenience column for `ORDER BY`/filter queries; avoids unpacking JSONB for "most recently updated."

### Status transition precedence

Multiple events can arrive per message (different recipients, retries, bounces-then-deliveries). The `delivery_status` column reflects the most severe outcome seen so far. Precedence:

```
bounced  >  dropped  >  spam_reported  >  delivered  >  deferred  >  null
```

A message with one recipient who bounced and one who delivered shows `bounced` (the conservative/alarming outcome surfaces). Operator can drill into `delivery_events` for per-recipient detail if they want.

**Why conservative-over-optimistic:** a bounced recipient is actionable (fix the email, resend); a delivered-but-one-bounce is still a problem. Surfacing the bounce is safer.

---

## Webhook endpoint

**Path:** `POST /api/webhooks/sendgrid` — **public, no session cookie required**. Secured by SendGrid's ECDSA signature headers:

- `X-Twilio-Email-Event-Webhook-Signature` — base64-encoded ECDSA signature
- `X-Twilio-Email-Event-Webhook-Timestamp` — unix timestamp

Verify against the public key stored in `SENDGRID_WEBHOOK_VERIFICATION_KEY` env var (base64-encoded ECDSA public key SendGrid generates when you enable signed webhook in Settings → Mail Settings → Event Webhook → Signature Verification).

Signature algorithm: ECDSA P-256 over `timestamp + raw_body`. Use `@sendgrid/eventwebhook` npm package (official SendGrid lib) OR implement manually with node's `crypto.createVerify('SHA256')`.

**Reject 401** on:
- Missing signature / timestamp header
- Signature verification failure
- Timestamp drift > 10 minutes (replay protection)

### Handler flow (per event in the body array)

1. Parse event. Extract `sg_message_id`, `sg_event_id`, `event` (enum), `timestamp`, `email`, `reason`.
2. `SELECT id, delivery_events, delivery_status FROM email_messages WHERE message_id = <sg_message_id>`. If no match, log `console.warn` and continue (orphan event; SendGrid sent us a webhook for a message we didn't originate — rare but possible if webhook URL is shared).
3. Check `delivery_events` for existing `sg_event_id` — if found, skip (duplicate webhook).
4. Compute new `delivery_status` using precedence table (if new event is more severe than current, bump; else keep current).
5. Atomic update: append event to `delivery_events`, update `delivery_status` + `last_delivery_event_at`.
6. Repeat for next event in body.
7. Return 200 with `{ processed: N, skipped: M }`.

### Events we track

- `delivered` — recipient's mail server accepted
- `bounced` — hard or soft bounce (reason in `reason` field)
- `dropped` — SendGrid didn't even attempt (bad address, bounce-suppression list, sender issue, etc.)
- `spam_reported` — recipient hit "mark as spam" in their inbox
- `deferred` — mail server returned a temporary failure (e.g. greylisting); SendGrid will retry

**Skip (not in v1):**
- `opened` — engagement tracking (requires open-pixel; privacy-sensitive)
- `clicked` — link click tracking
- `unsubscribe` / `group_unsubscribe` — SendGrid subscription groups (we don't use them)
- `processed` — pre-send lifecycle event (already implied by our `status='sent'`)

---

## UI surface

### `BulkEmailQueue` status pill expansion

Current states (from `components/ar/BulkEmailQueue.js`):
- `pending`, `ready`, `needs_edit`, `sending`, `sent`, `failed`

Post-2a.6 expand `sent` into delivery-aware variants:

| Delivery status | Pill label | Pill color | Icon |
|---|---|---|---|
| `null` (initial) | **Sent** | amber | Mail |
| `delivered` | **Delivered** | green | Check |
| `bounced` | **Bounced** | red | AlertCircle |
| `dropped` | **Dropped** | red | AlertCircle |
| `spam_reported` | **Spam** | orange | AlertCircle |
| `deferred` | **Deferred** | blue | RefreshCw (not spinning) |

Pill reads from `email_messages.delivery_status` via a polling fetch (see below).

### Polling for status updates

While the queue modal is open AND any row has `delivery_status=null` after send, the queue hook polls every 5 seconds:

```
GET /api/tenant/emails/deliveries?message_ids=a,b,c
→ { a: { delivery_status: 'delivered', last_delivery_event_at: '...' }, b: { delivery_status: null }, ... }
```

Stop polling when (a) all message_ids terminal (`delivered` / `bounced` / `dropped` / `spam_reported` — `deferred` is NOT terminal), (b) modal closes, or (c) 60 seconds elapsed with no progress (give up, operator can refresh manually).

Queue hook updates row state on poll response. No Supabase Realtime in v1.

**Polling tradeoff rationale:** Realtime would give instant UI updates but adds Supabase channel complexity, RLS concerns, and reconnect logic. At expected volume (few dozen sends per day per tenant, bulks of ~3-10), 5-second polling is imperceptible to operator and simpler to maintain.

---

## Operator setup

One-time, per environment:

1. SendGrid dashboard → **Settings → Mail Settings → Event Webhook**
2. Enable Event Webhook
3. HTTP Post URL: `https://drayagedirect.io/api/webhooks/sendgrid` (production) or your dev tunnel URL (e.g. `https://abc123.ngrok.io/api/webhooks/sendgrid`)
4. Select events: ✅ Delivered, ✅ Bounced, ✅ Dropped, ✅ Spam Reports, ✅ Deferred. Deselect Opens, Clicks, Unsubscribes, Group Unsubscribes, Group Resubscribes, Processed.
5. **Enable Signed Event Webhook** (toggle in same panel). SendGrid generates a Verification Key — copy it.
6. Paste key into `.env.local` (or prod env manager) as `SENDGRID_WEBHOOK_VERIFICATION_KEY=<base64-key>`
7. Save + Test (SendGrid has a "Test Your Integration" button that sends a sample payload to your endpoint)

---

## Failure policy

| Failure mode | Behavior |
|---|---|
| Webhook signature missing or invalid | Return 401. Don't leak info about which check failed. |
| Webhook timestamp > 10 min old | Return 401 (replay protection). |
| Event's `sg_message_id` not found in `email_messages` | Log `console.warn('orphan webhook', sg_message_id)`, return 200 with `skipped: 1`. Don't fail the whole batch. |
| Event's `sg_event_id` already in `delivery_events` | Skip, return `skipped: 1`. Idempotent re-delivery is safe. |
| DB update fails | Let exception propagate — return 500. SendGrid will retry with exponential backoff. |
| Poll endpoint fetch fails (in queue UI) | Log, continue polling. Don't fail the modal. If poll fails N times consecutively (e.g. 3), stop polling and show a subtle "status updates paused" indicator. Operator can refresh manually. |

---

## Testing

### Unit tests

| Test file | Cases |
|---|---|
| `tests/webhooks/sendgrid-signature.test.mjs` | signature verification — valid / invalid / missing / timestamp drift |
| `tests/webhooks/sendgrid-dedup.test.mjs` | dedup — sg_event_id already in delivery_events array returns skipped |
| `tests/webhooks/sendgrid-precedence.test.mjs` | precedence table — bounced-after-delivered keeps delivered, delivered-after-bounced keeps bounced |

### Reviewer-walked gates

| # | Gate | Success criterion |
|---|---|---|
| 1 | Migration 085 applies | `\d email_messages` shows 3 new columns; existing rows default to empty delivery_events + null delivery_status. |
| 2 | Signature verification works | curl the endpoint with a fake body + no signature header → 401. With SendGrid's "Test Your Integration" from the dashboard → 200. |
| 3 | Live `delivered` event | Send a real email to a Gmail address you own. Within 10s, `SELECT delivery_status, last_delivery_event_at FROM email_messages ORDER BY created_at DESC LIMIT 1` returns `delivered` + a recent timestamp. |
| 4 | Live `bounced` event | Send to a known-bad address (e.g. `bounce-test@simulator.amazonses.com` or a SendGrid test address). Confirm `delivery_status='bounced'` + event in `delivery_events`. |
| 5 | Dedup | Send the same test event twice via SendGrid's Test Integration button. `delivery_events` has one entry, not two. |
| 6 | UI pill updates | With the queue modal open after a bulk send, watch row status transition `Sent → Delivered` as the webhook fires. |
| 7 | Precedence | Send one email that both a delivered-recipient and bounced-recipient (bulk send with 2 recipients). After both webhooks land, `delivery_status='bounced'` (conservative wins). |
| 8 | Polling stops | After all rows terminal, verify network tab stops the 5s GET request. |

---

## Out of scope / tracked for later

1. **Engagement events (opens, clicks, unsubscribes).** Separate feature. Requires open-pixel tracking (privacy-sensitive), click-wrapping (breaks DKIM if done wrong), unsubscribe page infrastructure. Own spec.
2. **Realtime push via Supabase channels.** Polling is fine for v1. Realtime is a 2a.6b if operator UX needs it.
3. **Customer-facing delivery receipts.** Internal ops only. "Your email was delivered to X" shown to the CUSTOMER requires UX design + privacy review.
4. **Backfill of pre-2a.6 `email_messages`.** They stay `delivery_status=null` forever. Not worth the SendGrid API cost to retroactively query delivery status for hundreds of old rows.
5. **Webhook retry/queue on our side.** SendGrid retries failed webhooks with exponential backoff for up to 24 hours. We just need to be idempotent. No need for a Bull/sidekiq-style queue in v1.
6. **Cross-tenant dedup concerns.** If two tenants use the same SendGrid sub-account (unlikely but possible for a future pro tier), the webhook URL is shared. Tenant isolation comes from matching `sg_message_id` → `email_messages.tenant_id` — webhook handler does the lookup and UPDATE scoped appropriately. No extra tenant-boundary work needed.

---

## Open questions

None. All design decisions locked per brainstorming dialogue.

---

## References

- SendGrid Event Webhook docs: https://docs.sendgrid.com/for-developers/tracking-events/event
- Signature verification: https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
- `@sendgrid/eventwebhook` npm: https://www.npmjs.com/package/@sendgrid/eventwebhook
- Today's shipped infrastructure:
  - `lib/email-dispatch/dispatcher.js::dispatchEmail` — the function that currently stamps `status='sent'` on `email_messages` after SendGrid 202
  - `components/ar/BulkEmailQueue.js` — the queue UI that needs new pill states
  - `components/ar/useBulkEmailQueue.js` — the hook that will add polling
