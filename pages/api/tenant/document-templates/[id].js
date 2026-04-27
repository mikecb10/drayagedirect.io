import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { validateSectionConfig } from '../../../../lib/pdf/validate-section-config';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('document_templates')
      .select('id, tenant_id, customer_id, document_type, section_config, created_at, updated_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Template not found' });
    return res.status(200).json({ template: data });
  }

  if (req.method === 'PUT') {
    const { section_config } = req.body || {};

    // Need the existing row's document_type to validate the new section_config
    // against the right registry.
    const { data: existing, error: existErr } = await svc
      .from('document_templates')
      .select('document_type')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .maybeSingle();
    if (existErr) return res.status(500).json({ error: existErr.message });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const v = validateSectionConfig(section_config, existing.document_type);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const { data, error } = await svc
      .from('document_templates')
      .update({
        section_config,
        updated_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select('id, tenant_id, customer_id, document_type, section_config, created_at, updated_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ template: data });
  }

  if (req.method === 'DELETE') {
    const { error } = await svc
      .from('document_templates')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
