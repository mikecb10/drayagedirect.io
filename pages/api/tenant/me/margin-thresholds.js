import { requireTenantUser, requirePermission, getServiceClient } from '../../../../lib/tenant-api';
import { PERMISSIONS, hasPermission } from '../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return; // requireTenantUser already wrote the 401

  if (req.method === 'GET') return handleGet(req, res, ctx);
  if (req.method === 'PUT') return handlePut(req, res, ctx);
  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res, ctx) {
  if (!hasPermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.REPORTING])) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const svc = getServiceClient();
  const { data, error } = await svc
    .from('tenants')
    .select('margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs, margin_palette')
    .eq('id', ctx.tenantId)
    .single();

  if (error) {
    console.error('margin-thresholds GET failed', error);
    return res.status(500).json({ error: 'Failed to load thresholds' });
  }

  return res.status(200).json({
    red_threshold:    Number(data.margin_red_threshold),
    yellow_threshold: Number(data.margin_yellow_threshold),
    include_dry_runs: !!data.margin_include_dry_runs,
    palette:          data.margin_palette || 'default',
  });
}

async function handlePut(req, res, ctx) {
  // Permission check: only SETTINGS (or super_admin / 'all') can write
  if (!requirePermission(ctx, [PERMISSIONS.SETTINGS], res)) return;

  const { red_threshold, yellow_threshold, include_dry_runs, palette } = req.body ?? {};

  // Validate inputs
  const red    = Number(red_threshold);
  const yellow = Number(yellow_threshold);

  if (!Number.isFinite(red) || red < 0 || red > 100) {
    return res.status(400).json({ error: 'red_threshold must be between 0 and 100' });
  }
  if (!Number.isFinite(yellow) || yellow < 0 || yellow > 100) {
    return res.status(400).json({ error: 'yellow_threshold must be between 0 and 100' });
  }
  if (yellow <= red) {
    return res.status(400).json({ error: 'yellow_threshold must exceed red_threshold' });
  }
  if (typeof include_dry_runs !== 'boolean') {
    return res.status(400).json({ error: 'include_dry_runs must be a boolean' });
  }
  // Palette is optional — when omitted, leave the existing value alone.
  if (palette !== undefined && palette !== 'default' && palette !== 'colorblind') {
    return res.status(400).json({ error: 'palette must be "default" or "colorblind"' });
  }

  const updates = {
    margin_red_threshold:    red,
    margin_yellow_threshold: yellow,
    margin_include_dry_runs: include_dry_runs,
  };
  if (palette !== undefined) updates.margin_palette = palette;

  const svc = getServiceClient();
  const { error } = await svc
    .from('tenants')
    .update(updates)
    .eq('id', ctx.tenantId);

  if (error) {
    // Surface CHECK-constraint violation as 400 (defense in depth —
    // we already validated above, but DB is source of truth).
    if (error.message?.includes('chk_margin_threshold_order')) {
      return res.status(400).json({ error: 'yellow_threshold must exceed red_threshold' });
    }
    console.error('margin-thresholds PUT failed', error);
    return res.status(500).json({ error: 'Failed to save thresholds' });
  }

  return res.status(200).json({ ok: true });
}
