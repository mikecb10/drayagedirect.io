/**
 * Reference Data Handler Factory
 *
 * Creates CRUD handlers for any simple reference data table with this schema:
 *   id, tenant_id (nullable for system rows), code, label, description,
 *   is_system, is_enabled, created_at, updated_at, deleted_at
 *
 * Shared by: container_types, container_sizes, chassis_types, chassis_sizes
 *
 * Usage:
 *   // pages/api/tenant/container-types/index.js
 *   export default createListHandler('container_types', 'container_type');
 *
 *   // pages/api/tenant/container-types/[id].js
 *   export default createItemHandler('container_types', 'container_type');
 */

import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from './tenant-api';
import { logTenantAction, getClientIp } from './tenant-audit';
import { PERMISSIONS } from './permissions';
import {
  fetchOverrides,
  applyOverrides,
  filterEnabled,
  setOverride,
  fetchSortOrders,
  applySortOrders,
  saveSortOrders,
} from './tenant-reference-overrides';

const EDITABLE_FIELDS = ['code', 'label', 'description', 'is_enabled'];

/**
 * Create a list + create handler for GET/POST /api/tenant/{resource}
 */
export function createListHandler(tableName, entityLabel) {
  return async function handler(req, res) {
    const ctx = await requireTenantUser(req, res);
    if (!ctx) return;
    const svc = getServiceClient();

    if (req.method === 'GET') {
      const { search, enabled } = req.query;

      let query = svc
        .from(tableName)
        .select('*')
        .is('deleted_at', null)
        .or(`is_system.eq.true,tenant_id.eq.${ctx.tenantId}`)
        .order('is_system', { ascending: false })
        .order('label', { ascending: true });

      if (search) {
        query = query.or(`code.ilike.%${search}%,label.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      // Merge in tenant-specific overrides + sort orders
      const [overrides, sortOrders] = await Promise.all([
        fetchOverrides(svc, ctx.tenantId, tableName),
        fetchSortOrders(svc, ctx.tenantId, tableName),
      ]);
      let items = applyOverrides(data || [], overrides);
      items = applySortOrders(items, sortOrders);

      // If caller wants only enabled items (e.g. picker), filter server-side
      if (enabled === 'true') items = filterEnabled(items);

      return res.status(200).json({ items });
    }

    // Reorder: batch-save sort_order for all items
    if (req.method === 'PUT') {
      if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

      const { items } = req.body || {};
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array required with {id, sort_order}' });
      }

      try {
        await saveSortOrders(svc, ctx.tenantId, tableName, items);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: `${entityLabel}.reorder`,
        entityType: entityLabel,
        entityId: null,
        newValues: { count: items.length },
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST') {
      if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

      const body = req.body || {};
      if (!body.code || !body.label) {
        return res.status(400).json({ error: 'Code and label are required' });
      }

      const insertData = {
        tenant_id: ctx.tenantId,
        code: body.code,
        label: body.label,
        description: body.description || null,
        is_system: false,
        is_enabled: true,
      };

      const { data, error } = await svc
        .from(tableName)
        .insert(insertData)
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: `${entityLabel}.create`,
        entityType: entityLabel,
        entityId: data.id,
        newValues: { code: data.code, label: data.label },
        ipAddress: getClientIp(req),
      });

      return res.status(201).json({ item: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  };
}

/**
 * Create a single-item handler for GET/PUT/DELETE /api/tenant/{resource}/[id]
 */
export function createItemHandler(tableName, entityLabel) {
  return async function handler(req, res) {
    const ctx = await requireTenantUser(req, res);
    if (!ctx) return;

    const { id } = req.query;
    const svc = getServiceClient();

    if (req.method === 'GET') {
      const { data, error } = await svc
        .from(tableName)
        .select('*')
        .eq('id', id)
        .or(`is_system.eq.true,tenant_id.eq.${ctx.tenantId}`)
        .is('deleted_at', null)
        .maybeSingle();

      if (error || !data) return res.status(404).json({ error: `${entityLabel} not found` });
      return res.status(200).json({ item: data });
    }

    if (req.method === 'PUT') {
      if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

      const { data: existing } = await svc
        .from(tableName)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!existing) return res.status(404).json({ error: `${entityLabel} not found` });

      // System rows: only allow toggling is_enabled via the override table.
      // Everything else (label/code/description) is read-only to tenants.
      if (existing.is_system && existing.tenant_id === null) {
        if (req.body.is_enabled !== undefined) {
          await setOverride(svc, ctx.tenantId, tableName, id, !!req.body.is_enabled);

          await logTenantAction(svc, {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: `${entityLabel}.toggle`,
            entityType: entityLabel,
            entityId: id,
            newValues: { is_enabled: !!req.body.is_enabled },
            ipAddress: getClientIp(req),
          });

          return res.status(200).json({
            item: { ...existing, effective_enabled: !!req.body.is_enabled },
          });
        }
        return res.status(403).json({
          error: `System ${entityLabel} content cannot be edited. You can toggle it on/off for your tenant only.`,
        });
      }

      if (existing.tenant_id !== ctx.tenantId) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      const updates = {};
      for (const f of EDITABLE_FIELDS) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }

      const { data, error } = await svc
        .from(tableName)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: `${entityLabel}.update`,
        entityType: entityLabel,
        entityId: id,
        oldValues: existing,
        newValues: data,
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ item: data });
    }

    if (req.method === 'DELETE') {
      if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

      const { data: existing } = await svc
        .from(tableName)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!existing) return res.status(404).json({ error: `${entityLabel} not found` });
      if (existing.is_system) {
        return res.status(403).json({ error: `System ${entityLabel} cannot be deleted` });
      }
      if (existing.tenant_id !== ctx.tenantId) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      const { error } = await svc
        .from(tableName)
        .update({ deleted_at: new Date().toISOString(), is_enabled: false })
        .eq('id', id);

      if (error) return res.status(500).json({ error: error.message });

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: `${entityLabel}.delete`,
        entityType: entityLabel,
        entityId: id,
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  };
}
