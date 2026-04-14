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
 * /api/tenant/emails/templates
 *
 *   GET   — list all email templates for the current tenant
 *           Query params:
 *             ?search=foo        substring match on name/description/subject
 *             ?active=true|false filter by is_active
 *             ?system=true|false filter by is_system
 *
 *   POST  — create a new custom email template
 *           Body: { name, description, subject, body_text, body_html, body_format }
 *           Must have at least one of body_text or body_html.
 *           body_format drives which field is the "source of truth" and which
 *           gets auto-derived.
 *
 * Permission gate: MANAGE_SYSTEM_EMAILS | SETTINGS | ALL for writes.
 * Reads are available to anyone in the tenant who hits the endpoint — the
 * UI may restrict visibility further, but the API itself doesn't gate
 * reads beyond the tenant boundary enforced by RLS.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;
const MAX_SUBJECT = 500;
const MAX_BODY = 64 * 1024; // 64 KB — generous cap so nobody accidentally ships a novel

// ──────────────────────────────────────────────────────────────
// Derive both body_text and body_html from the provided content,
// based on body_format. The "source of truth" is whichever field
// the editor was in; the other is generated so both are always
// populated at send time regardless of which mode was authored.
// ──────────────────────────────────────────────────────────────
function deriveBodies({ body_text, body_html, body_format }) {
  if (body_format === 'html') {
    const html = (body_html || '').trim();
    return {
      body_html: html,
      body_text: body_text?.trim() || stripHtml(html),
    };
  }
  // Default: 'plain'
  const text = (body_text || '').trim();
  const autoHtml =
    text
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeForHtml(para).replace(/\n/g, '<br/>')}</p>`)
      .join('');
  return {
    body_text: text,
    body_html: body_html?.trim() || autoHtml,
  };
}

function escapeForHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ──────────────────────────────────────────────────────────────
// Field validation for CREATE — returns { ok, error, updates }
// ──────────────────────────────────────────────────────────────
function validateCreate(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Missing request body' };
  }

  const name = (body.name || '').trim();
  if (!name) return { ok: false, error: 'Name is required' };
  if (name.length > MAX_NAME) return { ok: false, error: `Name exceeds ${MAX_NAME} characters` };

  const description = body.description ? String(body.description).trim() : null;
  if (description && description.length > MAX_DESCRIPTION) {
    return { ok: false, error: `Description exceeds ${MAX_DESCRIPTION} characters` };
  }

  const subject = (body.subject || '').trim();
  if (!subject) return { ok: false, error: 'Subject is required' };
  if (subject.length > MAX_SUBJECT) {
    return { ok: false, error: `Subject exceeds ${MAX_SUBJECT} characters` };
  }

  const body_format = body.body_format === 'html' ? 'html' : 'plain';

  const hasText = body.body_text && body.body_text.trim().length > 0;
  const hasHtml = body.body_html && body.body_html.trim().length > 0;
  if (!hasText && !hasHtml) {
    return { ok: false, error: 'Template body is required (plain or HTML)' };
  }
  if ((body.body_text || '').length > MAX_BODY || (body.body_html || '').length > MAX_BODY) {
    return { ok: false, error: `Body exceeds ${MAX_BODY} characters` };
  }

  // Validate that every {{variable}} in subject + both body variants
  // exists in our catalog. If not, block with a specific list.
  const validation = validateTemplateBody(
    `${subject}\n${body.body_text || ''}\n${body.body_html || ''}`
  );
  if (!validation.valid) {
    return {
      ok: false,
      error: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
    };
  }

  const { body_text, body_html } = deriveBodies({
    body_text: body.body_text,
    body_html: body.body_html,
    body_format,
  });

  return {
    ok: true,
    updates: {
      name,
      description,
      subject,
      body_text,
      body_html,
      body_format,
      is_system: false, // API-created templates are always custom
      is_active: body.is_active !== false,
      format_overrides: body.format_overrides || {},
      attachment_document_types: Array.isArray(body.attachment_document_types)
        ? body.attachment_document_types
        : [],
      suppress_default_signature: !!body.suppress_default_signature,
    },
  };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  // ── LIST ──
  if (req.method === 'GET') {
    const { search, active, system } = req.query;

    let q = svc
      .from('email_templates')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('is_system', { ascending: false }) // system first, then custom
      .order('name', { ascending: true });

    if (active === 'true') q = q.eq('is_active', true);
    if (active === 'false') q = q.eq('is_active', false);
    if (system === 'true') q = q.eq('is_system', true);
    if (system === 'false') q = q.eq('is_system', false);

    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim();
      q = q.or(
        `name.ilike.%${s}%,description.ilike.%${s}%,subject.ilike.%${s}%,system_slug.ilike.%${s}%`
      );
    }

    const { data, error } = await q;
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ templates: data || [] });
  }

  // ── CREATE ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const validation = validateCreate(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const { data, error } = await svc
      .from('email_templates')
      .insert({
        tenant_id: ctx.tenantId,
        created_by: ctx.userId,
        updated_by: ctx.userId,
        ...validation.updates,
      })
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_template.create',
      entityType: 'email_template',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ template: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
