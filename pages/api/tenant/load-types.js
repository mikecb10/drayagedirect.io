import { requireTenantUser } from '../../../lib/tenant-api';
import { LOAD_TYPES } from '../../../lib/constants/load-types.js';

/**
 * /api/tenant/load-types
 *
 * GET — return the canonical LOAD_TYPES list.
 *
 * Tenant-scoped for auth (requires an authenticated tenant user); the list
 * itself is static across tenants — source of truth is
 * `lib/constants/load-types.js` (FU-059 consolidation).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return; // requireTenantUser already sent response

  return res.status(200).json({ load_types: LOAD_TYPES });
}
