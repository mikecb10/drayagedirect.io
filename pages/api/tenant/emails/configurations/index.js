import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/configurations
 *
 *   GET  — list all configurations for the current tenant, ordered by
 *          is_default first, then priority ASC, then name.
 *          Each row includes:
 *            - sender identity resolved (sender_address, shared_account, or null)
 *            - attached umbrella count
 *
 *   POST — create a new configuration.
 *          Body: {
 *            name, description?,
 *            sender_kind: 'sendgrid' | 'shared_gmail' | 'user_gmail',
 *            sender_address_id?,    // required for 'sendgrid'
 *            shared_account_id?,    // required for 'shared_gmail'
 *            priority?, is_active?, is_default?
 *          }
 *
 *          The 3-way mutually-exclusive CHECK constraint on
 *          email_configurations.one_sender is enforced by migration 055.
 *          We translate the UI's sender_kind enum into the right column
 *          set before insert.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const MAX_NAME = 200;
const MAX_DESCRIPTION = 500;

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

// Normalize the sender_kind enum + ids into the 3-column shape the
// schema expects. Exactly one of the three must end up truthy.
export function resolveSenderColumns(body) {
  const kind = body.sender_kind;
  if (kind === 'sendgrid') {
    if (!body.sender_address_id) {
      return { ok: false, error: 'sender_address_id is required when sender_kind = sendgrid' };
    }
    return {
      ok: true,
      cols: {
        sender_address_id: body.sender_address_id,
        shared_account_id: null,
        use_user_gmail: false,
      },
    };
  }
  if (kind === 'shared_gmail') {
    if (!body.shared_account_id) {
      return { ok: false, error: 'shared_account_id is required when sender_kind = shared_gmail' };
    }
    return {
      ok: true,
      cols: {
        sender_address_id: null,
        shared_account_id: body.shared_account_id,
        use_user_gmail: false,
      },
    };
  }
  if (kind === 'user_gmail') {
    return {
      ok: true,
      cols: {
        sender_address_id: null,
        shared_account_id: null,
        use_user_gmail: true,
      },
    };
  }
  return {
    ok: false,
    error: "sender_kind must be one of: 'sendgrid', 'shared_gmail', 'user_gmail'",
  };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  // ── LIST ──
  if (req.method === 'GET') {
    const { data: configs, error } = await svc
      .from('email_configurations')
      .select('*, email_configuration_umbrellas(count)')
      .eq('tenant_id', ctx.tenantId)
      .order('is_default', { ascending: false })
      .order('priority', { ascending: true })
      .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Resolve linked sender entities (two-step lookup to avoid deep embed
    // syntax). Gather ids, batch-fetch, then hydrate.
    const senderAddressIds = new Set();
    const sharedAccountIds = new Set();
    for (const c of configs || []) {
      if (c.sender_address_id) senderAddressIds.add(c.sender_address_id);
      if (c.shared_account_id) sharedAccountIds.add(c.shared_account_id);
    }

    let senderAddressMap = {};
    if (senderAddressIds.size > 0) {
      const { data: addrs } = await svc
        .from('tenant_sender_addresses')
        .select('id, local_part, display_name, domain_id')
        .in('id', Array.from(senderAddressIds))
        .eq('tenant_id', ctx.tenantId);
      for (const a of addrs || []) senderAddressMap[a.id] = a;
    }

    let sharedAccountMap = {};
    if (sharedAccountIds.size > 0) {
      const { data: accts } = await svc
        .from('email_accounts')
        .select('id, email_address, display_name, provider, is_active')
        .in('id', Array.from(sharedAccountIds))
        .eq('tenant_id', ctx.tenantId);
      for (const a of accts || []) sharedAccountMap[a.id] = a;
    }

    const rows = (configs || []).map((c) => {
      // Derive the UI-friendly sender_kind enum from the 3 mutually-exclusive cols
      let sender_kind = null;
      if (c.sender_address_id) sender_kind = 'sendgrid';
      else if (c.shared_account_id) sender_kind = 'shared_gmail';
      else if (c.use_user_gmail) sender_kind = 'user_gmail';

      return {
        ...c,
        sender_kind,
        sender_address: c.sender_address_id
          ? senderAddressMap[c.sender_address_id] || null
          : null,
        shared_account: c.shared_account_id
          ? sharedAccountMap[c.shared_account_id] || null
          : null,
        umbrella_count: c.email_configuration_umbrellas?.[0]?.count ?? 0,
        email_configuration_umbrellas: undefined,
      };
    });

    return res.status(200).json({ configurations: rows });
  }

  // ── CREATE ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const name = cleanStr(body.name);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (name.length > MAX_NAME) {
      return res.status(400).json({ error: `Name exceeds ${MAX_NAME} characters` });
    }

    const description = cleanStr(body.description);
    if (description && description.length > MAX_DESCRIPTION) {
      return res
        .status(400)
        .json({ error: `Description exceeds ${MAX_DESCRIPTION} characters` });
    }

    const sender = resolveSenderColumns(body);
    if (!sender.ok) return res.status(400).json({ error: sender.error });

    // If user is setting is_default=true, unset it from the existing default
    // (the partial unique index allows only one default per tenant).
    if (body.is_default === true) {
      await svc
        .from('email_configurations')
        .update({ is_default: false })
        .eq('tenant_id', ctx.tenantId)
        .eq('is_default', true);
    }

    const insertData = {
      tenant_id: ctx.tenantId,
      created_by: ctx.userId,
      name,
      description,
      is_active: body.is_active !== false,
      is_default: !!body.is_default,
      priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0,
      ...sender.cols,
    };

    const { data, error } = await svc
      .from('email_configurations')
      .insert(insertData)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_configuration.create',
      entityType: 'email_configuration',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ configuration: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
