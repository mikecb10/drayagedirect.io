/**
 * Condition Evaluator — shared engine for AR + AP tariff matching.
 *
 * Takes a load object and an array of conditions (from charge profile
 * or tariff), evaluates each rule against the load, and returns
 * true only if ALL conditions pass (AND logic).
 *
 * Each condition: { field, operator, values: [...], values2?: [...] }
 *
 * Operators:
 *   any_in / not_in — set membership
 *   equal / not_equal / larger / smaller / larger_or_equal / smaller_or_equal — comparison
 *   between / not_between — range (uses values[0] as min, values2[0] as max)
 */

/**
 * Evaluate all conditions against a load. Returns true if ALL pass (AND logic).
 * @param {object} load — full load object with nested relations (customer, orgs, routing_events, etc.)
 * @param {Array} conditions — array of condition objects
 * @param {object} context — optional extra context { driver, routingEvents, chargeSets }
 * @returns {boolean}
 */
export function evaluateConditions(load, conditions, context = {}) {
  if (!conditions || conditions.length === 0) return true; // No conditions = always match

  for (const cond of conditions) {
    if (!cond.field || !cond.operator) continue; // Skip empty/invalid conditions
    if (!evaluateSingleCondition(load, cond, context)) return false;
  }
  return true;
}

/**
 * Evaluate a single condition against a load.
 */
function evaluateSingleCondition(load, cond, context) {
  const { field, operator, values = [], values2 = [] } = cond;
  const loadValue = extractLoadValue(load, field, context);

  // Set operators: any_in / not_in
  if (operator === 'any_in') {
    if (Array.isArray(loadValue)) {
      return loadValue.some((v) => values.includes(String(v)));
    }
    return values.includes(String(loadValue));
  }

  if (operator === 'not_in') {
    if (Array.isArray(loadValue)) {
      return !loadValue.some((v) => values.includes(String(v)));
    }
    return !values.includes(String(loadValue));
  }

  // Comparison operators (numeric/time)
  const numVal = parseFloat(loadValue);
  const cmpVal = parseFloat(values[0]);
  const cmpVal2 = parseFloat((values2 || [])[0]);

  if (operator === 'equal') return numVal === cmpVal;
  if (operator === 'not_equal') return numVal !== cmpVal;
  if (operator === 'larger') return numVal > cmpVal;
  if (operator === 'smaller') return numVal < cmpVal;
  if (operator === 'larger_or_equal') return numVal >= cmpVal;
  if (operator === 'smaller_or_equal') return numVal <= cmpVal;
  if (operator === 'between') return numVal >= cmpVal && numVal <= cmpVal2;
  if (operator === 'not_between') return numVal < cmpVal || numVal > cmpVal2;

  return true; // Unknown operator = pass
}

/**
 * Extract the relevant value from a load for a given rule field.
 * Maps rule keys to load properties.
 */
function extractLoadValue(load, field, context) {
  switch (field) {
    // ── Load & Customer Context ──
    case 'load_type':
      return load.load_type || '';
    case 'customer':
      return load.customer_id || '';
    case 'terminal':
      return load.pickup_location_id || ''; // Terminal is typically the pickup
    case 'warehouse':
      return load.delivery_location_id || '';
    case 'branch':
      return load.branch_id || '';
    case 'csr':
      return load.csr_user_id || '';

    // ── Locations ──
    case 'chassis_pickup':
      return load.hook_chassis_location_id || load.pickup_location_id || '';
    case 'hook_chassis':
      return load.hook_chassis_location_id || '';
    case 'container_return':
      return load.return_location_id || '';
    case 'chassis_termination':
      return load.terminate_chassis_location_id || load.return_location_id || '';
    case 'drop_location':
      return load.delivery_location_id || '';
    case 'city_state': {
      // Check delivery city/state against condition values
      const city = load.destination_city || load.delivery_org?.city || '';
      const state = load.destination_state || load.delivery_org?.state || '';
      return city && state ? `${city}, ${state}` : '';
    }
    case 'state':
      return load.destination_state || load.delivery_org?.state || '';
    case 'delivery_country':
      return load.delivery_org?.country || 'US';
    case 'postal_zip_code':
      return load.destination_zip || load.delivery_org?.zip || '';

    // ── Equipment ──
    case 'container_type':
      return load.container_type || load.container_type_id || '';
    case 'container_size':
      return load.container_size || load.container_size_id || '';
    case 'steamship_line':
      return load.container_owner_id || '';
    case 'chassis_type':
      return load.chassis_type || load.chassis_type_id || '';
    case 'chassis_size':
      return load.chassis_size || load.chassis_size_id || '';
    case 'chassis_owner':
      return load.chassis_owner || '';
    case 'chassis_prefix': {
      const cn = load.chassis_number || '';
      return cn.slice(0, 4).toUpperCase(); // Prefix is typically first 4 chars
    }

    // ── Boolean Flags ──
    case 'is_hot': return boolStr(load.is_hot);
    case 'is_hazmat': return boolStr(load.is_hazmat);
    case 'is_overweight': return boolStr(load.is_overweight);
    case 'is_genset': return boolStr(load.is_genset);
    case 'is_scale': return boolStr(load.is_scale);
    case 'is_ev': return boolStr(load.is_ev);
    case 'is_bonded': return boolStr(load.is_bonded);
    case 'is_oog': return boolStr(load.is_oog);
    case 'is_double': return boolStr(load.is_double);
    case 'is_tanker': return boolStr(load.is_tanker);
    case 'is_liquor': return boolStr(load.is_liquor);
    case 'is_street_turn': return boolStr(load.is_street_turn);
    case 'dual_transaction': return boolStr(load.is_dual_transaction);
    case 'is_reefer':
      // Can be boolean or temperature number
      if (load.container_type === 'reefer') return 'true';
      return boolStr(load.is_reefer);

    // ── Time & Schedule ──
    case 'delivery_day': {
      const dd = load.delivery_date || load.delivery_apt_from;
      if (!dd) return '';
      const day = new Date(dd).getDay();
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      return days[day] || '';
    }
    case 'delivery_time': {
      const dt = load.delivery_apt_from;
      if (!dt) return '';
      const d = new Date(dt);
      return d.getHours() * 60 + d.getMinutes(); // Minutes since midnight for comparison
    }

    // ── Weight & Distance ──
    case 'commodities_weight':
      return load.weight_lbs || load.weight_kg || 0;
    case 'leg_distance':
      // Would need distance calculation between origin/destination
      // For now, use total_miles if available
      return load.total_miles || 0;

    // ── Conditional Status ──
    case 'dropped': {
      const events = load.routing_events || context.routingEvents || [];
      const hasDrop = events.some((e) => e.event_type === 'drop' && e.departed_at);
      const hasDelivery = events.some((e) => e.event_type === 'deliver' && e.departed_at);
      if (hasDrop && hasDelivery) return 'after_delivery';
      if (hasDrop && !hasDelivery) return 'before_delivery';
      return '';
    }
    case 'stopoff':
      return ''; // TBD
    case 'street_turn_type':
      return load.street_turn_type || '';

    // ── Groups (future) ──
    case 'commodity_profile':
      return load.commodity_profile_id || '';
    case 'city_groups':
      return ''; // TBD — would need city group membership lookup
    case 'postal_zip_groups':
      return ''; // TBD — would need zip group membership lookup

    default:
      return '';
  }
}

/** Convert boolean to 'true'/'false' string for set matching */
function boolStr(val) {
  if (val === true) return 'true';
  if (val === false) return 'false';
  return '';
}

/**
 * Evaluate conditions for a time value (delivery_time).
 * Handles HH:MM string conversion to minutes for comparison.
 */
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
