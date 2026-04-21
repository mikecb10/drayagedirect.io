// Public endpoint — no session. Security comes from SendGrid's ECDSA-signed
// headers. Signature is verified against SENDGRID_WEBHOOK_VERIFICATION_KEY.
//
// SendGrid sends a JSON array of events per request (batched). We iterate
// each event, dedup by sg_event_id, and update the matching email_messages
// row. Orphan events (sg_message_id we don't recognize) are logged and
// skipped without failing the batch — SendGrid would otherwise retry.

import { getServiceClient } from '../../../lib/tenant-api';
import { verifySendGridSignature } from '../../../lib/webhooks/sendgrid-signature';
import {
  extractBaseMessageId,
  isDuplicateEvent,
  computeNewDeliveryStatus,
  normalizeEvent,
  isTrackedEvent,
} from '../../../lib/webhooks/sendgrid-event-processor';

export const config = {
  runtime: 'nodejs',
  api: {
    // Disable Next.js body parsing so we can read the raw bytes for ECDSA
    // verification. Parsed JSON would lose the exact byte sequence SendGrid
    // signed against.
    bodyParser: false,
  },
};

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'read_body_failed' });
  }

  // ── Signature verification ──
  const sigResult = verifySendGridSignature({
    publicKey: process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY || '',
    rawBody,
    signature: req.headers[SIGNATURE_HEADER] || null,
    timestamp: req.headers[TIMESTAMP_HEADER] || null,
  });

  if (!sigResult.ok) {
    // 401 without leaking which check failed. Reason is logged server-side
    // for operator debugging.
    console.warn('[webhook/sendgrid] signature rejected:', sigResult.reason);
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ── Parse body ──
  let events;
  try {
    events = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'invalid_json' });
  }
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'expected_array' });
  }

  // ── Per-event processing ──
  const svc = getServiceClient();
  let processed = 0;
  let skipped = 0;
  let orphan = 0;

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') {
      skipped++;
      continue;
    }
    if (!isTrackedEvent(raw.event)) {
      skipped++;
      continue;
    }

    const baseId = extractBaseMessageId(raw.sg_message_id);
    if (!baseId) {
      skipped++;
      continue;
    }

    // Look up the row. provider_message_id has no UNIQUE constraint (migration
    // 053), so we use .limit(1) + array indexing instead of .maybeSingle() to
    // avoid a 500-loop if a duplicate ever slips in. maybeSingle throws PGRST116
    // on multi-match, which SendGrid would retry for 24h with no remediation.
    // .limit(1) gracefully picks the first match; normal operation produces no
    // duplicates because SendGrid's x-message-id is globally unique.
    const { data: rows, error: selectErr } = await svc
      .from('email_messages')
      .select('id, delivery_events, delivery_status')
      .eq('provider_message_id', baseId)
      .limit(1);

    if (selectErr) {
      // DB errors are operational failures — let SendGrid retry.
      console.error('[webhook/sendgrid] select failed:', selectErr.message);
      return res.status(500).json({ error: 'db_select_failed' });
    }

    const row = rows?.[0] ?? null;

    if (!row) {
      console.warn('[webhook/sendgrid] orphan event', {
        baseId,
        event: raw.event,
        sg_event_id: raw.sg_event_id ?? 'missing',
      });
      orphan++;
      continue;
    }

    const existing = Array.isArray(row.delivery_events) ? row.delivery_events : [];
    if (isDuplicateEvent(existing, raw.sg_event_id)) {
      skipped++;
      continue;
    }

    const normalized = normalizeEvent(raw);
    const newStatus = computeNewDeliveryStatus(row.delivery_status, raw.event);
    const nextEvents = [...existing, normalized];
    // timestamp from SendGrid is unix seconds; convert to ISO for the column.
    const lastEventIso = typeof raw.timestamp === 'number'
      ? new Date(raw.timestamp * 1000).toISOString()
      : new Date().toISOString();

    const { error: updateErr } = await svc
      .from('email_messages')
      .update({
        delivery_status: newStatus,
        last_delivery_event_at: lastEventIso,
        delivery_events: nextEvents,
      })
      .eq('id', row.id);

    if (updateErr) {
      console.error('[webhook/sendgrid] update failed:', updateErr.message);
      return res.status(500).json({ error: 'db_update_failed' });
    }
    processed++;
  }

  return res.status(200).json({ processed, skipped, orphan });
}
