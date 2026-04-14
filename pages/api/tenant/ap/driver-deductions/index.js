import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/ap/driver-deductions
 *
 * GET  — list all driver deduction configs (with driver + type joins)
 * POST — create a deduction config for a driver
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { driver_id } = req.query;
    let query = svc
      .from('driver_deductions')
      .select(`
        *,
        driver:drivers(id, name, first_name, last_name),
        deduction_type:deduction_types(id, name)
      `)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (driver_id) query = query.eq('driver_id', driver_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Group by driver for the settings view
    const byDriver = {};
    for (const d of data || []) {
      const did = d.driver_id;
      if (!byDriver[did]) {
        byDriver[did] = {
          driver_id: did,
          driver_name: d.driver?.name || `${d.driver?.first_name || ''} ${d.driver?.last_name || ''}`.trim(),
          enabled: 0,
          disabled: 0,
          total_cents: 0,
          deductions: [],
        };
      }
      byDriver[did].deductions.push(d);
      if (d.is_enabled) {
        byDriver[did].enabled++;
        byDriver[did].total_cents += d.amount_cents || 0;
      } else {
        byDriver[did].disabled++;
      }
    }

    return res.status(200).json({
      driver_deductions: data || [],
      by_driver: Object.values(byDriver),
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.driver_id) return res.status(400).json({ error: 'Driver is required' });
    if (!body.deduction_type_id) return res.status(400).json({ error: 'Deduction type is required' });

    const { data, error } = await svc
      .from('driver_deductions')
      .insert({
        tenant_id: ctx.tenantId,
        driver_id: body.driver_id,
        deduction_type_id: body.deduction_type_id,
        description: body.description || null,
        unit_of_measure: body.unit_of_measure || 'fixed',
        math: body.math || 'subtract',
        amount_cents: body.amount_cents || 0,
        is_enabled: body.is_enabled !== false,
        is_recurring: body.is_recurring !== false,
        total_amount_cents: body.total_amount_cents || null,
        split_periods: body.split_periods || null,
        periods_applied: 0,
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'driver_deduction.create', entityType: 'driver_deduction', entityId: data.id,
      newValues: data, ipAddress: getClientIp(req),
    });
    return res.status(201).json({ driver_deduction: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
