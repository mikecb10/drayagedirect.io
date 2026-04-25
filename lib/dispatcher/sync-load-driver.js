/**
 * Mirror move-level driver assignments (from the Driver Planner) to the
 * load-level `orders.driver_id` field so the Dispatcher Load Board's
 * DRIVER column reflects current planner state.
 *
 * Policy — STRICT CONSENSUS over non-cancelled moves with a driver assigned:
 *   - all share one driver_id → orders.driver_id = that driver
 *   - split across drivers    → orders.driver_id = NULL
 *   - no assigned moves       → orders.driver_id = NULL
 *
 * When orders.driver_id changes to a new non-null driver, runs the same
 * driver-pay path the Load Detail manual edit uses — `findMatchingDriverCharges`
 * + `applyDriverPayToLoad` from `lib/driver-tariff-engine`.
 *
 * Idempotent: if consensus already matches the current orders.driver_id,
 * returns `{ changed: false }` without any writes.
 *
 * Throws on Supabase errors. Callers should wrap in try/catch so a sync
 * failure doesn't break the underlying move assignment.
 *
 * @param {SupabaseClient} svc       — service-role client
 * @param {string} orderId           — UUID of the order/load
 * @param {string} tenantId          — UUID of the tenant
 * @returns {Promise<{changed: boolean, prev: string|null, next: string|null}>}
 */
export async function syncLoadDriverFromMoves(svc, orderId, tenantId) {
  // 1. Read the current order row (full select for the tariff engine).
  const { data: order, error: orderErr } = await svc
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (orderErr) {
    throw new Error(`syncLoadDriverFromMoves: read order failed: ${orderErr.message}`);
  }
  if (!order) {
    // Order doesn't exist or wrong tenant — nothing to sync.
    return { changed: false, prev: null, next: null };
  }

  // 2. Read all non-cancelled moves on this order.
  const { data: moves, error: movesErr } = await svc
    .from('order_container_moves')
    .select('driver_id, status')
    .eq('tenant_id', tenantId)
    .eq('order_id', orderId)
    .neq('status', 'cancelled');
  if (movesErr) {
    throw new Error(`syncLoadDriverFromMoves: read moves failed: ${movesErr.message}`);
  }

  // 3. Compute consensus over moves with a driver assigned.
  const assignedDriverIds = new Set(
    (moves || [])
      .map((m) => m.driver_id)
      .filter((id) => id != null)
  );
  let target;
  if (assignedDriverIds.size === 0) {
    target = null; // no assigned moves
  } else if (assignedDriverIds.size === 1) {
    target = [...assignedDriverIds][0]; // single shared driver
  } else {
    target = null; // mixed drivers — no consensus
  }

  // 4. Idempotent check: if target already matches, no writes.
  const prev = order.driver_id || null;
  if (target === prev) {
    return { changed: false, prev, next: target };
  }

  // 5. UPDATE orders.driver_id.
  const { error: updErr } = await svc
    .from('orders')
    .update({ driver_id: target })
    .eq('id', orderId)
    .eq('tenant_id', tenantId);
  if (updErr) {
    throw new Error(`syncLoadDriverFromMoves: update order failed: ${updErr.message}`);
  }

  // 6. If a new driver is now assigned (target non-null AND different from prev),
  //    run the same driver-pay path the Load Detail manual edit uses. Lazy-import
  //    so the heavy tariff engine isn't loaded on every request.
  if (target != null && target !== prev) {
    const { findMatchingDriverCharges, applyDriverPayToLoad } =
      await import('../driver-tariff-engine');
    const charges = await findMatchingDriverCharges(svc, order, target, tenantId);
    if (charges.length > 0) {
      await applyDriverPayToLoad(svc, orderId, target, tenantId, charges);
    }
  }

  return { changed: true, prev, next: target };
}
