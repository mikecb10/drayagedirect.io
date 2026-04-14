import { requireTenantUser, requirePermission, getServiceClient } from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/document-submissions/[id]
 *
 * PUT — approve or reject a submission
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    const body = req.body || {};
    const { action } = body; // 'approve' or 'reject'

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
    }

    // Fetch the submission
    const { data: submission, error: fetchErr } = await svc
      .from('document_submissions')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .single();

    if (fetchErr || !submission) return res.status(404).json({ error: 'Submission not found' });

    if (action === 'approve') {
      // Create a permanent document record on the load
      const { data: loadDoc } = await svc
        .from('order_documents')
        .insert({
          tenant_id: ctx.tenantId,
          order_id: submission.order_id,
          name: submission.file_name,
          document_type: submission.document_type,
          file_url: submission.file_url,
          file_size: submission.file_size,
          mime_type: submission.mime_type,
          uploaded_by: ctx.userId,
          source: 'mobile_driver',
        })
        .select()
        .single()
        .catch(() => ({ data: null }));

      // Update submission status
      const { data: updated, error: updateErr } = await svc
        .from('document_submissions')
        .update({
          status: 'approved',
          reviewed_by: ctx.userId,
          reviewed_at: new Date().toISOString(),
          load_document_id: loadDoc?.id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // Decrement pending doc count
      await svc.rpc('decrement_pending_docs', { tid: ctx.tenantId }).catch(() => {});

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'document.approve',
        entityType: 'document_submission',
        entityId: id,
        newValues: { status: 'approved', order_id: submission.order_id },
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ submission: updated });
    }

    if (action === 'reject') {
      const { data: updated, error: updateErr } = await svc
        .from('document_submissions')
        .update({
          status: 'rejected',
          reviewed_by: ctx.userId,
          reviewed_at: new Date().toISOString(),
          rejection_reason: body.rejection_reason || null,
          rejection_note: body.rejection_note || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // Decrement pending doc count
      await svc.rpc('decrement_pending_docs', { tid: ctx.tenantId }).catch(() => {});

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'document.reject',
        entityType: 'document_submission',
        entityId: id,
        newValues: { status: 'rejected', rejection_reason: body.rejection_reason },
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ submission: updated });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
