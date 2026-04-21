import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { sanitizeFilterSet } from '../../../../lib/ar-filter-params';
import { randomUUID } from 'crypto';

const AR_PERMS = [
  PERMISSIONS.ACCOUNTS_RECEIVABLE,
  PERMISSIONS.ALL,
];

const MAX_TABS_PER_SECTION = 20;
const MAX_TAB_NAME_LEN = 60;
const VALID_SECTIONS = new Set(['billing', 'invoices']);

/**
 * Shape-check + normalize a single tab coming from the client.
 * Returns a canonical tab object (with id + created_at assigned if new),
 * or throws an Error describing the first validation failure.
 */
function normalizeTab(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('tab must be an object');
  const section = raw.section;
  if (!VALID_SECTIONS.has(section)) throw new Error(`invalid section: ${section}`);
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) throw new Error('tab.name is required');
  if (name.length > MAX_TAB_NAME_LEN) throw new Error(`tab.name exceeds ${MAX_TAB_NAME_LEN} chars`);
  const filters = sanitizeFilterSet(raw.filters);
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : randomUUID(),
    section,
    name,
    filters,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, AR_PERMS, res)) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('user_ar_preferences')
      .select('custom_tabs')
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', ctx.userId)
      .limit(1);

    if (error) {
      console.error('[ar/user-preferences] select failed:', error.message);
      return res.status(500).json({ error: 'query_failed' });
    }
    const row = data?.[0];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ custom_tabs: row?.custom_tabs ?? [] });
  }

  if (req.method === 'PUT') {
    const { custom_tabs } = req.body || {};
    if (!Array.isArray(custom_tabs)) {
      return res.status(400).json({ error: 'custom_tabs must be an array' });
    }

    let normalized;
    try {
      normalized = custom_tabs.map(normalizeTab);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Cap per section so a buggy client can't blow up the JSONB blob.
    const billingCount  = normalized.filter((t) => t.section === 'billing').length;
    const invoicesCount = normalized.filter((t) => t.section === 'invoices').length;
    if (billingCount > MAX_TABS_PER_SECTION || invoicesCount > MAX_TABS_PER_SECTION) {
      return res.status(400).json({
        error: `max ${MAX_TABS_PER_SECTION} tabs per section`,
      });
    }

    const { error } = await svc
      .from('user_ar_preferences')
      .upsert(
        {
          tenant_id: ctx.tenantId,
          user_id: ctx.userId,
          custom_tabs: normalized,
        },
        { onConflict: 'tenant_id,user_id' }
      );

    if (error) {
      console.error('[ar/user-preferences] upsert failed:', error.message);
      return res.status(500).json({ error: 'save_failed' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ custom_tabs: normalized });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
