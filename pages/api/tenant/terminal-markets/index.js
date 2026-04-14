import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/terminal-markets
 *
 * GET  — list all unique markets with terminal counts + tenant enabled status
 * PUT  — toggle a market on/off for the tenant
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    // All terminals with names for hover previews
    const { data: terminals, error: tErr } = await svc
      .from('system_terminals')
      .select('market, country, type, default_name')
      .eq('is_system', true)
      .order('default_name');
    if (tErr) return res.status(500).json({ error: tErr.message });

    // Tenant toggles
    const { data: toggles } = await svc
      .from('tenant_market_toggles')
      .select('market, enabled')
      .eq('tenant_id', ctx.tenantId);

    const toggleMap = {};
    for (const t of toggles || []) toggleMap[t.market] = t.enabled;

    // Aggregate by market, collecting terminal names per type
    const marketMap = {};
    for (const t of terminals || []) {
      if (!marketMap[t.market]) {
        marketMap[t.market] = {
          market: t.market,
          country: t.country,
          marine: 0,
          rail: 0,
          total: 0,
          marine_names: [],
          rail_names: [],
        };
      }
      marketMap[t.market].total++;
      if (t.type === 'MARINE') {
        marketMap[t.market].marine++;
        marketMap[t.market].marine_names.push(t.default_name);
      } else {
        marketMap[t.market].rail++;
        marketMap[t.market].rail_names.push(t.default_name);
      }
    }

    const markets = Object.values(marketMap)
      .map((m) => ({
        ...m,
        enabled: toggleMap[m.market] ?? false,
      }))
      .sort((a, b) => a.country.localeCompare(b.country) || a.market.localeCompare(b.market));

    return res.status(200).json({ markets });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const { market, enabled } = req.body || {};
    if (!market || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'market (string) and enabled (boolean) required' });
    }

    const { error } = await svc
      .from('tenant_market_toggles')
      .upsert(
        { tenant_id: ctx.tenantId, market, enabled, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id,market' }
      );
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ market, enabled });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
