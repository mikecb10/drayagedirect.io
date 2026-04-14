import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { findMatchingCharges, applyChargesToLoad } from '../../../../../lib/tariff-engine';

/**
 * POST /api/tenant/loads/[id]/recalculate-charges
 *
 * Re-runs the tariff matching engine against the current load data.
 * Clears all auto-applied charges and re-applies from matching tariffs.
 * Manual charges (is_auto = false) are preserved.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  // Fetch the full load data for matching.
  // Uses `live_orders` view which automatically excludes soft-deleted rows
  // — no manual deleted_at filter needed.
  const { data: load, error: loadErr } = await svc
    .from('live_orders')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .single();

  if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

  // Delete existing auto-applied line items (preserve manual ones)
  // First find all charge sets for this load
  const { data: existingSets } = await svc
    .from('order_charge_sets')
    .select('id')
    .eq('order_id', id);

  if (existingSets?.length > 0) {
    for (const cs of existingSets) {
      // Delete only auto-applied line items
      await svc
        .from('order_charge_set_line_items')
        .delete()
        .eq('charge_set_id', cs.id)
        .eq('is_auto', true);
    }

    // Check if any charge sets are now empty (no manual items left) and remove them
    for (const cs of existingSets) {
      const { count } = await svc
        .from('order_charge_set_line_items')
        .select('id', { count: 'exact', head: true })
        .eq('charge_set_id', cs.id);

      if (count === 0) {
        await svc.from('order_charge_sets').delete().eq('id', cs.id);
      } else {
        // Recalculate totals for remaining manual items
        const { data: remaining } = await svc
          .from('order_charge_set_line_items')
          .select('total_cents')
          .eq('charge_set_id', cs.id);
        const total = (remaining || []).reduce((sum, li) => sum + (li.total_cents || 0), 0);
        await svc.from('order_charge_sets').update({
          subtotal_cents: total,
          total_cents: total,
          updated_at: new Date().toISOString(),
        }).eq('id', cs.id);
      }
    }
  }

  // Re-run the tariff engine
  const charges = await findMatchingCharges(svc, load, ctx.tenantId);

  if (charges.length > 0) {
    await applyChargesToLoad(svc, id, ctx.tenantId, charges);
  }

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'load.recalculate_charges',
    entityType: 'order',
    entityId: id,
    newValues: { charges_applied: charges.length },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({
    success: true,
    applied: charges.length,
    message: `${charges.length} charge${charges.length !== 1 ? 's' : ''} applied from matching tariffs`,
  });
}
