-- ============================================================
-- Migration 085: SendGrid delivery webhooks
-- ============================================================
-- 2a.6 — Stamp real delivery outcomes on email_messages rows
-- after SendGrid confirms (or rejects) delivery via its Event
-- Webhook. Adds three columns:
--   delivery_status        — most-severe outcome seen so far
--                            (bounced > dropped > spam_reported >
--                             delivered > deferred > null)
--   last_delivery_event_at — convenience column for ORDER BY
--                            and "most recently updated" filters
--   delivery_events        — append-only JSONB array of raw
--                            events for forensic debugging + dedup
--
-- No backfill of pre-2a.6 rows — they stay delivery_status=null
-- forever. The webhook is idempotent via sg_event_id dedup
-- inside delivery_events.
-- ============================================================

BEGIN;

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS delivery_status        TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_delivery_event_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS delivery_events        JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Partial index for polling hot path (queue UI polls by id + tenant;
-- the poll only cares about rows whose delivery is still resolving).
CREATE INDEX IF NOT EXISTS idx_email_messages_delivery_pending
  ON email_messages (tenant_id, id)
  WHERE delivery_status IS NULL AND status = 'sent';

-- Index for webhook lookup (base provider_message_id → row).
-- Tenant scoping is not enforced at the webhook layer (tenant is
-- inferred from the matched row), so provider_message_id alone
-- is the lookup key.
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_message_id
  ON email_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
