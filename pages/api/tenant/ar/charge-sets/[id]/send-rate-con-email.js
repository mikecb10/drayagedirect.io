import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import {
  dispatchEmail,
  resolveFromAddress,
  resolveFromName,
} from '../../../../../../lib/email-dispatch';
import { fetchFullConfiguration } from '../../../../../../lib/email-configuration-helpers';
import { archiveRateConPdf } from '../../../../../../lib/pdf/archive';
import { renderRateConPdf } from '../../../../../../lib/pdf/render-rate-con';

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

  const { id } = req.query;
  const { to, cc = [], bcc = [], subject, body_text, body_html, body_format } = req.body || {};

  if (!Array.isArray(to) || to.length === 0) {
    return res.status(400).json({ error: 'At least one To recipient is required' });
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ error: 'Subject is required' });
  }

  const svc = getServiceClient();

  // Verify charge set + tenant scope (no "already sent" guard — re-sending allowed)
  const { data: cs, error: fetchErr } = await svc
    .from('order_charge_sets')
    .select('id, charge_set_number, status')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!cs) return res.status(404).json({ error: 'Charge set not found' });

  // Pick the active sender config + hydrate via fetchFullConfiguration so
  // the sender-address struct is resolvable into a real email string.
  const { data: configRow, error: configErr } = await svc
    .from('email_configurations')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (configErr) return res.status(500).json({ error: configErr.message });
  if (!configRow) return res.status(500).json({ error: 'No active email sender configuration' });

  const fullConfig = await fetchFullConfiguration(svc, ctx.tenantId, configRow.id);
  if (!fullConfig) return res.status(500).json({ error: 'Sender configuration lookup failed' });

  const { data: tenantRow } = await svc
    .from('tenants')
    .select('id, name, email')
    .eq('id', ctx.tenantId)
    .maybeSingle();

  const fromAddress = resolveFromAddress(fullConfig, null, tenantRow);
  const fromName = resolveFromName(fullConfig, tenantRow);
  const replyTo = fullConfig.sender_address?.reply_to || null;

  // Step 4: Render PDF
  let pdfBuffer;
  try {
    pdfBuffer = await renderRateConPdf(svc, id, ctx.tenantId);
  } catch (e) {
    return res.status(500).json({ error: `Render failed: ${e.message}`, stage: 'render' });
  }

  // Step 5: Archive PDF to Storage (writes rate_con_pdf_url)
  let pdfStoragePath;
  try {
    pdfStoragePath = await archiveRateConPdf(svc, id, ctx.tenantId, pdfBuffer);
  } catch (e) {
    return res.status(500).json({ error: `Archive failed: ${e.message}`, stage: 'archive' });
  }

  // Step 6: Dispatch email
  let dispatchResult;
  try {
    dispatchResult = await dispatchEmail(svc, {
      tenantId: ctx.tenantId,
      senderKind: fullConfig.sender_kind,
      fromAddress,
      fromName,
      replyTo,
      to,
      cc,
      bcc,
      subject,
      html: body_html || null,
      text: body_text || null,
      bodyFormat: body_format || null,
      attachments: [{
        content: pdfBuffer,
        filename: `rate-con-${cs.charge_set_number || id}.pdf`,
        type: 'application/pdf',
      }],
      templateId: null,
      configurationId: fullConfig.id,
      sentByUserId: ctx.userId,
      relatedEntity: { type: 'charge_set', id },
      eventName: 'manual:rate_con_send',
    });
  } catch (e) {
    return res.status(500).json({
      error: `Email dispatch failed: ${e.message}`,
      stage: 'dispatch',
      rate_con_pdf_url: pdfStoragePath,
    });
  }

  // Step 7: Flip status
  const { error: updErr } = await svc
    .from('order_charge_sets')
    .update({ status: 'rate_con_sent' })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
  if (updErr) {
    console.error(`Charge set ${id}: email sent but status update failed:`, updErr.message);
    return res.status(500).json({
      error: `Email sent but status update failed: ${updErr.message}`,
      stage: 'status_update',
      rate_con_pdf_url: pdfStoragePath,
    });
  }

  // Step 8: Tenant audit log
  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'charge_set.send_rate_con_email',
    entityType: 'charge_set',
    entityId: id,
    newValues: { status: 'rate_con_sent', rate_con_pdf_url: pdfStoragePath },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({
    ok: true,
    rate_con_pdf_url: pdfStoragePath,
    message_ids: dispatchResult?.messageId ? [dispatchResult.messageId] : [],
  });
}
