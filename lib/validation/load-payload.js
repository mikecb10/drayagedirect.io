/**
 * Load-payload validation. Pure module — consumed by POST /api/tenant/loads
 * and PUT /api/tenant/loads/[id]. Keeps all load_type-specific validation
 * in one place so the API handlers stay thin.
 *
 * Returns { ok: true } on success; { ok: false, error: <string> } on failure.
 */

import { getLoadType } from '../constants/load-types.js';

export function validateLoadPayload(body) {
  const cfg = getLoadType(body?.load_type);
  if (!cfg) {
    return { ok: false, error: `Unknown load_type: ${body?.load_type}` };
  }

  if (cfg.requiresHookChassisLocation && !body.hook_chassis_location_id) {
    return {
      ok: false,
      error: `hook_chassis_location_id is required for ${cfg.label} loads`,
    };
  }

  if (cfg.requiresTerminateChassisLocation && !body.terminate_chassis_location_id) {
    return {
      ok: false,
      error: `terminate_chassis_location_id is required for ${cfg.label} loads`,
    };
  }

  // container_number / container_size are optional when allowsNullContainer is true.
  // Any stricter check (e.g., ISO format validation) lives outside this module.

  return { ok: true };
}
