// IMPORT DEPTH: pages/api/tenant/ar/invoices/bulk-send.js → repo root is ../../../../../
// Same depth as [invoiceId]/send-email.js (both are one level deeper inside invoices/).

import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import {
  dispatchEmail,
  resolveFromAddress,
  resolveFromName,
  logManualBulkSend,
} from '../../../../../lib/email-dispatch';
import { fetchFullConfiguration } from '../../../../../lib/email-configuration-helpers';
import { selectActiveConfig } from '../../../../../lib/email-dispatch/select-config.js';
import { renderInvoicePdf } from '../../../../../lib/pdf/render-invoice';
import { archiveInvoicePdf } from '../../../../../lib/pdf/archive';
import { checkChargeSetDistanceGate } from '../../../../../lib/charge-set-distance-gate';

export const config = { runtime: 'nodejs' };

const STAGE = {
  validate: 'validate',
  claim: 'claim',
  fetch_config: 'fetch_config',
  render: 'render',
  dispatch: 'dispatch',
  postdispatch: 'postdispatch',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  let stage = STAGE.validate;
  let claimedIds = [];
  const svc = getServiceClient();

  try {
    // ── STAGE: validate ──────────────────────────────────────────────────────
    const { group } = req.body || {};
    if (!group || typeof group !== 'object') {
      return res.status(400).json({ error: 'group required' });
    }
    const {
      invoice_ids: invoiceIds,
      recipients,
      subject,
      body_text: bodyText,
      body_html: bodyHtml,
      body_format: bodyFormat = 'html',
      grouping_kind: groupingKind = 'customer',
      group_label: groupLabel = null,
    } = group;

    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'group.invoice_ids (non-empty array) required' });
    }
    if (!recipients || !Array.isArray(recipients.to) || recipients.to.length === 0) {
      return res.status(400).json({ error: 'group.recipients.to (non-empty array) required' });
    }
    if (!subject || (!bodyText && !bodyHtml)) {
      return res.status(400).json({ error: 'group.subject and at least one body (body_text or body_html) required' });
    }

    // ── STAGE: claim ─────────────────────────────────────────────────────────
    // claim_invoices_for_send is the plural Task-1 (migration 081) RPC.
    // Signature: (p_invoice_ids UUID[], p_tenant_id UUID) → table(invoice_id UUID)
    // Returns only the UUIDs that were successfully claimed (others already
    // sent or mid-flight are silently skipped so the caller can proceed with
    // whatever subset is available).
    stage = STAGE.claim;
    const { data: claimRows, error: claimErr } = await svc.rpc(
      'claim_invoices_for_send',
      { p_invoice_ids: invoiceIds, p_tenant_id: ctx.tenantId }
    );
    if (claimErr) throw new Error(`claim RPC failed: ${claimErr.message}`);

    claimedIds = (claimRows ?? []).map((r) => r.invoice_id);
    if (claimedIds.length === 0) {
      const err = new Error('All invoices already claimed or sent');
      err.code = 'ALL_CLAIMED';
      throw err;
    }

    // Normalize to lowercase for UUID case-insensitive comparison; use Set for O(N) lookup.
    const claimedSet = new Set(claimedIds.map((id) => String(id).toLowerCase()));
    const skippedIds = invoiceIds.filter((id) => !claimedSet.has(String(id).toLowerCase()));

    // ── STAGE: fetch_config ───────────────────────────────────────────────────
    // Branch-aware config selection: prefer a config scoped to the load's
    // branch; fall back to tenant-default. For bulk sends the first invoice's
    // branch is used (all invoices share the same customer per the cross-
    // customer guard below; ambiguous multi-branch batches should be split).
    stage = STAGE.fetch_config;

    // Fetch invoice data (including branch_id for config selection) before
    // selecting the config so we can pass the branch to selectActiveConfig.
    // branch_id is a direct column on invoices (added in migration 064) —
    // there is no load_id FK on this table.
    const { data: invoices, error: invErr } = await svc
      .from('invoices')
      .select('id, invoice_number, customer_id, branch_id, customers:customer_id(name)')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('id', claimedIds);
    if (invErr) throw new Error(`invoice load: ${invErr.message}`);

    const loadBranchId = invoices?.[0]?.branch_id || null;
    const configRow = await selectActiveConfig(svc, ctx.tenantId, loadBranchId);
    if (!configRow) {
      const err = new Error('No active email configuration for this tenant');
      err.code = 'NO_ACTIVE_CONFIG';
      throw err;
    }

    const fullConfig = await fetchFullConfiguration(svc, ctx.tenantId, configRow.id);
    if (!fullConfig) throw new Error('Sender configuration lookup failed');

    const { data: tenantRow } = await svc
      .from('tenants')
      .select('id, name, contact_email')
      .eq('id', ctx.tenantId)
      .maybeSingle();

    const fromAddress = resolveFromAddress(fullConfig, null, tenantRow);
    const fromName = resolveFromName(fullConfig, tenantRow);
    const replyTo = fullConfig.sender_address?.reply_to || null;

    // ── STAGE: render ─────────────────────────────────────────────────────────
    // For each claimed invoice: render PDF → archive to Storage (stamps pdf_url)
    // → push SendGrid attachment. renderInvoicePdf returns a Buffer; we pass it
    // as `preRendered` to archiveInvoicePdf so the same bytes land in Storage
    // and in the attachment — no double-render.
    stage = STAGE.render;

    // Cross-customer isolation (defense-in-depth): the claim RPC enforces
    // tenant boundary but NOT customer homogeneity. resolveBulkBillingRecipients
    // checks this at defaults-fetch time, but /bulk-send must re-verify because
    // a crafted request could bypass the UI and stuff invoices from multiple
    // customers into one email — leaking one customer's data to another.
    const distinctCustomers = new Set((invoices ?? []).map((i) => i.customer_id).filter(Boolean));
    if (distinctCustomers.size > 1) {
      const err = new Error(
        `bulk-send group spans ${distinctCustomers.size} customers — all invoices must share the same customer_id`
      );
      err.code = 'CROSS_CUSTOMER';
      throw err;
    }

    const invoiceMap = Object.fromEntries((invoices ?? []).map((inv) => [inv.id, inv]));

    // ── Distance gate: skip invoices whose charge sets have unresolved distance ─
    // Look up all invoice→charge_set links in one query, then gate each invoice.
    // Invoices with unresolved charges are released from the claim and collected
    // in distanceSkipped so the caller knows which ones were excluded.
    const { data: allIcsRows } = await svc
      .from('invoice_charge_sets')
      .select('invoice_id, charge_set_id')
      .eq('tenant_id', ctx.tenantId)
      .in('invoice_id', claimedIds);

    // Group charge_set_ids by invoice_id for efficient per-invoice gating.
    const chargeSetsByInvoice = {};
    for (const { invoice_id, charge_set_id } of (allIcsRows ?? [])) {
      if (!chargeSetsByInvoice[invoice_id]) chargeSetsByInvoice[invoice_id] = [];
      chargeSetsByInvoice[invoice_id].push(charge_set_id);
    }

    const distanceSkipped = [];
    const sendableInvoiceIds = [];
    for (const invoiceId of claimedIds) {
      const chargeSetIds = chargeSetsByInvoice[invoiceId] ?? [];
      let blocked = false;
      let blockNames = [];
      for (const csId of chargeSetIds) {
        const gate = await checkChargeSetDistanceGate(svc, ctx.tenantId, csId);
        if (!gate.ok && !gate.dbError) {
          blocked = true;
          blockNames = blockNames.concat(gate.unresolvedNames ?? []);
        }
      }
      if (blocked) {
        distanceSkipped.push({
          invoice_id: invoiceId,
          reason: 'unresolved_distance',
          unresolved_names: blockNames,
        });
      } else {
        sendableInvoiceIds.push(invoiceId);
      }
    }

    // Release claims on distance-blocked invoices so they can be retried.
    if (distanceSkipped.length > 0) {
      const blockedIds = distanceSkipped.map(s => s.invoice_id);
      await svc
        .from('invoices')
        .update({ send_claimed_at: null })
        .eq('tenant_id', ctx.tenantId)
        .in('id', blockedIds);
    }

    // If everything is blocked by distance, return early with a 400.
    if (sendableInvoiceIds.length === 0) {
      return res.status(400).json({
        error: 'charge_set_has_unresolved_distance_charges',
        message: `Cannot send — all invoices in this group have unresolved distance charges. Open each load's Routing tab and save a route, or set the amounts manually.`,
        skipped: distanceSkipped,
        skipped_count: distanceSkipped.length,
      });
    }

    const primaryInvoice = invoices?.find(inv => sendableInvoiceIds.includes(inv.id)) ?? invoices?.[0] ?? null;

    const attachments = [];
    for (const invoiceId of sendableInvoiceIds) {
      const inv = invoiceMap[invoiceId];
      // renderInvoicePdf(svc, invoiceId, tenantId) → Buffer
      const buffer = await renderInvoicePdf(svc, invoiceId, ctx.tenantId);
      // archiveInvoicePdf(svc, invoiceId, tenantId, preRendered) → string (storagePath)
      // Side-effect: uploads to Storage + stamps invoices.pdf_url.
      await archiveInvoicePdf(svc, invoiceId, ctx.tenantId, buffer);

      const filename = `invoice-${inv?.invoice_number || invoiceId}.pdf`;
      // Pass raw Buffer — the SendGrid provider does the single base64
      // conversion (providers/sendgrid.js). Pre-encoding here would be
      // double-base64 and corrupt the attachment.
      attachments.push({
        content: buffer,
        filename,
        type: 'application/pdf',
        disposition: 'attachment',
      });
    }

    // ── STAGE: dispatch ───────────────────────────────────────────────────────
    // dispatchEmail(svc, params) — mirror single-invoice endpoint exactly.
    // recipients.to/cc/bcc come from the caller (resolved by Task 3's
    // resolveBulkBillingRecipients and passed through the grouping modal).
    stage = STAGE.dispatch;
    const dispatchResult = await dispatchEmail(svc, {
      tenantId: ctx.tenantId,
      senderKind: fullConfig.sender_kind,
      fromAddress,
      fromName,
      replyTo,
      to: recipients.to,
      cc: recipients.cc ?? [],
      bcc: recipients.bcc ?? [],
      subject,
      html: bodyHtml || null,
      text: bodyText || null,
      bodyFormat,
      attachments,
      templateId: null,
      configurationId: fullConfig.id,
      sentByUserId: ctx.userId,
      relatedEntity: { type: 'invoice_bulk', id: sendableInvoiceIds.join(',') },
      eventName: 'manual:invoice_bulk_send',
      // Task 7 precedence helpers: supply objects so dispatcher resolves
      // display name + reply-to via the unified helper path.
      config: fullConfig,
      tenant: tenantRow,
    });

    // ── STAGE: postdispatch ───────────────────────────────────────────────────
    // Stamp sent_at + release claim on all claimed invoices.
    // We do a direct UPDATE (no bulk release RPC) because the single-send
    // release_invoice_claim RPC takes one invoice_id — not an array.
    stage = STAGE.postdispatch;
    const sentAt = new Date().toISOString();
    // Defense-in-depth: tenant filter on UPDATE. The claim RPC already enforces
    // tenant boundary, but service-role bypasses RLS so we re-enforce here.
    // Match single-send release_invoice_claim(success=true) semantics: stamp
    // sent_at AND flip status='sent' so the AR Pipeline's status-based
    // bucketing moves these invoices into the Invoiced column.
    const { error: updErr } = await svc
      .from('invoices')
      .update({ sent_at: sentAt, send_claimed_at: null, status: 'sent' })
      .eq('tenant_id', ctx.tenantId)
      .in('id', sendableInvoiceIds);
    if (updErr) throw new Error(`sent_at update: ${updErr.message}`);

    // Single bulk audit-log row.
    await logManualBulkSend(svc, {
      tenantId: ctx.tenantId,
      invoiceIds: sendableInvoiceIds,
      userId: ctx.userId,
      groupingKind,
      groupLabel: groupLabel ?? primaryInvoice?.customers?.name ?? primaryInvoice?.customer_id ?? '(group)',
      customerId: primaryInvoice?.customer_id ?? null,
      referenceNumber: null,
      messageId: dispatchResult?.messageId ?? null,
      error: null,
    });

    return res.status(200).json({
      sent: sendableInvoiceIds,
      skipped: skippedIds,
      skipped_distance: distanceSkipped,
      skipped_distance_count: distanceSkipped.length,
      message_id: dispatchResult?.messageId ?? null,
    });

  } catch (err) {
    // Release claims so Retry can reacquire. Guard with is('sent_at', null)
    // to avoid un-marking any invoice that succeeded before the failure.
    if (claimedIds.length > 0 && ctx?.tenantId) {
      // Tenant filter for defense-in-depth; sent_at IS NULL guard preserves
      // any invoice that succeeded in a prior partial attempt.
      await svc
        .from('invoices')
        .update({ send_claimed_at: null })
        .eq('tenant_id', ctx.tenantId)
        .in('id', claimedIds)
        .is('sent_at', null);
    }

    // Audit-log the failure (best-effort — don't let log failure mask the real error).
    try {
      await logManualBulkSend(svc, {
        tenantId: ctx?.tenantId ?? null,
        invoiceIds: claimedIds,
        userId: ctx?.userId ?? null,
        groupingKind: req.body?.group?.grouping_kind ?? 'customer',
        groupLabel: req.body?.group?.group_label ?? null,
        customerId: null,
        referenceNumber: null,
        messageId: null,
        error: `${stage}: ${err.message}`,
      });
    } catch (_) { /* audit-log failure is not fatal */ }

    console.error(`[bulk-send] ${stage} failure:`, err);

    if (err.code === 'NO_ACTIVE_CONFIG') {
      return res.status(400).json({
        error: 'no_active_email_configuration',
        message: err.message,
      });
    }

    const status =
      err.code === 'ALL_CLAIMED' ? 409
      : err.code === 'CROSS_CUSTOMER' ? 400
      : stage === STAGE.claim ? 409
      : 502;

    return res.status(status).json({
      error: `${stage}_failed: ${err.message}`,
      stage,
      code: err.code ?? null,
    });
  }
}
