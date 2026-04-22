import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { computeManualAmount, computePresetAmount } from '../../../../../../lib/dry-run-engine';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (
    !requirePermission(
      ctx,
      [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.DISPATCHING, PERMISSIONS.ALL],
      res
    )
  )
    return;

  const svc = getServiceClient();
  const body = req.body || {};
  const { rate_source, rate_method } = body;

  // Loose validation — preview is called mid-edit; don't 400 on incomplete fields.
  if (!['preset', 'manual'].includes(rate_source)) {
    return res.status(200).json({ ar_amount_cents: 0, ap_amount_cents: 0 });
  }
  if (!['fixed', 'per_mile'].includes(rate_method)) {
    return res.status(200).json({ ar_amount_cents: 0, ap_amount_cents: 0 });
  }

  try {
    if (rate_source === 'preset') {
      if (!body.charge_profile_id || !body.driver_charge_profile_id) {
        return res.status(200).json({ ar_amount_cents: 0, ap_amount_cents: 0 });
      }

      const occurredAt = body.occurred_at ? new Date(body.occurred_at) : new Date();
      const occurredDateStr = occurredAt.toISOString().slice(0, 10);

      // AR profile + applicable tier (date-ranged)
      const arResult = await svc
        .from('charge_profiles')
        .select('id, name, unit_of_measure, is_dry_run, tenant_id')
        .eq('id', body.charge_profile_id)
        .eq('tenant_id', ctx.tenantId)
        .maybeSingle();
      const arProfile = arResult.data;
      if (!arProfile || !arProfile.is_dry_run) {
        return res.status(400).json({ error: 'AR profile not found or not dry-run eligible' });
      }
      if (!['fixed', 'per_mile'].includes(arProfile.unit_of_measure)) {
        return res
          .status(400)
          .json({ error: `AR profile unit_of_measure must be 'fixed' or 'per_mile' (got '${arProfile.unit_of_measure}')` });
      }

      const arTierResult = await svc
        .from('charge_profile_tiers')
        .select('amount_cents, start_date, end_date')
        .eq('charge_profile_id', arProfile.id)
        .order('created_at', { ascending: false })
        .limit(10);
      const arTier =
        (arTierResult.data || []).find(
          (t) =>
            (!t.start_date || t.start_date <= occurredDateStr) &&
            (!t.end_date || t.end_date >= occurredDateStr)
        ) || (arTierResult.data || [])[0];
      if (!arTier) return res.status(400).json({ error: 'AR profile has no tier configured' });

      // AP profile + most-recent tier (v1 — no date filtering)
      const apResult = await svc
        .from('driver_charge_profiles')
        .select('id, name, unit_of_measure, is_dry_run, tenant_id')
        .eq('id', body.driver_charge_profile_id)
        .eq('tenant_id', ctx.tenantId)
        .maybeSingle();
      const apProfile = apResult.data;
      if (!apProfile || !apProfile.is_dry_run) {
        return res.status(400).json({ error: 'AP profile not found or not dry-run eligible' });
      }
      if (!['fixed', 'per_mile'].includes(apProfile.unit_of_measure)) {
        return res
          .status(400)
          .json({ error: `AP profile unit_of_measure must be 'fixed' or 'per_mile' (got '${apProfile.unit_of_measure}')` });
      }

      const apTierResult = await svc
        .from('driver_charge_profile_tiers')
        .select('amount_cents')
        .eq('driver_charge_profile_id', apProfile.id)
        .order('created_at', { ascending: false })
        .limit(1);
      const apTier = (apTierResult.data || [])[0];
      if (!apTier) return res.status(400).json({ error: 'AP profile has no tier configured' });

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

      return res.status(200).json({
        ar_amount_cents: computePresetAmount(arLike, { miles: body.miles }),
        ap_amount_cents: computePresetAmount(apLike, { miles: body.miles }),
        ar_profile_name: arProfile.name,
        ap_profile_name: apProfile.name,
      });
    }

    // manual path
    const ar = computeManualAmount({
      rate_method,
      amount_cents: body.ar_amount_cents,
      rate_cents_per_mile: body.ar_rate_cents_per_mile,
      miles: body.miles,
    });
    const ap = computeManualAmount({
      rate_method,
      amount_cents: body.ap_amount_cents,
      rate_cents_per_mile: body.ap_rate_cents_per_mile,
      miles: body.miles,
    });
    return res.status(200).json({ ar_amount_cents: ar, ap_amount_cents: ap });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
