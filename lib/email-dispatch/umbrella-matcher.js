/**
 * Umbrella Matcher — pure functions
 *
 * Decides whether a load matches an umbrella's filter scope and resolves
 * the set of umbrellas that should fire for a given load.
 *
 * NO database access. Operates on plain objects hydrated by the caller.
 *
 * Resolution semantics (confirmed in migration 052):
 *   - Most specific umbrella wins (highest specificity_score, winner-take-all)
 *   - Ties on specificity all win — the config layer decides priority
 *   - Every umbrella with `always_run=true` fires independently, in addition
 *     to the winners, regardless of score
 */

/**
 * Map each umbrella filter column to a load-reading function.
 *
 * NULL (or empty array for TEXT[]) on the umbrella means "don't care".
 * When the umbrella column is populated the load's corresponding field
 * must match exactly.
 *
 * For boolean flags on the load, we compare strict equality: false vs true
 * both count as "populated" on the umbrella side (3-state: null=don't care,
 * true=must-be-true, false=must-be-false).
 */
const UMBRELLA_FILTERS = [
  // load_types is a TEXT[] after migration 058 — array-contains semantics
  {
    col: 'load_types',
    read: (load) => load?.load_type,
    match: (umbrellaVal, loadVal) => {
      if (!Array.isArray(umbrellaVal) || umbrellaVal.length === 0) return true;
      return umbrellaVal.includes(loadVal);
    },
    populated: (v) => Array.isArray(v) && v.length > 0,
  },
  { col: 'customer_id', read: (l) => l?.customer_id },
  { col: 'pickup_location_id', read: (l) => l?.pickup_location_id },
  { col: 'delivery_location_id', read: (l) => l?.delivery_location_id },
  { col: 'return_location_id', read: (l) => l?.return_location_id },
  { col: 'container_type', read: (l) => l?.container_type },
  { col: 'container_size', read: (l) => l?.container_size },
  // SSL on the umbrella is a text SCAC; on the load it's stored in
  // steamship_line_scac (preferred) or steamship_line (legacy free text).
  {
    col: 'ssl',
    read: (l) => l?.steamship_line_scac ?? l?.steamship_line ?? null,
  },
  { col: 'csr', read: (l) => l?.csr_id ?? l?.csr ?? null },
  { col: 'route_id', read: (l) => l?.route_id ?? null },
  { col: 'chassis_type', read: (l) => l?.chassis_type },
  { col: 'chassis_size', read: (l) => l?.chassis_size },
  { col: 'chassis_owner', read: (l) => l?.chassis_owner },
  // Boolean flags — orders table columns are is_<flag>; umbrella columns
  // drop the prefix. Null on the umbrella means "don't care".
  { col: 'hazmat', read: (l) => l?.is_hazmat === true },
  { col: 'overweight', read: (l) => l?.is_overweight === true },
  { col: 'liquor', read: (l) => l?.is_liquor === true },
  { col: 'hot', read: (l) => l?.is_hot === true },
  { col: 'genset', read: (l) => l?.is_genset === true },
  { col: 'oog', read: (l) => l?.is_oog === true },
  { col: 'overheight', read: (l) => l?.is_overheight === true },
  { col: 'scale', read: (l) => l?.is_scale === true },
  { col: 'ev', read: (l) => l?.is_ev === true },
  { col: 'street_turn', read: (l) => l?.is_street_turn === true },
  { col: 'bonded', read: (l) => l?.is_bonded === true },
  { col: 'double', read: (l) => l?.is_double === true },
  { col: 'tanker', read: (l) => l?.is_tanker === true },
  { col: 'bill_only', read: (l) => l?.is_bill_only === true },
];

/**
 * Check if a single umbrella matches a load.
 * Returns true iff every populated filter column on the umbrella matches.
 */
export function matchUmbrellaToLoad(load, umbrella) {
  if (!load || !umbrella) return false;
  if (umbrella.is_active === false) return false;

  for (const f of UMBRELLA_FILTERS) {
    const uVal = umbrella[f.col];
    const isPopulated = f.populated ? f.populated(uVal) : uVal != null;
    if (!isPopulated) continue;

    const lVal = f.read(load);
    if (f.match) {
      if (!f.match(uVal, lVal)) return false;
    } else {
      // Strict equality — handles booleans naturally (false === false)
      // For nulls on the load side, equality check fails correctly.
      if (uVal !== lVal) return false;
    }
  }

  return true;
}

/**
 * Given a load and the full set of active umbrellas for the tenant, return:
 *   - winners:  umbrellas tied at the highest specificity_score
 *   - alwaysRun: umbrellas with always_run=true (in addition to winners)
 *   - rejected: umbrellas that didn't match (with reason summaries for
 *               the audit log — not a full breakdown, just "no_match" or
 *               "inactive")
 *
 * The dispatcher fans out over [...winners, ...alwaysRun] — a single
 * umbrella appearing in both lists is deduped by caller so it only
 * fires once.
 */
export function resolveMatchingUmbrellas(load, umbrellas) {
  const matched = [];
  const rejected = [];

  for (const u of umbrellas || []) {
    if (u.is_active === false) {
      rejected.push({ umbrella: u, reason: 'inactive' });
      continue;
    }
    if (matchUmbrellaToLoad(load, u)) {
      matched.push(u);
    } else {
      rejected.push({ umbrella: u, reason: 'no_match' });
    }
  }

  // Split into winners + always-run buckets
  const alwaysRunAll = matched.filter((u) => u.always_run === true);
  const normal = matched.filter((u) => u.always_run !== true);

  let winners = [];
  if (normal.length > 0) {
    const maxScore = Math.max(...normal.map((u) => u.specificity_score || 0));
    winners = normal.filter((u) => (u.specificity_score || 0) === maxScore);
  }

  return { winners, alwaysRun: alwaysRunAll, rejected };
}

/**
 * Dedupe a list of umbrellas by id. Used when winners + alwaysRun overlap
 * (an always_run umbrella that also happens to be the highest-specificity
 * match).
 */
export function dedupeUmbrellasById(list) {
  const seen = new Set();
  const out = [];
  for (const u of list || []) {
    if (!u || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}
