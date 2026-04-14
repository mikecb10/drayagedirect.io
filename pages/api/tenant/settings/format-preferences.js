import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * GET/PUT /api/tenant/settings/format-preferences
 *
 * Reads and writes the tenant's row in the tenant_format_preferences table.
 * Powers the Formatting page under Settings → Communications.
 *
 * - GET  — returns the full row (auto-seeded on read if missing)
 * - PUT  — upserts a validated subset of fields; any unknown keys are
 *          ignored. Permission: manage_system_emails OR settings OR all.
 */

// Whitelist of editable columns with per-field validation.
// Keep this in sync with the columns on tenant_format_preferences.
const EDITABLE_FIELDS = {
  date_format: {
    type: 'enum',
    values: ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MMM D, YYYY', 'D MMM YYYY'],
  },
  date_use_long_month: { type: 'boolean' },
  date_empty_placeholder: { type: 'string', maxLen: 10 },
  time_format: { type: 'enum', values: ['12h', '24h'] },
  timezone: { type: 'string', maxLen: 64, nullable: true },
  time_show_timezone: { type: 'boolean' },
  currency_code: { type: 'string', maxLen: 8 },
  currency_symbol: { type: 'string', maxLen: 8 },
  currency_position: { type: 'enum', values: ['prefix', 'suffix', 'code_suffix'] },
  currency_thousands: { type: 'string', maxLen: 2 },
  currency_decimal: { type: 'string', maxLen: 2 },
  currency_decimal_places: { type: 'int', min: 0, max: 4 },
  currency_negative_style: { type: 'enum', values: ['minus', 'parens', 'red_minus'] },
  number_thousands: { type: 'string', maxLen: 2 },
  number_decimal: { type: 'string', maxLen: 2 },
  weight_unit: { type: 'enum', values: ['lbs', 'kg'] },
  weight_decimal_places: { type: 'int', min: 0, max: 4 },
  weight_show_unit: { type: 'boolean' },
  distance_unit: { type: 'enum', values: ['mi', 'km'] },
  phone_format: {
    type: 'enum',
    values: ['(###) ###-####', '###-###-####', '###.###.####', '+1 ### ### ####', 'raw'],
  },
  phone_country_default: { type: 'string', maxLen: 4 },
  address_format: { type: 'enum', values: ['single_line', 'multi_line', 'company_first'] },
  address_name_separator: { type: 'string', maxLen: 6 },
  container_number_format: { type: 'enum', values: ['compact', 'grouped', 'spaced'] },
  empty_placeholder: { type: 'string', maxLen: 16 },
  strict_empty_mode: { type: 'boolean' },
  organization_name_case: { type: 'enum', values: ['upper', 'title', 'as_entered'] },
  location_name_case: { type: 'enum', values: ['upper', 'title', 'as_entered'] },
  default_signature_html: { type: 'string', maxLen: 8192, nullable: true },
  default_signature_enabled: { type: 'boolean' },
};

function validateField(key, value) {
  const spec = EDITABLE_FIELDS[key];
  if (!spec) return { valid: false, reason: `Unknown field: ${key}` };

  if (value === null || value === undefined) {
    if (spec.nullable) return { valid: true, value: null };
    return { valid: false, reason: `${key} is required` };
  }

  switch (spec.type) {
    case 'boolean':
      if (typeof value !== 'boolean') return { valid: false, reason: `${key} must be a boolean` };
      return { valid: true, value };
    case 'int': {
      const n = Number(value);
      if (!Number.isInteger(n)) return { valid: false, reason: `${key} must be an integer` };
      if (spec.min != null && n < spec.min)
        return { valid: false, reason: `${key} must be >= ${spec.min}` };
      if (spec.max != null && n > spec.max)
        return { valid: false, reason: `${key} must be <= ${spec.max}` };
      return { valid: true, value: n };
    }
    case 'string': {
      if (typeof value !== 'string') return { valid: false, reason: `${key} must be a string` };
      if (spec.maxLen && value.length > spec.maxLen)
        return { valid: false, reason: `${key} exceeds max length of ${spec.maxLen}` };
      return { valid: true, value };
    }
    case 'enum': {
      if (!spec.values.includes(value))
        return {
          valid: false,
          reason: `${key} must be one of: ${spec.values.join(', ')}`,
        };
      return { valid: true, value };
    }
    default:
      return { valid: false, reason: `Unhandled validator for ${key}` };
  }
}

async function ensureRow(svc, tenantId) {
  // Defensive upsert — migration 051 seeds a row per tenant and installs
  // an auto-seed trigger on tenants INSERT, but we run an ON CONFLICT-aware
  // upsert on GET too so any edge-case missing rows self-heal.
  const { data: existing } = await svc
    .from('tenant_format_preferences')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (existing) return existing;

  const { data: seeded, error } = await svc
    .from('tenant_format_preferences')
    .insert({ tenant_id: tenantId })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return seeded;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    try {
      const prefs = await ensureRow(svc, ctx.tenantId);
      return res.status(200).json({ preferences: prefs });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
        res
      )
    ) {
      return;
    }

    // Validate incoming fields
    const updates = {};
    const errors = [];
    for (const [key, raw] of Object.entries(req.body || {})) {
      if (!(key in EDITABLE_FIELDS)) continue; // silently drop unknowns
      const result = validateField(key, raw);
      if (!result.valid) {
        errors.push(result.reason);
        continue;
      }
      updates[key] = result.value;
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    try {
      // Snapshot current state for audit
      const before = await ensureRow(svc, ctx.tenantId);

      const { data: after, error: updErr } = await svc
        .from('tenant_format_preferences')
        .update(updates)
        .eq('tenant_id', ctx.tenantId)
        .select('*')
        .single();

      if (updErr) {
        return res.status(500).json({ error: updErr.message });
      }

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'tenant_format_preferences.update',
        entityType: 'tenant_format_preferences',
        entityId: after.id,
        oldValues: before,
        newValues: after,
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ preferences: after });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
