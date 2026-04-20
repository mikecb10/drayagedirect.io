/**
 * Resolve the display-name portion of the From: header.
 *
 * Precedence chain (first non-null, non-empty value wins):
 *   1. template.from_display_name
 *   2. config.from_display_name
 *   3. tenant.name
 *   4. 'DrayageDirect Notifications' (platform floor)
 *
 * @param template { from_display_name?: string } | null
 * @param config { from_display_name?: string } | null
 * @param tenant { name?: string } | null
 * @returns string (always non-empty)
 */
export function resolveFromDisplayName(template, config, tenant) {
  const chain = [
    template?.from_display_name,
    config?.from_display_name,
    tenant?.name,
    'DrayageDirect Notifications',
  ];
  for (const candidate of chain) {
    const trimmed = (candidate || '').trim();
    if (trimmed) return trimmed;
  }
  return 'DrayageDirect Notifications';
}
