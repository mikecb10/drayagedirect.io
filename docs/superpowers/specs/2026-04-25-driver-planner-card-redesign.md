# Driver Planner Card Redesign — Design

**Status:** Design approved 2026-04-25 (brainstorm)
**Predecessor:** Driver Planner v1 (shipped 2026-04-24, commit `2f97f68`, migrations 090+091)
**Related:** Load Board's `DEFAULT_LOAD_TYPE_COLORS` ([DispatcherBoard.js:43](components/dispatcher/DispatcherBoard.js))

## 1. Goal

Replace the current low-density Driver Planner cards (load # + container # only) with information-dense cards that surface the fields a dispatcher actually scans for when assigning moves: move type, appointment window, LFD urgency, route, container details. Use the existing tenant-overridable load-type color map so visual identity is consistent with the Load Board.

## 2. Scope

**In scope**

- New shared compact card component used on both the right-rail unassigned panel AND the assigned grid cells.
- Right-rail card adds a click-to-expand chevron that grows the card in place to reveal Route / Container / Customer ref / Actions sections.
- Grid cells use the same compact view, click → existing `MovePreviewPanel` slide-out for full detail (no inline expand — too cramped).
- Load-type color stripe on the left edge of every card, sourced from the existing `DEFAULT_LOAD_TYPE_COLORS` map (extracted to a shared util).
- LFD urgency coloring on the LFD pill: red if past, amber if today/tomorrow, neutral otherwise.
- One field added to the planner endpoint's response: `customer_reference` (everything else is already on the wire).

**Out of scope (deferred — to be filed as future FUs)**

- Density toggle (Dense / Compact) in the planner toolbar — file when fleet grows past ~25 drivers.
- Hover-only expand on the right rail (currently click-only). Easy to add later if the user requests.
- Notes / hazmat flags / weight / seal# inside the expand — revisit after dogfooding.
- Custom color override per load_type via a NEW planner UI — already exists at `/settings/dispatcher-colors`.

## 3. Design Decisions (resolved during brainstorming)

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Compact card primary fields | **Variant B (Type + Time)** | User scans the planner by what kind of work + urgency. Move type pill + appt time + LFD give the actionable signal at a glance. |
| 2 | Expand-section content | Route / Container / Customer ref / Actions | Covers the 90% of cases where dispatcher needs more info but doesn't want to navigate to the load detail page. |
| 3 | Expand interaction (right rail) | **Click chevron, inline grow** | Persistent until clicked again. Hover would be twitchy when scrolling the panel. |
| 4 | Expand interaction (grid cell) | **Click → existing `MovePreviewPanel` slide-out** | Cells are too narrow for inline expand without overflowing the row. |
| 5 | Grid cell density | **Dense (matches right rail)** | Visual consistency, single-component reuse. Acceptable for fleets ≤25 drivers; density toggle deferred until needed. |
| 6 | LFD coloring | **Urgency tiers**: red (past) / amber (today or tomorrow) / neutral (>1 day out) | Visual urgency without adding extra UI chrome. |
| 7 | Color map source | **Reuse `DEFAULT_LOAD_TYPE_COLORS` from DispatcherBoard** | Tenant overrides via `/settings/dispatcher-colors` already plumbed; one source of truth. |
| 8 | Move-type pill overflow | **Truncate with `title` tooltip** | Move type strings can be long ("Inbound — Pick and Run + Live Unload"). Truncation keeps card height stable; tooltip preserves access to full text. |

## 4. Architecture

### 4.1 Frontend

```
components/dispatcher/planner/
  MoveCardCompact.jsx        ← NEW: shared compact view (used by both surfaces)
  MoveCardExpanded.jsx       ← NEW: right-rail expand wrapper (chevron + 4 sections)
  UnassignedMoveCard.jsx     ← REWRITE: thin wrapper over MoveCardCompact + MoveCardExpanded
  MoveCell.jsx               ← REFACTOR: replace internal markup with MoveCardCompact + click-to-slideout
  MovePreviewPanel.jsx       ← (unchanged — already slide-out)
```

#### `MoveCardCompact.jsx` (new, ~80 LoC)

Pure presentational. Takes a `move` prop and renders the compact view:

```jsx
<MoveCardCompact move={move} />
```

Internal layout (top-to-bottom):
1. Color stripe on left edge (4px wide), color from `getLoadTypeColor(move.order.load_type, tenantColors)`.
2. Header row: `<order_number>` (blue, bold) + `<customer.name>` (muted).
3. Move-type pill row: `<move_type>` truncated with `title` attr.
4. Time row: `📅 <events[0].scheduled_at formatted>` + `<LFD pill>` with urgency color.

Props:
- `move` (required) — the move object from the planner API.
- `tenantColors` (optional) — override map; falls back to defaults.

No state, no effects. Memoize via `React.memo` since the right rail + grid will re-render frequently during DnD.

#### `MoveCardExpanded.jsx` (new, ~120 LoC)

Wraps `MoveCardCompact` with the chevron + expandable detail sections. Right-rail-only.

State: `const [expanded, setExpanded] = useState(false);`

Expand section structure (inside the same outer card, separated by `border-t`):
- **Route** — list of all `move.events` rendered as colored dots + location_name + city/state + appt window. Color dots use existing `EVENT_COLOR` map already in `MoveCell.jsx` (extract to shared too — see §5).
- **Container** — `container_number` + `container_size · container_type` in a 2-col mini-grid.
- **Customer ref** — `order.customer_reference` if present (omit section entirely if null).
- **Actions** — two buttons: "Assign to driver" (emits onAssign), "Open full load" (Next.js `<Link>` to `/loads/[id]`).

Props:
- `move` (required)
- `onAssign` (optional callback) — when set, the "Assign to driver" button fires this; when unset, the button isn't rendered.
- `tenantColors` (optional)

#### `UnassignedMoveCard.jsx` (rewrite, ~30 LoC after rewrite)

Becomes a thin wrapper that adds the DnD draggable behavior + right-rail-specific spacing around `MoveCardExpanded`. The bucket-accent border-left (the existing `BUCKET_ACCENT` map for atPort/deliveries/return/other) is REPLACED by the load-type color stripe — bucket info already shown via the right-rail tab UI ([UnassignedRightRail.jsx](components/dispatcher/planner/UnassignedRightRail.jsx)), so the per-card accent is redundant.

#### `MoveCell.jsx` (refactor, drops ~80 LoC)

Replace the internal event-badge rendering with `<MoveCardCompact move={move} />`. The cell stays draggable (DnD wrapping unchanged), and click handler triggers the existing `MovePreviewPanel` slide-out via the same callback path it does today.

The `EVENT_COLOR` constant currently inline in `MoveCell.jsx:18-28` moves to the shared util (it's also used by `MoveCardExpanded`'s Route section).

### 4.2 Backend

#### `pages/api/tenant/dispatcher/planner/index.js` — one-line select tweak

Find the orders select around line 70 and add `customer_reference`. No new query, no migration, no RPC. Verify the column already exists on `orders` (it does — see [feature_accounts_receivable.md](memory/feature_accounts_receivable.md)'s `reference_number`↔`customer_reference` alias convention).

### 4.3 Shared utility extraction

```
lib/dispatcher/
  load-type-colors.js        ← NEW: DEFAULT_LOAD_TYPE_COLORS + getLoadTypeColor(loadType, tenantColors)
  event-colors.js            ← NEW: EVENT_COLOR map (pickup/deliver/return/etc.)
```

`DispatcherBoard.js:43-50` updates to import from `lib/dispatcher/load-type-colors.js` instead of defining inline. No behavior change there — just deduplication.

## 5. Data Flow

```
Planner API (/api/tenant/dispatcher/planner)
  └─> moves[].order { order_number, customer.name, container_number, container_size,
                       container_type, last_free_day, load_type, customer_reference★ }
  └─> moves[].move_type (free-form text)
  └─> moves[].events[] { event_type, location_name, city, state, scheduled_at, ... }
       │
       ├─> right rail: MoveCardExpanded → MoveCardCompact + chevron expand sections
       └─> grid cell:  MoveCardCompact + click handler → MovePreviewPanel slide-out

★ = new field added to API select
```

## 6. Color stripe logic

```js
// lib/dispatcher/load-type-colors.js
export const DEFAULT_LOAD_TYPE_COLORS = {
  import:    '#3b82f6',
  inbound:   '#0ea5e9',
  export:    '#8b5cf6',
  outbound:  '#a855f7',
  road:      '#f97316',
  bill_only: '#6b7280',
};

export function getLoadTypeColor(loadType, tenantColors = null) {
  const map = { ...DEFAULT_LOAD_TYPE_COLORS, ...(tenantColors?.load_type_colors || {}) };
  return map[loadType] || '#d1d5db'; // gray-300 fallback for unknown/null
}
```

## 7. LFD urgency coloring

```js
function lfdPillClass(lfdDateString) {
  if (!lfdDateString) return null; // hide pill if no LFD
  const lfd = new Date(lfdDateString);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  if (lfd < today) return 'bg-red-900/40 text-red-200';        // past
  if (lfd <= tomorrow) return 'bg-amber-900/40 text-amber-200'; // urgent
  return 'bg-slate-800 text-slate-300';                          // neutral
}
```

## 8. Files Changed

| File | Change | Approx LoC |
|---|---|---|
| `lib/dispatcher/load-type-colors.js` | New | +20 |
| `lib/dispatcher/event-colors.js` | New | +15 |
| `components/dispatcher/planner/MoveCardCompact.jsx` | New | +80 |
| `components/dispatcher/planner/MoveCardExpanded.jsx` | New | +120 |
| `components/dispatcher/planner/UnassignedMoveCard.jsx` | Rewrite | -42 → +30 (net -12) |
| `components/dispatcher/planner/MoveCell.jsx` | Refactor | -60 → +20 (net -40) |
| `components/dispatcher/DispatcherBoard.js` | Import shared color map | -8 → +2 |
| `pages/api/tenant/dispatcher/planner/index.js` | Add `customer_reference` to orders select | +1 |
| `lib/dispatcher/moveBuckets.js` | (unchanged — bucket logic stays) | 0 |

**Net:** ~+200 LoC across 8 files (mostly the two new component files). Zero migrations. Zero new API endpoints.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Move type strings exceed pill width | Truncate via CSS + `title` attr for hover tooltip; never wrap. |
| Dense grid cells become scroll-heavy at 25+ drivers | Density toggle deferred to a future FU. UI gracefully degrades — taller cells just mean more scrolling, not breakage. |
| Tenant overrides for unknown load_type values | `getLoadTypeColor` falls back to gray-300 for unknown types. |
| LFD timezone math edge cases | `last_free_day` is stored as a date (no time); compare against local-midnight today. No timezone surprises since we never inspect times. |
| `customer_reference` API change breaks existing planner consumers | Additive — same response shape with one new optional field. No existing consumer reads from `customer_reference` today on this endpoint. |
| Refactor of `MoveCell.jsx` introduces DnD regression | Keep the outer DnD wrapper untouched; only the inner content block changes. Verify drag-drop still works in Chrome gates. |
| Bucket-accent removal from right rail (`BUCKET_ACCENT`) loses visual cue | Bucket info is already conveyed by the right-rail tab the user is on (At Port / Deliveries / Return / Other). Per-card accent was redundant. |

## 10. Commit Plan

Single feature branch with ~7 small commits, squash-merged to main:

1. `feat(dispatcher): extract DEFAULT_LOAD_TYPE_COLORS to shared util`
2. `feat(dispatcher): extract EVENT_COLOR to shared util`
3. `feat(planner-api): expose customer_reference on orders select`
4. `feat(planner): add MoveCardCompact shared component`
5. `feat(planner): add MoveCardExpanded with click-to-expand sections`
6. `refactor(planner): UnassignedMoveCard uses MoveCardExpanded`
7. `refactor(planner): MoveCell uses MoveCardCompact`

Final squash-merge body includes `Resolves: FU-XXX` once filed.

## 11. Out-of-scope follow-ups (to file as new FUs after spec approval)

- **Density toggle in planner toolbar** — Dense / Compact view switch with per-user persistence. File when fleet grows past ~25 drivers, or when the user reports scrolling fatigue.
- **Hover-expand on right rail** — alternative interaction model; file if the user wants to test it after click-expand has shipped.
- **Notes / hazmat / weight / seal# in expand** — additional fields. File after dogfooding to see what's actually needed.
