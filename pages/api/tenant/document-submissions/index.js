import { requireTenantUser, requirePermission, getServiceClient } from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/document-submissions
 *
 * GET  — list submissions with filters (status, order_id, driver_id)
 * POST — create a new submission (driver upload via mobile)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { status, order_id, driver_id, limit: qLimit } = req.query;

    let query = svc
      .from('document_submissions')
      .select(`
        *,
        order:orders(id, order_number, status, load_type, deleted_at),
        driver:drivers(id, first_name, last_name, name),
        reviewer:users!document_submissions_reviewed_by_fkey(id, name)
      `)
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (order_id) query = query.eq('order_id', order_id);
    if (driver_id) query = query.eq('driver_id', driver_id);
    if (qLimit) query = query.limit(parseInt(qLimit));

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Exclude submissions whose parent load is soft-deleted.
    // (Supabase can't filter joined foreign tables server-side.)
    const submissions = (data || []).filter((s) => !s.order || s.order.deleted_at == null);

    // Also return counts by status for badges — recomputed from the filtered list
    const counts = { received: 0, approved: 0, rejected: 0 };
    for (const row of submissions) {
      if (counts[row.status] !== undefined) counts[row.status]++;
    }

    return res.status(200).json({ submissions, counts });
  }

  if (req.method === 'POST') {
    const body = req.body || {};

    if (!body.order_id || !body.document_type || !body.file_url) {
      return res.status(400).json({ error: 'order_id, document_type, and file_url are required' });
    }

    const { data: submission, error } = await svc
      .from('document_submissions')
      .insert({
        tenant_id: ctx.tenantId,
        order_id: body.order_id,
        routing_event_id: body.routing_event_id || null,
        driver_id: body.driver_id || null,
        uploaded_by_user_id: ctx.userId,
        document_type: body.document_type,
        file_name: body.file_name || 'document',
        file_url: body.file_url,
        file_size: body.file_size || null,
        mime_type: body.mime_type || null,
        thumbnail_url: body.thumbnail_url || null,
        status: 'received',
        blocks_event_type: body.blocks_event_type || null,
        requirement_key: body.requirement_key || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Check if this doc type requires validation.
    // Priority: per-customer config → tenant-level fallback.
    // If NOT in either list (or both empty), auto-approve immediately.

    // 1. Check per-customer config (from the load's customer)
    const { data: loadRow } = await svc
      .from('orders')
      .select('customer_id')
      .eq('id', body.order_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    let validationTypes = null;
    if (loadRow?.customer_id) {
      const { data: customer } = await svc
        .from('customers')
        .select('validation_required_doc_types')
        .eq('id', loadRow.customer_id)
        .maybeSingle();
      const customerTypes = customer?.validation_required_doc_types;
      if (Array.isArray(customerTypes) && customerTypes.length > 0) {
        validationTypes = customerTypes;
      }
    }

    // 2. Fall back to tenant-level config if customer has no config
    if (!validationTypes) {
      const { data: settings } = await svc
        .from('tenant_settings')
        .select('validation_required_doc_types')
        .eq('tenant_id', ctx.tenantId)
        .maybeSingle();
      const tenantTypes = settings?.validation_required_doc_types;
      if (Array.isArray(tenantTypes) && tenantTypes.length > 0) {
        validationTypes = tenantTypes;
      }
    }

    const requiresValidation = (() => {
      if (!validationTypes || validationTypes.length === 0) return false;
      const normalizedTypes = validationTypes.map((t) => String(t).toLowerCase());
      return normalizedTypes.includes(String(body.document_type).toLowerCase());
    })();

    if (!requiresValidation) {
      // Auto-approve: create permanent order_documents row and update
      // submission status to 'approved'. No pending count increment.
      const { data: loadDoc } = await svc
        .from('order_documents')
        .insert({
          tenant_id: ctx.tenantId,
          order_id: body.order_id,
          name: body.file_name || 'document',
          document_type: body.document_type,
          file_url: body.file_url,
          file_size: body.file_size || null,
          mime_type: body.mime_type || null,
          uploaded_by: ctx.userId,
          source: 'mobile_driver',
        })
        .select('id')
        .single()
        .catch(() => ({ data: null }));

      await svc
        .from('document_submissions')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          load_document_id: loadDoc?.id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', submission.id);

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'document.auto_approve',
        entityType: 'document_submission',
        entityId: submission.id,
        newValues: { order_id: body.order_id, document_type: body.document_type, auto: true },
        ipAddress: getClientIp(req),
      });

      return res.status(201).json({
        submission: { ...submission, status: 'approved' },
        auto_approved: true,
      });
    }

    // Requires validation — increment pending doc count for sidebar badge
    await svc.rpc('increment_pending_docs', { tid: ctx.tenantId }).catch(() => {});

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'document.submit',
      entityType: 'document_submission',
      entityId: submission.id,
      newValues: { order_id: body.order_id, document_type: body.document_type },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ submission });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
