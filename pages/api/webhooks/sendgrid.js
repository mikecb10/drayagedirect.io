// Public endpoint — no session. Security comes from SendGrid's ECDSA-signed
// headers. Signature is verified against SENDGRID_WEBHOOK_VERIFICATION_KEY.
//
// SendGrid sends a JSON array of events per request (batched). We iterate
// each event, dedup by sg_event_id, and update the matching email_messages
// row. Orphan events (sg_message_id we don't recognize) are logged and
// skipped without failing the batch — SendGrid would otherwise retry.

import { createClient } from '@supabase/supabase-js';
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

function getServiceClient() {
  // Inline client factory — matches the pattern in lib/tenant-api but without
  // the tenant-scoping since this endpoint runs pre-tenant (webhook is global).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE env vars missing');
  }
  return createClient(url, key, { auth: { persistSession: false } });
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

    // Look up the row. Use maybeSingle — if SendGrid has sent us a webhook
    // for a message we didn't originate (shared webhook URL, test event for
    // a nonexistent ID), we log and move on rather than failing the batch.
    const { data: row, error: selectErr } = await svc
      .from('email_messages')
      .select('id, delivery_events, delivery_status')
      .eq('provider_message_id', baseId)
      .maybeSingle();

    if (selectErr) {
      // DB errors are operational failures — let SendGrid retry.
      console.error('[webhook/sendgrid] select failed:', selectErr.message);
      return res.status(500).json({ error: 'db_select_failed' });
    }

    if (!row) {
      console.warn('[webhook/sendgrid] orphan event, no email_messages row for', baseId);
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
