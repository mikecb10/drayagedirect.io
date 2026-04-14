import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/chassis-owners
 *
 * Simple tenant-scoped CRUD list for chassis_owners directory profiles.
 * Unlike container_owners (SSLs) which has seeded system rows, this
 * table is entirely tenant-created: every trucking carrier builds
 * their own list of pools they pick up from + their own fleet entry.
 *
 *   GET   — list all active (not soft-deleted) chassis owners
 *           Query params:
 *             ?search=foo       substring match on name/code/contact
 *             ?enabled=true     only enabled owners
 *
 *   POST  — create a new chassis owner profile
 *           Body: { name, code?, address_line1?, address_line2?, city?,
 *                   state?, zip?, country?, contact_name?, phone?,
 *                   email?, is_own_fleet?, notes? }
 *
 * Permission gate: SETTINGS | ALL for writes.
 */

const WRITE_PERMS = [PERMISSIONS.SETTINGS, PERMISSIONS.ALL];

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
    const { search, enabled } = req.query;

    let query = svc
      .from('chassis_owners')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('is_own_fleet', { ascending: false }) // own fleet first
      .order('name', { ascending: true });

    if (enabled === 'true') {
      query = query.eq('is_enabled', true);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim();
      query = query.or(
        `name.ilike.%${s}%,code.ilike.%${s}%,contact_name.ilike.%${s}%`
      );
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ chassis_owners: data || [] });
  }

  // ── CREATE ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const name = cleanStr(body.name);
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const insertData = {
      tenant_id: ctx.tenantId,
      name,
      code: cleanStr(body.code)?.toUpperCase() || null,
      address_line1: cleanStr(body.address_line1),
      address_line2: cleanStr(body.address_line2),
      city: cleanStr(body.city),
      state: cleanStr(body.state)?.toUpperCase() || null,
      zip: cleanStr(body.zip),
      country: cleanStr(body.country) || 'US',
      contact_name: cleanStr(body.contact_name),
      phone: cleanStr(body.phone),
      email: cleanStr(body.email),
      is_enabled: body.is_enabled !== false,
      is_own_fleet: !!body.is_own_fleet,
      notes: cleanStr(body.notes),
    };

    const { data, error } = await svc
      .from('chassis_owners')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      // Unique code collision
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'A chassis owner with this code already exists',
        });
      }
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'chassis_owner.create',
      entityType: 'chassis_owner',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ chassis_owner: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
