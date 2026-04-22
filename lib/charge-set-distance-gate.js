/**
 * Gate helper: reject invoice / rate-con sends when the charge set has
 * rows with needs_distance=true AND total_cents IS NULL.
 *
 * Used by all 4 send endpoints: single + bulk for both invoice + rate-con.
 * Returns { ok: true } when the charge set is sendable, or
 * { ok: false, unresolvedIds, unresolvedNames } when blocked.
 */
export async function checkChargeSetDistanceGate(svc, tenantId, chargeSetId) {
  const { data: unresolved, error } = await svc
    .from('order_charge_set_line_items')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('charge_set_id', chargeSetId)
    .eq('needs_distance', true)
    .is('total_cents', null);
  if (error) {
    return { ok: false, dbError: error.message };
  }
  if (!unresolved?.length) {
    return { ok: true };
  }
  return {
    ok: false,
    unresolvedIds: unresolved.map(r => r.id),
    unresolvedNames: unresolved.map(r => r.name).filter(Boolean),
  };
}
