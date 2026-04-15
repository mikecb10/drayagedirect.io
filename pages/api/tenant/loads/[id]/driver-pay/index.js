import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [
          PERMISSIONS.DISPATCHING,
          PERMISSIONS.ORDER_ENTRY,
          PERMISSIONS.ACCOUNTS_PAYABLE,
          PERMISSIONS.ALL,
        ],
        res
      )
    )
      return;

    // Nest source_charge_profile + source_tariff so the UI can show the
    // profile name on hover and link clicks directly to the editor without
    // a second request. `*` picks up source_type / source_tariff_id /
    // source_charge_profile_id added by migration 073.
    const { data, error } = await svc
      .from('order_driver_pay_lines')
      .select(`
        *,
        driver:drivers(id, first_name, last_name, name),
        source_charge_profile:driver_charge_profiles!source_charge_profile_id(id, name, charge_name, calculation_mode),
        source_tariff:driver_tariffs!source_tariff_id(id, name)
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ lines: data || [] });
  }

  if (req.method === 'POST') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const {
      driver_id,
      line_type,
      description,
      from_location,
      to_location,
      amount_cents,
      hours,
      miles,
      worked_at,
      notes,
    } = req.body || {};

    const { data, error } = await svc
      .from('order_driver_pay_lines')
      .insert({
        tenant_id: ctx.tenantId,
        order_id: id,
        driver_id: driver_id || null,
        line_type: line_type || 'line_haul',
        description: description || null,
        from_location: from_location || null,
        to_location: to_location || null,
        amount_cents: amount_cents || 0,
        hours: hours ?? null,
        miles: miles ?? null,
        worked_at: worked_at || null,
        notes: notes || null,
        created_by: ctx.userId,
      })
      .select(`*, driver:drivers(id, first_name, last_name, name)`)
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.driver_pay_create',
      entityType: 'order',
      entityId: id,
      newValues: { line_type, amount_cents },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ line: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
