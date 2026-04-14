import { requireTenantUser, requirePermission, getServiceClient } from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

const EDITABLE_FIELDS = [
  'company_display_name',
  'default_payment_terms',
  'invoice_prefix',
  'order_prefix',
  'scac_code',
  'default_fuel_surcharge_pct',
  'labor_fee_cents',
  'quote_validity_days',
  'timezone',
  'date_format',
  'state_colors',
  'load_type_colors',
  'time_format',
  'logo_small_url',
  'logo_large_url',
  'live_presence_enabled',
  'validation_required_doc_types',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data: tenant, error: tenantErr } = await svc
      .from('tenants')
      .select('id, name, slug, status, contact_email, contact_phone, address_line1, address_city, address_state, address_zip, mc_number, dot_number, logo_url, created_at')
      .eq('id', ctx.tenantId)
      .single();

    if (tenantErr) {
      return res.status(500).json({ error: tenantErr.message });
    }

    const { data: settings } = await svc
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .single();

    return res.status(200).json({ tenant, settings });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data: oldSettings } = await svc
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .single();

    const { data, error } = await svc
      .from('tenant_settings')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'tenant_settings.update',
      entityType: 'tenant_settings',
      entityId: data.id,
      oldValues: oldSettings,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ settings: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
