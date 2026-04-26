import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { isValidDocumentType } from '../../../../lib/constants/document-types';
import { validateSectionConfig } from '../../../../lib/pdf/validate-section-config';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    // Optional filters: ?document_type=X&customer_id=Y
    // customer_id can be the literal string 'null' to fetch only tenant defaults.
    const { document_type, customer_id } = req.query || {};
    let query = svc
      .from('document_templates')
      .select('id, tenant_id, customer_id, document_type, section_config, created_at, updated_at')
      .eq('tenant_id', ctx.tenantId)
      .order('document_type', { ascending: true });
    if (document_type) {
      if (!isValidDocumentType(document_type)) {
        return res.status(400).json({ error: `invalid document_type: ${document_type}` });
      }
      query = query.eq('document_type', document_type);
    }
    if (customer_id === 'null') {
      query = query.is('customer_id', null);
    } else if (customer_id) {
      query = query.eq('customer_id', customer_id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ templates: data || [] });
  }

  if (req.method === 'POST') {
    const { customer_id, document_type, section_config } = req.body || {};
    const v = validateSectionConfig(section_config, document_type);
    if (!v.ok) return res.status(400).json({ error: v.error });
    if (customer_id !== undefined && customer_id !== null && typeof customer_id !== 'string') {
      return res.status(400).json({ error: 'customer_id must be a UUID string or null' });
    }

    const { data, error } = await svc
      .from('document_templates')
      .insert({
        tenant_id: ctx.tenantId,
        customer_id: customer_id || null,
        document_type,
        section_config,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('id, tenant_id, customer_id, document_type, section_config, created_at, updated_at')
      .single();
    if (error) {
      // Unique-index violation = duplicate template for the same scope
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'A template already exists for this (tenant, customer, document_type)',
        });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ template: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
