import {
  requireTenantUser,
  getServiceClient,
} from '../../../../../lib/tenant-api';

/**
 * POST /api/tenant/terminals/[id]/import
 *
 * "Imports" a system terminal into the tenant's organizations (customers) table.
 * If an org already exists for this terminal+tenant, returns the existing one.
 * Otherwise creates a new org with customer_types=['terminal'] and links it
 * via source_terminal_id.
 *
 * Returns: { organization: { id, name, ... } }
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const svc = getServiceClient();

  // Check if an org already exists for this terminal + tenant
  const { data: existing } = await svc
    .from('customers')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('source_terminal_id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return res.status(200).json({ organization: existing });
  }

  // Fetch the terminal
  const { data: terminal, error: tErr } = await svc
    .from('system_terminals')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (tErr || !terminal) {
    return res.status(404).json({ error: 'Terminal not found' });
  }

  // Also check tenant overrides for custom name
  const { data: override } = await svc
    .from('tenant_terminal_overrides')
    .select('custom_name')
    .eq('tenant_id', ctx.tenantId)
    .eq('terminal_id', id)
    .maybeSingle();

  const displayName = override?.custom_name || terminal.default_name;

  // Create org from terminal
  const { data: org, error: createErr } = await svc
    .from('customers')
    .insert({
      tenant_id: ctx.tenantId,
      name: displayName,
      customer_types: ['terminal'],
      address_line1: terminal.address,
      city: terminal.city,
      state: terminal.state,
      zip: terminal.zip,
      country: terminal.country === 'CAN' ? 'CA' : 'US',
      source_terminal_id: terminal.id,
      // Auto-assign the profile label + market from the system terminal
      profile_label: terminal.label,
      terminal_market: terminal.market,
      tracking_status: false, // default off until APIs configured
    })
    .select()
    .single();

  if (createErr) {
    return res.status(500).json({ error: createErr.message });
  }

  return res.status(201).json({ organization: org });
}
