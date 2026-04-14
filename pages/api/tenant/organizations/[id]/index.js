import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const EDITABLE_FIELDS = [
  'name',
  'short_name',
  'customer_types',
  'profile_label',
  'tracking_status',
  'market',
  'mc_number',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'country',
  'phone',
  'billing_email',
  'receiver_email',
  'quickbooks_email',
  'company_domain',
  'currency',
  'payment_terms',
  'payment_term_method',
  'payment_terms_from',
  'credit_limit_cents',
  'account_hold',
  'office_hour_start',
  'office_hour_end',
  'main_contact_name',
  'main_phone',
  'secondary_contact_name',
  'secondary_phone',
  'organization_subtype',
  'portal_enabled',
  'portal_admin_email',
  'can_edit_load',
  'tags',
  'notes',
  'status',
  // New fields from migration 027
  'sales_agent',
  'organization_subtypes',
  'quickbooks_company_field',
  'pay_type',
  'organization_tags',
  'is_hazmat_certified',
  'tir_optional',
  'invoice_combination',
  'payment_terms_days',
  'portal_email',
  'terminal_market',
  'source_terminal_id',
  // Geofence fields from migration 029
  'geofence_type',
  'geofence_data',
  // Required documents from migration 034
  'required_documents',
  // Per-customer document validation config from migration 062
  'validation_required_doc_types',
  // Invoice combination rule from migration 064
  'invoice_combination_rule',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const { data, error } = await svc
      .from('customers')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Organization not found' });

    return res.status(200).json({ organization: data });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const { data: oldOrg } = await svc
      .from('customers')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .single();

    if (!oldOrg) return res.status(404).json({ error: 'Organization not found' });

    const { data, error } = await svc
      .from('customers')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'organization.update',
      entityType: 'organization',
      entityId: id,
      oldValues: oldOrg,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ organization: data });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.ALL], res)) return;

    const { error } = await svc
      .from('customers')
      .update({ deleted_at: new Date().toISOString(), status: 'inactive' })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'organization.delete',
      entityType: 'organization',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
