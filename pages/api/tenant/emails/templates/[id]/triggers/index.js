import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../lib/permissions';
import {
  TRIGGER_KINDS,
  FIELD_CHANGE_TRIGGERS,
  FIELD_CHANGE_TYPES,
  POD_VALIDATION_GATES,
  NOTIFICATION_TRIGGERS,
  COMPOSITE_EVENT_TRIGGERS,
  LOAD_STATUSES,
  MISSING_INFO_APPLICABLE_FIELDS,
} from '../../../../../../../lib/email-trigger-events';

/**
 * /api/tenant/emails/templates/[id]/triggers
 *
 *   GET  — list all triggers attached to a given template
 *   POST — create a new trigger on the template
 *
 * Accepts the 4-kind drayage trigger model:
 *   - field_change
 *   - notification
 *   - event (composite)
 *   - status (load status + NOTIFY AFTER)
 *
 * Validation routes each kind through a dedicated sanitizer to keep
 * the conditions JSONB well-disciplined.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const MAX_NAME = 200;
const MAX_DESCRIPTION = 500;

const VALID_KINDS = new Set(TRIGGER_KINDS.map((k) => k.value));

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function cleanInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

// Normalize a { days, hours, minutes } duration object to safe ints.
function cleanDuration(raw) {
  if (!raw || typeof raw !== 'object') return { days: 0, hours: 0, minutes: 0 };
  return {
    days: cleanInt(raw.days),
    hours: cleanInt(raw.hours),
    minutes: cleanInt(raw.minutes),
  };
}

// ──────────────────────────────────────────────────────────────
// Kind-specific condition sanitizers
// ──────────────────────────────────────────────────────────────

function validateFieldChange(eventName, rawConditions) {
  const field = FIELD_CHANGE_TRIGGERS.find((f) => f.key === eventName);
  if (!field) {
    return { ok: false, error: `Unknown field_change event_name: ${eventName}` };
  }
  const conditions = rawConditions || {};
  const changeType = conditions.change_type;
  if (!FIELD_CHANGE_TYPES.some((t) => t.value === changeType)) {
    return {
      ok: false,
      error: `change_type must be one of: ${FIELD_CHANGE_TYPES.map((t) => t.value).join(', ')}`,
    };
  }
  const cleaned = { change_type: changeType };
  if (field.hasPodValidationGate) {
    const gate = conditions.validation_gate;
    if (gate) {
      if (!POD_VALIDATION_GATES.some((g) => g.value === gate)) {
        return {
          ok: false,
          error: `validation_gate must be one of: ${POD_VALIDATION_GATES.map((g) => g.value).join(', ')}`,
        };
      }
      cleaned.validation_gate = gate;
    } else {
      cleaned.validation_gate = 'at_upload'; // default
    }
  }
  return { ok: true, conditions: cleaned };
}

function validateNotification(eventName) {
  const notif = NOTIFICATION_TRIGGERS.find((n) => n.key === eventName);
  if (!notif) {
    return { ok: false, error: `Unknown notification event_name: ${eventName}` };
  }
  return { ok: true, conditions: {} };
}

function validateEvent(eventName, rawConditions) {
  const evt = COMPOSITE_EVENT_TRIGGERS.find((e) => e.key === eventName);
  if (!evt) {
    return { ok: false, error: `Unknown composite event_name: ${eventName}` };
  }
  const raw = rawConditions || {};
  const cleaned = {};

  // Walk the event's conditionSchema and sanitize each declared field.
  // Any keys in `raw` that aren't in the schema are silently dropped.
  for (const field of evt.conditionSchema.fields) {
    const value = raw[field.key];
    if (field.type === 'duration') {
      cleaned[field.key] = cleanDuration(value);
    } else if (field.type === 'duration_preset') {
      if (value && field.options?.some((o) => o.value === value)) {
        cleaned[field.key] = value;
      }
      // missing / invalid → omit (leaving it null in the DB)
    } else if (field.type === 'status_picker') {
      if (value && LOAD_STATUSES.some((s) => s.value === value)) {
        cleaned[field.key] = value;
      }
    } else if (field.type === 'multi_select') {
      if (!Array.isArray(value)) {
        cleaned[field.key] = [];
      } else {
        // Use MISSING_INFO_APPLICABLE_FIELDS as the reference set
        // (today that's the only multi_select we have).
        const allowed = new Set(MISSING_INFO_APPLICABLE_FIELDS.map((o) => o.value));
        cleaned[field.key] = value.filter((v) => allowed.has(v));
      }
    }
  }

  return { ok: true, conditions: cleaned };
}

function validateStatus(eventName, rawConditions) {
  const status = LOAD_STATUSES.find((s) => s.value === eventName);
  if (!status) {
    return { ok: false, error: `Unknown status event_name: ${eventName}` };
  }
  const raw = rawConditions || {};
  const notifyAfter = cleanDuration(raw.notify_after);
  return { ok: true, conditions: { notify_after: notifyAfter } };
}

// ──────────────────────────────────────────────────────────────
// Shared payload validation
// ──────────────────────────────────────────────────────────────
export function validateTriggerPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Missing request body' };
  }

  const name = cleanStr(body.name);
  if (!name) return { ok: false, error: 'Name is required' };
  if (name.length > MAX_NAME) {
    return { ok: false, error: `Name exceeds ${MAX_NAME} characters` };
  }

  const description = cleanStr(body.description);
  if (description && description.length > MAX_DESCRIPTION) {
    return {
      ok: false,
      error: `Description exceeds ${MAX_DESCRIPTION} characters`,
    };
  }

  const kind = body.trigger_kind;
  if (!VALID_KINDS.has(kind)) {
    return {
      ok: false,
      error: `trigger_kind must be one of: ${Array.from(VALID_KINDS).join(', ')}`,
    };
  }

  const eventName = cleanStr(body.event_name);
  if (!eventName) {
    return { ok: false, error: 'event_name is required' };
  }

  // Route through kind-specific sanitizer
  let conditionsResult;
  if (kind === 'field_change') {
    conditionsResult = validateFieldChange(eventName, body.conditions);
  } else if (kind === 'notification') {
    conditionsResult = validateNotification(eventName);
  } else if (kind === 'event') {
    conditionsResult = validateEvent(eventName, body.conditions);
  } else if (kind === 'status') {
    conditionsResult = validateStatus(eventName, body.conditions);
  }

  if (!conditionsResult.ok) {
    return { ok: false, error: conditionsResult.error };
  }

  const row = {
    name,
    description,
    trigger_kind: kind,
    event_name: eventName,
    conditions: conditionsResult.conditions,
    is_active: body.is_active !== false,
    dedupe_window_seconds:
      Number.isFinite(Number(body.dedupe_window_seconds)) &&
      Number(body.dedupe_window_seconds) >= 0
        ? Math.floor(Number(body.dedupe_window_seconds))
        : 3600,
    // These columns are unused by the new model (everything is in
    // conditions JSONB) but the schema still requires the 052 columns
    // to exist — set them to NULL.
    poll_anchor: null,
    poll_delay_amount: null,
    poll_delay_unit: null,
  };

  return { ok: true, row };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id: templateId } = req.query;
  if (!templateId) {
    return res.status(400).json({ error: 'Missing template id' });
  }

  const svc = getServiceClient();

  const { data: template, error: tErr } = await svc
    .from('email_templates')
    .select('id, tenant_id, name')
    .eq('id', templateId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!template) return res.status(404).json({ error: 'Template not found' });

  // ── LIST ──
  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('email_template_triggers')
      .select('*')
      .eq('template_id', templateId)
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ triggers: data || [] });
  }

  // ── CREATE ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const validation = validateTriggerPayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const insertData = {
      tenant_id: ctx.tenantId,
      template_id: templateId,
      created_by: ctx.userId,
      retroactive: false,
      ...validation.row,
    };

    const { data, error } = await svc
      .from('email_template_triggers')
      .insert(insertData)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_template_trigger.create',
      entityType: 'email_template_trigger',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ trigger: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
