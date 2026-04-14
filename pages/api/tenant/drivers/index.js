import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';
import { applyBranchFilter } from '../../../../lib/branch-filter';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

    const { status, search } = req.query;

    const { branch_id } = req.query;

    let query = svc
      .from('drivers')
      .select('*, branch:branches(id, name, code)')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    // Branch filtering
    query = applyBranchFilter(query, ctx);
    if (branch_id) query = query.eq('branch_id', branch_id);

    if (status) query = query.eq('status', status);
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`
      );
    }

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      total: data.length,
      active: data.filter((d) => d.status === 'active').length,
      inactive: data.filter((d) => d.status === 'inactive').length,
      on_leave: data.filter((d) => d.status === 'on_leave').length,
    };

    return res.status(200).json({ drivers: data, stats });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};
    const fullName =
      body.name ||
      (body.first_name && body.last_name
        ? `${body.first_name} ${body.last_name}`
        : body.first_name || body.last_name || 'Unnamed Driver');

    if (!fullName) return res.status(400).json({ error: 'Name is required' });

    const insertData = {
      tenant_id: ctx.tenantId,
      name: fullName,
      first_name: body.first_name || null,
      last_name: body.last_name || null,
      username: body.username || null,
      email: body.email || null,
      phone: body.phone || null,
      date_of_birth: body.date_of_birth || null,
      date_of_hire: body.date_of_hire || null,
      billing_email: body.billing_email || null,
      branch_id: body.branch_id || (ctx.branchIds?.length === 1 ? ctx.branchIds[0] : null),
      home_branch_timezone: body.home_branch_timezone || null,
      default_start_location: body.default_start_location || null,
      driver_tags: body.driver_tags || null,
      profile_type: body.profile_type || null,
      // License
      license_number: body.license_number || null,
      license_state: body.license_state || null,
      license_expiry: body.license_expiry || null,
      // Expirations
      medical_exp: body.medical_exp || null,
      twic_exp: body.twic_exp || null,
      sea_link_exp: body.sea_link_exp || null,
      ocac_insurance_exp: body.ocac_insurance_exp || null,
      termination_date: body.termination_date || null,
      // Documents
      sealink_number: body.sealink_number || null,
      register_business_name: body.register_business_name || null,
      hst_number: body.hst_number || null,
      social_security: body.social_security || null,
      tablet_number: body.tablet_number || null,
      eld_number: body.eld_number || null,
      eld_connected: body.eld_connected || false,
      fuel_card: body.fuel_card || null,
      ez_pass: body.ez_pass || null,
      bank_account: body.bank_account || null,
      routing_number: body.routing_number || null,
      // Other
      emergency_contact_name: body.emergency_contact_name || null,
      emergency_relation: body.emergency_relation || null,
      emergency_phone: body.emergency_phone || null,
      truck_owner: body.truck_owner || null,
      carrier_name: body.carrier_name || null,
      main_office_address: body.main_office_address || null,
      tshirt_size: body.tshirt_size || null,
      permanent_address: body.permanent_address || null,
      truck_number: body.truck_number || null,
      trailer_number: body.trailer_number || null,
      // Preferences
      driver_shift: body.driver_shift || 'day',
      preferred_states: body.preferred_states || null,
      preferred_load_types: body.preferred_load_types || null,
      min_miles: body.min_miles || null,
      max_miles: body.max_miles || null,
      preferred_chassis_types: body.preferred_chassis_types || null,
      preferred_container_types: body.preferred_container_types || null,
      endorsements: body.endorsements || {},
      // Financial
      pay_type: body.pay_type || 'flat',
      pay_rate_cents: body.pay_rate_cents || null,
      pay_percentage: body.pay_percentage || null,
      hst_pct: body.hst_pct || null,
      disable_driver_pay: body.disable_driver_pay || false,
      hide_settlements: body.hide_settlements || false,
      // Mobile permissions
      mobile_permissions: body.mobile_permissions || {},
      // Status
      status: body.status || 'active',
      notes: body.notes || null,
    };

    const { data, error } = await svc
      .from('drivers')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'driver.create',
      entityType: 'driver',
      entityId: data.id,
      newValues: { name: data.name, email: data.email },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ driver: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
