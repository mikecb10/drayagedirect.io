/**
 * Shared helpers for email_configurations.
 *
 * Kept in lib/ so both the API route handler (pages/api/tenant/emails/
 * configurations/[id].js) and the trigger dispatcher (lib/email-dispatch/
 * dispatcher.js) can import them without either depending on the other.
 * Webpack also struggles with imports whose path contains bracket-style
 * Next.js dynamic segments, so a plain lib/ module avoids that entirely.
 */

/**
 * Fetch a full configuration row with its attached umbrellas and
 * eager-loaded sender entity (tenant_sender_addresses row or
 * email_accounts shared-scope row).
 *
 * Returns an object of shape:
 *   {
 *     ...config_row,
 *     sender_kind:    'sendgrid' | 'shared_gmail' | 'user_gmail' | null,
 *     sender_address: tenant_sender_addresses row | null,
 *     shared_account: email_accounts row (partial, no tokens) | null,
 *     umbrellas: [{ attachment_id, id, name, specificity_score, ... }, ...]
 *   }
 * ...or null if no such configuration exists for the given tenant.
 */
export async function fetchFullConfiguration(svc, tenantId, configId) {
  const { data: config, error: cErr } = await svc
    .from('email_configurations')
    .select('*')
    .eq('id', configId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!config) return null;

  // Fetch attached umbrellas
  const { data: attachments } = await svc
    .from('email_configuration_umbrellas')
    .select(
      '*, umbrella:email_umbrellas(id, name, description, specificity_score, is_active, always_run, is_default)'
    )
    .eq('configuration_id', configId)
    .eq('tenant_id', tenantId);

  // Hydrate sender entity
  let sender_address = null;
  let shared_account = null;
  if (config.sender_address_id) {
    // Eager-load the parent domain so callers (the dispatcher in
    // particular) can build the full From: address without a second
    // lookup.
    const { data } = await svc
      .from('tenant_sender_addresses')
      .select(
        'id, local_part, display_name, domain_id, reply_to, is_active, is_default, domain:tenant_sender_domains!inner(id, domain, status, default_from_name)'
      )
      .eq('id', config.sender_address_id)
      .maybeSingle();
    if (data) {
      sender_address = {
        ...data,
        domain: data.domain?.domain || null,
        domain_status: data.domain?.status || null,
        domain_row: data.domain || null,
      };
    }
  }
  if (config.shared_account_id) {
    const { data } = await svc
      .from('email_accounts')
      .select('id, email_address, display_name, provider, is_active')
      .eq('id', config.shared_account_id)
      .maybeSingle();
    shared_account = data || null;
  }

  let sender_kind = null;
  if (config.sender_address_id) sender_kind = 'sendgrid';
  else if (config.shared_account_id) sender_kind = 'shared_gmail';
  else if (config.use_user_gmail) sender_kind = 'user_gmail';

  return {
    ...config,
    sender_kind,
    sender_address,
    shared_account,
    umbrellas: (attachments || []).map((a) => ({
      attachment_id: a.id,
      ...a.umbrella,
    })),
  };
}

// resolveSenderColumns lives in pages/api/tenant/emails/configurations/
// index.js as an exported helper. We deliberately don't mirror it here —
// only one place should own the "sender_kind enum → 3 mutually exclusive
// columns" translation so the CHECK constraint has a single source of
// truth.
