/**
 * Charge-Set Status Transition Helper
 *
 * Centralizes all writes to order_charge_sets.status. Mirrors the
 * fireStatusChangeTriggers pattern in lib/email-dispatch/status-change-fire.js:
 * UPDATE the status (+ any extraFields co-written in the same UPDATE),
 * write a history row, log-and-continue on history-write failure.
 *
 * Called from API handlers under pages/api/tenant/ar/** and
 * pages/api/tenant/loads/[id]/charge-sets/**.
 *
 * No-op if newStatus === current status AND no extraFields provided.
 */

/**
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   chargeSetId: string,
 *   newStatus: string,
 *   actorUserId: string | null,
 *   extraFields?: object,
 * }} params
 * @returns {Promise<{ oldStatus: string | null, newStatus: string, row: object }>}
 * @throws on DB UPDATE failure (history-write failures are logged, not thrown).
 */
export async function transitionChargeSetStatus(svc, params) {
  const { tenantId, chargeSetId, newStatus, actorUserId, extraFields } = params;

  // 1. Fetch current state
  const { data: current, error: fetchErr } = await svc
    .from('order_charge_sets')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', chargeSetId)
    .maybeSingle();
  if (fetchErr) throw new Error(`charge_set fetch failed: ${fetchErr.message}`);
  if (!current) throw new Error(`charge_set ${chargeSetId} not found for tenant ${tenantId}`);

  const oldStatus = current.status;
  const hasExtraFields = extraFields && Object.keys(extraFields).length > 0;

  // 2. No-op short-circuit
  if (oldStatus === newStatus && !hasExtraFields) {
    return { oldStatus, newStatus, row: current };
  }

  // 3. UPDATE (status + extraFields merged)
  const updatePayload = { status: newStatus, ...(extraFields || {}) };
  const { data: updated, error: updErr } = await svc
    .from('order_charge_sets')
    .update(updatePayload)
    .eq('tenant_id', tenantId)
    .eq('id', chargeSetId)
    .select()
    .single();
  if (updErr) throw new Error(`charge_set update failed: ${updErr.message}`);

  // 4. History INSERT (log-and-continue; non-fatal)
  try {
    const { error: histErr } = await svc
      .from('order_charge_sets_status_history')
      .insert({
        tenant_id: tenantId,
        charge_set_id: chargeSetId,
        old_status: oldStatus ?? null,
        new_status: newStatus,
        changed_by: actorUserId ?? null,
      });
    if (histErr) {
      console.error(`charge_set history insert failed for ${chargeSetId}:`, histErr.message);
    }
  } catch (e) {
    console.error(`charge_set history insert threw for ${chargeSetId}:`, e?.message || e);
  }

  return { oldStatus, newStatus, row: updated };
}
