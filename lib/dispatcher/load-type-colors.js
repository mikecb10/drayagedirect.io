/**
 * Tenant-overridable color map for load_type. Used by the dispatcher
 * Load Board (DispatcherBoard) and Driver Planner cards to render the
 * left-edge color stripe.
 *
 * Values are #rrggbb hex strings — works directly in inline styles and
 * via Tailwind arbitrary values like `border-l-[var(--lt-color)]`.
 *
 * Tenants can override any of these via /settings/dispatcher-colors.
 * Fallback for unknown/null load_type is #d1d5db (gray-300).
 */
export const DEFAULT_LOAD_TYPE_COLORS = {
  import:    '#3b82f6', // blue-500
  inbound:   '#0ea5e9', // sky-500
  export:    '#8b5cf6', // violet-500
  outbound:  '#a855f7', // purple-500
  road:      '#f97316', // orange-500
  bill_only: '#6b7280', // gray-500
};

export function getLoadTypeColor(loadType, tenantColors = null) {
  const map = { ...DEFAULT_LOAD_TYPE_COLORS, ...(tenantColors?.load_type_colors || {}) };
  return map[loadType] || '#d1d5db';
}
