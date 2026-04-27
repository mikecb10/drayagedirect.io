/**
 * Validate the JSONB shape of customers.default_notify_parties.
 * Throws on bad shape. Returns the canonicalized array on success.
 *
 * Pure function — no DB or auth dependencies — so it can be imported
 * directly in unit tests (plain Node ESM).
 */
export function validateDefaultNotifyParties(value) {
  if (!Array.isArray(value)) {
    const e = new Error('default_notify_parties must be an array');
    e.statusCode = 400;
    throw e;
  }
  return value.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      const e = new Error(`default_notify_parties[${idx}] must be an object`);
      e.statusCode = 400;
      throw e;
    }
    if (entry.type !== 'group' && entry.type !== 'contact') {
      const e = new Error(`default_notify_parties[${idx}].type must be "group" or "contact"`);
      e.statusCode = 400;
      throw e;
    }
    if (!entry.id || typeof entry.id !== 'string') {
      const e = new Error(`default_notify_parties[${idx}].id is required`);
      e.statusCode = 400;
      throw e;
    }
    return {
      type: entry.type,
      id: entry.id,
      source_organization_id: entry.source_organization_id || null,
    };
  });
}
