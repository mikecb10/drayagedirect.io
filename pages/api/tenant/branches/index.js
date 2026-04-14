import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/branches
 *
 * GET  — list all branches (any authenticated user)
 * POST — create a branch (super_admin only)
 */

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  // ── LIST ──
  if (req.method === 'GET') {
    const { search, status } = req.query;

    let query = svc
      .from('branches')
      .select('*, manager:users!manager_user_id(id, name, email)')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (status) {
      query = query.eq('status', status);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim();
      query = query.or(
        `name.ilike.%${s}%,code.ilike.%${s}%,city.ilike.%${s}%,market.ilike.%${s}%`
      );
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const branches = data || [];

    // Compute stats
    const stats = {
      total: branches.length,
      active: branches.filter((b) => b.status === 'active').length,
      inactive: branches.filter((b) => b.status === 'inactive').length,
    };

    // Get user/customer counts per branch
    const branchIds = branches.map((b) => b.id);
    if (branchIds.length > 0) {
      const [userCounts, customerCounts] = await Promise.all([
        svc
          .from('user_branches')
          .select('branch_id')
          .eq('tenant_id', ctx.tenantId)
          .in('branch_id', branchIds),
        svc
          .from('customer_branches')
          .select('branch_id')
          .eq('tenant_id', ctx.tenantId)
          .in('branch_id', branchIds),
      ]);

      const uCounts = {};
      const cCounts = {};
      (userCounts.data || []).forEach((r) => {
        uCounts[r.branch_id] = (uCounts[r.branch_id] || 0) + 1;
      });
      (customerCounts.data || []).forEach((r) => {
        cCounts[r.branch_id] = (cCounts[r.branch_id] || 0) + 1;
      });

      branches.forEach((b) => {
        b.user_count = uCounts[b.id] || 0;
        b.customer_count = cCounts[b.id] || 0;
      });
    }

    return res.status(200).json({ branches, stats });
  }

  // ── CREATE (super_admin only) ──
  if (req.method === 'POST') {
    if (ctx.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can create branches' });
    }

    const body = req.body || {};
    const name = cleanStr(body.name);
    if (!name) return res.status(400).json({ error: 'Branch name is required' });

    const insertData = {
      tenant_id: ctx.tenantId,
      name,
      code: cleanStr(body.code)?.toUpperCase() || null,
      market: cleanStr(body.market),
      address_line1: cleanStr(body.address_line1),
      city: cleanStr(body.city),
      state: cleanStr(body.state)?.toUpperCase() || null,
      zip: cleanStr(body.zip),
      country: cleanStr(body.country) || 'US',
      phone: cleanStr(body.phone),
      email: cleanStr(body.email),
      manager_user_id: cleanStr(body.manager_user_id),
      status: body.status === 'inactive' ? 'inactive' : 'active',
    };

    const { data, error } = await svc
      .from('branches')
      .insert(insertData)
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
      action: 'branch.create',
      entityType: 'branch',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ branch: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
