/**
 * Recipient Expander
 *
 * Takes a recipient JSONB array (the shape stored on
 * email_umbrella_groups.to_recipients/cc_recipients/bcc_recipients)
 * and resolves it to a flat list of email-address strings at send time.
 *
 * Supported entry types (per migration 052 lines 227-232)
 * (post-FU-113: contact/contact_group resolve via organization_* tables, not legacy customer_contact_groups):
 *   { type: 'email',         value: 'ops@example.com' }
 *   { type: 'contact',       value: '<organization_contacts uuid>' }
 *   { type: 'contact_group', value: '<organization_groups uuid>' }
 *   { type: 'role',          value: 'load_dispatcher' | 'driver' | 'customer_primary' | 'tenant_dispatcher' | 'acting_user' }
 *   { type: 'variable',      value: 'customer.primary_contact.email' } — dotted path through the context tree
 *
 * The `cache` argument lets the dispatcher reuse contact-group lookups
 * within a single fire — if three groups all reference the same contact
 * group, the DB is hit once.
 */

import { getByPath } from '../email-variable-resolver.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(s) {
  return typeof s === 'string' && EMAIL_RE.test(s);
}

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Resolve one recipient entry to 0..n email addresses.
 */
async function expandEntry(svc, tenantId, entry, context, cache) {
  if (!entry || !entry.type) return [];

  switch (entry.type) {
    case 'email': {
      const e = normalizeEmail(entry.value);
      return isValidEmail(e) ? [e] : [];
    }

    case 'variable': {
      const path = entry.value;
      if (!path || typeof path !== 'string') return [];
      const v = getByPath(context, path);
      if (v == null) return [];
      // A variable may resolve to a single address, a comma-separated
      // string, or an array — handle all three.
      if (Array.isArray(v)) {
        return v.map(normalizeEmail).filter(isValidEmail);
      }
      const s = String(v);
      if (s.includes(',')) {
        return s
          .split(',')
          .map(normalizeEmail)
          .filter(isValidEmail);
      }
      const e = normalizeEmail(s);
      return isValidEmail(e) ? [e] : [];
    }

    case 'contact': {
      if (!entry.value) return [];
      const cacheKey = `contact:${entry.value}`;
      if (cache && cache.has(cacheKey)) return cache.get(cacheKey);
      const { data } = await svc
        .from('organization_contacts')
        .select('email')
        .eq('id', entry.value)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      const emails = data?.email && isValidEmail(normalizeEmail(data.email))
        ? [normalizeEmail(data.email)]
        : [];
      if (cache) cache.set(cacheKey, emails);
      return emails;
    }

    case 'contact_group': {
      if (!entry.value) return [];
      const cacheKey = `cg:${entry.value}`;
      if (cache && cache.has(cacheKey)) return cache.get(cacheKey);
      const { data } = await svc
        .from('organization_group_members')
        .select('contact:organization_contacts(email)')
        .eq('group_id', entry.value);
      const emails = (data || [])
        .map((r) => normalizeEmail(r.contact?.email))
        .filter(isValidEmail);
      if (cache) cache.set(cacheKey, emails);
      return emails;
    }

    case 'role': {
      // Load-scoped per-load notify parties — query junction table and
      // expand each row to its emails. Returns the dedupe'd union.
      if (entry.value === 'load_notify_parties') {
        const loadId = context?.load?.id;
        if (!loadId) return [];
        const cacheKey = `lnp:${loadId}`;
        if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

        const { data: parties } = await svc
          .from('load_notify_parties')
          .select('party_type, party_id')
          .eq('tenant_id', tenantId)
          .eq('load_id', loadId);

        const out = new Set();
        for (const p of parties || []) {
          if (p.party_type === 'group') {
            const { data } = await svc
              .from('organization_group_members')
              .select('contact:organization_contacts(email)')
              .eq('group_id', p.party_id);
            for (const r of data || []) {
              const e = normalizeEmail(r.contact?.email);
              if (isValidEmail(e)) out.add(e);
            }
          } else if (p.party_type === 'contact') {
            const { data } = await svc
              .from('organization_contacts')
              .select('email')
              .eq('id', p.party_id)
              .eq('tenant_id', tenantId)
              .maybeSingle();
            const e = normalizeEmail(data?.email);
            if (isValidEmail(e)) out.add(e);
          } else {
            // unknown party_type — skip silently (DB CHECK should prevent this)
            continue;
          }
        }

        const result = Array.from(out);
        if (cache) cache.set(cacheKey, result);
        return result;
      }

      // Map role token → context path. Extend as needed.
      const roleMap = {
        driver: 'driver.email',
        load_dispatcher: 'user.email',
        acting_user: 'user.email',
        customer_primary: 'customer.primary_contact_email',
        tenant_dispatcher: 'tenant.dispatcher_email',
        tenant_ops: 'tenant.ops_email',
      };
      const path = roleMap[entry.value];
      if (!path) return [];
      const v = getByPath(context, path);
      if (v == null) return [];
      const e = normalizeEmail(v);
      return isValidEmail(e) ? [e] : [];
    }

    default:
      return [];
  }
}

/**
 * Expand a full recipient array (to / cc / bcc) into a deduped list
 * of valid email strings.
 */
export async function expandRecipients(svc, tenantId, entries, context, cache) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const out = new Set();
  for (const entry of entries) {
    const emails = await expandEntry(svc, tenantId, entry, context, cache);
    for (const e of emails) out.add(e);
  }
  return Array.from(out);
}

/**
 * Convenience wrapper — expand all three buckets of a group at once.
 * The same `cache` is reused across buckets so a contact group used in
 * both to_recipients and cc_recipients only hits the DB once.
 */
export async function expandGroupRecipients(svc, tenantId, group, context, cache) {
  const reuseCache = cache || new Map();
  const [to, cc, bcc] = await Promise.all([
    expandRecipients(svc, tenantId, group?.to_recipients || [], context, reuseCache),
    expandRecipients(svc, tenantId, group?.cc_recipients || [], context, reuseCache),
    expandRecipients(svc, tenantId, group?.bcc_recipients || [], context, reuseCache),
  ]);
  return { to, cc, bcc };
}
