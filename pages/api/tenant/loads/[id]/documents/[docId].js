import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

const BUCKET = 'load-documents';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id, docId } = req.query;
  const svc = getServiceClient();

  // ── PUT: update document metadata (e.g. attach_to_invoice toggle) ──
  if (req.method === 'PUT') {
    const body = req.body || {};
    const updates = {};
    if ('attach_to_invoice' in body) {
      updates.attach_to_invoice = !!body.attach_to_invoice;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields in request' });
    }
    const { data, error } = await svc
      .from('order_documents')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', docId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Document not found' });
    return res.status(200).json({ document: data });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    // Fetch the document to get its storage path
    const { data: doc } = await svc
      .from('order_documents')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', docId)
      .maybeSingle();

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Remove from storage
    await svc.storage.from(BUCKET).remove([doc.file_url]);

    // Remove DB row
    const { error } = await svc
      .from('order_documents')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', docId);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.document_delete',
      entityType: 'order',
      entityId: id,
      newValues: { file_name: doc.file_name },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
