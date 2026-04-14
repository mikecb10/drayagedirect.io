import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const EDITABLE = [
  'chassis_number',
  'chassis_owner',
  'chassis_type',
  'chassis_size',
  'license_plate',
  'license_plate_state',
  'vin',
  'registration_exp',
  'inspection_exp',
  'gps_device_id',
  'is_enabled',
  'notes',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('equipment_chassis')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Chassis not found' });
    return res.status(200).json({ chassis: data });
  }

  if (req.method === 'PUT') {
    const updates = {};
    for (const f of EDITABLE) {
      if (req.body[f] !== undefined) updates[f] = req.body[f] === '' ? null : req.body[f];
    }

    const { data, error } = await svc
      .from('equipment_chassis')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'chassis.update',
      entityType: 'equipment_chassis',
      entityId: id,
      newValues: updates,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ chassis: data });
  }

  if (req.method === 'DELETE') {
    const { error } = await svc
      .from('equipment_chassis')
      .update({ deleted_at: new Date().toISOString(), is_enabled: false })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'chassis.delete',
      entityType: 'equipment_chassis',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
