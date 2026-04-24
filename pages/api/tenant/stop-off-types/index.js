import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';
import { coerceBool, coerceInt } from '../../../../lib/utils/coerce.js';

/**
 * /api/tenant/stop-off-types
 *
 * Tenant-scoped CRUD list for the stop_off_types catalog (migration 100 —
 * Stop-Offs + Chassis Splits Foundation). Each tenant gets 4 seeded defaults
 * (Fuel Stop, Driver Break, Scale, Chassis Exchange) and may add their own.
 *
 *   GET   — list all stop-off types for this tenant, ordered by sort_order
 *           (ascending). No query params yet — consumer UI is an admin
 *           settings table that shows everything including inactive rows.
 *
 *   POST  — create a new stop-off type.
 *           Body: {
 *             name (required),
 *             description?,
 *             has_cargo_transfer?     (default false),
 *             is_paid_to_driver?      (default false),
 *             is_billable_to_customer? (default false),
 *             counts_toward_detention? (default false),
 *             requires_location_pick?  (default true),
 *             is_active?               (default true),
 *             sort_order?              (default 0),
 *           }
 *           Returns 409 on unique (tenant_id, name) collision.
 *
 * Permission gate: SETTINGS | ALL for writes. Reads are available to any
 * authenticated tenant user so the create-stop-off picker (B.1f admin UI)
 * can populate dropdowns without giving every dispatcher full Settings.
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
    const { data, error } = await svc
      .from('stop_off_types')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ stop_off_types: data || [] });
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
      description: cleanStr(body.description),
      has_cargo_transfer:      coerceBool(body.has_cargo_transfer, false),
      is_paid_to_driver:       coerceBool(body.is_paid_to_driver, false),
      is_billable_to_customer: coerceBool(body.is_billable_to_customer, false),
      counts_toward_detention: coerceBool(body.counts_toward_detention, false),
      requires_location_pick:  coerceBool(body.requires_location_pick, true),
      is_active:               coerceBool(body.is_active, true),
      sort_order:              coerceInt(body.sort_order, 0),
      created_by: ctx.userId,
    };

    const { data, error } = await svc
      .from('stop_off_types')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      // Unique (tenant_id, name) collision
      if (error.code === '23505') {
        return res.status(409).json({
          error: `Stop-off type "${name}" already exists`,
        });
      }
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'stop_off_type.create',
      entityType: 'stop_off_type',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ stop_off_type: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
