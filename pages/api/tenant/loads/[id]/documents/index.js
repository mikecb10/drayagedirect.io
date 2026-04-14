import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

const BUCKET = 'load-documents';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { data, error } = await svc
      .from('order_documents')
      .select('*, uploader:users(id, name, email)')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .order('uploaded_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Sign URLs for display (valid for 1 hour)
    const withUrls = await Promise.all(
      (data || []).map(async (doc) => {
        const { data: signed } = await svc.storage
          .from(BUCKET)
          .createSignedUrl(doc.file_url, 3600);
        return { ...doc, signed_url: signed?.signedUrl || null };
      })
    );

    return res.status(200).json({ documents: withUrls });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const { file_name, file_base64, mime_type, document_type } = req.body || {};
    if (!file_name || !file_base64) {
      return res.status(400).json({ error: 'file_name and file_base64 are required' });
    }

    // Decode base64
    const buffer = Buffer.from(file_base64.split(',').pop(), 'base64');
    const path = `${ctx.tenantId}/${id}/${Date.now()}-${file_name}`;

    // Ensure bucket exists (idempotent)
    const { data: buckets } = await svc.storage.listBuckets();
    if (!buckets?.find((b) => b.name === BUCKET)) {
      await svc.storage.createBucket(BUCKET, { public: false });
    }

    const { error: uploadErr } = await svc.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: mime_type || 'application/octet-stream' });

    if (uploadErr) return res.status(500).json({ error: uploadErr.message });

    const { data, error } = await svc
      .from('order_documents')
      .insert({
        tenant_id: ctx.tenantId,
        order_id: id,
        document_type: document_type || 'other',
        file_name,
        file_url: path,
        file_size: buffer.length,
        mime_type: mime_type || null,
        uploaded_by: ctx.userId,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.document_upload',
      entityType: 'order',
      entityId: id,
      newValues: { file_name, document_type },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ document: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
