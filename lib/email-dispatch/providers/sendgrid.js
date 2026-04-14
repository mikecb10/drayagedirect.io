/**
 * SendGrid email provider
 *
 * Sends a real email via the SendGrid v3 API, then writes the
 * email_messages row with provider='sendgrid' and status='sent'.
 * On send failure, writes the row with status='failed' + error_message
 * and throws so the dispatcher records the failure in umbrella_decisions.
 *
 * Requires SENDGRID_API_KEY in process.env.
 *
 * The `dispatch(svc, tenantId, message)` contract is identical to
 * mock.js — the provider registry swaps them transparently.
 */

import sgMail from '@sendgrid/mail';
import { randomUUID } from 'crypto';

// Initialize SendGrid with the API key. If missing, dispatch() will
// fail at call time with a clear error rather than at import time.
const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

/**
 * @param svc  service-role Supabase client
 * @param tenantId  tenant UUID
 * @param message  {
 *   load_id, organization_id?,
 *   from_address, from_name?, reply_to?,
 *   to, cc, bcc,      // each a string[] of email addresses
 *   subject, html, text,
 *   template_id, umbrella_id, group_id, configuration_id, trigger_id,
 *   sent_by_user_id
 * }
 */
export async function dispatch(svc, tenantId, message) {
  if (!apiKey) {
    throw new Error(
      'SENDGRID_API_KEY is not set in environment. Add it to .env.local.'
    );
  }

  const nowIso = new Date().toISOString();
  const threadKey = `load-${message.load_id}-${message.template_id}`;

  // Build the SendGrid message payload
  const sgMsg = {
    to: (message.to || []).map((email) => ({ email })),
    from: {
      email: message.from_address,
      name: message.from_name || undefined,
    },
    subject: message.subject || '(no subject)',
    html: message.html || undefined,
    text: message.text || undefined,
  };

  // CC / BCC — SendGrid wants arrays of {email} objects
  if (message.cc && message.cc.length > 0) {
    sgMsg.cc = message.cc.map((email) => ({ email }));
  }
  if (message.bcc && message.bcc.length > 0) {
    sgMsg.bcc = message.bcc.map((email) => ({ email }));
  }

  // Reply-To
  if (message.reply_to) {
    sgMsg.replyTo = { email: message.reply_to };
  }

  // Sandbox mode — validates the payload without actually sending.
  // Useful for CI tests.  Set SENDGRID_SANDBOX_MODE=true in env.
  if (process.env.SENDGRID_SANDBOX_MODE === 'true') {
    sgMsg.mailSettings = { sandboxMode: { enable: true } };
  }

  let providerMessageId = null;
  let status = 'sent';
  let errorMessage = null;

  try {
    const [response] = await sgMail.send(sgMsg);
    // SendGrid returns the message ID in the x-message-id header
    providerMessageId =
      response?.headers?.['x-message-id'] || `sg-${randomUUID()}`;
  } catch (err) {
    status = 'failed';
    // SendGrid errors come in err.response.body.errors[]
    if (err.response?.body?.errors) {
      errorMessage = err.response.body.errors
        .map((e) => e.message)
        .join('; ');
    } else {
      errorMessage = err.message || 'Unknown SendGrid error';
    }
  }

  // Write the email_messages row regardless of success/failure.
  // The status field tells the UI + audit what happened.
  const { data, error: insertErr } = await svc
    .from('email_messages')
    .insert({
      tenant_id: tenantId,
      load_id: message.load_id || null,
      organization_id: message.organization_id || null,
      direction: 'outbound',
      from_address: message.from_address,
      from_name: message.from_name || null,
      to_addresses: message.to || [],
      cc_addresses: message.cc || [],
      bcc_addresses: message.bcc || [],
      reply_to: message.reply_to || null,
      subject: message.subject || '',
      body_html: message.html || null,
      body_text: message.text || null,
      provider: 'sendgrid',
      provider_message_id: providerMessageId || `sg-failed-${randomUUID()}`,
      thread_key: threadKey,
      status,
      last_status_at: nowIso,
      sent_at: status === 'sent' ? nowIso : null,
      error_message: errorMessage,
      template_id: message.template_id || null,
      umbrella_id: message.umbrella_id || null,
      group_id: message.group_id || null,
      configuration_id: message.configuration_id || null,
      trigger_id: message.trigger_id || null,
      sent_by_user_id: message.sent_by_user_id || null,
    })
    .select('id')
    .single();

  if (insertErr) {
    throw new Error(`sendgrid provider db insert: ${insertErr.message}`);
  }

  // If the SendGrid call itself failed, throw AFTER writing the row
  // so the message is auditable even on failure.
  if (status === 'failed') {
    throw new Error(`SendGrid send failed: ${errorMessage}`);
  }

  return { ok: true, messageId: data.id, providerMessageId };
}

export const providerName = 'sendgrid';
