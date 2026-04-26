# FU-098: Custom Single-Select `Dropdown` Component — Design

**Status:** Design approved 2026-04-26 (brainstorm).
**Tracks:** FU-098
**Discovered during:** Bulk-bar gap audit (2026-04-25 polish marathon).

## 1. Goal

Replace the native `<select>` element used by the dispatcher bulk-bar's `SelectField` (BulkActionBar.js:500-520, 6 call sites) with a fully-styled custom dropdown so the open option panel matches the dark theme instead of inheriting OS chrome. Build it as a shared primitive (`components/ui/Dropdown.js`) so future pages have a custom single-select to reach for, mirroring `components/ui/MultiSelect.js` which already provides the multi-select case.

## 2. Scope

**In scope**
- New `components/ui/Dropdown.js` (~80 LoC) — custom-rendered single-select with button trigger + portal-rendered popover panel.
- `components/dispatcher/BulkActionBar.js` — `SelectField` body switches from `<select>` to `<Dropdown>`. The 6 call sites' props are unchanged.
- Commit `851403d`'s explicit `bg-white dark:bg-slate-800` per-`<option>` workaround in `SelectField` is unwound (the new dropdown renders its own panel, so per-option workarounds are no longer needed).

**Out of scope (deferred / future FUs)**
- Audit + replace native `<select>` elsewhere in the codebase (settings pages, modal forms, etc.). FU-098 is bulk-bar-scoped per the ledger entry.
- Type-to-search / filter-inside-dropdown — YAGNI; current call sites have ≤10 options each.
- Async option loading. None of the bulk-bar call sites need it (all options are static reference data already loaded into the form).

## 3. API

The component is a drop-in replacement for `components/ui/Select.js`, with the same prop names so future swaps are mechanical.

```jsx
<Dropdown
  label="Container Size"
  value={form.container_size}
  options={[{ value: '20', label: '20 ft' }, ...]}
  onChange={(v) => setForm({ ...form, container_size: v })}
  placeholder="— Select —"
  disabled={false}
  required={false}
  error={null}              // string | null
  className=""
  name=""                   // optional, used as label htmlFor
/>
```

Notes:
- `value` is the option's `value` (string or null/undefined for "no selection").
- `onChange(value)` is called with the new value (matches existing `SelectField` and `MultiSelect` ergonomics — no synthetic-event passthrough).
- An empty option (label = `placeholder`, value = `''`) is rendered first when no value is selected, mirroring the existing `SelectField` behavior at line 513.

## 4. Behavior

**Open / close**
- Click the button → toggle open
- `Escape` → close
- `Tab` (default browser focus) → close (focus moves out)
- Click outside the wrapper → close (mousedown listener, like `MultiSelect.js:32-40`)

**Keyboard navigation**
- `ArrowDown` from button (closed): open and highlight first option
- `ArrowUp` from button (closed): open and highlight last option
- `ArrowDown` / `ArrowUp` (open): cycle highlighted option
- `Enter` (open, option highlighted): select it, close, return focus to button
- Click on option (open): select it, close
- `Home` / `End` (open): jump to first / last
- Highlight is purely visual (CSS class) — does NOT change `value` until commit

**Selection & display**
- The button shows the label of the current `value`'s option, or the `placeholder` if none.
- The currently-selected option in the open panel gets a checkmark / highlight so users see what's selected as they scroll.

**Visual**
- Button: identical border, padding, focus ring to the existing `SelectField` button (so the closed state is visually unchanged).
- Panel: portal-rendered to `document.body`, positioned absolutely under the button using `getBoundingClientRect()`. Background `bg-white dark:bg-slate-800`, border + shadow, max-height with scroll for long lists.
- Panel z-index high enough to clear bulk-bar's popover layer.

**a11y**
- Button has `aria-haspopup="listbox"`, `aria-expanded={open}`.
- Panel has `role="listbox"`.
- Each option has `role="option"`, `aria-selected={value === o.value}`.

## 5. Architecture

Single file: `components/ui/Dropdown.js`.

```
Dropdown (forwardRef)
├── wrapperRef                        // for click-outside scope
├── buttonRef                         // for focus restore + portal positioning
├── state: open, highlightedIdx
├── effect: window resize / scroll → reposition panel (or close — see decision)
├── effect: mousedown click-outside listener
├── handlers: onButtonClick, onKeyDown, onOptionClick
└── render
    ├── <label> (if label prop)
    ├── <button> (trigger — styled like the old SelectField's <select>)
    └── createPortal(<DropdownPanel ... />, document.body)
        └── <ul role="listbox"> options
```

**Reposition vs close on scroll/resize:** close. Simpler; matches typical dropdown UX (scroll dismisses); no perf concern. Reposition is over-engineering for this v1.

## 6. Migration of bulk-bar `SelectField`

```jsx
function SelectField({ label, value, options, onChange }) {
  return (
    <Dropdown
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      placeholder="— Select —"
    />
  );
}
```

The 6 call sites (lines 363, 462, 778, 779, 782, 783) need no changes. Removes the `optionClass` constant and the per-`<option>` color workaround comment (lines 501-504, 513-516).

## 7. Verification plan

1. `BulkActionBar` mounts in dispatcher; opening "Edit Equipment Info" popover shows the 4 dropdowns (Container Size/Type, Chassis Size/Type) with the new custom panel in dark mode.
2. Open a dropdown → option panel renders with `dark:bg-slate-800`, no white OS chrome.
3. Keyboard: focus button via Tab → ArrowDown opens + highlights first option → ArrowDown cycles → Enter selects + closes.
4. Escape closes.
5. Click outside closes.
6. Selecting an option fires `onChange` and the form state updates (verified by submitting the popover and confirming the bulk-update API receives the new value).
7. Dropdown panel is not clipped by any popover overflow (portal works).
8. dd-qa: clean.

## 8. Risk and rollback

**Risk:** low. Pure UI; no schema, API, or business-logic changes. The existing API (`SelectField` props) is unchanged so consumers don't move.

**Rollback:** revert the commit; the native `<select>` returns. No data implications.
