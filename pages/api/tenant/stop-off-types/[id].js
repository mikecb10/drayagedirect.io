import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';
import { coerceBool, coerceInt } from '../../../../lib/utils/coerce.js';

/**
 * /api/tenant/stop-off-types/[id]
 *
 * Single-item endpoint for the stop_off_types catalog (migration 100 —
 * Stop-Offs + Chassis Splits Foundation).
 *
 *   GET    — fetch one stop-off type for this tenant
 *
 *   PUT    — partial update. Body may contain any subset of:
 *              name, description,
 *              has_cargo_transfer, is_paid_to_driver, is_billable_to_customer,
 *              counts_toward_detention, requires_location_pick,
 *              is_active, sort_order
 *            Returns 409 on unique (tenant_id, name) collision.
 *            Set is_active=false to soft-delete (keeps referential integrity
 *            for historical order_routing_events).
 *
 *   DELETE — hard-delete. Blocked with 409 if any order_routing_events
 *            reference this type; the response tells the caller to soft-
 *            delete via PUT instead. The 409 body includes
 *            referenced_event_count so the admin UI can confirm the
 *            blocking count before offering the soft-delete fallback.
 *
 * Permission gate: SETTINGS | ALL for writes (PUT, DELETE). GET is available
 * to any authenticated tenant user so picker UIs can read one row without
 * granting full Settings.
 */

const WRITE_PERMS = [PERMISSIONS.SETTINGS, PERMISSIONS.ALL];

const BOOL_FIELDS = new Set([
  'has_cargo_transfer',
  'is_paid_to_driver',
  'is_billable_to_customer',
  'counts_toward_detention',
  'requires_location_pick',
  'is_active',
]);

const INT_FIELDS = new Set(['sort_order']);

const EDITABLE_FIELDS = new Set([
  'name',
  'description',
  'has_cargo_transfer',
  'is_paid_to_driver',
  'is_billable_to_customer',
  'counts_toward_detention',
  'requires_location_pick',
  'is_active',
  'sort_order',
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
    return res.status(400).json({ error: 'Missing stop-off type id' });
  }

  const svc = getServiceClient();

  // Fetch first so GET/PUT/DELETE all share one 404 path and PUT can log
  // oldValues.
  const { data: existing, error: fetchErr } = await svc
    .from('stop_off_types')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!existing) return res.status(404).json({ error: 'Stop-off type not found' });

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({ stop_off_type: existing });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const updates = {};

    for (const key of Object.keys(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (BOOL_FIELDS.has(key)) {
        updates[key] = coerceBool(body[key], existing[key]);
      } else if (INT_FIELDS.has(key)) {
        updates[key] = coerceInt(body[key], existing[key]);
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

    updates.updated_at = new Date().toISOString();

    const { data, error } = await svc
      .from('stop_off_types')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: `Stop-off type "${updates.name || existing.name}" already exists`,
        });
      }
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'stop_off_type.update',
      entityType: 'stop_off_type',
      entityId: data.id,
      oldValues: existing,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ stop_off_type: data });
  }

  // ── DELETE (hard) ──
  // Blocked if any order_routing_events reference this type — soft-delete
  // via PUT(is_active=false) is the user-facing pattern when in use.
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const { count, error: refErr } = await svc
      .from('order_routing_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('stop_off_type_id', id);

    if (refErr) return res.status(500).json({ error: refErr.message });

    if (count && count > 0) {
      return res.status(409).json({
        error:
          `Cannot delete: ${count} routing event(s) reference this type. ` +
          `Deactivate it instead (PUT with is_active=false).`,
        referenced_event_count: count,
      });
    }

    const { error: delErr } = await svc
      .from('stop_off_types')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);

    if (delErr) {
      // Race guard: if an order_routing_event gets inserted between the
      // count check and the delete, Postgres rejects with 23503 (FK
      // violation). Surface as the same 409 the pre-check uses so the
      // caller handles one shape.
      if (delErr.code === '23503') {
        return res.status(409).json({
          error:
            'Cannot delete: this type is now referenced by a routing event. ' +
            'Deactivate it instead (PUT with is_active=false).',
        });
      }
      return res.status(500).json({ error: delErr.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'stop_off_type.delete',
      entityType: 'stop_off_type',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
