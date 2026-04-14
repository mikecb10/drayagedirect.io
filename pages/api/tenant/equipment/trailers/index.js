import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const EDITABLE = [
  'trailer_number',
  'trailer_owner',
  'trailer_type',
  'license_plate',
  'license_plate_state',
  'vin',
  'registration_exp',
  'inspection_exp',
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
      .from('equipment_trailers')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('trailer_number', { ascending: true });

    if (enabled === 'true') query = query.eq('is_enabled', true);
    if (enabled === 'false') query = query.eq('is_enabled', false);
    if (search) query = query.ilike('trailer_number', `%${search}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      total: data.length,
      enabled: data.filter((t) => t.is_enabled).length,
      disabled: data.filter((t) => !t.is_enabled).length,
    };

    return res.status(200).json({ trailers: data, stats });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.trailer_number) return res.status(400).json({ error: 'Trailer number is required' });

    const insertData = { tenant_id: ctx.tenantId };
    for (const f of EDITABLE) {
      if (body[f] !== undefined) insertData[f] = body[f] === '' ? null : body[f];
    }

    const { data, error } = await svc
      .from('equipment_trailers')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'trailer.create',
      entityType: 'equipment_trailer',
      entityId: data.id,
      newValues: { trailer_number: data.trailer_number },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ trailer: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
