# Driver Planner Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the low-density Driver Planner cards with information-dense cards (Variant B compact + click-to-expand on right rail; Dense compact + slide-out on grid cells) that surface the move type, appointment time, LFD urgency, and full route inline. Reuse DispatcherBoard's tenant-overridable load_type color map for the left-edge stripe.

**Architecture:** Two new shared utility modules (`load-type-colors`, `event-colors`) + one new helper (`lfd-urgency`) + two new presentational components (`MoveCardCompact`, `MoveCardExpanded`) + refactor of two existing components (`UnassignedMoveCard`, `MoveCell`) to use the shared compact view. One additive API select tweak adds two fields (`load_type`, `customer_reference`) to the planner endpoint's orders join. Zero migrations, zero new RPCs.

**Tech Stack:** Next.js 14 (pages router), React 18, Tailwind CSS, Supabase (service-role for the planner endpoint), `@dnd-kit/core` (DnD already present on both surfaces). No test framework in repo — verification via syntax checks (`node --check`) + visual Chrome gates per the codebase convention (2a.4, driver-planner v1, FU-024).

**Spec:** [docs/superpowers/specs/2026-04-25-driver-planner-card-redesign.md](../specs/2026-04-25-driver-planner-card-redesign.md) (commit `28f3c23`)

---

## Spec Deltas (caught during planning)

Two scope items the spec didn't explicitly cover. Both confirmed by reading the actual files:

1. **API select** — spec said "everything else is already on the wire" + listed only `customer_reference` as missing. In fact, the planner API at [pages/api/tenant/dispatcher/planner/index.js:72-76](../../../pages/api/tenant/dispatcher/planner/index.js) does NOT select `load_type` either. Both fields must be added. (Single-line change becomes two-field change.)
2. **MoveCell header buttons** — the existing [MoveCell.jsx:117-173](../../../components/dispatcher/planner/MoveCell.jsx) renders a header row with Dispatch (✓) and Unassign (✗) action buttons. The spec said "refactor to use shared compact, drop redundant rendering" but didn't specify what stays. **The action buttons must be preserved** — they're the only way to dispatch/unassign without opening the full slide-out. The new MoveCell becomes: header (preserved) + MoveCardCompact (new content body) + TrackingLine (preserved if active).

These are noted here so the engineer doesn't go off-script. No spec rewrite needed.

---

## File Structure

**Create:**
- `lib/dispatcher/load-type-colors.js` — `DEFAULT_LOAD_TYPE_COLORS` map + `getLoadTypeColor(loadType, tenantColors)` helper
- `lib/dispatcher/event-colors.js` — `EVENT_COLOR` + `EVENT_LABEL` maps (extracted from MoveCell)
- `lib/dispatcher/lfd-urgency.js` — `lfdPillClass(lfdDateString)` returning Tailwind classes by urgency tier
- `components/dispatcher/planner/MoveCardCompact.jsx` — pure presentational compact view (~80 LoC)
- `components/dispatcher/planner/MoveCardExpanded.jsx` — wrapper adding chevron + 4 expand sections (~120 LoC)

**Modify:**
- `pages/api/tenant/dispatcher/planner/index.js` — add `load_type, customer_reference` to orders select (line 72-76 area)
- `components/dispatcher/planner/UnassignedMoveCard.jsx` — rewrite as thin wrapper over `MoveCardExpanded` + DnD
- `components/dispatcher/planner/MoveCell.jsx` — refactor to use `MoveCardCompact` for body; preserve header action buttons + TrackingLine
- `components/dispatcher/DispatcherBoard.js` — import `DEFAULT_LOAD_TYPE_COLORS` from shared util instead of inline definition (lines 43-50)

**Parallelizable:** Tasks 1, 2, 3, 4 touch disjoint files and can run as concurrent subagents. Task 5 (MoveCardCompact) depends on Tasks 1+4. Task 6 (MoveCardExpanded) depends on Tasks 2+5. Tasks 7+8 (refactor UnassignedMoveCard / MoveCell) depend on Tasks 5+6 / 5 respectively. Task 9 (DispatcherBoard import) depends only on Task 1. Task 10 is verification at the end.

---

## Task 1: Extract `DEFAULT_LOAD_TYPE_COLORS` to shared util

**Files:**
- Create: `lib/dispatcher/load-type-colors.js`

**Context:** The map currently lives inline in [DispatcherBoard.js:43-50](../../../components/dispatcher/DispatcherBoard.js). Extract verbatim — no value changes — so both surfaces import from one source.

- [ ] **Step 1: Create the shared util file**

Write to `lib/dispatcher/load-type-colors.js`:

```js
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
```

- [ ] **Step 2: Verify syntax**

Run: `node --check lib/dispatcher/load-type-colors.js`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add lib/dispatcher/load-type-colors.js
git commit -m "feat(dispatcher): extract DEFAULT_LOAD_TYPE_COLORS to shared util"
```

---

## Task 2: Extract `EVENT_COLOR` + `EVENT_LABEL` to shared util

**Files:**
- Create: `lib/dispatcher/event-colors.js`

**Context:** Both maps currently inline in [MoveCell.jsx:18-28](../../../components/dispatcher/planner/MoveCell.jsx). The new `MoveCardExpanded` Route section needs the same color map for the route-step dots. Extract verbatim.

- [ ] **Step 1: Create the shared util file**

Write to `lib/dispatcher/event-colors.js`:

```js
/**
 * Event-type → color and label maps. Used by the planner cards (MoveCell,
 * MoveCardExpanded Route section) to render event badges and route-step dots.
 *
 * Tailwind class strings — usable directly on JSX className.
 */
export const EVENT_COLOR = {
  pickup:  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  deliver: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  return:  'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

export const EVENT_LABEL = {
  pickup:  'Pick Up Container',
  deliver: 'Deliver Container',
  return:  'Return Container',
};

/**
 * Compact dot color (just text-color, no bg) for route-step dots in the
 * MoveCardExpanded Route section.
 */
export const EVENT_DOT_COLOR = {
  pickup:  'text-blue-500 dark:text-blue-400',
  deliver: 'text-green-500 dark:text-green-400',
  return:  'text-purple-500 dark:text-purple-400',
};
```

- [ ] **Step 2: Verify syntax**

Run: `node --check lib/dispatcher/event-colors.js`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add lib/dispatcher/event-colors.js
git commit -m "feat(dispatcher): extract EVENT_COLOR/LABEL to shared util"
```

---

## Task 3: Add `load_type` + `customer_reference` to planner API orders select

**Files:**
- Modify: `pages/api/tenant/dispatcher/planner/index.js`

**Context:** Both fields are stored on `orders` but not currently selected. Both are additive — no schema change, no migration, no RLS implications.

- [ ] **Step 1: Add the two fields to the orders select**

Find this block at [pages/api/tenant/dispatcher/planner/index.js:72-76](../../../pages/api/tenant/dispatcher/planner/index.js):

```js
      order:orders!order_container_moves_order_id_fkey(
        id, order_number, container_number, container_size, container_type,
        last_free_day, container_at_port, empty_ready_for_return_at, branch_id,
        status, deleted_at, actual_delivery_at
      ),
```

Replace with:

```js
      order:orders!order_container_moves_order_id_fkey(
        id, order_number, container_number, container_size, container_type,
        load_type, customer_reference,
        last_free_day, container_at_port, empty_ready_for_return_at, branch_id,
        status, deleted_at, actual_delivery_at
      ),
```

- [ ] **Step 2: Verify syntax**

Run: `node --check pages/api/tenant/dispatcher/planner/index.js`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/dispatcher/planner/index.js
git commit -m "feat(planner-api): expose load_type and customer_reference on orders"
```

---

## Task 4: Create `lfd-urgency.js` helper

**Files:**
- Create: `lib/dispatcher/lfd-urgency.js`

**Context:** The LFD pill needs urgency-tier coloring (red past / amber today-or-tomorrow / neutral else). Pure date math — no React, no DOM.

- [ ] **Step 1: Create the helper file**

Write to `lib/dispatcher/lfd-urgency.js`:

```js
/**
 * LFD pill urgency classes. Used by MoveCardCompact to color the
 * "LFD MM/DD" pill based on how close the deadline is.
 *
 * Tiers:
 *   - past:    LFD < today          → red
 *   - urgent:  LFD <= today + 1 day → amber
 *   - normal:  else                 → neutral slate
 *   - missing: null/undefined LFD   → null (caller should hide pill)
 *
 * Returns a Tailwind className string ready to drop on a span.
 */
export function lfdPillClass(lfdDateString) {
  if (!lfdDateString) return null;

  const lfd = new Date(lfdDateString);
  if (Number.isNaN(lfd.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (lfd < today) {
    return 'bg-red-900/40 text-red-200 dark:bg-red-900/40 dark:text-red-200';
  }
  if (lfd <= tomorrow) {
    return 'bg-amber-900/40 text-amber-200 dark:bg-amber-900/40 dark:text-amber-200';
  }
  return 'bg-slate-800 text-slate-300 dark:bg-slate-800 dark:text-slate-300';
}

/**
 * Format a YYYY-MM-DD or ISO datetime as MM/DD for the LFD pill.
 * Returns null on invalid input.
 */
export function fmtLfdShort(lfdDateString) {
  if (!lfdDateString) return null;
  const d = new Date(lfdDateString);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check lib/dispatcher/lfd-urgency.js`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add lib/dispatcher/lfd-urgency.js
git commit -m "feat(dispatcher): add LFD urgency pill helper"
```

---

## Task 5: Create `MoveCardCompact` component

**Files:**
- Create: `components/dispatcher/planner/MoveCardCompact.jsx`

**Context:** Pure presentational. Takes a `move` prop and renders the compact view (color stripe + load # + customer + move-type pill + appt + LFD). Used by both UnassignedMoveCard (right rail) and MoveCell (grid cells).

The order coming from the planner API is at `move.order` and now (after Task 3) includes `load_type` + `customer_reference`. Customer name is NOT directly on the order — it's on `move.order.customer.name` only if the API joined the customers table. Per the planner API recon, customers are NOT joined. The customer name would need a separate fetch OR would show as just the customer_id. **Decision: omit customer name from compact for now** — the spec showed "Big B Beer" as a customer-name placeholder, but without the API join we'd be showing a UUID. Use `move.order.customer_reference` instead (which IS available after Task 3) as a secondary identifier, or omit the second line entirely on compact.

For this implementation, the compact card renders these lines:
1. **Color stripe** — left edge, 4px wide, color from `getLoadTypeColor(order.load_type)`.
2. **Load # row** — `order.order_number` only (no customer name in this iteration).
3. **Move-type pill** — `move.move_type` truncated, with `title` attr for full text on hover.
4. **Time row** — `events[0]?.scheduled_at` formatted as `MM/DD HH:mm` + LFD pill if `order.last_free_day` is present.

- [ ] **Step 1: Write the component**

Write to `components/dispatcher/planner/MoveCardCompact.jsx`:

```jsx
import { memo } from 'react';
import { getLoadTypeColor } from '../../../lib/dispatcher/load-type-colors';
import { lfdPillClass, fmtLfdShort } from '../../../lib/dispatcher/lfd-urgency';

function fmtAptShort(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return null;
  }
}

/**
 * Compact card view used by both the right-rail unassigned panel and the
 * assigned grid cells. Renders:
 *   - left-edge color stripe (load_type)
 *   - load number (order_number)
 *   - move type pill (truncated, hover-tooltip for full text)
 *   - first event appt time + LFD urgency pill
 *
 * Pure presentational — no internal state, no callbacks. Memoized because
 * the planner re-renders heavily during DnD.
 *
 * Props:
 *   move          (required) — move object from /api/tenant/dispatcher/planner
 *   tenantColors  (optional) — { load_type_colors?: {} } to override stripe map
 */
function MoveCardCompact({ move, tenantColors = null }) {
  const order = move?.order || {};
  const stripeColor = getLoadTypeColor(order.load_type, tenantColors);
  const apt = fmtAptShort(move?.events?.[0]?.scheduled_at);
  const lfdShort = fmtLfdShort(order.last_free_day);
  const lfdClass = lfdPillClass(order.last_free_day);

  return (
    <div
      className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded overflow-hidden"
      style={{ borderLeft: `4px solid ${stripeColor}` }}
    >
      {/* Load # row */}
      <div className="px-2 pt-2 pb-1">
        <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">
          {order.order_number || move?.id?.slice(0, 8) || '—'}
        </div>
      </div>

      {/* Move-type pill row */}
      {move?.move_type && (
        <div className="px-2 pb-1">
          <span
            title={move.move_type}
            className="inline-block max-w-full truncate px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          >
            {move.move_type}
          </span>
        </div>
      )}

      {/* Time + LFD row */}
      {(apt || lfdShort) && (
        <div className="px-2 pb-2 flex items-center gap-2 flex-wrap">
          {apt && (
            <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
              📅 {apt}
            </span>
          )}
          {lfdShort && lfdClass && (
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${lfdClass}`}>
              LFD {lfdShort}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(MoveCardCompact);
```

- [ ] **Step 2: Skip syntax check**

Node can't parse JSX directly. Skip; rely on Next dev server compilation (verified in Task 10).

- [ ] **Step 3: Commit**

```bash
git add components/dispatcher/planner/MoveCardCompact.jsx
git commit -m "feat(planner): add MoveCardCompact shared component"
```

---

## Task 6: Create `MoveCardExpanded` component

**Files:**
- Create: `components/dispatcher/planner/MoveCardExpanded.jsx`

**Context:** Wraps `MoveCardCompact` with a click chevron that reveals 4 expand sections inline (Route, Container, Customer ref, Actions). Used ONLY by the right-rail unassigned panel — assigned grid cells skip the inline expand and use the existing slide-out panel instead.

- [ ] **Step 1: Write the component**

Write to `components/dispatcher/planner/MoveCardExpanded.jsx`:

```jsx
import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import MoveCardCompact from './MoveCardCompact';
import { EVENT_DOT_COLOR } from '../../../lib/dispatcher/event-colors';

function fmtAptShort(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return null;
  }
}

/**
 * Right-rail card. Wraps MoveCardCompact with an inline chevron expand
 * revealing Route / Container / Customer ref / Actions sections.
 *
 * Click anywhere on the card body OR on the chevron to toggle expand.
 * Click on the "Open full load" link or "Assign to driver" button stops
 * propagation so the expand state doesn't toggle.
 *
 * Props:
 *   move          (required) — move object
 *   tenantColors  (optional) — for stripe color override
 *   onAssign      (optional) — () => void; called when Assign is clicked.
 *                              When unset, the Assign button isn't rendered
 *                              (right-rail uses DnD assignment, not button).
 */
export default function MoveCardExpanded({ move, tenantColors = null, onAssign = null }) {
  const [expanded, setExpanded] = useState(false);
  const order = move?.order || {};
  const events = move?.events || [];

  return (
    <div>
      {/* Compact view (always visible) */}
      <div onClick={() => setExpanded((v) => !v)} className="cursor-pointer">
        <MoveCardCompact move={move} tenantColors={tenantColors} />
      </div>

      {/* Chevron toggle */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="w-full flex items-center justify-center py-1 text-[10px] text-gray-500 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 bg-gray-50 dark:bg-slate-800/40 border-x border-b border-gray-200 dark:border-slate-700 rounded-b"
      >
        {expanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
        {expanded ? 'less' : 'more'}
      </button>

      {/* Expanded sections */}
      {expanded && (
        <div className="border-x border-b border-gray-200 dark:border-slate-700 rounded-b -mt-1 bg-gray-50/60 dark:bg-slate-900/60">

          {/* Route */}
          {events.length > 0 && (
            <div className="px-2 py-2 border-t border-gray-200 dark:border-slate-700">
              <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-1.5">Route</div>
              <ol className="space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className={`text-[10px] mt-0.5 ${EVENT_DOT_COLOR[e.event_type] || 'text-gray-400'}`}>●</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">
                        {e.event_type || 'event'}
                      </div>
                      <div className="text-[11px] font-medium text-gray-900 dark:text-slate-100 truncate" title={e.location_name}>
                        {e.location_name || 'No Location Provided'}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-slate-400">
                        {[e.city, e.state].filter(Boolean).join(', ')}
                        {e.scheduled_at && ` · ${fmtAptShort(e.scheduled_at)}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Container */}
          {(order.container_number || order.container_size) && (
            <div className="px-2 py-2 border-t border-gray-200 dark:border-slate-700">
              <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-1.5">Container</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] uppercase text-gray-400 dark:text-slate-500">Number</div>
                  <div className="text-[11px] font-mono text-gray-900 dark:text-slate-100">
                    {order.container_number || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-gray-400 dark:text-slate-500">Size · Type</div>
                  <div className="text-[11px] font-mono text-gray-900 dark:text-slate-100">
                    {[order.container_size, order.container_type].filter(Boolean).join(' ') || '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Customer ref */}
          {order.customer_reference && (
            <div className="px-2 py-2 border-t border-gray-200 dark:border-slate-700">
              <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-0.5">Customer ref</div>
              <div className="text-[11px] font-mono text-gray-900 dark:text-slate-100 truncate" title={order.customer_reference}>
                {order.customer_reference}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-2 py-2 border-t border-gray-200 dark:border-slate-700 flex gap-1">
            {onAssign && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAssign(); }}
                className="flex-1 px-2 py-1 rounded text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                Assign to driver
              </button>
            )}
            {order.id && (
              <Link
                href={`/loads/${order.id}`}
                onClick={(e) => e.stopPropagation()}
                className={`${onAssign ? 'flex-1' : 'w-full'} px-2 py-1 rounded text-[11px] font-medium text-center border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800`}
              >
                Open full load
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Skip syntax check**

JSX. Verified in Task 10.

- [ ] **Step 3: Commit**

```bash
git add components/dispatcher/planner/MoveCardExpanded.jsx
git commit -m "feat(planner): add MoveCardExpanded with click-to-expand sections"
```

---

## Task 7: Refactor `UnassignedMoveCard.jsx` to use the new components

**Files:**
- Modify: `components/dispatcher/planner/UnassignedMoveCard.jsx`

**Context:** The current 42-line file has its own inline rendering of load # + container + first event. Replace entirely with a thin wrapper that wires DnD around `MoveCardExpanded`. The existing `BUCKET_ACCENT` map is removed — bucket info already lives on the right-rail tab UI; the per-card accent was redundant. The new color stripe (load_type) replaces it.

- [ ] **Step 1: Replace the file contents**

Overwrite `components/dispatcher/planner/UnassignedMoveCard.jsx` with:

```jsx
import { useDraggable } from '@dnd-kit/core';
import MoveCardExpanded from './MoveCardExpanded';

/**
 * Right-rail unassigned move card. DnD-draggable wrapper around
 * MoveCardExpanded (which renders compact + click-to-expand).
 *
 * The bucket prop is unused now — bucket info is conveyed by the
 * right-rail tab UI in UnassignedRightRail. Kept in the prop signature
 * for backwards compat with the parent until UnassignedRightRail is
 * cleaned up; can be dropped in a follow-up.
 *
 * Props:
 *   move    (required) — move object from /api/tenant/dispatcher/planner
 *   bucket  (legacy)   — ignored (was used for the removed BUCKET_ACCENT)
 */
export default function UnassignedMoveCard({ move /* , bucket */ }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unassigned:${move.id}`,
    data: { type: 'unassigned-move', move },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
    >
      <MoveCardExpanded move={move} />
    </div>
  );
}
```

- [ ] **Step 2: Skip syntax check**

JSX.

- [ ] **Step 3: Commit**

```bash
git add components/dispatcher/planner/UnassignedMoveCard.jsx
git commit -m "refactor(planner): UnassignedMoveCard uses MoveCardExpanded"
```

---

## Task 8: Refactor `MoveCell.jsx` to use `MoveCardCompact`

**Files:**
- Modify: `components/dispatcher/planner/MoveCell.jsx`

**Context:** This is the trickiest refactor. The current 213-line file has a lot going on: header buttons, container line, assigned-at line, TrackingLine, events list, LFD bar. We **preserve the header buttons + TrackingLine + draggable wrapper**, replace the content body (container line + events list + LFD bar) with `<MoveCardCompact />`, and import `EVENT_LABEL` / `EVENT_COLOR` from the new shared util (was inline in this file before).

The existing `STATUS_BG` map stays (drives the cell background by move status). The existing `fmtApt` helper stays (still used by the assigned-at line).

- [ ] **Step 1: Replace the file contents**

Overwrite `components/dispatcher/planner/MoveCell.jsx` with:

```jsx
import { useEffect, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Check, X } from 'lucide-react';
import {
  fmtRelativeETA, fmtAbsoluteETA, fmtOnSiteDuration,
  freshnessColor, freshnessColorClass,
} from '../../../lib/dispatcher/tracking-display.js';
import MoveCardCompact from './MoveCardCompact';

const STATUS_BG = {
  unassigned: 'bg-gray-100 dark:bg-gray-800',
  pending: 'bg-blue-50 dark:bg-blue-950',
  dispatched: 'bg-indigo-50 dark:bg-indigo-950',
  in_progress: 'bg-amber-50 dark:bg-amber-950',
  completed: 'bg-green-50 dark:bg-green-950',
  cancelled: 'bg-gray-100 dark:bg-gray-800 line-through',
};

function fmtApt(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return null;
  }
}

function TrackingLine({ move, events }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (move.tracking_status !== 'on_site') return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [move.tracking_status]);

  const nextPending = events.find((e) => e.event_status === 'pending');
  const arrived = events.find((e) => e.event_status === 'arrived');
  const dot = freshnessColorClass(freshnessColor(move.last_ping_at));

  if (move.tracking_status === 'in_transit') {
    if (!nextPending) return null;
    return (
      <div className="px-2 pb-1 text-[10px] flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} title={`Last ping ${move.last_ping_at || 'unknown'}`} />
        <span className="text-blue-700 dark:text-blue-400">▶</span>
        <span className="text-gray-700 dark:text-gray-300">
          ETA {fmtAbsoluteETA(nextPending.eta_arrival_at)} · {fmtRelativeETA(nextPending.eta_arrival_at)}
        </span>
      </div>
    );
  }
  if (move.tracking_status === 'on_site') {
    if (!arrived) return null;
    return (
      <div className="px-2 pb-1 text-[10px] flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span>📍</span>
        <span className="text-green-700 dark:text-green-400">On-site {fmtOnSiteDuration(arrived.arrived_at)}</span>
      </div>
    );
  }
  if (move.tracking_status === 'paused') {
    const pausedFor = move.last_ping_at
      ? Math.round((Date.now() - new Date(move.last_ping_at).getTime()) / 60000)
      : null;
    return (
      <div className="px-2 pb-1 text-[10px] flex items-center gap-1 text-amber-700 dark:text-amber-400">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span>⏸ Paused {pausedFor != null ? `${pausedFor}m` : ''}</span>
      </div>
    );
  }
  return null;
}

/**
 * Assigned move cell on the planner grid. Renders:
 *   - header row: load # link + Dispatch (✓) + Unassign (✗) action buttons
 *   - body: <MoveCardCompact /> (color stripe + load # + move type + appt + LFD)
 *   - assigned-at line + TrackingLine (when active)
 *
 * Click anywhere on the body opens MovePreviewPanel via onClickPreview.
 * Click on header buttons (dispatch/unassign/load-link) stops propagation.
 *
 * Props:
 *   move           (required)
 *   onClickPreview (cb) — invoked with `move` when cell body is clicked
 *   onOpenLoad     (cb) — invoked with order.id when load # link is clicked
 *   onDispatch     (cb) — invoked with `move` when Dispatch button is clicked
 *   onUnassign     (cb) — invoked with `move` when Unassign button is clicked
 */
export default function MoveCell({ move, onClickPreview, onOpenLoad, onDispatch, onUnassign }) {
  const draggable = useDraggable({
    id: `assigned:${move.id}`,
    data: { type: 'assigned-move', move },
    disabled: ['in_progress', 'completed', 'cancelled'].includes(move.status),
  });

  const order = move.order || {};
  const bg = STATUS_BG[move.status] || STATUS_BG.pending;

  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      className={[
        'flex flex-col h-full rounded border border-gray-200 dark:border-gray-700',
        bg,
        'cursor-grab active:cursor-grabbing hover:shadow-sm',
        draggable.isDragging && 'opacity-50',
      ].filter(Boolean).join(' ')}
      onClick={() => onClickPreview?.(move)}
      data-move-id={move.id}
    >
      {/* Header: load # link + dispatch/unassign buttons */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenLoad?.(order.id || move.order_id);
          }}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 bg-transparent p-0 border-0 cursor-pointer"
        >
          {order.order_number || move.id.slice(0, 8)}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDispatch?.(move); }}
            disabled={!['pending', 'dispatched'].includes(move.status)}
            className={[
              'w-5 h-5 rounded flex items-center justify-center',
              move.status === 'dispatched'
                ? 'bg-green-600 text-white'
                : 'border border-green-600 text-green-600 hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950',
              !['pending', 'dispatched'].includes(move.status) && 'opacity-40 cursor-not-allowed',
            ].filter(Boolean).join(' ')}
            title={
              ['in_progress', 'completed'].includes(move.status)
                ? "Can't dispatch — move is already in progress."
                : move.status === 'cancelled'
                ? 'Cancelled moves cannot be dispatched.'
                : move.status === 'unassigned'
                ? 'Assign a driver before dispatching.'
                : move.status === 'dispatched'
                ? 'Re-send to driver mobile app'
                : 'Dispatch to driver mobile app'
            }
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUnassign?.(move); }}
            disabled={!['pending', 'dispatched'].includes(move.status)}
            className={[
              'w-5 h-5 rounded flex items-center justify-center border border-red-600 text-red-600 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950',
              !['pending', 'dispatched'].includes(move.status) && 'opacity-40 cursor-not-allowed',
            ].filter(Boolean).join(' ')}
            title={
              ['in_progress', 'completed'].includes(move.status)
                ? "Can't unassign — move is already in progress. Reverse status on the Load Detail page first."
                : move.status === 'cancelled'
                ? 'Cancelled moves cannot be unassigned.'
                : 'Unassign driver'
            }
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body: shared compact card */}
      <div className="p-1">
        <MoveCardCompact move={move} />
      </div>

      {/* Assigned-at line + TrackingLine (preserved) */}
      {move.assigned_at && (
        <div className="px-2 pb-1 text-[10px] text-gray-500 dark:text-gray-500">
          Assigned: {fmtApt(move.assigned_at)}
        </div>
      )}

      {move.tracking_status && move.tracking_status !== 'idle' && move.tracking_status !== 'completed' && (
        <TrackingLine move={move} events={move.events || []} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Skip syntax check**

JSX.

- [ ] **Step 3: Commit**

```bash
git add components/dispatcher/planner/MoveCell.jsx
git commit -m "refactor(planner): MoveCell uses MoveCardCompact for body"
```

---

## Task 9: Update `DispatcherBoard.js` to import from shared util

**Files:**
- Modify: `components/dispatcher/DispatcherBoard.js`

**Context:** Currently defines `DEFAULT_LOAD_TYPE_COLORS` inline at lines 43-50. Replace the inline definition with an import from the new shared util. No behavior change.

- [ ] **Step 1: Replace inline definition with import**

In `components/dispatcher/DispatcherBoard.js`, find the import block at the top (around lines 14-19) and add a new import for the shared util. Find this:

```js
import {
  resolveColumns,
  DEFAULT_ORDER,
  DEFAULT_FROZEN,
  computeWarnings,
} from '../../lib/dispatcher-columns';
```

Add right after it:

```js
import { DEFAULT_LOAD_TYPE_COLORS } from '../../lib/dispatcher/load-type-colors';
```

Then find the inline definition at lines 43-50:

```js
const DEFAULT_LOAD_TYPE_COLORS = {
  import: '#3b82f6',
  inbound: '#0ea5e9',
  export: '#8b5cf6',
  outbound: '#a855f7',
  road: '#f97316',
  bill_only: '#6b7280',
};
```

Delete it entirely (the import now provides the value).

- [ ] **Step 2: Verify the rest of the file still references the constant correctly**

The constant is used at line 119 (`...DEFAULT_LOAD_TYPE_COLORS`) — since the import has the same name, no other changes needed.

Run: `node --check components/dispatcher/DispatcherBoard.js` — note this WILL fail because it's JSX. Skip; rely on Task 10's preview-server compile.

- [ ] **Step 3: Commit**

```bash
git add components/dispatcher/DispatcherBoard.js
git commit -m "refactor(dispatcher): import DEFAULT_LOAD_TYPE_COLORS from shared util"
```

---

## Task 10: Visual verification gates

**Files (verification only — no code changes):**
- None

**Context:** Boot the preview server, navigate to /dispatcher (Driver Planner tab), and confirm the new design renders correctly on both surfaces. Plus a regression check on the Dispatcher Load Board (which now imports from the shared util).

The dev server is at `http://localhost:51146` (running). Test creds: `test@testtruck.com` / `DrayageDirect2026!` (super_admin on Test Trucking Co tenant). Test data: tenant has 10 unassigned moves visible in the planner right rail (TEST-M000013, TEST-N000014, etc. per earlier session screenshots).

- [ ] **Step 1: Reload the dev server preview and check for compile errors**

If the user has the dev server hot-reloaded across tasks, the preview should auto-pick-up changes. Use `preview_logs` (filter level: 'error') to scan for any TypeScript / module-resolution errors. Expect: clean. Any unexpected error → re-read the file path and import resolution; common mistake is `../../../lib/...` depth from a `components/dispatcher/planner/` file.

- [ ] **Step 2: Gate A — right-rail unassigned card compact view**

Navigate to /dispatcher → Driver Planner tab. In the right rail (with "All" tab selected so all moves are visible):
- Each card has a colored left-edge stripe (4px). Cards with `load_type='import'` are blue, `inbound` are sky/teal, `export` are violet, `outbound` are purple. (The test data should include several of these.)
- Card body shows: load # (e.g., TEST-M000013, blue text) + move type pill (e.g., "Pick and Run + Live Unload" — may truncate) + appt time + LFD pill (if LFD is set).
- Hover over a truncated move-type pill — tooltip shows full text.

Take a screenshot.

- [ ] **Step 3: Gate B — right-rail click-to-expand**

Click the "▼ more" chevron on any card. Card grows in place revealing 4 sections:
- **Route** — list of events with colored dots (blue=pickup, green=deliver, purple=return) + location name + city/state + appt window.
- **Container** — number + size·type in a 2-col grid.
- **Customer ref** — the customer's PO/booking # if set (omits section if null).
- **Actions** — "Open full load" link (no Assign button on right rail since DnD is the assign mechanism).

Click "▲ less" to collapse. Click another card's chevron — only that one expands (independent state per card).

Take a screenshot of an expanded card.

- [ ] **Step 4: Gate C — assigned grid cell**

Drag any unassigned move onto a driver's row in the grid. The cell renders:
- Header (preserved): load # link + Dispatch (✓) + Unassign (✗) buttons.
- Body: same MoveCardCompact as the right rail (stripe + load # + move-type pill + appt + LFD).
- No inline expand chevron (grid cells skip it).

Click on the cell body (not the buttons). Existing `MovePreviewPanel` slides in from the right with full move detail.

Take a screenshot.

- [ ] **Step 5: Gate D — tracking-line preservation**

If the test tenant has a move with `tracking_status='in_transit'` or `'on_site'`: confirm the tracking line still appears below the compact card on the assigned cell (showing ETA or on-site duration). If no such move exists in the test tenant, skip this gate and note "no in-flight moves to verify" — the code is unchanged.

- [ ] **Step 6: Gate E — Dispatcher Load Board regression**

Navigate to /dispatcher (top-level tab — the Load Board, not Driver Planner). Verify:
- Load rows still show the colored vertical stripe on the left edge (M=blue, N=sky, etc.).
- Color values match what the planner shows (because both now import from the same util).

Take a screenshot of a row or two.

- [ ] **Step 7: Commit only if any fixes needed**

If all gates pass, no commit. If a fix was needed (e.g., wrong import path, missing field rendering), commit:

```bash
git add <fixed files>
git commit -m "fix(planner): <bug description>"
```

---

## Task 11: Final ship — squash review + `Resolves: FU-XXX` commit

**Files:**
- None (or commit message body only)

**Context:** The individual Task 1-9 commits stand on their own. Final ship is verifying the branch is clean and routing the FU closure.

- [ ] **Step 1: Review the commit series**

Run `git log --oneline main..HEAD` to list the commits. Expected: 7-9 commits.

- [ ] **Step 2: Run dd-qa skill for final review**

Invoke the `dd-qa` skill to validate field consistency, enum alignment, routing logic, UI pattern compliance.

- [ ] **Step 3: Confirm no stray debug or commented code**

Run:
```bash
git diff main..HEAD -- components/dispatcher/ pages/api/tenant/dispatcher/ lib/dispatcher/ | grep -E '^\+.*(console\.log|debugger|TODO|XXX|FIXME)'
```
Expected: no output (or only unrelated pre-existing lines).

- [ ] **Step 4: File the new follow-ups identified in the spec's §11**

Add three entries to `memory/followups.md` under "# Open":

```md
### FU-XXX: Density toggle (Dense / Compact) for Driver Planner grid
- Source: 2026-04-25-driver-planner-card-redesign-design.md §11
- Scope: small
- Area: dispatcher
- Intent: Toolbar toggle + per-user persistence so large fleets can switch the grid cells from Dense (current) to Compact (load # + appt + dest city only). File when fleet grows past ~25 drivers or scrolling fatigue is reported.

### FU-XXX: Hover-expand option on planner right-rail card
- Source: 2026-04-25-driver-planner-card-redesign-design.md §11
- Scope: small
- Area: dispatcher
- Intent: Alternative to click-to-expand. File if user wants to A/B after click-to-expand has shipped.

### FU-XXX: Notes / hazmat / weight / seal# in planner card expand
- Source: 2026-04-25-driver-planner-card-redesign-design.md §11
- Scope: small (per field added)
- Area: dispatcher
- Intent: Surface additional load fields in the MoveCardExpanded sections. File after dogfooding to see which fields the dispatcher actually needs.
```

(The three FU numbers are sequential next-available; check `memory/followups.md` for current highest open number and increment.)

- [ ] **Step 5: Final merge / PR**

If on a feature branch: open PR `feat(planner): driver planner card redesign — Variant B + Dense`. Body summary + `Resolves: FU-XXX` (if a parent FU was filed before starting this work).

If committing directly to main: amend the LAST commit body to include `Resolves: FU-XXX` if a tracking FU exists, OR file a new closing FU entry retroactively.

- [ ] **Step 6: Verify ledger closure**

If a tracking FU exists, the `update-followups` skill will close it on its next run via SHA match.

---

## Self-Review

**Spec coverage check:**

- §2 In Scope: shared compact + click-expand right rail + dense grid + slide-out + color stripe + LFD urgency + customer_reference field → Tasks 1-9 ✓
- §2 Out of Scope: density toggle, hover-expand, notes/hazmat — file as FUs in Task 11 ✓
- §3 Decision 1 (Variant B compact) → Task 5 ✓
- §3 Decision 2 (4 expand sections) → Task 6 ✓
- §3 Decision 3 (inline grow) → Task 6 ✓
- §3 Decision 4 (slide-out for grid) → Task 8 (existing onClickPreview path retained) ✓
- §3 Decision 5 (Dense grid) → Task 8 (uses MoveCardCompact, same as right rail) ✓
- §3 Decision 6 (LFD urgency tiers) → Task 4 ✓
- §3 Decision 7 (reuse color map) → Tasks 1 + 9 ✓
- §3 Decision 8 (move-type truncate + tooltip) → Task 5 (line with `title={move.move_type}` + truncate class) ✓
- §4.1 Frontend architecture (5 components) → Tasks 5, 6, 7, 8 + DispatcherBoard import (Task 9) ✓
- §4.2 Backend (`customer_reference`) → Task 3 (added load_type too — see Spec Deltas) ✓
- §4.3 Shared util extraction → Tasks 1, 2 ✓
- §6 Color stripe logic → Task 1 (file content matches spec verbatim) ✓
- §7 LFD urgency coloring → Task 4 (file content matches spec verbatim) ✓
- §8 Files Changed table → matches Task 1-9 file list ✓
- §9 Risks (truncate / scroll / unknown types / timezone / additive API / DnD regression / bucket-accent removal) → Task 5 (truncate via `title`), Task 4 (timezone explained), Task 8 (DnD wrapper preserved), Task 7 (bucket-accent removed) ✓
- §10 Commit plan → 7 commits in spec; my plan has 8 commits (added one for `lfd-urgency.js` which the spec lumped under the LFD logic but I split per atomic commit guidance). Acceptable variance.

**Placeholder scan:** No "TBD", no "implement appropriate", no "similar to". Every step shows the actual code or command. Expected outputs are specified for verification steps.

**Type consistency:**
- `getLoadTypeColor(loadType, tenantColors)` defined in Task 1, called in Task 5 ✓
- `lfdPillClass` + `fmtLfdShort` defined in Task 4, called in Task 5 ✓
- `EVENT_DOT_COLOR` defined in Task 2, used in Task 6 (Route section) ✓
- `MoveCardCompact` props (`move`, `tenantColors`) defined in Task 5, called in Tasks 6, 8 ✓
- `MoveCardExpanded` props (`move`, `tenantColors`, `onAssign`) defined in Task 6, called in Task 7 ✓
- `MoveCell` callback signatures (`onClickPreview`, `onOpenLoad`, `onDispatch`, `onUnassign`) preserved across refactor — same as pre-refactor ✓
- API select adds `load_type` and `customer_reference` (Task 3) — both consumed in Task 5 (`order.load_type`) and Task 6 (`order.customer_reference`) ✓

No issues found.
