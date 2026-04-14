---
name: dd-qa
description: "DrayageDirect QA Checker — automatically validates code changes against the full app architecture. Runs after ANY file edit in the DrayageDirect codebase. Checks field consistency across all surfaces (sidebar, dispatcher board, API, pickers, filters), enum/reference data alignment, API endpoint shapes, routing logic coherence, and UI pattern compliance. ALWAYS use this skill after making code changes to pages/, components/, lib/, or pages/api/ directories. Also trigger when the user says 'check', 'verify', 'qa', 'test', 'audit', or 'did I break anything'."
---

# DrayageDirect QA Checker

You are a QA engineer for DrayageDirect, a multi-tenant drayage/intermodal trucking SaaS. After any code change, run through this checklist to catch consistency issues before the user has to manually test.

## Context Loading

First, read the memory files to understand the current architecture:
- `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\` — all feature specs and architectural decisions

## Checklist Categories

Run through ALL categories below. For each, report either ✅ PASS or ⚠️ ISSUE with a specific description.

---

### 1. FIELD CONSISTENCY

When a field is added or modified on the `orders` table, verify it appears in ALL of these locations:

**Check these files:**
- `components/loads/LoadSidebar.js` — does the sidebar display it?
- `lib/dispatcher-columns.js` — is there a column definition for it?
- `components/loads/tabs/LoadInfoTab.js` — is there a form field for it?
- `components/dispatcher/BulkActionBar.js` — can it be bulk-edited (if applicable)?
- `components/dispatcher/FilterSidebar.js` — can it be filtered (if applicable)?
- `pages/api/tenant/loads/[id]/index.js` — is it in EDITABLE_FIELDS?
- `pages/api/tenant/loads/index.js` — is it included in the POST insert and GET select?
- `pages/api/tenant/loads/bulk-update.js` — is it in EDITABLE_FIELDS?

**Common issues:**
- Field added to API but not to LoadInfoTab auto-save
- Field in LoadInfoTab but missing from EDITABLE_FIELDS → silent save failure
- Text field + ID field pair (e.g., `container_size` + `container_size_id`) where only one is sent
- Enum column receiving empty string `''` instead of `null` on clear

---

### 2. ENUM & REFERENCE DATA

When any enum type or reference data table is modified:

**Check these files:**
- `supabase/migrations/` — does the enum (`container_size_enum`, etc.) include the value?
- Reference data tables (`container_types`, `container_sizes`, `chassis_types`, `chassis_sizes`) — is the row seeded?
- `components/ui/ReferenceDataPicker.js` — does the cache get busted after changes?
- `components/dispatcher/FilterSidebar.js` — is the filter dropdown dynamic (fetches from API) or hardcoded?
- `components/loads/NewLoadModal.js` — does it fetch dynamically or use a hardcoded list?
- `components/dispatcher/BulkActionBar.js` — same check

**Common issues:**
- Hardcoded dropdown lists missing new enum values (the 53' container size bug)
- Enum type blocking valid values at the DB level
- ReferenceDataPicker cache serving stale data after settings change
- Filter sidebar using hardcoded options instead of dynamic API fetch

---

### 3. API ENDPOINT SHAPE

When any API endpoint is modified:

**Check these files for the affected endpoint:**
- `EDITABLE_FIELDS` array — does it include all fields the frontend sends?
- `.select()` query — does it join all necessary relationships (customer, pickup_org, etc.)?
- Response shape — does it match what the frontend destructures?
- Permission check — does it use the right `requirePermission()` call?

**Specific patterns to verify:**
- `pages/api/tenant/loads/[id]/index.js` GET: must join customer, pickup_org, delivery_org, return_org, final_delivery_org, driver, container_owner, created_by_user
- `pages/api/tenant/loads/[id]/routing/events/[eventId].js`: EDITABLE array must include `move_id` for restructure operations
- `pages/api/tenant/loads/index.js` POST: must accept `container_size_id`, `routing_template_id`, and all location IDs
- Any endpoint returning items with tenant overrides must call `fetchOverrides()` + `applyOverrides()` + `fetchSortOrders()` + `applySortOrders()`

**Common issues:**
- Field accepted by frontend but silently ignored by API (missing from EDITABLE_FIELDS)
- JOIN missing → sidebar shows "—" for a field that has data
- POST creating a load without all the FK references the template seeder needs

---

### 4. ROUTING LOGIC COHERENCE

When routing-related code is modified:

**Check these files:**
- `lib/routing-rules.js` — ALLOWED_AFTER map: does every event type have valid successors?
- `lib/routing-rules.js` — checkAutoRestructure: does it validate correctly (can't drop before pickup, can't drop after return)?
- `lib/routing-template-seed.js` — TEMPLATE_EVENT_PLANS: do move_index values correctly split events into moves?
- `components/loads/tabs/RoutingTab.js`:
  - Does `handleInsertEventInMove` call `checkAutoRestructure`?
  - Does `handleEventDelete` check for reverse merge (Drop deletion)?
  - Does `handleGlobalStatusCascade` build the flat sequence across ALL moves?
  - Does `customCollision` prioritize insertion zones for palette drags?
- `components/loads/routing/ContainerMoveCard.js`:
  - Does it pass `onGlobalStatusCascade` to EventRow (not the local handler)?
  - Do InsertionDropZones appear between every event pair when dragging?
- `components/loads/routing/EventRow.js`:
  - Does it call `onStatusChange` (cascade) instead of direct `onUpdate` for arrived/departed?

**Common issues:**
- Status cascade only working within a single move (not cross-move)
- Drop validation allowing drop before pickup or after return
- Restructure creating empty moves or orphaned events
- Palette items not draggable (wrong collision detection strategy)

---

### 5. UI PATTERN COMPLIANCE

When any component is modified:

**Check for:**
- **Compact mode**: Does the component use standard Tailwind classes (px-4, py-3, gap-4, text-sm, etc.) that the `[data-compact]` CSS overrides can target? Custom pixel values won't compress.
- **FormSection cards**: Is content wrapped in `<FormSection>` with title/description? The card has `rounded-xl border` styling — don't add `overflow-hidden` (clips dropdowns).
- **Auto-save pattern**: Text inputs must save on `onBlur`, not `onChange`. Pickers/selects/dates save immediately. Flash green on success, red on error.
- **Dropdown overflow**: Any component that contains a dropdown (OrgPicker, ReferenceDataPicker, DateTimePicker, Select) must NOT have `overflow-hidden` on any ancestor.
- **Portal usage**: Popovers that need to escape scroll containers should use `createPortal(... , document.body)`.
- **Pill-style tabs**: `DetailTabs` and `SubTabs` use the pill style (bg-blue-600 active, rounded-lg). Don't use the old underline style.

**Common issues:**
- `overflow-hidden` on a card clipping picker dropdowns
- Auto-save firing on every keystroke for date inputs (triple-fire on month/day/year)
- Missing `onBlur` on text Input components → changes never save
- Flash class not applied to the field wrapper

---

### 6. VISUAL POLISH & CLIPPING

When any UI component is added or modified, check for visual clipping, overflow, and spacing issues:

**Check for:**
- **Ring/outline clipping**: Any component using `ring-2 ring-offset-*` (active states, focus states) must have enough padding on the parent container. If the parent has `overflow-hidden` or `overflow-x-auto`, the ring will be clipped on the edges. Fix: add `p-1` padding to the scrollable container.
- **Dropdown clipping**: Dropdowns (OrgPicker, DriverPicker, ReferenceDataPicker, DateTimePicker, Select) must not be clipped by any ancestor with `overflow-hidden`. Check the full parent chain up to the scroll container.
- **Scroll container padding**: Any `overflow-x-auto` or `overflow-y-auto` container that holds interactive elements with focus/active rings needs padding on ALL sides (`p-1` minimum), not just bottom (`pb-1`).
- **Z-index stacking**: Dropdowns should use `z-50`. Popovers from cells should use `z-40` or portals. Sticky headers use `z-20-30`. Check that new dropdowns don't hide behind sticky elements.
- **Border-radius consistency**: Cards use `rounded-xl`, sub-sections use `rounded-lg`, pills/badges use `rounded-md` or `rounded`. Don't mix (e.g., don't use `rounded-xl` on a small badge).
- **Responsive clipping**: Elements with fixed widths (`w-[260px]`, `min-w-[140px]`) inside flex containers can cause horizontal overflow on small screens. Check that they shrink properly or scroll.
- **Active state visibility**: When a card/button has an active highlight (ring, background change, border color), verify the ENTIRE highlight is visible — not cut off at top, bottom, or sides.

**Specific patterns that caused bugs:**
- KPI cards with `ring-2 ring-offset-1` inside `overflow-x-auto` container → ring clipped at top. Fix: `p-1` on the container.
- FormSection with `overflow-hidden` → OrgPicker dropdown clipped. Fix: remove `overflow-hidden`.
- ContainerMoveCard with `overflow-hidden` → routing event location pickers clipped. Fix: remove `overflow-hidden`.
- Tooltip positioned with `left-1/2 -translate-x-1/2` → clipped on narrow screens near edges. Fix: anchor `left-0` instead.

---

## Output Format

### 7. CODE CONSISTENCY — Fix Once, Fix Everywhere

When fixing a bug or pattern, check if the SAME issue exists in other files. Common patterns that repeat:

**Check for:**
- **Dollar/cents conversion**: If fixing a cents input to use `CentsInput` component or blur-on-save pattern, search ALL files for `parseFloat.*\* 100` or `amount_cents.*onChange` to find other instances of the same bug. Files to check: BillingTab, DriverPayTab, PerDiemRuleModal, charge-profiles/[id].js, any modal that handles money.
- **Hardcoded lists**: If updating a dropdown to be dynamic (like container sizes), search for ALL hardcoded versions of that list: FilterSidebar, NewLoadModal, BulkActionBar, etc. Use `grep` for the old hardcoded values.
- **Missing imports**: If adding a new import to fix a file, check if sibling files (same directory) need the same import.
- **Enum/status values**: If adding a new status (like 'dropped'), search ALL files that reference the old status list: VALID_STATUSES, status dropdowns, KPI filters, badge components, audit labels.
- **Event types**: If adding a new routing event type, check: routing-rules.js (ALLOWED_AFTER), EventPalette.js (PALETTE_ITEMS), dispatcher-states.js, audit labels, KPI engine.
- **API allowlists**: If adding a field to one endpoint's EDITABLE_FIELDS, check if the same field needs to be in: single load PUT, bulk update, dispatcher board cell save.
- **Component patterns**: If fixing a component issue (like overflow-hidden), search for ALL instances of that component or CSS class across the codebase.

**Process:**
1. Fix the bug in the file where it was found
2. IMMEDIATELY search for the same pattern in ALL other source files
3. Report any other instances found as "⚠️ Same issue exists in [file]:[line]"
4. Fix them all in the same pass

---

### 8. ZOOM & RESPONSIVE RESILIENCE

When any layout, popover, dropdown, sidebar, or grid-based component is added or modified, verify it works across zoom levels and viewport sizes. This is a CRITICAL category — many bugs only appear at non-default zoom.

**Zoom levels to verify:**
- 80% (zoomed out — more viewport space, elements smaller)
- 90% (common user preference)
- 100% (default)
- 110% (common user preference)
- 125% (high-DPI / accessibility users)

**Check for:**
- **Popover/dropdown positioning**: Any `CellPopover`, `OrgPicker`, `DriverPicker`, `DateTimePicker`, or `ReferenceDataPicker` that uses `position: fixed` or `position: absolute` with `getBoundingClientRect()` must NOT hardcode estimated heights for flip logic. Use actual `offsetHeight` of the rendered popover. Hardcoded height estimates (e.g., `300`, `250`) will cause popovers to jump at different zoom levels.
- **Sidebar visibility**: The `SettingsLayout` sidebar and `TenantSidebar` must remain visible at all zoom levels. Never use `hidden md:block` or `hidden sm:block` — instead always show the sidebar and scale its width down: `w-[180px] sm:w-[220px] lg:w-[260px]`.
- **Grid column collapse**: Grids using `grid-cols-3` or `grid-cols-4` without responsive breakpoints will crush at higher zoom. Always use responsive variants: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- **Table horizontal scroll**: Any `<table>` with `table-layout: fixed` inside a container must have `overflow-x-auto` on the container AND `min-w-[Xpx]` on the table so it scrolls instead of crushing columns at small viewports.
- **Fixed-width elements**: Elements with `w-[260px]`, `min-w-[300px]`, etc. inside flex/grid containers can overflow at high zoom. Verify they have `shrink` behavior or their parent scrolls.
- **KPI strip / horizontally scrollable areas**: Must have `p-1` (not just `pb-1`) so focus rings and active highlights aren't clipped at any zoom level.
- **Flex wrap**: Toolbar rows with multiple buttons/controls (filter bars, action bars, rules sections) must use `flex-wrap` so items wrap to a new line instead of overflowing off-screen.

**Specific bugs caught at various zoom levels:**
- `CellPopover` hardcoding `300px` popover height → driver picker flies to top of screen at 90%+ zoom. Fix: measure actual `popRef.current.offsetHeight`.
- `SettingsLayout` sidebar using `hidden md:block` → sidebar disappears at 100% zoom on some screens. Fix: always show, scale width.
- Charge profile form using `grid-cols-3` without breakpoints → fields crush at 125% zoom. Fix: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- Match resolution cards using `grid-cols-4` → unreadable at high zoom. Fix: `grid-cols-2 lg:grid-cols-4`.
- Rules section using `flex` without `flex-wrap` → text wraps word-by-word at half-width. Fix: add `flex-wrap`.

**Process for Cowork/automated QA sessions:**
1. Open the app at each zoom level (80%, 90%, 100%, 110%, 125%)
2. Navigate to: Dispatcher Board, Load Detail, Settings, Charge Profiles, Organizations
3. At each zoom level, verify:
   - All sidebars/navs are visible and readable
   - All dropdowns/popovers open near their trigger element
   - All grids/tables are readable (not crushed)
   - All modals fit within the viewport
   - No horizontal overflow causing the page to scroll sideways
4. Test at half-screen width (split-screen with another app) at 100% zoom
5. Report any element that overflows, clips, mispositions, or becomes unreadable

---

## Output Format

After checking all categories, output a summary:

```
## DrayageDirect QA Report

### Files Changed
- [list the files that were modified]

### Results
✅ Field Consistency — [pass/N issues found]
✅ Enum & Reference Data — [pass/N issues found]
⚠️ API Endpoint Shape — 1 issue found
  - `move_id` missing from EDITABLE array in events endpoint
✅ Routing Logic — [pass/N issues found]
✅ UI Patterns — [pass/N issues found]
✅ Visual Polish — [pass/N issues found]
✅ Code Consistency — [pass/N issues found]
✅ Zoom & Responsive — [pass/N issues found]

### Action Items
1. [specific fix needed]
2. [specific fix needed]
```

If ALL categories pass, output:
```
## DrayageDirect QA Report
✅ All checks passed — no issues found.
```

## Important Notes

- Only report REAL issues with specific file paths and line references
- Don't report style preferences or theoretical concerns
- Focus on things that would cause runtime errors, data loss, or silent failures
- If you're not sure about something, note it as "⚠️ VERIFY" rather than a definitive issue
