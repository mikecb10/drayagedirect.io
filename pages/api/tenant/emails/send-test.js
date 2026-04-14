import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { resolveEmailTemplate, mergeFormatPrefs } from '../../../../lib/email-variable-resolver';
import { buildTriggerContext } from '../../../../lib/email-dispatch';
import { getProvider } from '../../../../lib/email-dispatch/providers/index.js';

/**
 * /api/tenant/emails/send-test
 *
 * POST body: { template_id, to_address, load_id? }
 *
 * Renders a template against a real load (or the most recent load if
 * load_id is omitted) and sends it to the specified address via the
 * SendGrid provider. Bypasses the normal trigger → umbrella →
 * configuration chain — this is a direct "show me what the email
 * looks like in a real inbox" tool for template authors.
 *
 * Uses the tenant's SENDGRID_FROM_EMAIL env var or the default sender
 * address (tenant_sender_addresses.is_default=true) as the From:.
 *
 * Permission gate: MANAGE_SYSTEM_EMAILS.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, WRITE_PERMS, res)) return;

  const { template_id, to_address, load_id } = req.body || {};
  if (!template_id) {
    return res.status(400).json({ error: 'template_id is required' });
  }
  if (!to_address || typeof to_address !== 'string' || !to_address.includes('@')) {
    return res.status(400).json({ error: 'A valid to_address is required' });
  }

  const svc = getServiceClient();

  // 1. Fetch the template
  const { data: template, error: tErr } = await svc
    .from('email_templates')
    .select('*')
    .eq('id', template_id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!template) return res.status(404).json({ error: 'Template not found' });

  // 2. Pick a load for context
  let loadId = load_id;
  if (!loadId) {
    const { data: recentLoad } = await svc
      .from('orders')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    loadId = recentLoad?.id;
  }

  if (!loadId) {
    return res.status(400).json({
      error: 'No loads found in this tenant. Create at least one load to use as test context.',
    });
  }

  // 3. Build context from the load
  let builtContext;
  try {
    builtContext = await buildTriggerContext(svc, ctx.tenantId, loadId, ctx.userId);
  } catch (e) {
    return res.status(500).json({ error: `Context build failed: ${e.message}` });
  }

  const { context, formatPrefs } = builtContext;

  // 4. Resolve the template
  const rendered = resolveEmailTemplate({
    subject: template.subject,
    body_html: template.body_html,
    body_text: template.body_text,
    context,
    formatPrefs,
    templateOverrides: template.format_overrides || {},
    strict: false,
  });

  // 5. Resolve the From address — use the default sender address if one
  //    exists, otherwise fall back to the SENDGRID_FROM_EMAIL env var.
  let fromAddress = process.env.SENDGRID_FROM_EMAIL;
  let fromName = null;

  const { data: defaultAddr } = await svc
    .from('tenant_sender_addresses')
    .select('*, domain:tenant_sender_domains!inner(domain)')
    .eq('tenant_id', ctx.tenantId)
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();

  if (defaultAddr?.domain?.domain) {
    fromAddress = `${defaultAddr.local_part}@${defaultAddr.domain.domain}`;
    fromName = defaultAddr.display_name;
  }

  if (!fromAddress) {
    return res.status(400).json({
      error:
        'No sender address configured. Either create a default sender address in Settings → Sender Addresses, or set SENDGRID_FROM_EMAIL in .env.local.',
    });
  }

  // 6. Send via SendGrid provider
  const provider = getProvider('sendgrid');
  try {
    const result = await provider.dispatch(svc, ctx.tenantId, {
      load_id: loadId,
      from_address: fromAddress,
      from_name: fromName,
      to: [to_address.trim().toLowerCase()],
      cc: [],
      bcc: [],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template_id: template.id,
      sent_by_user_id: ctx.userId,
    });

    return res.status(200).json({
      ok: true,
      message_id: result.messageId,
      provider_message_id: result.providerMessageId,
      rendered: {
        subject: rendered.subject,
        from_address: fromAddress,
        from_name: fromName,
        to_address,
        missing_variables: rendered.missing,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
      rendered: {
        subject: rendered.subject,
        from_address: fromAddress,
        missing_variables: rendered.missing,
      },
    });
  }
}
