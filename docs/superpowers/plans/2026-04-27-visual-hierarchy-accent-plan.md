# Visual Hierarchy Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve FU-121's "monochromatic dark mode" complaint with two surgical fixes: bump the umbrella editor's `GROUP_ACCENT_PALETTE` body tint from imperceptible (`/10`) to visibly distinct (`/65`), and migrate `components/loads/NewLoadModal.js` onto the existing `<SectionCard>` primitive (4 sections). Plus a documentation note capturing the tint-alpha threshold lesson.

**Architecture:** No new primitives, no new tokens, no Tailwind config changes. Three coordinated edits to existing files: (1) constant-value bump in the umbrella's accent palette, (2) wrap NewLoadModal's flat 3-column grid in four neutral `<SectionCard>` chunks, (3) append one FAQ entry to `docs/ui-system.md`. Total ~40 net LoC across 3 files.

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4. `<SectionCard>` lives at `components/ui/FormSection.js`, exports both `SectionCard` (named) and `FormSection` (default backward-compat) — both point at the same implementation. The five-color accent palette (`blue` / `emerald` / `amber` / `purple` / `rose`) is currently page-local in the umbrella editor.

**Spec:** `docs/superpowers/specs/2026-04-27-visual-hierarchy-accent-design.md`

**Tracks:** FU-121 (resolves the headline visible complaint; defers `accent` prop on `<SectionCard>` to a future FU per "3+ uses" governance).

---

## Scope

### In scope (3 files)

| # | File | Change |
|---|---|---|
| 1 | `pages/settings/communications/umbrellas/[id].js` | Bump `bg` field on 5 entries of `GROUP_ACCENT_PALETTE` (lines 977–983) |
| 2 | `components/loads/NewLoadModal.js` | Wrap form contents in 4 `<SectionCard>` sections; add import |
| 3 | `docs/ui-system.md` | Append one FAQ entry on tint alpha thresholds |

### Out of scope (deferred — see spec §1)

- `accent` prop on `<SectionCard>`
- `GroupCard` refactor in umbrella editor
- Tab-color theming as a system primitive
- Pattern C (identical-row list) fix
- AR FilterSidebar / dispatcher / settings comms migration

### Success criteria

- Umbrella editor in dark mode with 3+ Email Groups present shows visibly distinct cards across colors.
- New Load modal in dark mode shows four clearly-separated sections (header bars + visible chrome) instead of a flat 3-column grid.
- `npm run lint` passes.
- No existing `<SectionCard>` consumer regresses (default rendering unchanged — we don't modify the primitive itself).

---

## Task 1: Bump umbrella editor `GROUP_ACCENT_PALETTE`

**Files:**
- Modify: `pages/settings/communications/umbrellas/[id].js:977-983`

**What this fixes:** FU-121's headline complaint. The current `dark:bg-{color}-950/10` body tint produces a ~4 sRGB-point shift over `bg-slate-900` — imperceptible at normal viewing scale. Five stacked Email Groups in five different colors look identical. Bumping to `/65` makes them visibly distinct (validated against 3-color stack in the design phase).

- [ ] **Step 1: Read the current palette to confirm line numbers**

Run: `grep -n "GROUP_ACCENT_PALETTE" pages/settings/communications/umbrellas/[id].js`

Expected: line 977 with the const declaration, line 1118 where it's consumed in `GroupCard`.

Then read lines 977–983 to verify exact content matches the BEFORE block in Step 2. If line numbers have drifted, locate the const by name and adjust the Edit accordingly.

- [ ] **Step 2: Apply the tint bump (single Edit)**

Use the Edit tool with these exact strings:

`old_string`:
```js
const GROUP_ACCENT_PALETTE = [
  { border: 'border-l-blue-500',    bg: 'bg-blue-50/30 dark:bg-blue-950/10',    badgeBg: 'bg-blue-600' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-50/30 dark:bg-emerald-950/10', badgeBg: 'bg-emerald-600' },
  { border: 'border-l-amber-500',   bg: 'bg-amber-50/30 dark:bg-amber-950/10',  badgeBg: 'bg-amber-600' },
  { border: 'border-l-purple-500',  bg: 'bg-purple-50/30 dark:bg-purple-950/10', badgeBg: 'bg-purple-600' },
  { border: 'border-l-rose-500',    bg: 'bg-rose-50/30 dark:bg-rose-950/10',    badgeBg: 'bg-rose-600' },
];
```

`new_string`:
```js
const GROUP_ACCENT_PALETTE = [
  { border: 'border-l-blue-500',    bg: 'bg-blue-50/40 dark:bg-blue-950/65',    badgeBg: 'bg-blue-600' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-50/40 dark:bg-emerald-950/65', badgeBg: 'bg-emerald-600' },
  { border: 'border-l-amber-500',   bg: 'bg-amber-50/40 dark:bg-amber-950/65',  badgeBg: 'bg-amber-600' },
  { border: 'border-l-purple-500',  bg: 'bg-purple-50/40 dark:bg-purple-950/65', badgeBg: 'bg-purple-600' },
  { border: 'border-l-rose-500',    bg: 'bg-rose-50/40 dark:bg-rose-950/65',    badgeBg: 'bg-rose-600' },
];
```

Only the `bg` field changes on each row (light `/30` → `/40`, dark `/10` → `/65`). `border` and `badgeBg` are unchanged. The 5 colors stay in the same order (`GroupCard` rotates the palette by `index % 5`, so order matters).

- [ ] **Step 3: Verify the change with grep**

Run: `grep -n "dark:bg-blue-950" pages/settings/communications/umbrellas/[id].js`

Expected: one match showing `dark:bg-blue-950/65` on line ~978.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: passes with no new warnings or errors related to this file. (Pre-existing lint output for unrelated files is acceptable; only flag NEW issues from this change.)

- [ ] **Step 5: Manual visual verification**

If the dev server isn't running, start it: `npm run dev`. Open `http://localhost:3000/settings/communications/umbrellas` in dark mode. Click into any umbrella that has 2+ Email Groups (or create one with 3+ groups for the test).

Verify:
- Each Email Group card shows a visibly distinct body tint color from its neighbors (blue, emerald, amber).
- The colored left-edge + numbered badge are unchanged.
- Group 4 (purple) and Group 5 (rose) are also visibly distinct if you stack 5 groups.
- Light mode: same check — body tints are subtle but present (not pure white).

If any group still reads as identical to neighbors, the alpha values may have failed to apply — verify via DevTools inspector that the rendered class includes `dark:bg-blue-950/65` (and equivalent for other colors).

- [ ] **Step 6: Commit**

```bash
git add pages/settings/communications/umbrellas/[id].js
git commit -m "$(cat <<'EOF'
fix(umbrellas): bump GROUP_ACCENT_PALETTE body tint /10 → /65 (FU-121)

The dark-mode body tint at /10 alpha is imperceptible against bg-slate-900
— five stacked Email Groups in five different colors look identical. Bump
to /65 (validated against 3-color stack during design phase) so the cards
visibly differentiate. Light mode bumps /30 → /40 for parity.

No structural changes; constant-value edit on 5 palette entries.

Resolves: FU-121 (headline visible complaint)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migrate NewLoadModal onto `<SectionCard>`

**Files:**
- Modify: `components/loads/NewLoadModal.js` (import + render block ~lines 466–745)

**What this fixes:** Pattern A — flat-section page. Current modal renders the form as one `<form className="space-y-4">` with sections separated only by thin `border-t` lines. The 3-column grid mixes 6 concept clusters (Customer + Branch / Locations / Container / Trailer / Appointments / References). After this task, the form has 4 distinct sections with header bars: Routing template / Customer / Routing / Container & schedule.

- [ ] **Step 1: Read the current render block**

Run the Read tool on `components/loads/NewLoadModal.js`, lines 460–750. Confirm:
- Line ~467: `<Modal isOpen={isOpen} onClose={onClose} title="Create New Load" size="xl">`
- Line ~468: `<form onSubmit={handleSubmit} className="space-y-4">`
- Line ~503: `{/* Type pills row */}` block
- Line ~526: `{/* Routing template chip grid (DnD-reorderable) */}` block
- Line ~575: `{/* 3-column field grid */}` — the big mixed grid (Customer + Branch + Locations + Container + Appointments + References)
- Line ~714: `{/* Notify parties (collapsible, only when customer is set) */}` block
- Line ~738: `{/* Footer */}` block

If line numbers have drifted significantly (>20 lines), navigate by comment markers — the structure is what matters, not exact line numbers.

- [ ] **Step 2: Add the SectionCard import**

Use the Edit tool. After the existing imports near the top of the file (around line 10–14), add:

`old_string`:
```js
import OrgPicker from '../ui/OrgPicker';
import BranchPicker from '../ui/BranchPicker';
```

`new_string`:
```js
import OrgPicker from '../ui/OrgPicker';
import BranchPicker from '../ui/BranchPicker';
import { SectionCard } from '../ui/FormSection';
```

Note: `FormSection.js` exports both `SectionCard` (named) and `FormSection` (default). We use the named import to make the new contract explicit.

- [ ] **Step 3: Verify the import landed**

Run: `grep -n "SectionCard" components/loads/NewLoadModal.js`

Expected: one match — the new import line.

- [ ] **Step 4: Wrap the "Routing template" section in `<SectionCard>`**

Use the Edit tool. Replace the existing `{/* Routing template chip grid (DnD-reorderable) */}` block (which currently renders a top-level `<div>` containing the eyebrow label + the chip grid).

`old_string`:
```jsx
        {/* Routing template chip grid (DnD-reorderable) */}
        {form.load_type !== 'bill_only' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 font-medium">
                Routing Template <span className="text-gray-400 dark:text-slate-500 normal-case font-normal">— drag to reorder</span>
              </div>
              {templateOrder.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetOrder}
                  className="text-[10px] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 underline-offset-2 hover:underline"
                >
                  Reset order
                </button>
              )}
            </div>
            {loadingTemplates ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 py-3">Loading templates…</div>
            ) : orderedTemplates.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 py-3">
                No templates available for this load type.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedTemplates.map((t) => t.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {orderedTemplates.map((tpl) => (
                      <SortableTemplateChip
                        key={tpl.id}
                        tpl={tpl}
                        active={form.routing_template_id === tpl.id}
                        onSelect={() => selectTemplate(tpl)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}
```

`new_string`:
```jsx
        {/* Routing template chip grid (DnD-reorderable) */}
        {form.load_type !== 'bill_only' && (
          <SectionCard
            title="Routing template"
            description="Drag to reorder · choose the leg pattern for this load"
            actions={templateOrder.length > 0 ? (
              <button
                type="button"
                onClick={handleResetOrder}
                className="text-[10px] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 underline-offset-2 hover:underline"
              >
                Reset order
              </button>
            ) : null}
            columns={0}
          >
            {loadingTemplates ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 py-3">Loading templates…</div>
            ) : orderedTemplates.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 py-3">
                No templates available for this load type.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedTemplates.map((t) => t.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {orderedTemplates.map((tpl) => (
                      <SortableTemplateChip
                        key={tpl.id}
                        tpl={tpl}
                        active={form.routing_template_id === tpl.id}
                        onSelect={() => selectTemplate(tpl)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </SectionCard>
        )}
```

Notes:
- The "Reset order" button moves from inline-with-eyebrow into the `actions` slot of SectionCard (right of the title). The conditional rendering is preserved via ternary.
- The eyebrow label (`Routing Template — drag to reorder`) becomes SectionCard's `title` + `description` props.
- `columns={0}` means SectionCard renders children unwrapped (no internal grid) — the DnD chip grid keeps its own `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`.

- [ ] **Step 5: Wrap the "Customer" + "Routing" + "Container & schedule" sections**

The existing 3-column grid (line ~575) bundles all of these into one `<div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">`. Split it into 3 separate `<SectionCard>`s.

Use the Edit tool.

`old_string`:
```jsx
        {/* 3-column field grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          {/* Customer (col-span 2) + Branch */}
          <div className="md:col-span-2">
            <OrgPicker
              label="Customer"
              type="customer"
              value={form.customer_id}
              valueLabel={form.customer_label}
              onChange={handleCustomerChange}
              required
            />
          </div>
          {branches?.length > 0 ? (
            <BranchPicker
              label="Branch"
              value={form.branch_id}
              onChange={(val) => setForm((f) => ({ ...f, branch_id: val }))}
              placeholder="— Select —"
            />
          ) : (
            <div />
          )}

          {/* Locations (slot1, slot2, slot3) */}
          {typeCfg.slot1 && (
            <OrgPicker
              label={typeCfg.slot1.label}
              type={typeCfg.slot1.orgType}
              value={form.pickup_location_id}
              valueLabel={form.pickup_location_label}
              onChange={(org) => selectOrg('pickup_location_id', 'pickup_location_label', org)}
            />
          )}
          {typeCfg.slot2 && (
            <OrgPicker
              label={typeCfg.slot2.label}
              type={typeCfg.slot2.orgType}
              value={form.delivery_location_id}
              valueLabel={form.delivery_location_label}
              onChange={(org) => selectOrg('delivery_location_id', 'delivery_location_label', org)}
            />
          )}
          {typeCfg.slot3 && (
            <OrgPicker
              label={typeCfg.slot3.label}
              type={typeCfg.slot3.orgType}
              value={form.return_location_id}
              valueLabel={form.return_location_label}
              onChange={(org) => selectOrg('return_location_id', 'return_location_label', org)}
            />
          )}
          {typeCfg.showFinalDelivery && (
            <OrgPicker
              label="Final Delivery"
              type="final_destination"
              value={form.final_delivery_location_id}
              valueLabel={form.final_delivery_location_label}
              onChange={(org) =>
                selectOrg('final_delivery_location_id', 'final_delivery_location_label', org)
              }
            />
          )}

          {/* Container fields (only if showContainer) */}
          {typeCfg.showContainer && (
            <>
              <Input
                label="Container #"
                value={form.container_number}
                onChange={(e) => update('container_number', e.target.value.toUpperCase())}
                placeholder="MSKU1234567"
              />
              <Select
                label="Size"
                value={form.container_size}
                onChange={(e) => {
                  const code = e.target.value;
                  update('container_size', code);
                  const match = containerSizes.find((s) => s.value === code);
                  update('container_size_id', match?.id || null);
                }}
                options={containerSizes}
              />
              <div />
            </>
          )}

          {/* Trailer (only if showTrailer) */}
          {typeCfg.showTrailer && (
            <>
              <Input
                label="Trailer / Dry Van ID"
                value={form.trailer_number}
                onChange={(e) => update('trailer_number', e.target.value.toUpperCase())}
                placeholder="TRL12345"
              />
              <div />
              <div />
            </>
          )}

          {/* Appointments (when typeCfg shows them) */}
          {(typeCfg.showContainer || typeCfg.showTrailer || form.load_type === 'chassis_reposition') && (
            <>
              <DatePicker
                showTime
                label="Pickup Apt"
                value={form.pickup_apt_from}
                onChange={(v) => updateApt('pickup', v)}
              />
              <DatePicker
                showTime
                label="Delivery Apt"
                value={form.delivery_apt_from}
                onChange={(v) => updateApt('delivery', v)}
              />
              <div />
            </>
          )}

          {/* References (skip for bill_only and chassis_reposition) */}
          {form.load_type !== 'bill_only' && form.load_type !== 'chassis_reposition' && (
            <>
              <Input
                label="Master BOL"
                value={form.bill_of_lading}
                onChange={(e) => update('bill_of_lading', e.target.value)}
              />
              <Input
                label="Booking #"
                value={form.booking_number}
                onChange={(e) => update('booking_number', e.target.value)}
              />
              <div />
            </>
          )}
        </div>
```

`new_string`:
```jsx
        {/* Customer section — bill-to + branch */}
        <SectionCard
          title="Customer"
          description="Bill-to organization and optional branch assignment"
          columns={0}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <OrgPicker
                label="Customer"
                type="customer"
                value={form.customer_id}
                valueLabel={form.customer_label}
                onChange={handleCustomerChange}
                required
              />
            </div>
            {branches?.length > 0 ? (
              <BranchPicker
                label="Branch"
                value={form.branch_id}
                onChange={(val) => setForm((f) => ({ ...f, branch_id: val }))}
                placeholder="— Select —"
              />
            ) : (
              <div />
            )}
          </div>
        </SectionCard>

        {/* Routing section — pickup / delivery / return / final delivery */}
        {(typeCfg.slot1 || typeCfg.slot2 || typeCfg.slot3 || typeCfg.showFinalDelivery) && (
          <SectionCard
            title="Routing"
            description="Pickup → Delivery → Return locations"
            columns={0}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {typeCfg.slot1 && (
                <OrgPicker
                  label={typeCfg.slot1.label}
                  type={typeCfg.slot1.orgType}
                  value={form.pickup_location_id}
                  valueLabel={form.pickup_location_label}
                  onChange={(org) => selectOrg('pickup_location_id', 'pickup_location_label', org)}
                />
              )}
              {typeCfg.slot2 && (
                <OrgPicker
                  label={typeCfg.slot2.label}
                  type={typeCfg.slot2.orgType}
                  value={form.delivery_location_id}
                  valueLabel={form.delivery_location_label}
                  onChange={(org) => selectOrg('delivery_location_id', 'delivery_location_label', org)}
                />
              )}
              {typeCfg.slot3 && (
                <OrgPicker
                  label={typeCfg.slot3.label}
                  type={typeCfg.slot3.orgType}
                  value={form.return_location_id}
                  valueLabel={form.return_location_label}
                  onChange={(org) => selectOrg('return_location_id', 'return_location_label', org)}
                />
              )}
              {typeCfg.showFinalDelivery && (
                <OrgPicker
                  label="Final Delivery"
                  type="final_destination"
                  value={form.final_delivery_location_id}
                  valueLabel={form.final_delivery_location_label}
                  onChange={(org) =>
                    selectOrg('final_delivery_location_id', 'final_delivery_location_label', org)
                  }
                />
              )}
            </div>
          </SectionCard>
        )}

        {/* Container & schedule — container/trailer + appointments + references.
            Outer guard: render unless bill_only (which has no container, no trailer,
            no appointments, no references). For chassis_reposition, only the
            appointments inner block renders — section still shows. */}
        {form.load_type !== 'bill_only' && (
          <SectionCard
            title="Container & schedule"
            description="Container details, appointments, and reference numbers"
            columns={0}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {typeCfg.showContainer && (
                <>
                  <Input
                    label="Container #"
                    value={form.container_number}
                    onChange={(e) => update('container_number', e.target.value.toUpperCase())}
                    placeholder="MSKU1234567"
                  />
                  <Select
                    label="Size"
                    value={form.container_size}
                    onChange={(e) => {
                      const code = e.target.value;
                      update('container_size', code);
                      const match = containerSizes.find((s) => s.value === code);
                      update('container_size_id', match?.id || null);
                    }}
                    options={containerSizes}
                  />
                  <div />
                </>
              )}
              {typeCfg.showTrailer && (
                <>
                  <Input
                    label="Trailer / Dry Van ID"
                    value={form.trailer_number}
                    onChange={(e) => update('trailer_number', e.target.value.toUpperCase())}
                    placeholder="TRL12345"
                  />
                  <div />
                  <div />
                </>
              )}
              {(typeCfg.showContainer || typeCfg.showTrailer || form.load_type === 'chassis_reposition') && (
                <>
                  <DatePicker
                    showTime
                    label="Pickup Apt"
                    value={form.pickup_apt_from}
                    onChange={(v) => updateApt('pickup', v)}
                  />
                  <DatePicker
                    showTime
                    label="Delivery Apt"
                    value={form.delivery_apt_from}
                    onChange={(v) => updateApt('delivery', v)}
                  />
                  <div />
                </>
              )}
              {form.load_type !== 'bill_only' && form.load_type !== 'chassis_reposition' && (
                <>
                  <Input
                    label="Master BOL"
                    value={form.bill_of_lading}
                    onChange={(e) => update('bill_of_lading', e.target.value)}
                  />
                  <Input
                    label="Booking #"
                    value={form.booking_number}
                    onChange={(e) => update('booking_number', e.target.value)}
                  />
                  <div />
                </>
              )}
            </div>
          </SectionCard>
        )}
```

Notes on the conditional outer wrappers:
- The "Routing" section wraps in `{(typeCfg.slot1 || typeCfg.slot2 || typeCfg.slot3 || typeCfg.showFinalDelivery) && (...)}` so `bill_only` (all slots null) doesn't render an empty card.
- The "Container & schedule" section wraps in `{form.load_type !== 'bill_only' && (...)}` — the simplest guard that matches the union of the four inner block conditions:
  - `showContainer` → import / export / inbound / outbound / road : true → renders → outer must be true
  - `showTrailer` → road : true → renders → outer must be true
  - Appointments inner condition includes `form.load_type === 'chassis_reposition'` → renders → outer must be true
  - References inner condition is `!bill_only && !chassis_reposition` → renders → outer must be true
  - Net: every load_type EXCEPT `bill_only` has at least one inner block that should render. So `!bill_only` is the correct outer guard.

The 3-column inner grid layout (`grid grid-cols-1 md:grid-cols-3 gap-3`) is preserved inside each SectionCard's body via `columns={0}` (which means SectionCard doesn't apply its own grid).

The `pt-2 border-t border-gray-100 dark:border-slate-800` divider on the original outer grid is removed — SectionCard's own border + spacing handles the visual separation.

- [ ] **Step 6: Verify the file structure with grep**

Run: `grep -cn "<SectionCard" components/loads/NewLoadModal.js`

Expected: 4 matches (one per section: Routing template, Customer, Routing, Container & schedule).

Run: `grep -n "</SectionCard>" components/loads/NewLoadModal.js`

Expected: 4 matches at the appropriate close-tag locations.

- [ ] **Step 7: Run lint**

Run: `npm run lint`

Expected: passes with no new warnings or errors. Pay attention to JSX-balance warnings — if any, recheck the open/close `<SectionCard>` pairs.

- [ ] **Step 8: Run build (catch SSR / import errors lint can miss)**

Run: `npm run build`

Expected: build completes without errors. The build step compiles all pages including modal-using pages, so any import path issue or SectionCard prop-validation issue surfaces here.

If build fails: most likely cause is the SectionCard import path. Verify `components/ui/FormSection.js` exists and exports `{ SectionCard }`. (It does — confirmed during spec writing — but rare path drift could occur.)

- [ ] **Step 9: Manual visual verification across load types**

Start dev server if not running: `npm run dev`. Open `http://localhost:3000` (or whichever port is in use), log in, click "Create Load" or navigate to wherever NewLoadModal is triggered.

Verify in dark mode at viewport zoom 100%:

For each load_type (test all 7), confirm:

| load_type | Routing template card | Customer card | Routing card | Container & schedule card |
|---|---|---|---|---|
| import | yes (templates available) | yes | yes (3 location slots) | yes (container + appts + refs) |
| export | yes | yes | yes (3 location slots) | yes |
| inbound | yes | yes | yes (3 location slots) | yes |
| outbound | yes | yes | yes (slot1, slot2, final delivery) | yes (no slot3, no return) |
| road | yes | yes | yes (slot1, slot2, no slot3) | yes (trailer not container, appts only) |
| bill_only | NO (`load_type !== 'bill_only'` guard) | yes | NO (no slots in TYPE_CONFIG) | NO (no container, no trailer, no refs) |
| chassis_reposition | yes (has its own templates) | yes | yes | yes (appts only, no container/trailer/refs) |

Any failure (card renders empty, card missing when expected, fields appear in wrong card, conditional logic broken) is a blocker — debug before committing.

Also verify:
- Notify-parties `<details>` collapsible still appears below the Container & schedule section when a customer is selected.
- Footer button row (Cancel + Create Load) still appears below.
- Light mode at zoom 100% — same checks.
- Type pills row still sits above the first SectionCard, outside any chrome.

- [ ] **Step 10: Commit**

```bash
git add components/loads/NewLoadModal.js
git commit -m "$(cat <<'EOF'
refactor(NewLoadModal): wrap form in 4 SectionCards (FU-121)

Migrate the New Load modal off raw class strings onto the existing
<SectionCard> primitive. Splits the previous flat 3-column grid (which
mixed Customer / Branch / Locations / Container / Trailer / Appointments /
References into one pile) into four named sections:
  - Routing template
  - Customer
  - Routing
  - Container & schedule

Type pills row stays outside any card (it's a discriminator). Notify
parties <details> and the footer button row remain unchanged.

All conditional rendering (typeCfg.showContainer, typeCfg.slot*, load_type
guards for bill_only / chassis_reposition) preserved verbatim — sections
silently disappear when their conditional says they shouldn't render.

No primitive changes — uses existing SectionCard from
components/ui/FormSection.js.

Resolves: FU-121 (NewLoadModal Pattern A migration)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Document the tint-alpha threshold in `docs/ui-system.md`

**Files:**
- Modify: `docs/ui-system.md` (append entry to §9 FAQ)

**Why:** Spec §5 captures a non-obvious lesson — alpha levels under ~30% are imperceptible against `slate-900` in dark mode. Future contributors attempting accent treatments should not have to re-discover this. The doc entry also forward-references the eventual `<SectionCard accent>` prop so the next contributor knows it's planned-but-deferred.

- [ ] **Step 1: Read the current §9 FAQ to find the insertion point**

Run the Read tool on `docs/ui-system.md`. Find the §9 FAQ block (starts with `## 9. FAQ`). Note the last existing Q/A pair (currently the "I want a collapsible section" Q at the end).

- [ ] **Step 2: Append the new FAQ entry**

Use the Edit tool. The exact `old_string` depends on the last existing Q/A — use what you found in Step 1. The `new_string` is the same plus the appended block.

`old_string` (this is the current end of §9, verify by reading the file):
```md
**Q: I want a collapsible section.**
A: No you don't — the spec explicitly bans it. If your section gets collapsed often, move its content to a different tab or page.
```

`new_string`:
```md
**Q: I want a collapsible section.**
A: No you don't — the spec explicitly bans it. If your section gets collapsed often, move its content to a different tab or page.

**Q: I want to add a tinted-color background to a section. What alpha level works in dark mode?**
A: Validated against `bg-slate-900` page background:
- Below ~30% — imperceptible. Eye reads as no tint at all.
- 30–50% — visible but subtle. Good for "these cards belong to a series" cues where you don't want competing chroma.
- 50–70% — clearly tinted. Cards read as colored without becoming saturated.
- Above ~70% — saturated. Cards feel like alerts, not sections. Avoid for neutral grouping.

In light mode, halve the alpha (15% / 30% / 40%) — the white background takes color more readily. The umbrella editor's `GROUP_ACCENT_PALETTE` uses 65% / 40% (dark / light) as the canonical "visible differentiation across multiple stacked cards" level.

A `<SectionCard>` `accent` prop encoding this guidance is planned — see the FU tracker when 2–3 confirmed consumers materialize.
```

- [ ] **Step 3: Verify the entry landed**

Run: `grep -n "tinted-color background" docs/ui-system.md`

Expected: one match in the §9 FAQ section.

- [ ] **Step 4: Commit**

```bash
git add docs/ui-system.md
git commit -m "$(cat <<'EOF'
docs(ui-system): document tint-alpha threshold for accent treatments (FU-121)

Capture the lesson learned during FU-121's design phase — body tints below
~30% alpha are imperceptible against bg-slate-900 in dark mode. Documents
the threshold ranges (30–50% subtle, 50–70% clearly tinted, >70% saturated)
and the canonical 65%/40% level used by the umbrella editor's
GROUP_ACCENT_PALETTE. Forward-references the planned <SectionCard accent>
prop so contributors know it's deferred-not-forgotten.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After all three tasks are committed:

- [ ] **Step 1: Confirm three commits**

Run: `git log --oneline -4`

Expected: three new commits in this order (most recent first):
1. `docs(ui-system): document tint-alpha threshold for accent treatments (FU-121)`
2. `refactor(NewLoadModal): wrap form in 4 SectionCards (FU-121)`
3. `fix(umbrellas): bump GROUP_ACCENT_PALETTE body tint /10 → /65 (FU-121)`

Plus the spec commit (`docs(spec): visual hierarchy pass …`) from earlier.

- [ ] **Step 2: Run lint + build clean**

Run: `npm run lint`
Expected: passes.

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 3: Final visual smoke test**

Open dev server, in dark mode at 100% zoom:
1. Umbrella editor with multiple groups — confirm visible color differentiation across colors.
2. New Load modal — confirm 4 distinct sections render correctly across at least 3 load_types: import (covers the all-blocks-rendered case), road (covers showTrailer), bill_only (covers full-section-omitted case). Also test chassis_reposition — its Container & schedule section should render with appointments only.
3. `pages/settings/profile.js` — confirm it renders identically to before (smoke test that we didn't accidentally affect SectionCard's primitive rendering).

Followups reconciliation (memory/followups.md updates closing FU-121's headline complaint) is handled by the `update-followups` skill at session end, not as part of this plan.

---

## Out of scope reminders

These are NOT to be done in this PR — see spec §1 for full reasoning. If the executing agent feels tempted to expand scope, stop and propose a follow-up FU instead:

- Adding `accent` prop to `<SectionCard>` — defer until 2–3 consumers exist
- Refactoring `GroupCard` in umbrella editor to use `<SectionCard>` — depends on accent prop + slot expansion
- Tab-color theming as a system primitive
- Migrating AR FilterSidebar / dispatcher FilterSidebar / settings comms pages
- Pattern C identical-row list fix
- Tailwind config / token additions
