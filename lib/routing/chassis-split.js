/**
 * Chassis-split detection. Pure module — no side effects, no DB access.
 *
 * A chassis split exists iff the load has a non-null hook_chassis_location_id
 * or terminate_chassis_location_id (columns added in migration 065). Presence
 * of the column value IS the signal; no comparison against container pickup
 * or return locations is needed — the user explicitly set a separate location,
 * so it's a split by definition.
 *
 * Chassis reposition is a distinct concept: load_type === 'chassis_reposition'
 * means the whole load is about moving the chassis (no container). Splits are
 * about chassis handling WITHIN a container load.
 */

/**
 * @param {object} load - Order row (may be partial; only chassis location fields required)
 * @returns {{
 *   isSplit: boolean,
 *   isHookSplit: boolean,
 *   isTerminateSplit: boolean,
 *   hookLocationId: string | null,
 *   terminateLocationId: string | null,
 * }}
 */
export function detectChassisSplit(load) {
  const hookLoc = load?.hook_chassis_location_id ?? null;
  const terminateLoc = load?.terminate_chassis_location_id ?? null;
  const isHookSplit = hookLoc != null;
  const isTerminateSplit = terminateLoc != null;
  return {
    isSplit: isHookSplit || isTerminateSplit,
    isHookSplit,
    isTerminateSplit,
    hookLocationId: hookLoc,
    terminateLocationId: terminateLoc,
  };
}

/**
 * @param {object} load - Order row with load_type field
 * @returns {boolean}
 */
export function isChassisReposition(load) {
  return load?.load_type === 'chassis_reposition';
}

/**
 * @param {object} load
 * @returns {boolean} true if the load involves any chassis handling (reposition OR split)
 */
export function hasChassisHandling(load) {
  return isChassisReposition(load) || detectChassisSplit(load).isSplit;
}
