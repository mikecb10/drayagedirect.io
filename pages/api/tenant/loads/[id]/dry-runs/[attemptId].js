import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { validatePayload, computeManualAmount, computePresetAmount } from '../../../../../../lib/dry-run-engine';

const ALLOWED = [
  PERMISSIONS.ACCOUNTS_RECEIVABLE,
  PERMISSIONS.ACCOUNTS_PAYABLE,
  PERMISSIONS.DISPATCHING,
  PERMISSIONS.ALL,
];

// Real invoiced statuses set by the AR flow: 'invoiced' (set by /ar/invoices POST
// when a charge set is converted to an invoice), 'billed' (alt/legacy value used
// in BillingTab filters), 'rebilling' (charge set being re-billed after credit
// memo). 'approved' is pre-invoice and still editable — do not block on it.
const INVOICED_STATUSES = ['invoiced', 'billed', 'rebilling'];

// ---------------------------------------------------------------------------
// Shared: load AR + AP profiles and tiers (same logic as index.js)
// ---------------------------------------------------------------------------
async function loadArProfileAndTier(svc, tenantId, profileId, occurredDateStr) {
  const { data: profile } = await svc
    .from('charge_profiles')
    .select('id, name, unit_of_measure, is_dry_run')
    .eq('id', profileId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!profile || !profile.is_dry_run) {
    throw Object.assign(new Error('AR profile not found or not dry-run eligible'), { status: 400 });
  }
  if (!['fixed', 'per_mile'].includes(profile.unit_of_measure)) {
    throw Object.assign(
      new Error(`AR profile unit_of_measure must be 'fixed' or 'per_mile' (got '${profile.unit_of_measure}')`),
      { status: 400 }
    );
  }

  const { data: tiers } = await svc
    .from('charge_profile_tiers')
    .select('amount_cents, start_date, end_date')
    .eq('charge_profile_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const tier =
    (tiers || []).find(
      (t) =>
        (!t.start_date || t.start_date <= occurredDateStr) &&
        (!t.end_date || t.end_date >= occurredDateStr)
    ) || (tiers || [])[0];

  if (!tier) {
    throw Object.assign(new Error('AR profile has no tier configured'), { status: 400 });
  }

  return { profile, tier };
}

async function loadApProfileAndTier(svc, tenantId, profileId) {
  const { data: profile } = await svc
    .from('driver_charge_profiles')
    .select('id, name, unit_of_measure, is_dry_run')
    .eq('id', profileId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!profile || !profile.is_dry_run) {
    throw Object.assign(new Error('AP profile not found or not dry-run eligible'), { status: 400 });
  }
  if (!['fixed', 'per_mile'].includes(profile.unit_of_measure)) {
    throw Object.assign(
      new Error(`AP profile unit_of_measure must be 'fixed' or 'per_mile' (got '${profile.unit_of_measure}')`),
      { status: 400 }
    );
  }

  const { data: tiers } = await svc
    .from('driver_charge_profile_tiers')
    .select('amount_cents')
    .eq('driver_charge_profile_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(1);

  const tier = (tiers || [])[0];
  if (!tier) {
    throw Object.assign(new Error('AP profile has no tier configured'), { status: 400 });
  }

  return { profile, tier };
}

// ---------------------------------------------------------------------------
// Guard: is this dry run still editable?
// ---------------------------------------------------------------------------
async function assertEditable(svc, attemptId) {
  // Fetch the AR line item and its charge set status
  const { data: liRow } = await svc
    .from('order_charge_set_line_items')
    .select('id, charge_set:order_charge_sets!charge_set_id(status)')
    .eq('dry_run_attempt_id', attemptId)
    .maybeSingle();

  if (liRow?.charge_set?.status && INVOICED_STATUSES.includes(liRow.charge_set.status)) {
    return {
      ok: false,
      reason: 'This dry run has been invoiced. Create a credit memo to reverse.',
    };
  }

  // Fetch the AP pay line
  const { data: payRow } = await svc
    .from('order_driver_pay_lines')
    .select('id')
    .eq('dry_run_attempt_id', attemptId)
    .maybeSingle();

  if (payRow) {
    // Check if it exists in a closed settlement
    const { data: settlementRow } = await svc
      .from('driver_settlement_lines')
      .select('id')
      .eq('driver_pay_line_id', payRow.id)
      .maybeSingle();

    if (settlementRow) {
      return {
        ok: false,
        reason: 'This dry run is in a closed settlement. Create a pay adjustment to reverse.',
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, ALLOWED, res)) return;

  const { id: orderId, attemptId } = req.query;
  const svc = getServiceClient();

  // Load and validate the attempt exists and belongs to this load/tenant
  const { data: attempt } = await svc
    .from('dry_run_attempts')
    .select('*')
    .eq('id', attemptId)
    .eq('tenant_id', ctx.tenantId)
    .eq('order_id', orderId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!attempt) return res.status(404).json({ error: 'Dry run not found' });

  // ---- PATCH --------------------------------------------------------------
  if (req.method === 'PATCH') {
    // Guard: invoiced / settled?
    const guard = await assertEditable(svc, attemptId);
    if (!guard.ok) return res.status(409).json({ error: guard.reason });

    // Merge incoming body over existing row
    const body = req.body || {};
    const merged = {
      event_id: body.event_id ?? attempt.event_id,
      driver_id: body.driver_id ?? attempt.driver_id,
      occurred_at: body.occurred_at ?? attempt.occurred_at,
      rate_source: body.rate_source ?? attempt.rate_source,
      rate_method: body.rate_method ?? attempt.rate_method,
      miles: body.miles !== undefined ? body.miles : attempt.miles,
      charge_profile_id: body.charge_profile_id !== undefined ? body.charge_profile_id : attempt.charge_profile_id,
      driver_charge_profile_id:
        body.driver_charge_profile_id !== undefined
          ? body.driver_charge_profile_id
          : attempt.driver_charge_profile_id,
      ar_amount_cents: body.ar_amount_cents !== undefined ? body.ar_amount_cents : attempt.ar_amount_cents,
      ap_amount_cents: body.ap_amount_cents !== undefined ? body.ap_amount_cents : attempt.ap_amount_cents,
      ar_rate_cents_per_mile: body.ar_rate_cents_per_mile,
      ap_rate_cents_per_mile: body.ap_rate_cents_per_mile,
      notes: body.notes !== undefined ? body.notes : attempt.notes,
    };

    // Validate merged payload
    // isEdit=true — detached dry runs (event_id=null after two-tier leg delete)
    // should remain editable from Billing / Driver Pay tabs.
    const validation = validatePayload(merged, { isEdit: true });
    if (!validation.ok) return res.status(400).json({ error: validation.reason });

    // Recompute amounts
    let arAmount, apAmount;
    try {
      if (merged.rate_source === 'preset') {
        const occurredAt = merged.occurred_at ? new Date(merged.occurred_at) : new Date();
        const occurredDateStr = occurredAt.toISOString().slice(0, 10);

        const { profile: arProfile, tier: arTier } = await loadArProfileAndTier(
          svc,
          ctx.tenantId,
          merged.charge_profile_id,
          occurredDateStr
        );
        const { profile: apProfile, tier: apTier } = await loadApProfileAndTier(
          svc,
          ctx.tenantId,
          merged.driver_charge_profile_id
        );

        const arLike = {
          rate_method: arProfile.unit_of_measure,
          amount_cents: arTier.amount_cents,
          rate_cents_per_mile: arTier.amount_cents,
        };
        const apLike = {
          rate_method: apProfile.unit_of_measure,
          amount_cents: apTier.amount_cents,
          rate_cents_per_mile: apTier.amount_cents,
        };

        arAmount = computePresetAmount(arLike, { miles: merged.miles });
        apAmount = computePresetAmount(apLike, { miles: merged.miles });
      } else {
        // manual — recompute always to catch rate/miles changes
        arAmount = computeManualAmount({
          rate_method: merged.rate_method,
          amount_cents: merged.ar_amount_cents,
          rate_cents_per_mile: merged.ar_rate_cents_per_mile,
          miles: merged.miles,
        });
        apAmount = computeManualAmount({
          rate_method: merged.rate_method,
          amount_cents: merged.ap_amount_cents,
          rate_cents_per_mile: merged.ap_rate_cents_per_mile,
          miles: merged.miles,
        });
      }
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    const occurredAtIso = merged.occurred_at
      ? new Date(merged.occurred_at).toISOString()
      : attempt.occurred_at;

    // Update parent row
    const { data: updated, error: updateErr } = await svc
      .from('dry_run_attempts')
      .update({
        event_id: merged.event_id,
        driver_id: merged.driver_id,
        occurred_at: occurredAtIso,
        rate_source: merged.rate_source,
        rate_method: merged.rate_method,
        miles: merged.miles || null,
        charge_profile_id: merged.charge_profile_id || null,
        driver_charge_profile_id: merged.driver_charge_profile_id || null,
        ar_amount_cents: arAmount,
        ap_amount_cents: apAmount,
        notes: merged.notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', attemptId)
      .select()
      .single();

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // Build description for derived rows. Includes the driver name so
    // multi-driver invoices stay defensible.
    const { data: driverRow } = await svc
      .from('drivers')
      .select('name')
      .eq('id', merged.driver_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    const driverName = driverRow?.name || 'Driver';
    const milesLabel =
      merged.rate_method === 'per_mile' && merged.miles ? `${merged.miles} mi · ` : '';
    const dateLabel = occurredAtIso.slice(0, 10);
    const description = `${driverName} · ${milesLabel}${dateLabel}`;

    // Update AR line item
    const { error: liErr } = await svc
      .from('order_charge_set_line_items')
      .update({
        per_unit_price_cents: arAmount,
        total_cents: arAmount,
        description,
      })
      .eq('dry_run_attempt_id', attemptId);

    if (liErr) return res.status(500).json({ error: `Failed to update line item: ${liErr.message}` });

    // Update AP pay line
    const { error: payErr } = await svc
      .from('order_driver_pay_lines')
      .update({
        amount_cents: apAmount,
        miles: merged.rate_method === 'per_mile' ? (merged.miles || null) : null,
        description,
      })
      .eq('dry_run_attempt_id', attemptId);

    if (payErr) return res.status(500).json({ error: `Failed to update pay line: ${payErr.message}` });

    // Audit
    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'dry_run.update',
      entityType: 'dry_run',
      entityId: attemptId,
      newValues: {
        ar_amount_cents: arAmount,
        ap_amount_cents: apAmount,
        rate_source: merged.rate_source,
        miles: merged.miles,
      },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ dry_run: updated });
  }

  // ---- DELETE -------------------------------------------------------------
  if (req.method === 'DELETE') {
    // Guard: invoiced / settled?
    const guard = await assertEditable(svc, attemptId);
    if (!guard.ok) return res.status(409).json({ error: guard.reason });

    const now = new Date().toISOString();

    // Soft-delete parent
    const { error: softErr } = await svc
      .from('dry_run_attempts')
      .update({ deleted_at: now })
      .eq('id', attemptId);

    if (softErr) return res.status(500).json({ error: softErr.message });

    // Hard-delete AR line items (no deleted_at on this table)
    const { error: liErr } = await svc
      .from('order_charge_set_line_items')
      .delete()
      .eq('dry_run_attempt_id', attemptId);

    if (liErr) return res.status(500).json({ error: `Failed to delete line item: ${liErr.message}` });

    // Hard-delete AP pay lines (no deleted_at on this table)
    const { error: payErr } = await svc
      .from('order_driver_pay_lines')
      .delete()
      .eq('dry_run_attempt_id', attemptId);

    if (payErr) return res.status(500).json({ error: `Failed to delete pay line: ${payErr.message}` });

    // Audit
    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'dry_run.delete',
      entityType: 'dry_run',
      entityId: attemptId,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
