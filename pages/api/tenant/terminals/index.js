import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/terminals
 *
 * GET — list terminals available to the tenant.
 *       Only terminals in enabled markets are returned.
 *       Custom names from tenant_terminal_overrides are applied.
 *
 * Query params:
 *   - market: filter by market name
 *   - type: 'MARINE' | 'RAIL'
 *   - search: fuzzy search on label or name
 *   - all: if 'true', return ALL system terminals (for settings page)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const { market, type, search, all } = req.query;

  // 1. Get enabled markets
  const { data: toggles } = await svc
    .from('tenant_market_toggles')
    .select('market')
    .eq('tenant_id', ctx.tenantId)
    .eq('enabled', true);

  const enabledMarkets = (toggles || []).map((t) => t.market);

  // 2. Query terminals
  let query = svc.from('system_terminals').select('*').eq('is_system', true);

  // In "all" mode (settings page) show everything; otherwise only enabled markets
  if (all !== 'true') {
    if (enabledMarkets.length === 0) {
      return res.status(200).json({ terminals: [] });
    }
    query = query.in('market', enabledMarkets);
  }

  if (market) query = query.eq('market', market);
  if (type) query = query.eq('type', type);
  if (search) {
    query = query.or(`label.ilike.%${search}%,default_name.ilike.%${search}%,city.ilike.%${search}%`);
  }

  query = query.order('market').order('type').order('label');

  const { data: terminals, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // 3. Fetch tenant overrides
  const terminalIds = (terminals || []).map((t) => t.id);
  let overrides = {};
  if (terminalIds.length > 0) {
    const { data: ovRows } = await svc
      .from('tenant_terminal_overrides')
      .select('terminal_id, custom_name, enabled')
      .eq('tenant_id', ctx.tenantId)
      .in('terminal_id', terminalIds);
    for (const ov of ovRows || []) {
      overrides[ov.terminal_id] = ov;
    }
  }

  // 4. Merge: apply custom_name + effective_enabled
  const merged = (terminals || []).map((t) => {
    const ov = overrides[t.id];
    return {
      ...t,
      effective_name: ov?.custom_name || t.default_name,
      custom_name: ov?.custom_name || null,
      effective_enabled: ov ? ov.enabled : true,
      market_enabled: enabledMarkets.includes(t.market),
    };
  });

  return res.status(200).json({ terminals: merged });
}
