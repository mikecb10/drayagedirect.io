import { withRetry } from './retry.js';
import { getSupabaseBreaker } from './circuit-breaker.js';

/**
 * Fetch wrapper that routes Supabase PostgREST data-plane calls
 * through retry + circuit breaker. Non-PostgREST paths (auth, storage,
 * realtime, functions) pass through unchanged so they keep their own
 * behavior (auth retries are handled by @supabase/auth-js itself,
 * realtime is already tracked by LiveIndicator, etc.).
 *
 * Install by passing this as the `global.fetch` option to the Supabase
 * client factory:
 *
 *   createClient(url, key, { global: { fetch: resilientFetch } })
 *
 * ## Why fetch-level and not Proxy-level
 *
 * An earlier version of this file used a Proxy on `client.from()` to
 * wrap the returned PostgrestQueryBuilder's `.then()`. That approach
 * looked clean but was silently broken: `.select()`, `.eq()`, etc.
 * each return a NEW builder object (PostgrestFilterBuilder, etc.), so
 * the wrapping on the original QueryBuilder never reached the awaited
 * tail of the chain. Fetch-level interception is immune — every
 * builder in the chain, no matter how deep, ultimately funnels through
 * the same `fetch` passed via `global.fetch`.
 */
export async function resilientFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url;

  // Only wrap PostgREST data-plane calls. Auth / storage / realtime /
  // functions paths pass through unchanged.
  if (!url || !url.includes('/rest/v1/')) {
    return fetch(input, init);
  }

  const breaker = getSupabaseBreaker();
  return withRetry(() => breaker.execute(async () => {
    const res = await fetch(input, init);
    // Treat 5xx as failures for retry + breaker accounting. 4xx is a
    // client-side concern (auth denial, RLS, validation) — pass through.
    if (res.status >= 500) {
      const err = new Error(`Supabase HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }));
}

/**
 * Deprecated — no-op passthrough kept for migration.
 *
 * Earlier phases of Tier 0 wired `wrapSupabaseClient` into the three
 * Supabase factories. When the fetch-level approach replaced Proxy-level,
 * rather than rip out every call site in one commit, we keep the same
 * import name as a no-op and update the factories to additionally pass
 * `global: { fetch: resilientFetch }`. Remove this export once every
 * caller has migrated.
 *
 * @deprecated use `resilientFetch` via `global.fetch` instead
 */
export function wrapSupabaseClient(client) {
  return client;
}
