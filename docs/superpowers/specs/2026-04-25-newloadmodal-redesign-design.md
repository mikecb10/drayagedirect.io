# NewLoadModal Redesign — Single-Page Wide Layout + Per-User Template Order

**Status:** Design approved 2026-04-25 (brainstorm)
**Predecessor:** existing `components/loads/NewLoadModal.js` (612 LoC, 2-step wizard)

## 1. Goal

Restructure the New Load creation modal into a single-page dense layout that fits on a 1080p+ viewport without scrolling. Replace the existing 2-step wizard with a Linear/Notion-style single screen that puts type pills + template chips + all detail fields in one view. Add per-user drag-to-reorder on the routing template chips so each dispatcher can put their most-used templates first.

## 2. Scope

**In scope**

- Single-page layout (variant B from brainstorm): ~1040px-wide modal, no wizard, no scroll
- Type pills row at top (Import / Inbound / Export / Outbound / Road / Bill Only / Chassis Repo)
- Routing template chip grid below the type pills, filtered by the active type
- 3-column field grid for Customer / Locations / Container / Dates / References
- Per-user drag-to-reorder for the routing template chips, persisted to `user_dispatcher_preferences.routing_template_order` (new column, ALTER TABLE migration)
- Reorder persists across sessions and devices for the same user
- New templates (added by tenant admin or seed) automatically append at the end of the user's order
- Reset-to-default button to clear the user's custom order

**Out of scope (deferred)**

- "Automatic" mode (drag-drop a rate-con PDF → AI extracts fields). Per `feature_new_load_modal.md` this is Phase 7-8.
- Container-number auto-fetch from terminal APIs. Phase 7.
- Tenant-admin reorder of templates (admin-set tenant-wide default). Future FU if dispatchers ask for it.
- Pin-favorites alternative. Stick with full drag-to-reorder.

## 3. Design Decisions (resolved during brainstorm)

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Layout philosophy | **Variant B — single-page wide modal (~1040px)** | Most "Linear / Notion" feel; eliminates wizard overhead; fits all fields on one screen at 1080p+. |
| 2 | Wizard or single-screen | **Single screen** (drop the wizard) | Wizard adds clicks for no benefit when the form fits on one page. Type pills + template grid handle Step 1's job inline. |
| 3 | Template reorder mechanism | **Per-user drag-to-reorder** (vs per-tenant settings or pin-favorites) | Drayage dispatchers specialize (one does imports, another outbound rail). Personalized order beats tenant-wide order. |
| 4 | Template order storage | **New column on `user_dispatcher_preferences`** (vs new dedicated table) | Existing table already holds dispatcher-domain prefs (column_order, frozen_columns); load creation is part of that domain. One ALTER TABLE migration vs a new full-stack table. |
| 5 | New-template fallback position | **End of order** (vs alphabetical merge or top) | Predictable: existing user order stays stable; new templates appear last until the user drags them up. |
| 6 | Modal width handling on small viewports | **Min 980px, gracefully scrolls horizontally below that** | <1080p users (laptops with sidebar open) get a horizontal scroll rather than broken layout. The ≥1080px target is the "no vertical scroll" promise. |

## 4. Architecture

### 4.1 Frontend — `components/loads/NewLoadModal.js`

**Significant rewrite.** Net: smaller (~470 LoC after rewrite, down from 612) because the wizard plumbing goes away.

**Removed:**
- `step` state + step navigation handlers (~40 LoC)
- Step 1 standalone view (load type radio + template radio in their own panel)
- "Back" button + step transitions

**Restructured:**
- Single render path: header (title + close) → body (type pills row → template chip grid → 3-col field grid) → footer (Cancel / Create Load)
- Body uses CSS grid for the 3-column field layout
- Template chip grid uses `@dnd-kit/sortable` for drag-to-reorder (already in deps via the planner)

**Template chip grid behavior:**
- Renders `templates` array filtered by `form.load_type` (existing filter — unchanged)
- Each chip is a `<DraggableChip>` with `useSortable` from `@dnd-kit/sortable`
- Chip click → sets `form.routing_template_id` (existing behavior)
- Chip drag → reorders the array; on drop, `PUT /api/tenant/dispatcher-preferences { routing_template_order: [...ids] }`
- Order is read from `user_dispatcher_preferences.routing_template_order` on modal open; merged with the fetched template list (any template not in the order array appends at the end)
- "Reset order" link below the chip grid → empty array → templates fall back to default order

**Field grid:**
- Customer (col-span 2) | Branch
- Pickup Location | Delivery Location | Return Location
- Container # | Size | LFD
- Pickup Apt | Delivery Apt | Master BOL / Booking #

(Fields shown depend on `TYPE_CONFIG[load_type]` — chassis_reposition swaps Pickup/Delivery for Hook/Terminate slots; bill_only hides container/dates entirely. Existing logic, preserved.)

### 4.2 Backend

**Migration `105_routing_template_order.sql`:**

```sql
BEGIN;

ALTER TABLE user_dispatcher_preferences
  ADD COLUMN IF NOT EXISTS routing_template_order TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';

COMMIT;
```

Single column add, idempotent, non-breaking.

**API endpoint `pages/api/tenant/dispatcher-preferences/index.js`:**

Already exists. Add `routing_template_order` to the GET response shape and the PUT update payload allowlist. ~5 LoC delta. Validates that array entries are UUIDs.

**API endpoint `pages/api/tenant/routing-templates`:**

No change. Already returns templates filtered by `load_type` query param. The frontend handles the order-merge.

### 4.3 Drag-to-reorder mechanics

`@dnd-kit/sortable` is already used by the dispatcher Load Board's column reorder (per migration 006 + `DispatcherBoard.js`). Same pattern:

- Wrap chip grid in `<SortableContext items={orderedTemplateIds} strategy={rectSortingStrategy}>`
- Each chip uses `useSortable({ id: template.id })`
- `onDragEnd` updates local state + fires `updatePreferences({ routing_template_order: nextOrder })` (existing helper from `useDispatcherPreferences` hook — verify name during planning)

## 5. Data Flow

```
Modal opens
  └─> Fetch /api/tenant/dispatcher-preferences → get routing_template_order
  └─> Fetch /api/tenant/routing-templates?load_type=<type> → get templates
      └─> Merge: orderedTemplates = orderArray.map(id => templates.find(...)).filter(Boolean)
                                 + templates.filter(t => !orderArray.includes(t.id))
      └─> Render chip grid in merged order

User drags chip A from position 3 to position 1
  └─> Local: setOrderedTemplates(reorder)
  └─> Persist: PUT /api/tenant/dispatcher-preferences
                body: { routing_template_order: orderedTemplates.map(t => t.id) }
  └─> Optimistic update (no spinner — DnD should feel instant)

User clicks "Reset order"
  └─> Local: setOrderedTemplates(templates) // back to fetch order
  └─> Persist: PUT routing_template_order: []
```

## 6. Files Changed

| File | Change | Approx LoC |
|---|---|---|
| `supabase/migrations/105_routing_template_order.sql` | New migration | +9 |
| `pages/api/tenant/dispatcher-preferences/index.js` | Add `routing_template_order` to GET + PUT | +6 |
| `components/loads/NewLoadModal.js` | Rewrite to single-page layout + DnD chips | -612 → +470 (net -142) |
| `hooks/useDispatcherPreferences.js` *(or equivalent)* | Expose `routing_template_order` from prefs hook | +3 |

**Total:** ~+490 LoC across 4 files; ~-612 LoC removed; net **-122 LoC** (rewrite shrinks the file). One migration. No new RPCs.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Modal breaks on viewports <1080p (laptop with sidebar open) | Min-width 980px; below that, horizontal scroll inside the modal — degrades but doesn't crash. |
| User has 100+ templates (heavy chip grid) | Today's seed has ~12; grid wraps cleanly. If a tenant grows past ~25 templates, file FU for grouped/collapsed view (not in scope today). |
| Drag-drop conflict with click-to-select on chips | `@dnd-kit` PointerSensor activation distance: 5px. A click without 5px movement still fires `onClick` (selects template); only a real drag triggers reorder. Same pattern the planner uses. |
| Reset-order races with a concurrent drag in another tab | Last-write-wins; harmless. The DB stores the latest order; both tabs converge on next open. |
| New template added by admin while user has it open | Falls into the "not in user's order" branch → appears at the end on next modal open. Acceptable. |
| Migration 105 conflicts with a concurrent unrelated migration also numbered 105 | Confirmed against `ls supabase/migrations/` (last is 104_margin_palette). If a parallel branch ships 105 first, rebase and renumber. |

## 8. Verification Gates

1. **Layout fits at 1080p** — open the modal at 1920×1080 viewport, no vertical scroll.
2. **Layout degrades cleanly at 1366×768** — modal scales (or horizontally scrolls) without breaking.
3. **Type pill switching filters templates** — click "Export" → only export templates show.
4. **Template chip click selects** — click "Pick & Run + Live Unload" → `form.routing_template_id` set, chip highlighted.
5. **Drag-to-reorder persists** — drag chip A from position 3 to 1 → close modal → reopen → still in position 1. Verify via `SELECT routing_template_order FROM user_dispatcher_preferences WHERE user_id = ...`.
6. **Reset-order works** — click "Reset" → templates revert to fetch order; row shows `routing_template_order = '{}'`.
7. **New template auto-appends** — admin adds a new template via seed/import → user's existing order is preserved; new template appears last.
8. **Form submission unchanged** — Create Load with all required fields → load created identically to current behavior (regression check on the `handleSubmit` path).
9. **Bill Only path unchanged** — switch to Bill Only type → container/dates fields hide; submit creates a bill-only load.
10. **chassis_reposition path unchanged** — Hook/Terminate slot fields appear in place of pickup/delivery; submit works.

## 9. Commit Plan

Single feature branch with ~5 commits, squash-merged to main:

1. `feat(db): add routing_template_order column to user_dispatcher_preferences (migration 105)`
2. `feat(api): expose routing_template_order on dispatcher-preferences endpoint`
3. `refactor(load-modal): rewrite NewLoadModal as single-page layout (drop wizard)`
4. `feat(load-modal): drag-to-reorder routing template chips with persistence`
5. `feat(load-modal): reset-order link + empty-state polish`

Final squash-merge to main with `Resolves: <FU-NEW>` (will file as new FU when planning).

## 10. Out-of-scope follow-ups (file as new FUs after spec approval)

- **Tenant-admin reorder of templates** — admin sets a default tenant-wide order; users without a personal order get that. File if dispatchers ask for it.
- **Group/collapse template grid** at >25 templates — segmented or collapsible groups by load_type or by usage frequency.
- **Frequency-based "suggested" templates** — show usage count, surface most-used templates for new dispatchers who haven't customized yet.
- **Auto mode (rate-con PDF → AI extract)** — Phase 7-8.
- **Container # auto-fetch from terminal APIs** — Phase 7.
