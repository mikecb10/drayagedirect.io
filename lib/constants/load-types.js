/**
 * Single source of truth for load types. Resolves FU-059.
 *
 * Every consumer imports from here. Adding a new load type:
 *   1. Add entry below; letter must be unique
 *   2. Set behavior flags to match intent
 *   3. If the type has validation requirements (e.g., chassis_reposition),
 *      add requires* flags — consumed by lib/validation/load-payload.js
 *
 * Letter preservation note: existing letters (M/N/E/O/R/B) match the
 * hardcoded map at pages/api/tenant/loads/index.js LOAD_TYPE_LETTER
 * (pre-consolidation). Do not change these — they are already embedded
 * in load-number prefixes across live tenant data.
 */

export const LOAD_TYPES = [
  {
    value: 'import',
    label: 'Import',
    letter: 'M',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Import container from port to consignee',
  },
  {
    value: 'inbound',
    label: 'Inbound',
    letter: 'N',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Inbound rail container to consignee',
  },
  {
    value: 'export',
    label: 'Export',
    letter: 'E',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Export container from shipper to port',
  },
  {
    value: 'outbound',
    label: 'Outbound',
    letter: 'O',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Outbound rail container from shipper',
  },
  {
    value: 'road',
    label: 'Road',
    letter: 'R',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Over-the-road move (non-intermodal)',
  },
  {
    value: 'bill_only',
    label: 'Bill Only',
    letter: 'B',
    allowsNullContainer: true,
    matchesTariffs: false,
    matchesDriverTariffs: false,
    showsOnDispatcherBoard: false,
    description: 'Manual invoice-only; no driver or container ops',
  },
  {
    value: 'chassis_reposition',
    label: 'Chassis Reposition',
    letter: 'C',
    allowsNullContainer: true,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Move a chassis between terminals (no container)',
    requiresHookChassisLocation: true,
    requiresTerminateChassisLocation: true,
  },
];

// Derived lookups (preserve existing names — zero breaking changes for consumers)
export const VALID_LOAD_TYPES = LOAD_TYPES.map((t) => t.value);
export const LOAD_TYPE_LETTER = Object.fromEntries(LOAD_TYPES.map((t) => [t.value, t.letter]));
export const LOAD_TYPE_LABELS = Object.fromEntries(LOAD_TYPES.map((t) => [t.value, t.label]));

// Filtered lists for UI chip groups + engines
export const TARIFF_MATCHING_LOAD_TYPES = LOAD_TYPES.filter((t) => t.matchesTariffs);
export const DRIVER_TARIFF_MATCHING_LOAD_TYPES = LOAD_TYPES.filter((t) => t.matchesDriverTariffs);
export const DISPATCHER_BOARD_LOAD_TYPES = LOAD_TYPES.filter((t) => t.showsOnDispatcherBoard);

// Helpers
export function getLoadType(value) {
  return LOAD_TYPES.find((t) => t.value === value) || null;
}

export function isValidLoadType(value) {
  return VALID_LOAD_TYPES.includes(value);
}
