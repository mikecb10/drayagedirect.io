import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { validatePayload, computeManualAmount, computePresetAmount } from '../../../../../../lib/dry-run-engine';
import { generateChargeSetNumber } from '../../../../../../lib/charge-set-utils';

const ALLOWED = [
  PERMISSIONS.ACCOUNTS_RECEIVABLE,
  PERMISSIONS.ACCOUNTS_PAYABLE,
  PERMISSIONS.DISPATCHING,
  PERMISSIONS.ALL,
];

// ---------------------------------------------------------------------------
// Shared: load AR profile + applicable tier
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

// ---------------------------------------------------------------------------
// Shared: load AP profile + most-recent tier (v1)
// ---------------------------------------------------------------------------
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
// Compute AR + AP amounts from a validated body
// ---------------------------------------------------------------------------
async function computeAmounts(svc, tenantId, body) {
  const { rate_source, rate_method, miles } = body;

  if (rate_source === 'preset') {
    const occurredAt = body.occurred_at ? new Date(body.occurred_at) : new Date();
    const occurredDateStr = occurredAt.toISOString().slice(0, 10);

    const { profile: arProfile, tier: arTier } = await loadArProfileAndTier(
      svc,
      tenantId,
      body.charge_profile_id,
      occurredDateStr
    );
    const { profile: apProfile, tier: apTier } = await loadApProfileAndTier(
      svc,
      tenantId,
      body.driver_charge_profile_id
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

    return {
      arAmount: computePresetAmount(arLike, { miles }),
      apAmount: computePresetAmount(apLike, { miles }),
    };
  }

  // manual
  return {
    arAmount: computeManualAmount({
      rate_method,
      amount_cents: body.ar_amount_cents,
      rate_cents_per_mile: body.ar_rate_cents_per_mile,
      miles,
    }),
    apAmount: computeManualAmount({
      rate_method,
      amount_cents: body.ap_amount_cents,
      rate_cents_per_mile: body.ap_rate_cents_per_mile,
      miles,
    }),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, ALLOWED, res)) return;

  const { id: orderId } = req.query;
  const svc = getServiceClient();

  // ---- GET ----------------------------------------------------------------
  if (req.method === 'GET') {
    let query = svc
      .from('dry_run_attempts')
      .select(
        `*,
         driver:drivers(id, name),
         charge_profile:charge_profiles(id, name),
         driver_charge_profile:driver_charge_profiles(id, name)`
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false });

    if (req.query.event_id) {
      query = query.eq('event_id', req.query.event_id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ dry_runs: data || [] });
  }

  // ---- POST ---------------------------------------------------------------
  if (req.method === 'POST') {
    const body = req.body || {};

    // 1. Validate payload shape
    const validation = validatePayload(body);
    if (!validation.ok) return res.status(400).json({ error: validation.reason });

    // 2. Verify event belongs to this load
    const { data: event } = await svc
      .from('order_routing_events')
      .select('id, event_type, location_id')
      .eq('id', body.event_id)
      .eq('order_id', orderId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (!event) return res.status(400).json({ error: 'Event not found on this load' });

    // 3. Compute amounts
    let arAmount, apAmount;
    try {
      ({ arAmount, apAmount } = await computeAmounts(svc, ctx.tenantId, body));
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    const occurredAt = body.occurred_at ? new Date(body.occurred_at).toISOString() : new Date().toISOString();

    // 4. Insert parent dry_run_attempts row
    const { data: attempt, error: attemptErr } = await svc
      .from('dry_run_attempts')
      .insert({
        tenant_id: ctx.tenantId,
        order_id: orderId,
        event_id: body.event_id,
        driver_id: body.driver_id,
        occurred_at: occurredAt,
        rate_source: body.rate_source,
        charge_profile_id: body.charge_profile_id || null,
        driver_charge_profile_id: body.driver_charge_profile_id || null,
        rate_method: body.rate_method,
        miles: body.miles || null,
        ar_amount_cents: arAmount,
        ap_amount_cents: apAmount,
        notes: body.notes || null,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (attemptErr) return res.status(500).json({ error: attemptErr.message });

    // 5. Find-or-create a charge set in an editable status
    const { data: load } = await svc
      .from('orders')
      .select('customer_id')
      .eq('id', orderId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    let chargeSet;
    const { data: existingSets } = await svc
      .from('order_charge_sets')
      .select('id, status')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', orderId)
      .in('status', ['draft', 'unapproved'])
      .order('created_at', { ascending: true })
      .limit(1);

    if (existingSets && existingSets.length > 0) {
      chargeSet = existingSets[0];
    } else {
      const csNumber = await generateChargeSetNumber(svc, ctx.tenantId, orderId);
      const { data: newSet, error: csErr } = await svc
        .from('order_charge_sets')
        .insert({
          tenant_id: ctx.tenantId,
          order_id: orderId,
          charge_set_number: csNumber,
          bill_to_customer_id: load?.customer_id || null,
          status: 'draft',
        })
        .select()
        .single();

      if (csErr) {
        // Clean up parent
        await svc
          .from('dry_run_attempts')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', attempt.id);
        return res.status(500).json({ error: `Failed to create charge set: ${csErr.message}` });
      }
      chargeSet = newSet;
    }

    // 6. Build human-friendly event label
    const eventLabel = event.event_type
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // 7. Description string shared by both derived rows
    const milesLabel =
      body.rate_method === 'per_mile' && body.miles ? `${body.miles} mi · ` : '';
    const dateLabel = occurredAt.slice(0, 10);
    const description = `Driver · ${milesLabel}${dateLabel}`;

    // 8. Insert AR charge set line item
    const { error: liErr } = await svc.from('order_charge_set_line_items').insert({
      tenant_id: ctx.tenantId,
      charge_set_id: chargeSet.id,
      name: `Dry Run — ${eventLabel}`,
      description,
      unit_of_measure: body.rate_method,
      unit_count: 1,
      per_unit_price_cents: arAmount,
      total_cents: arAmount,
      is_auto: false,
      source_profile_id: body.charge_profile_id || null,
      dry_run_attempt_id: attempt.id,
    });

    if (liErr) {
      await svc
        .from('dry_run_attempts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', attempt.id);
      return res.status(500).json({ error: `Failed to create charge set line item: ${liErr.message}` });
    }

    // 9. Insert AP driver pay line
    const { error: payErr } = await svc.from('order_driver_pay_lines').insert({
      tenant_id: ctx.tenantId,
      order_id: orderId,
      driver_id: body.driver_id,
      line_type: 'dry_run',
      description,
      amount_cents: apAmount,
      miles: body.rate_method === 'per_mile' ? (body.miles || null) : null,
      worked_at: occurredAt,
      status: 'drafted',
      created_by: ctx.userId,
      dry_run_attempt_id: attempt.id,
    });

    if (payErr) {
      await svc
        .from('dry_run_attempts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', attempt.id);
      return res.status(500).json({ error: `Failed to create driver pay line: ${payErr.message}` });
    }

    // 10. Audit
    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'dry_run.create',
      entityType: 'dry_run',
      entityId: attempt.id,
      newValues: {
        event_id: body.event_id,
        ar_amount_cents: arAmount,
        ap_amount_cents: apAmount,
        rate_source: body.rate_source,
      },
      ipAddress: getClientIp(req),
    });

    // 11. Return
    return res.status(201).json({ dry_run: attempt });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
