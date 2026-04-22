import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import {
  dispatchEmail,
  resolveFromAddress,
  resolveFromName,
} from '../../../../../../lib/email-dispatch';
import { fetchFullConfiguration } from '../../../../../../lib/email-configuration-helpers';
import { selectActiveConfig } from '../../../../../../lib/email-dispatch/select-config.js';
import { archiveInvoicePdf } from '../../../../../../lib/pdf/archive';
import { renderInvoicePdf } from '../../../../../../lib/pdf/render-invoice';
import { checkChargeSetDistanceGate } from '../../../../../../lib/charge-set-distance-gate';

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

  // Distance gate: block send if any charge line items have unresolved distance
  // (needs_distance=true + total_cents IS NULL). Invoices link to charge sets via
  // the invoice_charge_sets join table — look up all charge_set_ids for this invoice,
  // then gate each one. Release the claim before returning 400 so the invoice can be
  // retried after the dispatcher resolves distance via the Routing tab.
  {
    const { data: icsRows, error: icsErr } = await svc
      .from('invoice_charge_sets')
      .select('charge_set_id')
      .eq('invoice_id', invoiceId)
      .eq('tenant_id', ctx.tenantId);
    if (icsErr) {
      await releaseClaim();
      return res.status(500).json({ error: `invoice_charge_sets lookup failed: ${icsErr.message}` });
    }
    for (const { charge_set_id } of (icsRows ?? [])) {
      const gate = await checkChargeSetDistanceGate(svc, ctx.tenantId, charge_set_id);
      if (!gate.ok) {
        await releaseClaim();
        if (gate.dbError) {
          return res.status(500).json({ error: `Distance gate query failed: ${gate.dbError}` });
        }
        return res.status(400).json({
          error: 'charge_set_has_unresolved_distance_charges',
          message: `Cannot send — ${gate.unresolvedIds?.length || 0} charge(s) have unresolved distance. Open the load's Routing tab and save a route, or set the amount manually.`,
          unresolved_ids: gate.unresolvedIds,
          unresolved_names: gate.unresolvedNames,
        });
      }
    }
  }

  // Fetch branch_id for branch-aware config selection. The claim RPC only
  // returns core invoice fields, so we do a single-column lookup here.
  // branch_id is a direct column on invoices (migration 064) — no load_id FK.
  const { data: invoiceLoadRow } = await svc
    .from('invoices')
    .select('branch_id')
    .eq('id', invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  const loadBranchId = invoiceLoadRow?.branch_id || null;

  // Pick the active sender config for this tenant + hydrate it via
  // fetchFullConfiguration so the sender-address struct (local_part +
  // domain join) is resolvable into a real email string. Prefers a config
  // scoped to the load's branch; falls back to tenant-default.
  const configRow = await selectActiveConfig(svc, ctx.tenantId, loadBranchId);
  if (!configRow) {
    await releaseClaim();
    return res.status(400).json({
      error: 'no_active_email_configuration',
      message: 'No active email configuration for this tenant',
    });
  }

  const fullConfig = await fetchFullConfiguration(svc, ctx.tenantId, configRow.id);
  if (!fullConfig) {
    await releaseClaim();
    return res.status(500).json({ error: 'Sender configuration lookup failed' });
  }

  const { data: tenantRow } = await svc
    .from('tenants')
    .select('id, name, contact_email')
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
      // Task 7 precedence helpers: supply objects so dispatcher resolves
      // display name + reply-to via the unified helper path.
      config: fullConfig,
      tenant: tenantRow,
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
