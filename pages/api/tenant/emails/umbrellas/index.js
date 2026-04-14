import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/umbrellas
 *
 *   GET   — list all umbrellas for the current tenant, ordered by
 *           is_default first (so "Default — All Loads" floats to top),
 *           then by specificity_score DESC (most specific next),
 *           then by name. Each row includes a computed group_count via
 *           an embedded count select.
 *
 *   POST  — create a new umbrella. Body accepts all 19 filter columns
 *           as optional fields. Populating any of them adds to the
 *           specificity_score via the BEFORE INSERT trigger in 052.
 *
 * Permission gate: MANAGE_SYSTEM_EMAILS | SETTINGS | ALL for writes.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

// The 27 filter columns an umbrella can scope on after migration 058.
// Any that are undefined in the request body are left NULL. Populating a
// column adds 1 to the specificity score (computed automatically by the
// DB trigger). load_types is a TEXT[] multi-select; a populated array
// counts as 1 regardless of how many entries it has.
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
  // 6 original flags
  'hazmat',
  'overweight',
  'liquor',
  'hot',
  'genset',
  'oog',
  // 8 new flags from migration 058
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
    // Normalize to a deduped, trimmed array of strings.
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

  const svc = getServiceClient();

  // ── LIST ──
  if (req.method === 'GET') {
    // Two-step fetch so we don't depend on PostgREST's FK-name-disambig
    // syntax for the 4 customer FKs. Step 1: umbrellas + group counts.
    // Step 2: one batched customer lookup across all referenced org ids.
    const { data: umbrellas, error: uErr } = await svc
      .from('email_umbrellas')
      .select('*, email_umbrella_groups(count)')
      .eq('tenant_id', ctx.tenantId)
      .order('is_default', { ascending: false })
      .order('specificity_score', { ascending: false })
      .order('name', { ascending: true });

    if (uErr) {
      return res.status(500).json({ error: uErr.message });
    }

    // Collect every referenced customer_id / location_id so we can
    // hydrate names in one query
    const orgIds = new Set();
    for (const u of umbrellas || []) {
      for (const k of [
        'customer_id',
        'pickup_location_id',
        'delivery_location_id',
        'return_location_id',
      ]) {
        if (u[k]) orgIds.add(u[k]);
      }
    }

    let orgMap = {};
    if (orgIds.size > 0) {
      // The customers table uses `short_name`, NOT `code` — caught this
      // bug when the umbrella list page showed an error banner
      // "column customers.code does not exist". The UI only consumes
      // `name` for the scope summary, so short_name is plenty.
      const { data: orgs, error: oErr } = await svc
        .from('customers')
        .select('id, name, short_name, city, state')
        .in('id', Array.from(orgIds))
        .eq('tenant_id', ctx.tenantId);
      if (oErr) {
        return res.status(500).json({ error: oErr.message });
      }
      for (const o of orgs || []) orgMap[o.id] = o;
    }

    // Normalize each row: flatten group_count, hydrate org names
    const rows = (umbrellas || []).map((u) => ({
      ...u,
      group_count: u.email_umbrella_groups?.[0]?.count ?? 0,
      email_umbrella_groups: undefined,
      customer: u.customer_id ? orgMap[u.customer_id] || null : null,
      pickup: u.pickup_location_id ? orgMap[u.pickup_location_id] || null : null,
      delivery: u.delivery_location_id
        ? orgMap[u.delivery_location_id] || null
        : null,
      return: u.return_location_id
        ? orgMap[u.return_location_id] || null
        : null,
    }));

    return res.status(200).json({ umbrellas: rows });
  }

  // ── CREATE ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const row = {
      tenant_id: ctx.tenantId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
      name,
      description: body.description ? String(body.description).trim() : null,
      is_active: body.is_active !== false,
      always_run: !!body.always_run,
      is_default: false, // Only the seed migration can create defaults
    };

    for (const field of FILTER_FIELDS) {
      const v = cleanFilterValue(field, body[field]);
      if (v !== undefined) row[field] = v;
    }

    const { data, error } = await svc
      .from('email_umbrellas')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_umbrella.create',
      entityType: 'email_umbrella',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ umbrella: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
