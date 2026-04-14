import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';
import {
  fetchOverrides,
  applyOverrides,
  filterEnabled,
} from '../../../../lib/tenant-reference-overrides';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { search, enabled } = req.query;

    let query = svc
      .from('container_owners')
      .select('*')
      .is('deleted_at', null)
      .or(`is_system.eq.true,tenant_id.eq.${ctx.tenantId}`)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,label.ilike.%${search}%,scac_code.ilike.%${search}%`
      );
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Merge tenant overrides so items carry an effective_enabled flag
    const overrides = await fetchOverrides(svc, ctx.tenantId, 'container_owners');
    let items = applyOverrides(data || [], overrides);
    if (enabled === 'true') items = filterEnabled(items);

    return res.status(200).json({ container_owners: items });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'Name is required' });

    const insertData = {
      tenant_id: ctx.tenantId,
      name: body.name,
      label: body.label || null,
      scac_code: body.scac_code ? body.scac_code.toUpperCase().trim() : null,
      contact_name: body.contact_name || null,
      phone: body.phone || null,
      email: body.email || null,
      address_line1: body.address_line1 || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      country: body.country || 'US',
      website: body.website || null,
      notes: body.notes || null,
      is_system: false,
      is_enabled: true,
    };

    const { data, error } = await svc
      .from('container_owners')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'container_owner.create',
      entityType: 'container_owner',
      entityId: data.id,
      newValues: { name: data.name, scac_code: data.scac_code },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ container_owner: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
