import {
  requireTenantUser,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';

/**
 * /api/tenant/branches/[id]
 *
 * GET    — single branch with counts
 * PUT    — update branch (super_admin only)
 * DELETE — soft-delete branch (super_admin only)
 */

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

const EDITABLE_FIELDS = [
  'name', 'code', 'market', 'address_line1', 'city', 'state', 'zip',
  'country', 'phone', 'email', 'manager_user_id', 'status',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  // ── GET ──
  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('branches')
      .select('*, manager:users!manager_user_id(id, name, email)')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    // Get counts
    const [userRes, customerRes, orderRes, driverRes] = await Promise.all([
      svc.from('user_branches').select('id', { count: 'exact', head: true })
        .eq('branch_id', id).eq('tenant_id', ctx.tenantId),
      svc.from('customer_branches').select('id', { count: 'exact', head: true })
        .eq('branch_id', id).eq('tenant_id', ctx.tenantId),
      svc.from('orders').select('id', { count: 'exact', head: true })
        .eq('branch_id', id).eq('tenant_id', ctx.tenantId).is('deleted_at', null),
      svc.from('drivers').select('id', { count: 'exact', head: true })
        .eq('branch_id', id).eq('tenant_id', ctx.tenantId).is('deleted_at', null),
    ]);

    data.user_count = userRes.count || 0;
    data.customer_count = customerRes.count || 0;
    data.order_count = orderRes.count || 0;
    data.driver_count = driverRes.count || 0;

    return res.status(200).json({ branch: data });
  }

  // ── UPDATE (super_admin only) ──
  if (req.method === 'PUT') {
    if (ctx.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can edit branches' });
    }

    // Fetch existing for audit
    const { data: existing } = await svc
      .from('branches')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .single();

    if (!existing) return res.status(404).json({ error: 'Branch not found' });

    const body = req.body || {};
    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) {
        if (field === 'code') {
          updates[field] = cleanStr(body[field])?.toUpperCase() || null;
        } else if (field === 'state') {
          updates[field] = cleanStr(body[field])?.toUpperCase() || null;
        } else {
          updates[field] = field === 'manager_user_id' ? (body[field] || null) : cleanStr(body[field]);
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await svc
      .from('branches')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .select('*, manager:users!manager_user_id(id, name, email)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A branch with this code already exists' });
      }
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'branch.update',
      entityType: 'branch',
      entityId: id,
      oldValues: existing,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ branch: data });
  }

  // ── DELETE (super_admin only, soft delete) ──
  if (req.method === 'DELETE') {
    if (ctx.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can delete branches' });
    }

    const { data: existing } = await svc
      .from('branches')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .single();

    if (!existing) return res.status(404).json({ error: 'Branch not found' });

    const { error } = await svc
      .from('branches')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);

    if (error) return res.status(500).json({ error: error.message });

    // Clean up junction tables
    await Promise.all([
      svc.from('user_branches').delete().eq('branch_id', id),
      svc.from('customer_branches').delete().eq('branch_id', id),
    ]);

    // Null out FK references
    await Promise.all([
      svc.from('orders').update({ branch_id: null }).eq('branch_id', id).eq('tenant_id', ctx.tenantId),
      svc.from('drivers').update({ branch_id: null }).eq('branch_id', id).eq('tenant_id', ctx.tenantId),
    ]);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'branch.delete',
      entityType: 'branch',
      entityId: id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
