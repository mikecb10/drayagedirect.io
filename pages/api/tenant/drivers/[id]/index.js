import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const EDITABLE_FIELDS = [
  'name', 'first_name', 'last_name', 'username', 'email', 'phone',
  'date_of_birth', 'date_of_hire', 'billing_email', 'home_branch_timezone',
  'default_start_location', 'driver_tags', 'profile_type',
  'license_number', 'license_state', 'license_expiry',
  'medical_exp', 'twic_exp', 'sea_link_exp', 'ocac_insurance_exp', 'termination_date',
  'sealink_number', 'register_business_name', 'hst_number', 'social_security',
  'tablet_number', 'eld_number', 'eld_connected', 'fuel_card', 'ez_pass',
  'bank_account', 'routing_number',
  'emergency_contact_name', 'emergency_relation', 'emergency_phone',
  'truck_owner', 'carrier_name', 'main_office_address', 'tshirt_size',
  'permanent_address', 'truck_number', 'trailer_number',
  'driver_shift', 'preferred_states', 'preferred_load_types',
  'min_miles', 'max_miles', 'preferred_chassis_types', 'preferred_container_types',
  'endorsements',
  'pay_type', 'pay_rate_cents', 'pay_percentage', 'hst_pct',
  'disable_driver_pay', 'hide_settlements',
  'mobile_permissions', 'location_tracking_enabled',
  'status', 'notes', 'branch_id',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

    const { data, error } = await svc
      .from('drivers')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Driver not found' });
    return res.status(200).json({ driver: data });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

    const updates = {};
    for (const f of EDITABLE_FIELDS) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    // Auto-derive `name` from first/last if not provided
    if ((updates.first_name || updates.last_name) && !updates.name) {
      updates.name = `${updates.first_name || ''} ${updates.last_name || ''}`.trim();
    }

    const { data: oldDriver } = await svc
      .from('drivers')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .single();

    if (!oldDriver) return res.status(404).json({ error: 'Driver not found' });

    const { data, error } = await svc
      .from('drivers')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'driver.update',
      entityType: 'driver',
      entityId: id,
      oldValues: oldDriver,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ driver: data });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.ALL], res)) return;

    const { error } = await svc
      .from('drivers')
      .update({ deleted_at: new Date().toISOString(), status: 'inactive' })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'driver.delete',
      entityType: 'driver',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
