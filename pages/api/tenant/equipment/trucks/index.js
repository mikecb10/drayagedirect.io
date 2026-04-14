import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const EDITABLE = [
  'truck_number',
  'truck_owner',
  'license_plate',
  'license_plate_state',
  'vin',
  'address',
  'year',
  'make',
  'model',
  'annual_inspection_date',
  'registration_exp',
  'inspection_exp',
  'hut_exp',
  'itd_number',
  'use_for_pre_appointment',
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
      .from('equipment_trucks')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('truck_number', { ascending: true });

    if (enabled === 'true') query = query.eq('is_enabled', true);
    if (enabled === 'false') query = query.eq('is_enabled', false);
    if (search) query = query.ilike('truck_number', `%${search}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      total: data.length,
      enabled: data.filter((t) => t.is_enabled).length,
      disabled: data.filter((t) => !t.is_enabled).length,
    };

    return res.status(200).json({ trucks: data, stats });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.truck_number) return res.status(400).json({ error: 'Truck number is required' });

    const insertData = { tenant_id: ctx.tenantId };
    for (const f of EDITABLE) {
      if (body[f] !== undefined) insertData[f] = body[f] === '' ? null : body[f];
    }

    const { data, error } = await svc
      .from('equipment_trucks')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'truck.create',
      entityType: 'equipment_truck',
      entityId: data.id,
      newValues: { truck_number: data.truck_number },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ truck: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
