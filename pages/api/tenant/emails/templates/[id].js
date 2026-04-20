import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { validateTemplateBody } from '../../../../../lib/email-variables';
import { stripHtml } from '../../../../../lib/email-variable-resolver';

/**
 * /api/tenant/emails/templates/[id]
 *
 *   GET    — fetch a single template by id
 *   PUT    — update an existing template (partial — only provided fields change)
 *            System templates can be renamed + edited but is_system stays true
 *            and system_slug is frozen.
 *   DELETE — delete a custom template. System templates (is_system = true)
 *            return 403; the UI should offer an "Archive" (is_active = false)
 *            instead.
 *
 * Permission gate for PUT/DELETE: MANAGE_SYSTEM_EMAILS | SETTINGS | ALL.
 * RLS enforces tenant isolation; we additionally short-circuit with a
 * single fetch-then-authorize so users get proper 404/403 codes rather
 * than an opaque "no rows updated" silent success.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;
const MAX_SUBJECT = 500;
const MAX_BODY = 64 * 1024;

// Fields the client may update. Any key not in this allowlist is dropped.
const EDITABLE_FIELDS = new Set([
  'name',
  'description',
  'subject',
  'body_text',
  'body_html',
  'body_format',
  'is_active',
  'format_overrides',
  'attachment_document_types',
  'suppress_default_signature',
  'from_display_name',
]);

// Protected: these fields are frozen on all templates (system or custom)
// or only changeable via explicit endpoints.
const READONLY_FIELDS = new Set([
  'id',
  'tenant_id',
  'is_system',
  'system_slug',
  'created_at',
  'created_by',
  'updated_at',
]);

function escapeForHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function deriveBodies({ body_text, body_html, body_format }) {
  if (body_format === 'html') {
    const html = (body_html || '').trim();
    return {
      body_html: html,
      body_text: body_text?.trim() || stripHtml(html),
    };
  }
  const text = (body_text || '').trim();
  const autoHtml = text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeForHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return {
    body_text: text,
    body_html: body_html?.trim() || autoHtml,
  };
}

// Build an updates object from the incoming body, whitelisting editable
// fields and dropping everything else. Returns { ok, error, updates }.
function validateUpdate(existing, body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Missing request body' };
  }

  const updates = {};

  // Scalar validations
  if ('name' in body) {
    const name = String(body.name || '').trim();
    if (!name) return { ok: false, error: 'Name cannot be empty' };
    if (name.length > MAX_NAME) {
      return { ok: false, error: `Name exceeds ${MAX_NAME} characters` };
    }
    updates.name = name;
  }

  if ('description' in body) {
    const description = body.description ? String(body.description).trim() : null;
    if (description && description.length > MAX_DESCRIPTION) {
      return { ok: false, error: `Description exceeds ${MAX_DESCRIPTION} characters` };
    }
    updates.description = description;
  }

  if ('subject' in body) {
    const subject = String(body.subject || '').trim();
    if (!subject) return { ok: false, error: 'Subject cannot be empty' };
    if (subject.length > MAX_SUBJECT) {
      return { ok: false, error: `Subject exceeds ${MAX_SUBJECT} characters` };
    }
    updates.subject = subject;
  }

  if ('is_active' in body) {
    updates.is_active = !!body.is_active;
  }

  if ('format_overrides' in body && body.format_overrides !== null) {
    if (typeof body.format_overrides !== 'object') {
      return { ok: false, error: 'format_overrides must be an object' };
    }
    updates.format_overrides = body.format_overrides;
  }

  if ('attachment_document_types' in body) {
    if (!Array.isArray(body.attachment_document_types)) {
      return { ok: false, error: 'attachment_document_types must be an array' };
    }
    updates.attachment_document_types = body.attachment_document_types
      .filter((t) => typeof t === 'string')
      .map((t) => t.trim());
  }

  if ('suppress_default_signature' in body) {
    updates.suppress_default_signature = !!body.suppress_default_signature;
  }

  if ('from_display_name' in body) {
    const val = body.from_display_name;
    if (val == null || val === '') {
      updates.from_display_name = null;
    } else {
      const trimmed = String(val).trim().slice(0, 100);
      updates.from_display_name = trimmed || null;
    }
  }

  // Body handling — any of body_text, body_html, body_format triggers a
  // re-derivation so both fields are kept in sync.
  const bodyChanged =
    'body_text' in body || 'body_html' in body || 'body_format' in body;

  if (bodyChanged) {
    const effective_format =
      body.body_format === 'html' || body.body_format === 'plain'
        ? body.body_format
        : existing.body_format || 'plain';

    const effective_text =
      'body_text' in body ? body.body_text : existing.body_text;
    const effective_html =
      'body_html' in body ? body.body_html : existing.body_html;

    const hasText = effective_text && String(effective_text).trim().length > 0;
    const hasHtml = effective_html && String(effective_html).trim().length > 0;
    if (!hasText && !hasHtml) {
      return { ok: false, error: 'Template body cannot be empty' };
    }

    if (
      (effective_text || '').length > MAX_BODY ||
      (effective_html || '').length > MAX_BODY
    ) {
      return { ok: false, error: `Body exceeds ${MAX_BODY} characters` };
    }

    const derived = deriveBodies({
      body_text: effective_text,
      body_html: effective_html,
      body_format: effective_format,
    });
    updates.body_text = derived.body_text;
    updates.body_html = derived.body_html;
    updates.body_format = effective_format;
  }

  // Validate that every {{variable}} across subject + both body variants
  // exists in the catalog. Uses the NEW values from the updates object
  // (falling back to the existing row for fields the caller didn't touch).
  const finalSubject = 'subject' in updates ? updates.subject : existing.subject;
  const finalBodyText = 'body_text' in updates ? updates.body_text : existing.body_text;
  const finalBodyHtml = 'body_html' in updates ? updates.body_html : existing.body_html;

  const validation = validateTemplateBody(
    `${finalSubject}\n${finalBodyText || ''}\n${finalBodyHtml || ''}`
  );
  if (!validation.valid) {
    return {
      ok: false,
      error: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
    };
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'No editable fields in request' };
  }

  // Drop any readonly fields the client tried to include (defense in depth)
  for (const k of Object.keys(updates)) {
    if (READONLY_FIELDS.has(k) || !EDITABLE_FIELDS.has(k)) {
      delete updates[k];
    }
  }

  return { ok: true, updates };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing template id' });
  }

  const svc = getServiceClient();

  // Fetch the existing row first so we can apply partial updates and
  // return a proper 404 instead of a silent "no rows updated".
  const { data: existing, error: fetchErr } = await svc
    .from('email_templates')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (fetchErr) {
    return res.status(500).json({ error: fetchErr.message });
  }
  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({ template: existing });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const validation = validateUpdate(existing, req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const { data: updated, error: updErr } = await svc
      .from('email_templates')
      .update({
        ...validation.updates,
        updated_by: ctx.userId,
      })
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
      action: 'email_template.update',
      entityType: 'email_template',
      entityId: updated.id,
      oldValues: existing,
      newValues: updated,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ template: updated });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    if (existing.is_system) {
      return res.status(403).json({
        error:
          'System templates cannot be deleted — toggle is_active=false to archive instead.',
      });
    }

    const { error: delErr } = await svc
      .from('email_templates')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);

    if (delErr) {
      return res.status(500).json({ error: delErr.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_template.delete',
      entityType: 'email_template',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
