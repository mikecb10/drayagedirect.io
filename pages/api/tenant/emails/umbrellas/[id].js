import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/umbrellas/[id]
 *
 *   GET    — fetch one umbrella by id, including its email groups and
 *            the template attachments on each group. Used by the
 *            umbrella editor page to hydrate the full structure.
 *
 *   PUT    — partial update. Accepts any subset of the 19 filter
 *            columns + name/description/active/always_run.
 *            is_default is frozen (only seed migration can set it).
 *            The DB trigger recomputes specificity_score automatically
 *            on UPDATE.
 *
 *   DELETE — remove a custom umbrella. Default umbrellas (is_default=true)
 *            return 403 — the UI should offer "deactivate" instead.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

// All 27 filter columns after migration 058. See index.js for full notes.
const FILTER_FIELDS = [
  'load_types',
  'customer_id',
  'pickup_location_id',
  'delivery_location_id',
  'return_location_id',
  'container_type',
  'container_size',
  'ssl',
  'csr',
  'route_id',
  'chassis_type',
  'chassis_size',
  'chassis_owner',
  'hazmat',
  'overweight',
  'liquor',
  'hot',
  'genset',
  'oog',
  'overheight',
  'scale',
  'ev',
  'street_turn',
  'bonded',
  'double',
  'tanker',
  'bill_only',
];

const BOOLEAN_FIELDS = new Set([
  'hazmat',
  'overweight',
  'liquor',
  'hot',
  'genset',
  'oog',
  'overheight',
  'scale',
  'ev',
  'street_turn',
  'bonded',
  'double',
  'tanker',
  'bill_only',
]);

const UUID_FIELDS = new Set([
  'customer_id',
  'pickup_location_id',
  'delivery_location_id',
  'return_location_id',
  'route_id',
]);

const ARRAY_FIELDS = new Set(['load_types']);

function cleanFilterValue(field, raw) {
  if (raw === undefined) return undefined;
  if (ARRAY_FIELDS.has(field)) {
    if (!Array.isArray(raw)) return [];
    return Array.from(
      new Set(
        raw
          .filter((v) => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      )
    );
  }
  if (raw === null || raw === '') return null;
  if (BOOLEAN_FIELDS.has(field)) {
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    return null;
  }
  if (UUID_FIELDS.has(field)) {
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  }
  return typeof raw === 'string' ? raw.trim() || null : raw;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing umbrella id' });
  }

  const svc = getServiceClient();

  // Fetch existing umbrella with groups + group_templates eager-loaded.
  // Two-step fetch: (1) umbrella + related org names, (2) groups with
  // their attached templates. Two queries is simpler than trying to
  // chain the full embed tree through PostgREST.
  async function fetchFullUmbrella() {
    const { data: umbrella, error: uErr } = await svc
      .from('email_umbrellas')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    if (uErr) throw new Error(uErr.message);
    if (!umbrella) return null;

    // Fetch groups for this umbrella
    const { data: groups, error: gErr } = await svc
      .from('email_umbrella_groups')
      .select('*')
      .eq('umbrella_id', id)
      .eq('tenant_id', ctx.tenantId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (gErr) throw new Error(gErr.message);

    // Fetch all template attachments for these groups in one query
    const groupIds = (groups || []).map((g) => g.id);
    let attachments = [];
    if (groupIds.length > 0) {
      const { data, error: aErr } = await svc
        .from('email_umbrella_group_templates')
        .select('*, template:email_templates(id,name,system_slug,is_system,subject,is_active,body_format)')
        .in('group_id', groupIds)
        .eq('tenant_id', ctx.tenantId)
        .order('sort_order', { ascending: true });
      if (aErr) throw new Error(aErr.message);
      attachments = data || [];
    }

    const groupsWithTemplates = (groups || []).map((g) => ({
      ...g,
      templates: attachments
        .filter((a) => a.group_id === g.id)
        .map((a) => ({
          attachment_id: a.id,
          sort_order: a.sort_order,
          ...a.template,
        })),
    }));

    return { ...umbrella, groups: groupsWithTemplates };
  }

  let existing;
  try {
    existing = await fetchFullUmbrella();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  if (!existing) {
    return res.status(404).json({ error: 'Umbrella not found' });
  }

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({ umbrella: existing });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const updates = {};

    if ('name' in body) {
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
      updates.name = name;
    }
    if ('description' in body) {
      updates.description = body.description
        ? String(body.description).trim()
        : null;
    }
    if ('is_active' in body) updates.is_active = !!body.is_active;
    if ('always_run' in body) updates.always_run = !!body.always_run;

    for (const field of FILTER_FIELDS) {
      if (field in body) {
        const v = cleanFilterValue(field, body[field]);
        if (v !== undefined) updates[field] = v;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields in request' });
    }

    updates.updated_by = ctx.userId;

    const { data: updated, error: updErr } = await svc
      .from('email_umbrellas')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .select('*')
      .single();

    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_umbrella.update',
      entityType: 'email_umbrella',
      entityId: updated.id,
      oldValues: existing,
      newValues: updated,
      ipAddress: getClientIp(req),
    });

    // Return the full hydrated umbrella so the editor stays in sync
    try {
      const refreshed = await fetchFullUmbrella();
      return res.status(200).json({ umbrella: refreshed });
    } catch (e) {
      return res.status(200).json({ umbrella: updated });
    }
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    if (existing.is_default) {
      return res.status(403).json({
        error:
          'Default umbrella cannot be deleted. Toggle is_active=false to deactivate.',
      });
    }

    const { error: delErr } = await svc
      .from('email_umbrellas')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);

    if (delErr) {
      return res.status(500).json({ error: delErr.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_umbrella.delete',
      entityType: 'email_umbrella',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
