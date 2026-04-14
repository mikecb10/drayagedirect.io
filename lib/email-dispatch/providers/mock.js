/**
 * Mock email provider
 *
 * Writes a fully-populated row to email_messages with provider='manual'
 * and status='sent' so the rest of the pipeline (audit log, activity UI)
 * behaves exactly as if a real send had happened. The real SendGrid
 * adapter (Milestone 4a) will implement the same `dispatch(svc, tenantId,
 * message)` contract and simply call the SendGrid API before writing the
 * row. The Gmail/Outlook OAuth adapters (Milestone 4b) do likewise.
 *
 * Returns { ok, messageId } on success.
 * Throws on DB error — caller wraps in try/catch to record suppressed
 * reason on the umbrella_decisions log.
 */

import { randomUUID } from 'crypto';

/**
 * message shape (assembled by dispatcher.js):
 * {
 *   load_id, organization_id?,
 *   from_address, from_name?, reply_to?,
 *   to, cc, bcc,      // each a string[] of email addresses
 *   subject, html, text,
 *   template_id, umbrella_id, group_id, configuration_id, trigger_id,
 *   sent_by_user_id
 * }
 */
export async function dispatch(svc, tenantId, message) {
  const nowIso = new Date().toISOString();
  const providerMessageId = `mock-${randomUUID()}`;
  const threadKey = `load-${message.load_id}-${message.template_id}`;

  const { data, error } = await svc
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
      provider: 'manual',
      provider_message_id: providerMessageId,
      thread_key: threadKey,
      status: 'sent',
      last_status_at: nowIso,
      sent_at: nowIso,
      template_id: message.template_id || null,
      umbrella_id: message.umbrella_id || null,
      group_id: message.group_id || null,
      configuration_id: message.configuration_id || null,
      trigger_id: message.trigger_id || null,
      sent_by_user_id: message.sent_by_user_id || null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`mock provider insert: ${error.message}`);
  }

  return { ok: true, messageId: data.id, providerMessageId };
}

export const providerName = 'mock';
