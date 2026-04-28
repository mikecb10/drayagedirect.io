// Shared Supabase-client mock for fetcher integration tests.
//
// The PDF renderer modules build their data with a fixed set of chained
// Supabase query methods. This helper provides a minimal stand-in that
// returns canned responses keyed by table name, supporting the chain
// methods all 6 AR-family renderers (Invoice, Rate Con, Combined Invoice,
// POD, Statement, Credit Memo) plus resolveTemplateConfig collectively use.
//
// Convention: tests in tests/*-fetcher-integration.test.mjs import this
// helper. New chain methods can be added to `obj` below without breaking
// existing callers — methods are no-op pass-throughs that return self.

/**
 * Build a Supabase-shaped client mock for unit tests.
 *
 * @param {Record<string, { data: any, error: any }>} responses
 *   Map from table name to the response object returned by terminal
 *   methods (.maybeSingle()) and when the chain is awaited directly
 *   (no terminal). Tables not in the map return { data: null, error: null }.
 *
 * @returns {object} A mock client supporting:
 *     client.from(table).select(...).eq(...).is(...).maybeSingle()
 *     client.from(table).select(...).in(...).eq(...).is(...)   // awaited directly
 *     client.from(table).select(...).or(...)                   // resolveTemplateConfig path
 *
 * Chain methods returned by the builder: select, eq, in, is, not,
 * gt, lte, order, or. All are no-op pass-throughs returning self.
 */
export function makeMockSvc(responses) {
  function builder(table) {
    const response = responses[table] || { data: null, error: null };
    const obj = {
      // Terminal: resolves to a single row response.
      maybeSingle: () => Promise.resolve(response),
      // Chain methods (no-ops returning self).
      select: () => obj,
      eq:     () => obj,
      in:     () => obj,
      is:     () => obj,
      not:    () => obj,
      gt:     () => obj,
      lte:    () => obj,
      order:  () => obj,
      or:     () => obj,
      // Awaiting the chain directly (no terminal) returns the response.
      then:   (resolve, reject) => Promise.resolve(response).then(resolve, reject),
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}
