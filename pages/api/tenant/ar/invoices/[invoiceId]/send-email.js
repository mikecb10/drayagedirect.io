import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import {
  dispatchEmail,
  resolveFromAddress,
  resolveFromName,
} from '../../../../../../lib/email-dispatch';
import { fetchFullConfiguration } from '../../../../../../lib/email-configuration-helpers';
import { archiveInvoicePdf } from '../../../../../../lib/pdf/archive';
import { renderInvoicePdf } from '../../../../../../lib/pdf/render-invoice';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { invoiceId } = req.query;
  const { to, cc = [], bcc = [], subject, body_text, body_html, body_format } = req.body || {};

  if (!Array.isArray(to) || to.length === 0) {
    return res.status(400).json({ error: 'At least one To recipient is required' });
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ error: 'Subject is required' });
  }

  const svc = getServiceClient();

  // Atomic claim. Uses claim_invoice_for_send() RPC (migration 080) so
  // two concurrent POSTs for the same invoice can't both pass the "not
  // yet sent" check and double-dispatch. The RPC grabs a row-level lock,
  // stamps send_claimed_at, and returns a discriminator telling us
  // exactly why a claim failed (not_found / already_sent /
  // send_in_progress). If anything after the claim errors (render,
  // archive, dispatch), we release the claim via release_invoice_claim()
  // with success=false so the invoice can be retried.
  const { data: claimRows, error: claimErr } = await svc.rpc(
    'claim_invoice_for_send',
    { p_invoice_id: invoiceId, p_tenant_id: ctx.tenantId }
  );
  if (claimErr) return res.status(500).json({ error: claimErr.message });
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim) return res.status(500).json({ error: 'Claim RPC returned no row' });
  if (!claim.claim_ok) {
    if (claim.claim_reason === 'not_found') {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (claim.claim_reason === 'already_sent') {
      return res.status(409).json({ error: 'Invoice already sent' });
    }
    // send_in_progress — another request currently holds the claim.
    return res.status(409).json({ error: 'Invoice send already in progress' });
  }
  const invoice = {
    id: claim.id,
    invoice_number: claim.invoice_number,
    status: claim.status,
    customer_id: claim.customer_id,
    sent_at: claim.sent_at,
  };

  // From here on, any non-success path MUST release the claim so a
  // retry is possible. The helper below keeps the rollback in one place.
  const releaseClaim = async () => {
    const { error: relErr } = await svc.rpc('release_invoice_claim', {
      p_invoice_id: invoiceId,
      p_tenant_id: ctx.tenantId,
      p_success: false,
    });
    if (relErr) {
      console.error(
        `Invoice ${invoiceId}: release_invoice_claim(false) failed:`,
        relErr.message
      );
    }
  };

  // Pick the active sender config for this tenant + hydrate it via
  // fetchFullConfiguration so the sender-address struct (local_part +
  // domain join) is resolvable into a real email string.
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
    pdfBuffer = await renderInvoicePdf(svc, invoiceId, ctx.tenantId);
  } catch (e) {
    await releaseClaim();
    return res.status(500).json({ error: `Render failed: ${e.message}`, stage: 'render' });
  }

  // Step 5: Archive PDF to Storage (writes pdf_url)
  let pdfStoragePath;
  try {
    pdfStoragePath = await archiveInvoicePdf(svc, invoiceId, ctx.tenantId, pdfBuffer);
  } catch (e) {
    await releaseClaim();
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
        filename: `invoice-${invoice.invoice_number || invoiceId}.pdf`,
        type: 'application/pdf',
      }],
      templateId: null,
      configurationId: fullConfig.id,
      sentByUserId: ctx.userId,
      relatedEntity: { type: 'invoice', id: invoiceId },
      eventName: 'manual:invoice_send',
    });
  } catch (e) {
    await releaseClaim();
    return res.status(500).json({
      error: `Email dispatch failed: ${e.message}`,
      stage: 'dispatch',
      pdf_url: pdfStoragePath,
    });
  }

  // Step 7: Release claim with success=true → stamps sent_at + status='sent'
  const { data: releasedAt, error: updErr } = await svc.rpc(
    'release_invoice_claim',
    {
      p_invoice_id: invoiceId,
      p_tenant_id: ctx.tenantId,
      p_success: true,
    }
  );
  if (updErr) {
    console.error(`Invoice ${invoiceId}: email sent but status update failed:`, updErr.message);
    return res.status(500).json({
      error: `Email sent but status update failed: ${updErr.message}`,
      stage: 'status_update',
      pdf_url: pdfStoragePath,
    });
  }
  const now = releasedAt || new Date().toISOString();

  // Step 8: Tenant audit log
  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'invoice.send_email',
    entityType: 'invoice',
    entityId: invoiceId,
    newValues: { status: 'sent', sent_at: now, pdf_url: pdfStoragePath },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({
    ok: true,
    sent_at: now,
    pdf_url: pdfStoragePath,
    message_ids: dispatchResult?.messageId ? [dispatchResult.messageId] : [],
  });
}
