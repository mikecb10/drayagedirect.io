/**
 * Helpers for tenant-specific overrides of reference data.
 *
 * Each tenant can toggle system-seeded entries (container types, container
 * owners, etc.) on or off without modifying the shared system rows. Overrides
 * live in `tenant_reference_toggles` and are merged into API responses so the
 * picker and settings pages see a tenant-specific view.
 */

/**
 * Fetch all overrides for a tenant + resource, returning a map keyed by item_id.
 * map[item_id] = boolean (true = enabled, false = disabled)
 * If an item has no override entry, the source row's own is_enabled is used.
 */
export async function fetchOverrides(svc, tenantId, resource) {
  const { data } = await svc
    .from('tenant_reference_toggles')
    .select('item_id, enabled')
    .eq('tenant_id', tenantId)
    .eq('resource', resource);

  const map = {};
  for (const row of data || []) {
    map[row.item_id] = row.enabled;
  }
  return map;
}

/**
 * Apply overrides to a list of reference items.
 * Each item gets an `effective_enabled` field reflecting the tenant's view.
 * Non-system rows use their own is_enabled directly (no override lookup).
 */
export function applyOverrides(items, overrides) {
  return items.map((item) => {
    // Tenant-owned rows: own is_enabled is the source of truth
    if (!item.is_system) {
      return { ...item, effective_enabled: !!item.is_enabled };
    }
    // System rows: check for a tenant override
    if (overrides[item.id] !== undefined) {
      return { ...item, effective_enabled: overrides[item.id] };
    }
    // No override: system row is enabled by default
    return { ...item, effective_enabled: !!item.is_enabled };
  });
}

/**
 * Filter a list of items to only those effectively enabled for the tenant.
 */
export function filterEnabled(items) {
  return items.filter((item) => item.effective_enabled !== false);
}

/**
 * Upsert an override row for a single item.
 */
export async function setOverride(svc, tenantId, resource, itemId, enabled) {
  const { error } = await svc
    .from('tenant_reference_toggles')
    .upsert(
      {
        tenant_id: tenantId,
        resource,
        item_id: itemId,
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,resource,item_id' }
    );
  if (error) throw new Error(error.message);
}

// ============================================================
// Sort ordering
// ============================================================

/**
 * Fetch tenant-specific sort orders for a resource.
 * Returns a map: item_id → sort_order (integer).
 */
export async function fetchSortOrders(svc, tenantId, resource) {
  const { data } = await svc
    .from('tenant_reference_sort_orders')
    .select('item_id, sort_order')
    .eq('tenant_id', tenantId)
    .eq('resource', resource);

  const map = {};
  for (const row of data || []) {
    map[row.item_id] = row.sort_order;
  }
  return map;
}

/**
 * Apply sort orders to a list of items, then sort.
 * Items with a custom sort_order come first (ascending), then unsorted items alphabetically.
 */
export function applySortOrders(items, sortOrders) {
  return items
    .map((item) => ({
      ...item,
      sort_order: sortOrders[item.id] ?? null,
    }))
    .sort((a, b) => {
      // Items with custom sort_order first
      if (a.sort_order !== null && b.sort_order !== null) return a.sort_order - b.sort_order;
      if (a.sort_order !== null) return -1;
      if (b.sort_order !== null) return 1;
      // Fallback: alphabetical by label
      return (a.label || '').localeCompare(b.label || '');
    });
}

/**
 * Batch-save sort orders for a resource. Accepts an array of { id, sort_order }.
 */
export async function saveSortOrders(svc, tenantId, resource, items) {
  const rows = items.map((item) => ({
    tenant_id: tenantId,
    resource,
    item_id: item.id,
    sort_order: item.sort_order,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await svc
    .from('tenant_reference_sort_orders')
    .upsert(rows, { onConflict: 'tenant_id,resource,item_id' });

  if (error) throw new Error(error.message);
}
