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

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { enabled, search } = req.query;
    let query = svc
      .from('equipment_chassis')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('chassis_number', { ascending: true });

    if (enabled === 'true') query = query.eq('is_enabled', true);
    if (enabled === 'false') query = query.eq('is_enabled', false);
    if (search) query = query.ilike('chassis_number', `%${search}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      total: data.length,
      enabled: data.filter((c) => c.is_enabled).length,
      disabled: data.filter((c) => !c.is_enabled).length,
    };

    return res.status(200).json({ chassis: data, stats });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.chassis_number) return res.status(400).json({ error: 'Chassis number is required' });

    const insertData = { tenant_id: ctx.tenantId };
    for (const f of EDITABLE) {
      if (body[f] !== undefined) insertData[f] = body[f] === '' ? null : body[f];
    }

    const { data, error } = await svc
      .from('equipment_chassis')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'chassis.create',
      entityType: 'equipment_chassis',
      entityId: data.id,
      newValues: { chassis_number: data.chassis_number },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ chassis: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
