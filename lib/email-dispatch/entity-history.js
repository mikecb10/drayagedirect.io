/**
 * Entity → (history table, history id column) mapping.
 *
 * Single source of truth for the 3 entity-type status histories.
 * Consumed by:
 *   - lib/email-dispatch/status-change-fire.js (firing path)
 *   - lib/email-dispatch/evaluators/status.js (polled-worker evaluator)
 *
 * Adding a 4th entity type:
 *   1. Add a row here
 *   2. Extend the CHECK constraint in supabase/migrations/097_trigger_entity_type.sql
 *      (via a new migration ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT)
 *   3. Create the corresponding history table + back-reference audit (see migration 096 pattern)
 *   4. Wire the new entity's transition helper to call fireStatusChangeTriggers
 *   5. FU-072 / FU-073 land first if immediate-fire / delayed-fire needed for non-order types
 */

export const HISTORY_TABLE_BY_ENTITY = {
  order:      { table: 'order_status_history',                  idColumn: 'order_id' },
  charge_set: { table: 'order_charge_sets_status_history',      idColumn: 'charge_set_id' },
  move:       { table: 'order_container_moves_status_history',  idColumn: 'move_id' },
};
