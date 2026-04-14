/**
 * Routing Template Seeder
 *
 * Maps the 12 canonical routing templates to an ordered list of Container
 * Moves, each containing 1+ events. A move is the unit a driver gets
 * assigned to; events are the actions inside that move.
 *
 * ## Event types
 *
 *   pull     — Take a container from a terminal/port (loaded for import,
 *              empty for export).
 *   pickup   — Generic "pick up a container" action (domestic single-leg
 *              moves only).
 *   deliver  — Arrive at a customer location with the container. This is
 *              the load's milestone — the cargo has reached its destination.
 *              In Drop & Hook templates, a `deliver` is IMMEDIATELY followed
 *              by a `drop` in the same move, representing "I arrived +
 *              dropped the container and left". The two events share a
 *              timestamp — see the event timestamp cascade below.
 *   drop     — Park a container at a location and leave it. Appears in:
 *              (a) Prepull scenarios — driver drops at the yard between
 *                  the pull and the delivery.
 *              (b) Drop & Hook scenarios — driver delivers and drops at
 *                  the customer in one action, then departs.
 *   hook     — Pick up a previously-dropped container from a yard or a
 *              customer. Always paired with a preceding `drop` at the
 *              same location (enforced by the Drop ↔ Hook location sync
 *              in the events PUT handler).
 *   return   — Take the container to a terminal. Used for BOTH:
 *              • Empty return to an import terminal
 *              • Loaded delivery to an export terminal / rail ramp
 *              The loaded/empty distinction is derivable from the load
 *              type + sequence position, so the event type itself stays
 *              generic ("take container to a terminal").
 *
 * ## Location roles
 *
 *   pickup   → load.pickup_location_id   (import: terminal/port; export: empty depot)
 *   delivery → load.delivery_location_id (warehouse / customer / shipper)
 *   return   → load.return_location_id   (import: return terminal; export: delivery port/rail)
 *   yard     → null (dispatcher picks a company yard later)
 *
 * ## Deliver + Drop pair rule
 *
 * Drop & Hook templates include a `deliver` event immediately BEFORE the
 * `drop` event at the customer, even though the two happen at the same
 * physical location in the same instant. This is a deliberate modeling
 * choice:
 *
 *   1. It gives the dispatcher two distinct UI cards to drag/delete,
 *      making template conversion a simple data manipulation: delete the
 *      drop → it becomes a live unload; add a drop after a deliver → it
 *      becomes a drop & hook.
 *   2. The timeline + audit trail show BOTH "container delivered" AND
 *      "container dropped" as recorded events, so downstream logic (KPI
 *      cards, charge profile conditions, reporting) can reference either
 *      one independently.
 *
 * The two events share timestamps (set together, cleared together) via
 * the cascade in pages/api/tenant/loads/[id]/routing/events/[eventId].js.
 *
 * ## The 15 templates
 *
 *   Import (4) — ocean import, port → consignee
 *     1. Pick and Run + Live Unload
 *     2. Pick and Run + Drop & Hook
 *     3. Prepull + Live Unload
 *     4. Prepull + Drop & Hook
 *
 *   Inbound (4) — intermodal/rail import, rail terminal → consignee
 *   Same structure as Import but with rail-themed labels. Inbound and
 *   Import are functionally identical (pull a loaded container from a
 *   terminal, take it to the customer, return empty), but tenants
 *   differentiate them so that ocean vs rail loads can be tracked,
 *   billed, and reported separately.
 *     5. Inbound — Pick and Run + Live Unload
 *     6. Inbound — Pick and Run + Drop & Hook
 *     7. Inbound — Prepull + Live Unload
 *     8. Inbound — Prepull + Drop & Hook
 *
 *   Export (4)
 *     9. Export — Pick Empty + Live Load + Deliver
 *    10. Export — Pick Empty + Drop & Hook + Deliver
 *    11. Export — Hook Loaded + Deliver
 *    12. Export — Pick Empty + Prepull + Deliver
 *
 *   Outbound / Rail export (2)
 *    13. Outbound — Pick Empty + Live Load + Deliver to Rail
 *    14. Outbound — Hook Loaded + Deliver to Rail
 *
 *   Domestic / single-leg (1)
 *    15. One Way Move
 *
 *   Gray Pool variants — DEFERRED. Will be added in a follow-up once we've
 *   defined the semantics. `Pick and Run + Gray Pool` and `Prepull + Gray
 *   Pool` are NOT in this file so the template picker will not show them.
 *
 *   Removed from picker:
 *     - Shunt (was identical to One Way Move)
 *     - Hook with Return (legacy, redundant with Outbound — Hook Loaded)
 *     - Inbound + Live, Inbound + Drop & Hook, Inbound Prepull + Live
 *       (legacy from migration 004, replaced by the 4 new canonical
 *       Inbound templates above)
 *     - Outbound + Live Load, Outbound + Drop & Hook, Outbound Prepull
 *       Empty (legacy from migration 004, replaced by the 2 new canonical
 *       Outbound templates above)
 *   Existing loads that reference these names still work because their
 *   events are already in the DB; only the picker drops the options.
 */

// ============================================================
// Template event plans — each entry: { type, role?, move_index }
// ============================================================

const TEMPLATE_EVENT_PLANS = {
  // ---- Import (ocean) -----------------------------------------------------
  'Pick and Run + Live Unload': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'deliver', role: 'delivery', move_index: 0 },
    { type: 'return',  role: 'return',   move_index: 0 },
  ],
  'Pick and Run + Drop & Hook': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'deliver', role: 'delivery', move_index: 0 },
    { type: 'drop',    role: 'delivery', move_index: 0 },
    { type: 'hook',    role: 'delivery', move_index: 1 },
    { type: 'return',  role: 'return',   move_index: 1 },
  ],
  'Prepull + Live Unload': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'drop',    role: 'yard',     move_index: 0 },
    { type: 'hook',    role: 'yard',     move_index: 1 },
    { type: 'deliver', role: 'delivery', move_index: 1 },
    { type: 'return',  role: 'return',   move_index: 1 },
  ],
  'Prepull + Drop & Hook': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'drop',    role: 'yard',     move_index: 0 },
    { type: 'hook',    role: 'yard',     move_index: 1 },
    { type: 'deliver', role: 'delivery', move_index: 1 },
    { type: 'drop',    role: 'delivery', move_index: 1 },
    { type: 'hook',    role: 'delivery', move_index: 2 },
    { type: 'return',  role: 'return',   move_index: 2 },
  ],

  // ---- Inbound (rail import) ----------------------------------------------
  // Functionally identical to Import — same event types, same move
  // structure, same location roles. Tenants pick Inbound vs Import based
  // on whether the container originated at a rail terminal or an ocean
  // port, which affects billing/reporting but not routing.
  'Inbound — Pick and Run + Live Unload': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'deliver', role: 'delivery', move_index: 0 },
    { type: 'return',  role: 'return',   move_index: 0 },
  ],
  'Inbound — Pick and Run + Drop & Hook': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'deliver', role: 'delivery', move_index: 0 },
    { type: 'drop',    role: 'delivery', move_index: 0 },
    { type: 'hook',    role: 'delivery', move_index: 1 },
    { type: 'return',  role: 'return',   move_index: 1 },
  ],
  'Inbound — Prepull + Live Unload': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'drop',    role: 'yard',     move_index: 0 },
    { type: 'hook',    role: 'yard',     move_index: 1 },
    { type: 'deliver', role: 'delivery', move_index: 1 },
    { type: 'return',  role: 'return',   move_index: 1 },
  ],
  'Inbound — Prepull + Drop & Hook': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'drop',    role: 'yard',     move_index: 0 },
    { type: 'hook',    role: 'yard',     move_index: 1 },
    { type: 'deliver', role: 'delivery', move_index: 1 },
    { type: 'drop',    role: 'delivery', move_index: 1 },
    { type: 'hook',    role: 'delivery', move_index: 2 },
    { type: 'return',  role: 'return',   move_index: 2 },
  ],

  // ---- Export -------------------------------------------------------------
  // pickup = empty container depot
  // delivery = shipper/warehouse
  // return = delivery port (where the loaded container gets delivered)
  'Export — Pick Empty + Live Load + Deliver': [
    { type: 'pull',    role: 'pickup',   move_index: 0 }, // Pick empty from terminal
    { type: 'deliver', role: 'delivery', move_index: 0 }, // Live load at shipper
    { type: 'return',  role: 'return',   move_index: 0 }, // Deliver loaded to port
  ],
  'Export — Pick Empty + Drop & Hook + Deliver': [
    { type: 'pull',    role: 'pickup',   move_index: 0 }, // Pick empty from terminal
    { type: 'deliver', role: 'delivery', move_index: 0 }, // Arrive at shipper with empty
    { type: 'drop',    role: 'delivery', move_index: 0 }, // Drop empty at shipper
    { type: 'hook',    role: 'delivery', move_index: 1 }, // Hook loaded from shipper
    { type: 'return',  role: 'return',   move_index: 1 }, // Deliver loaded to port
  ],
  'Export — Hook Loaded + Deliver': [
    { type: 'hook',   role: 'pickup', move_index: 0 }, // Hook pre-loaded at shipper
    { type: 'return', role: 'return', move_index: 0 }, // Deliver loaded to port
  ],
  'Export — Pick Empty + Prepull + Deliver': [
    { type: 'pull',    role: 'pickup',   move_index: 0 }, // Pick empty from terminal
    { type: 'drop',    role: 'yard',     move_index: 0 }, // Drop empty at yard
    { type: 'hook',    role: 'yard',     move_index: 1 }, // Hook empty from yard
    { type: 'deliver', role: 'delivery', move_index: 1 }, // Live load at shipper
    { type: 'return',  role: 'return',   move_index: 1 }, // Deliver loaded to port
  ],

  // ---- Outbound / rail export ---------------------------------------------
  'Outbound — Pick Empty + Live Load + Deliver to Rail': [
    { type: 'pull',    role: 'pickup',   move_index: 0 },
    { type: 'deliver', role: 'delivery', move_index: 0 },
    { type: 'return',  role: 'return',   move_index: 0 },
  ],
  'Outbound — Hook Loaded + Deliver to Rail': [
    { type: 'hook',   role: 'pickup', move_index: 0 },
    { type: 'return', role: 'return', move_index: 0 },
  ],

  // ---- Domestic single-leg ------------------------------------------------
  'One Way Move': [
    { type: 'pickup',  role: 'pickup',   move_index: 0 },
    { type: 'deliver', role: 'delivery', move_index: 0 },
  ],
};

// Display labels for each event type — used wherever the user-facing label
// differs from the enum value.
const EVENT_LABELS = {
  pull: 'Pull from Terminal',
  pickup: 'Pickup Container',
  drop: 'Drop Container',
  hook: 'Hook Container',
  deliver: 'Deliver Container',
  return: 'Return Container',
  wait: 'Wait',
  scale: 'Scale',
};

// ============================================================
// buildRoutingEventsForTemplate
// ============================================================
/**
 * Given a routing template and a load, return `{ moves, events }`:
 *   - `moves`: array of `{ sequence, move_type, status }` shells. The caller
 *     inserts these into `order_container_moves` first, then uses the
 *     returned IDs to set `move_id` on each event before inserting into
 *     `order_routing_events`.
 *   - `events`: array of event row payloads with `move_index` indicating
 *     which move (by position in the `moves` array) they belong to.
 *
 * Falls back to legacy flat behavior if the template name is not recognized —
 * everything goes into a single move.
 */
export function buildRoutingEventsForTemplate({ template, load, locations }) {
  if (!template || !load) return { moves: [], events: [] };

  const plan = TEMPLATE_EVENT_PLANS[template.name] || null;

  // Resolve location snapshot per role
  const byRole = {
    pickup: { id: load.pickup_location_id || null, snap: locations?.pickup || {} },
    delivery: { id: load.delivery_location_id || null, snap: locations?.delivery || {} },
    return: { id: load.return_location_id || null, snap: locations?.return || {} },
    yard: { id: null, snap: {} },
  };

  // Legacy fallback: every event goes in move 0
  const sequence = plan
    ? plan
    : (template.event_sequence || []).map((ev) => ({
        type: ev.type,
        role: null,
        move_index: 0,
      }));

  // Derive unique move shells from the plan
  const moveCount = sequence.reduce((max, ev) => Math.max(max, ev.move_index), 0) + 1;
  const moves = Array.from({ length: moveCount }, (_, i) => ({
    sequence: i,
    move_type: template.name || null,
    status: 'pending',
  }));

  // Build event payloads
  const events = sequence.map((ev, idx) => {
    const res = byRole[ev.role || ''] || { id: null, snap: {} };
    return {
      tenant_id: load.tenant_id,
      order_id: load.id,
      sequence: idx,
      move_index: ev.move_index, // caller wires this to move_id after inserts
      event_type: ev.type,
      location_id: res.id,
      location_name: res.snap?.name || null,
      address: res.snap?.address_line1 || null,
      city: res.snap?.city || null,
      state: res.snap?.state || null,
      zip: res.snap?.zip || null,
      notes: null,
    };
  });

  return { moves, events };
}

export { EVENT_LABELS, TEMPLATE_EVENT_PLANS };
