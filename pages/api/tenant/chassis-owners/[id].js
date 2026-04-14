import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/chassis-owners/[id]
 *
 *   GET    — fetch one chassis owner profile
 *   PUT    — partial update (whitelist of editable fields)
 *   DELETE — soft-delete (sets deleted_at + is_enabled=false)
 */

const WRITE_PERMS = [PERMISSIONS.SETTINGS, PERMISSIONS.ALL];

const EDITABLE_FIELDS = new Set([
  'name',
  'code',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'country',
  'contact_name',
  'phone',
  'email',
  'is_enabled',
  'is_own_fleet',
  'notes',
]);

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing chassis owner id' });
  }

  const svc = getServiceClient();

  // Fetch first so we can return 404/403 explicitly
  const { data: existing, error: fetchErr } = await svc
    .from('chassis_owners')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!existing) return res.status(404).json({ error: 'Chassis owner not found' });

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({ chassis_owner: existing });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const updates = {};

    for (const key of Object.keys(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === 'is_enabled' || key === 'is_own_fleet') {
        updates[key] = !!body[key];
      } else if (key === 'state' || key === 'code') {
        const cleaned = cleanStr(body[key]);
        updates[key] = cleaned ? cleaned.toUpperCase() : null;
      } else {
        updates[key] = cleanStr(body[key]);
      }
    }

    if ('name' in updates && !updates.name) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields in request' });
    }

    const { data, error } = await svc
      .from('chassis_owners')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .select('*')
      .single();

    if (error) {
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
      action: 'chassis_owner.update',
      entityType: 'chassis_owner',
      entityId: data.id,
      oldValues: existing,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ chassis_owner: data });
  }

  // ── DELETE (soft) ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const { error: delErr } = await svc
      .from('chassis_owners')
      .update({
        deleted_at: new Date().toISOString(),
        is_enabled: false,
      })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);

    if (delErr) return res.status(500).json({ error: delErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'chassis_owner.delete',
      entityType: 'chassis_owner',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
