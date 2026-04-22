// IMPORT DEPTH: pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js -> repo root is ../../../../../

import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import {
  dispatchEmail,
  resolveFromAddress,
  resolveFromName,
  logManualBulkRateConSend,
} from '../../../../../lib/email-dispatch';
import { fetchFullConfiguration } from '../../../../../lib/email-configuration-helpers';
import { selectActiveConfig } from '../../../../../lib/email-dispatch/select-config.js';
import { renderRateConPdf } from '../../../../../lib/pdf/render-rate-con';
import { archiveRateConPdf } from '../../../../../lib/pdf/archive';
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
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res
  )) return;

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
      charge_set_ids: chargeSetIds,
      recipients,
      subject,
      body_text: bodyText,
      body_html: bodyHtml,
      body_format: bodyFormat = 'html',
      grouping_kind: groupingKind = 'customer',
      group_label: groupLabel = null,
    } = group;

    if (!Array.isArray(chargeSetIds) || chargeSetIds.length === 0) {
      return res.status(400).json({ error: 'group.charge_set_ids (non-empty array) required' });
    }
    if (!recipients || !Array.isArray(recipients.to) || recipients.to.length === 0) {
      return res.status(400).json({ error: 'group.recipients.to (non-empty array) required' });
    }
    if (!subject || (!bodyText && !bodyHtml)) {
      return res.status(400).json({ error: 'group.subject and at least one body (body_text or body_html) required' });
    }
    if (!['customer', 'reference', 'charge_set'].includes(groupingKind)) {
      return res.status(400).json({ error: `invalid grouping_kind: ${groupingKind}` });
    }

    // ── STAGE: claim ─────────────────────────────────────────────────────────
    // Task 5 migration 083 RPC. Returns subset of claimed ids; already-claimed
    // rows silently skipped. Partial-subset case (some but not all) is handled
    // below as an atomic abort per spec failure policy.
    stage = STAGE.claim;
    const { data: claimRows, error: claimErr } = await svc.rpc(
      'claim_charge_sets_for_rate_con_send',
      { p_charge_set_ids: chargeSetIds, p_tenant_id: ctx.tenantId }
    );
    if (claimErr) throw new Error(`claim RPC failed: ${claimErr.message}`);

    claimedIds = (claimRows ?? []).map((r) => r.charge_set_id);
    if (claimedIds.length === 0) {
      const err = new Error('All charge-sets already claimed or sent');
      err.code = 'ALL_CLAIMED';
      throw err;
    }

    const claimedSet = new Set(claimedIds.map((id) => String(id).toLowerCase()));
    const skippedIds = chargeSetIds.filter((id) => !claimedSet.has(String(id).toLowerCase()));

    // Partial-subset policy (spec Failure Policy): if NOT all requested ids
    // were claimed, atomically abort this group. Release the partial claim
    // and mark the whole group skipped with a retry hint. This keeps each
    // group all-or-nothing so the operator isn't left reasoning about a
    // 2-of-3 email.
    if (claimedIds.length < chargeSetIds.length) {
      await svc
        .from('order_charge_sets')
        .update({ send_claimed_at: null })
        .eq('tenant_id', ctx.tenantId)
        .in('id', claimedIds);
      const err = new Error(`partial claim: ${claimedIds.length} of ${chargeSetIds.length} claimed — retry later`);
      err.code = 'PARTIAL_CLAIM';
      throw err;
    }

    // ── STAGE: fetch_config ───────────────────────────────────────────────────
    // Branch-aware config selection (2a.5): pull branch_id from the first
    // charge-set's order. order_charge_sets uses order_id (not load_id) as FK.
    stage = STAGE.fetch_config;

    const { data: chargeSets, error: csErr } = await svc
      .from('order_charge_sets')
      .select('id, charge_set_number, status, order:order_id(branch_id, customer_id)')
      .eq('tenant_id', ctx.tenantId)
      .in('id', claimedIds);
    if (csErr) throw new Error(`charge-set load: ${csErr.message}`);

    // Cross-customer isolation (defense-in-depth). Even though the email
    // popup resolves recipients via resolveBulkChargeSetRecipients which
    // enforces homogeneity, a crafted request could bypass the UI and
    // stuff charge-sets from different customers into one email.
    const distinctCustomers = new Set((chargeSets ?? []).map((cs) => cs.order?.customer_id).filter(Boolean));
    if (distinctCustomers.size > 1) {
      const err = new Error(
        `bulk-send-rate-con group spans ${distinctCustomers.size} customers — all charge-sets must share the same customer_id`
      );
      err.code = 'CROSS_CUSTOMER';
      throw err;
    }

    const loadBranchId = chargeSets?.[0]?.order?.branch_id || null;
    const primaryCustomerId = chargeSets?.[0]?.order?.customer_id || null;

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
    // For each claimed charge-set: renderRateConPdf -> archiveRateConPdf
    // (with preRendered passthrough) -> push attachment. renderRateConPdf
    // returns a Buffer; the same bytes land in Storage and in the attachment.
    stage = STAGE.render;

    const csMap = Object.fromEntries((chargeSets ?? []).map((cs) => [cs.id, cs]));

    // ── Distance gate: skip charge sets with unresolved distance ─────────────
    // Gate each claimed charge set. Blocked ones are released from the claim
    // and collected in distanceSkipped so the caller knows which were excluded.
    const distanceSkipped = [];
    const sendableCsIds = [];
    for (const csId of claimedIds) {
      const gate = await checkChargeSetDistanceGate(svc, ctx.tenantId, csId);
      if (!gate.ok) {
        // Block both real unresolved-distance hits AND DB errors.
        // Treating dbError as "OK to send" defeats the safety net (CR found).
        const reason = gate.dbError ? 'distance_check_failed' : 'unresolved_distance';
        const cs = csMap[csId];
        distanceSkipped.push({
          charge_set_id: csId,
          reason,
          unresolved_names: gate.unresolvedNames ?? [],
          db_error: gate.dbError || null,
        });
      } else {
        sendableCsIds.push(csId);
      }
    }

    // Release claims on distance-blocked charge sets so they can be retried.
    if (distanceSkipped.length > 0) {
      const blockedIds = distanceSkipped.map(s => s.charge_set_id);
      await svc
        .from('order_charge_sets')
        .update({ send_claimed_at: null })
        .eq('tenant_id', ctx.tenantId)
        .in('id', blockedIds);
    }

    // If everything is blocked by distance, return early with a 400.
    if (sendableCsIds.length === 0) {
      return res.status(400).json({
        error: 'charge_set_has_unresolved_distance_charges',
        message: `Cannot send — all charge sets in this group have unresolved distance charges. Open each load's Routing tab and save a route, or set the amounts manually.`,
        skipped: distanceSkipped,
        skipped_count: distanceSkipped.length,
      });
    }

    const attachments = [];
    for (const csId of sendableCsIds) {
      const cs = csMap[csId];
      const buffer = await renderRateConPdf(svc, csId, ctx.tenantId);
      await archiveRateConPdf(svc, csId, ctx.tenantId, buffer);

      const filename = `rate-con-${cs?.charge_set_number || csId}.pdf`;
      // Pass raw Buffer — providers/sendgrid.js does the single base64 conversion.
      // Pre-encoding here would be double-base64 and corrupt the attachment.
      attachments.push({
        content: buffer,
        filename,
        type: 'application/pdf',
        disposition: 'attachment',
      });
    }

    // ── STAGE: dispatch ───────────────────────────────────────────────────────
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
      // NOTE: Do NOT pass relatedEntity + eventName here. They trigger
      // dispatchEmail's inline audit row with umbrella_decisions[0].type
      // = 'manual'. For the bulk flow, we write our own audit row via
      // logManualBulkRateConSend below with type='manual_bulk_rate_con'
      // so queries can discriminate single vs bulk sends. Supplying the
      // fields here produces a duplicate (and misleading) audit row.
      relatedEntity: null,
      eventName: null,
      // 2a.5 precedence helpers: supply objects so dispatcher resolves
      // display name + reply-to via the unified helper path.
      config: fullConfig,
      tenant: tenantRow,
    });

    // ── STAGE: postdispatch ───────────────────────────────────────────────────
    // Release claim + flip status to 'rate_con_sent' in a single UPDATE.
    // Defense-in-depth tenant filter on UPDATE (claim RPC already enforces,
    // but service-role bypasses RLS).
    //
    // NOTE: order_charge_sets has NO sent_at column (verified against the
    // migration history — columns are created_at, updated_at, invoiced_at,
    // last_rebilled_at, send_claimed_at). The single-send endpoint at
    // send-rate-con-email.js also only updates status. If a sent_at-like
    // column is ever added, stamp it here alongside status.
    stage = STAGE.postdispatch;
    const { error: updErr } = await svc
      .from('order_charge_sets')
      .update({ status: 'rate_con_sent', send_claimed_at: null })
      .eq('tenant_id', ctx.tenantId)
      .in('id', sendableCsIds);
    if (updErr) throw new Error(`status update: ${updErr.message}`);

    // Bulk audit log entry.
    await logManualBulkRateConSend(svc, {
      tenantId: ctx.tenantId,
      chargeSetIds: sendableCsIds,
      userId: ctx.userId,
      groupingKind,
      groupLabel: groupLabel ?? primaryCustomerId ?? '(group)',
      customerId: primaryCustomerId,
      referenceNumber: null,
      messageId: dispatchResult?.messageId ?? null,
      error: null,
    });

    return res.status(200).json({
      sent: sendableCsIds,
      skipped: skippedIds,
      skipped_distance: distanceSkipped,
      skipped_distance_count: distanceSkipped.length,
      message_id: dispatchResult?.messageId ?? null,
    });

  } catch (err) {
    // Release claims so retry can re-acquire. Guard with status guard
    // so any charge-set that moved to 'rate_con_sent' in a prior partial
    // success isn't un-claimed.
    if (claimedIds.length > 0 && ctx?.tenantId) {
      await svc
        .from('order_charge_sets')
        .update({ send_claimed_at: null })
        .eq('tenant_id', ctx.tenantId)
        .in('id', claimedIds)
        .neq('status', 'rate_con_sent');
    }

    // Audit-log the failure (best-effort).
    try {
      await logManualBulkRateConSend(svc, {
        tenantId: ctx?.tenantId ?? null,
        chargeSetIds: claimedIds,
        userId: ctx?.userId ?? null,
        groupingKind: req.body?.group?.grouping_kind ?? 'customer',
        groupLabel: req.body?.group?.group_label ?? null,
        customerId: null,
        referenceNumber: null,
        messageId: null,
        error: `${stage}: ${err.message}`,
      });
    } catch (_) { /* audit-log failure is not fatal */ }

    console.error(`[bulk-send-rate-con] ${stage} failure:`, err);

    if (err.code === 'NO_ACTIVE_CONFIG') {
      return res.status(400).json({ error: 'no_active_email_configuration', message: err.message });
    }

    const status =
      err.code === 'ALL_CLAIMED' ? 409
      : err.code === 'PARTIAL_CLAIM' ? 409
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
