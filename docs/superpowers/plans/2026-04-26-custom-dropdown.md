# FU-098: Custom Single-Select Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dispatcher bulk-bar's native `<select>` (used by 6 call sites via the local `SelectField` component in `BulkActionBar.js`) with a custom-rendered dropdown that obeys dark mode and ships as a shared primitive at `components/ui/Dropdown.js`.

**Architecture:** New file `components/ui/Dropdown.js` mirrors `components/ui/MultiSelect.js`'s pattern (open-state + click-outside listener) but for a single value. Dropdown panel is portal-rendered to `document.body` so it can't clip inside popovers. `SelectField` in BulkActionBar.js becomes a thin wrapper around `<Dropdown>`; the 6 call sites' props are unchanged.

**Tech Stack:** React 18 / Next.js / Tailwind CSS / lucide-react icons (ChevronDown, Check) / `react-dom`'s `createPortal`.

**Testing approach:** This codebase uses `node:test` for pure-logic unit tests (`tests/*.test.mjs`) but does not have a React component testing harness (no jsdom, RTL, or Vitest). Standing one up for a single 80-LoC presentational component is over-engineering. Verification is via dev-server browser preview (state changes, dark-mode rendering, keyboard nav) plus `dd-qa` plus a code-level grep for the a11y attributes. This matches the project's established pattern for UI work (see e.g. `session_2026_04_25_polish_marathon.md` and the visual-gates approach).

---

### Task 1: Create `components/ui/Dropdown.js`

**Files:**
- Create: `components/ui/Dropdown.js`

- [ ] **Step 1: Write the full Dropdown component**

```jsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

/**
 * Custom-rendered single-select dropdown. Drop-in replacement for a
 * native `<select>` styled to match dark mode without inheriting OS
 * chrome. Sibling to components/ui/MultiSelect.js.
 *
 * Props:
 *   label, name           — optional <label> + htmlFor
 *   value                 — currently-selected option's value (string|null)
 *   options               — [{ value, label }]
 *   onChange(value)       — called with the new value (no synthetic event)
 *   placeholder           — shown when value is empty (default '— Select —')
 *   disabled, required, error, className
 */
export default function Dropdown({
  label,
  name,
  value,
  options = [],
  onChange,
  placeholder = '— Select —',
  disabled = false,
  required = false,
  error = null,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);

  const currentOption = options.find((o) => o.value === value) || null;
  const currentLabel = currentOption ? currentOption.label : placeholder;

  // Position the portal panel under the button using getBoundingClientRect.
  function recomputePos() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
  }

  // Click-outside closes; matches MultiSelect.js:32-40 pattern.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      // Wrapper covers the button. Panel is portaled, so check it explicitly.
      const inWrapper = wrapperRef.current && wrapperRef.current.contains(e.target);
      const inPanel = e.target.closest('[data-dropdown-panel="true"]');
      if (!inWrapper && !inPanel) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Close (rather than reposition) on scroll/resize — matches typical UX
  // and avoids the cost/complexity of live repositioning.
  useEffect(() => {
    if (!open) return;
    function onDismiss() {
      setOpen(false);
    }
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open]);

  function openPanel(initialHighlight = -1) {
    if (disabled) return;
    recomputePos();
    setHighlightedIdx(
      initialHighlight === -1
        ? Math.max(0, options.findIndex((o) => o.value === value))
        : initialHighlight
    );
    setOpen(true);
  }

  function commit(idx) {
    const opt = options[idx];
    if (!opt) return;
    onChange?.(opt.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPanel(0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        openPanel(options.length - 1);
      }
      return;
    }
    // open
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIdx((i) => (i + 1) % options.length);
        return;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIdx((i) => (i - 1 + options.length) % options.length);
        return;
      case 'Home':
        e.preventDefault();
        setHighlightedIdx(0);
        return;
      case 'End':
        e.preventDefault();
        setHighlightedIdx(options.length - 1);
        return;
      case 'Enter':
        e.preventDefault();
        if (highlightedIdx >= 0) commit(highlightedIdx);
        return;
      case 'Tab':
        // Default focus advance — close panel.
        setOpen(false);
        return;
    }
  }

  const buttonClass =
    `block w-full rounded-lg border px-3 py-2 text-sm text-left flex items-center justify-between ` +
    `bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 ` +
    (error
      ? 'border-red-300 dark:border-red-800 focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-900/40 '
      : 'border-gray-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 ') +
    'focus:outline-none ' +
    (disabled ? 'opacity-60 cursor-not-allowed ' : 'cursor-pointer ');

  const valueClass = currentOption
    ? 'truncate'
    : 'truncate text-gray-400 dark:text-slate-500';

  return (
    <div ref={wrapperRef} className={className}>
      {label && (
        <label
          htmlFor={name}
          className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5"
        >
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <button
        ref={buttonRef}
        id={name}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={onKeyDown}
        className={buttonClass}
      >
        <span className={valueClass}>{currentLabel}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0" />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <ul
            data-dropdown-panel="true"
            role="listbox"
            style={{
              position: 'absolute',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 1000,
            }}
            className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg max-h-64 overflow-auto py-1"
          >
            {options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400 dark:text-slate-500 italic">
                No options
              </li>
            ) : (
              options.map((o, idx) => {
                const isSelected = o.value === value;
                const isHighlighted = idx === highlightedIdx;
                return (
                  <li
                    key={o.value}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                    onClick={() => commit(idx)}
                    className={
                      'px-3 py-2 text-sm cursor-pointer flex items-center justify-between ' +
                      (isHighlighted
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-gray-900 dark:text-slate-100 '
                        : 'text-gray-900 dark:text-slate-100 ') +
                      'hover:bg-blue-50 dark:hover:bg-blue-900/30'
                    }
                  >
                    <span className="truncate">{o.label}</span>
                    {isSelected && (
                      <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    )}
                  </li>
                );
              })
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

The dev server should HMR-pick up the new file. Verify with `preview_logs` showing a successful compile (`✓ Compiled in NNN ms`). No import path is consumed yet, so the file just sits in the bundle.

---

### Task 2: Wire `Dropdown` into BulkActionBar's `SelectField`

**Files:**
- Modify: `components/dispatcher/BulkActionBar.js:500-520` (the `SelectField` definition)

- [ ] **Step 1: Add the import**

At the top of `BulkActionBar.js`, after the other `components/ui/*` imports, add:

```jsx
import Dropdown from '../ui/Dropdown';
```

- [ ] **Step 2: Replace the `SelectField` body**

Find the existing `SelectField` function (lines 500-520):

```jsx
function SelectField({ label, value, options, onChange }) {
  // Native <option> elements inherit the <select>'s text color, so in dark
  // mode the open dropdown panel (rendered white by Chrome/Windows) shows
  // light text on white = unreadable. Explicit bg + text per option fixes it.
  const optionClass = 'bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100';
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
      >
        <option value="" className={optionClass}>— Select —</option>
        {(options || []).map((o) => (
          <option key={o.value} value={o.value} className={optionClass}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
```

Replace the entire function with:

```jsx
function SelectField({ label, value, options, onChange }) {
  return (
    <Dropdown
      label={label}
      value={value}
      options={options || []}
      onChange={onChange}
      placeholder="— Select —"
    />
  );
}
```

The 6 call sites (lines 363, 462, 778, 779, 782, 783) are unchanged.

- [ ] **Step 3: Build check**

Verify the dev server recompiles cleanly via `preview_logs`. Expected: `✓ Compiled in NNN ms` with no errors.

---

### Task 3: Verify in browser preview

**Files:**
- Touch: none (verification only)

- [ ] **Step 1: Navigate to dispatcher**

```js
preview_eval: window.location.href = '/dispatcher'
```

If the page sits on the auth spinner (it has all session), skip to step 5 and rely on dispatch a verification subagent + manual check, since `BulkActionBar` only mounts when loads are selected which requires a logged-in dispatcher session. (Same situation as FU-110 / FU-086 today.)

- [ ] **Step 2: If logged in, simulate selection + open Edit Equipment popover**

```js
preview_eval:
  // Click the first row checkbox to select a load (or trigger the bulk-bar somehow).
  document.querySelector('[data-row-select-all]')?.click();
  document.querySelector('[data-bulk-action="equipment"]')?.click();
```

Then snapshot:

```js
preview_snapshot
```

Look for the 4 dropdowns (Container Size, Container Type, Chassis Size, Chassis Type) rendered by `EquipmentInfoForm`.

- [ ] **Step 3: Open one and confirm panel renders**

```js
preview_click selector='[data-row-select-all] + * button[aria-haspopup="listbox"]'
preview_snapshot
```

Expected: panel appears with `bg-white dark:bg-slate-800` styling, listing all options, current value has the `Check` icon.

- [ ] **Step 4: Test keyboard**

```js
preview_eval:
  const btn = document.querySelector('button[aria-haspopup="listbox"]');
  btn.focus();
  btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
```

Then snapshot to confirm the panel opened and first option is highlighted (`bg-blue-50 dark:bg-blue-900/30`).

- [ ] **Step 5: If browser drive is gated by auth, dispatch a code-only subagent for the static check**

Spawn an Explore subagent with:
- Confirm `components/ui/Dropdown.js` exports a default function with the documented prop set.
- Confirm `BulkActionBar.js` imports `Dropdown` from `'../ui/Dropdown'` and that `SelectField` no longer references `<select>`, `<option>`, or the `optionClass` const.
- Confirm `aria-haspopup="listbox"`, `aria-expanded`, `role="listbox"`, `role="option"` are present in `Dropdown.js`.
- Confirm the dev server shows clean compile in `preview_logs`.

Expected: subagent reports pass.

- [ ] **Step 6: If subagent says fail or browser test reveals an issue, diagnose + fix and re-run**

Common failure modes to watch for:
- Portal panel positioned wrong: `recomputePos` not called or `getBoundingClientRect` measurement is stale. Fix: call `recomputePos` inside `openPanel` (already done in the spec).
- Click-outside fires inside the panel: the `data-dropdown-panel="true"` attribute may not be matching. Fix: confirm the attribute is on the `<ul>`, and the `closest()` lookup uses the same string.
- Keyboard does nothing: ensure the button's `onKeyDown={onKeyDown}` is wired (Task 1).

---

### Task 4: Run dd-qa

**Files:**
- Touch: none (skill invocation)

- [ ] **Step 1: Invoke dd-qa skill**

Per `MEMORY.md` engineering convention, dd-qa runs after any file edit in `components/`. Both files modified are under `components/`.

- [ ] **Step 2: Address findings (if any)**

dd-qa is advisory. If it surfaces actual breakage (vs nice-to-haves), fix inline. If only nice-to-haves, log them as new follow-ups in `memory/followups.md`.

Likely concerns dd-qa may flag (anticipated):
- "Dropdown overflow" — Should pass since the new component uses portal rendering, which is exactly the dd-qa-recommended pattern.
- "Pill-style tabs" — N/A.

---

### Task 5: Update FU-098 in followups.md

**Files:**
- Modify: `C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md`

- [ ] **Step 1: Move FU-098 from Open to Recently Resolved**

Remove the FU-098 block from the "Open" section. Add a one-paragraph entry to "Recently resolved" under `## 2026-04-26` (the section already exists as of FU-086 / FU-110 / FU-111 today). Match the existing formatting:

```
### FU-098: [bulk-bar] Replace native `<select>` with custom styled dropdown
- **Resolved:** 2026-04-26 in `<sha>` — new `components/ui/Dropdown.js` (custom single-select sibling to MultiSelect.js, portal-rendered panel, ChevronDown trigger, full keyboard nav, listbox a11y). BulkActionBar's local SelectField became a thin wrapper; all 6 call sites unchanged. Removes the per-`<option>` color workaround introduced in `851403d`. Native-select audit in other pages remains as future work.
```

- [ ] **Step 2: Update MEMORY.md count line**

Bump open count -1, recently-resolved +1. Update the HEAD SHA in the audit line to the new commit.

---

### Task 6: Commit

**Files:**
- Stage: `components/ui/Dropdown.js`, `components/dispatcher/BulkActionBar.js`, `docs/superpowers/specs/2026-04-26-custom-dropdown-design.md`, `docs/superpowers/plans/2026-04-26-custom-dropdown.md`
- Stage (separately, in a follow-on commit): `memory/followups.md`, `memory/MEMORY.md`

- [ ] **Step 1: Stage code + docs and commit**

```bash
git add components/ui/Dropdown.js \
        components/dispatcher/BulkActionBar.js \
        docs/superpowers/specs/2026-04-26-custom-dropdown-design.md \
        docs/superpowers/plans/2026-04-26-custom-dropdown.md

git commit -m "$(cat <<'EOF'
feat(ui): custom Dropdown component; replace bulk-bar native select (FU-098)

New components/ui/Dropdown.js — single-select sibling to MultiSelect.js
with the same custom-rendered panel approach (open state + click-outside
listener) but for a single value. Panel is portal-rendered to
document.body so it can't clip inside popovers. Full keyboard nav
(Escape, Up/Down, Enter, Home/End, Tab), ChevronDown trigger,
Check icon next to the selected option, listbox a11y attributes.

BulkActionBar.js's local SelectField becomes a thin wrapper; the 6
call sites (Container Size/Type, Chassis Size/Type, plus 2 others)
are unchanged. Removes the per-<option> bg+text-color workaround
introduced in 851403d — no longer needed since the new dropdown
renders its own panel.

Resolves: FU-098

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: clean commit, hooks pass.

- [ ] **Step 2: Verify commit landed**

```bash
git log -1 --stat
```

Confirm 4 files staged.

---

## Self-Review

**Spec coverage:**
- New `components/ui/Dropdown.js` — Task 1 ✓
- BulkActionBar SelectField swap — Task 2 ✓
- Portal-rendered panel — Task 1 step 1 (`createPortal`) ✓
- Click-outside via mousedown — Task 1 (effect with `wrapperRef`/`data-dropdown-panel`) ✓
- Keyboard nav (Escape, Up/Down, Enter, Home/End, Tab) — Task 1 (`onKeyDown` switch) ✓
- a11y attributes — Task 1 (`aria-haspopup`, `aria-expanded`, `role="listbox"`, `role="option"`, `aria-selected`) ✓
- Same prop API as Select.js — Task 1 (label, name, value, options, onChange, placeholder, disabled, required, error, className) ✓
- Browser verification — Task 3 ✓
- dd-qa — Task 4 ✓
- Followups update — Task 5 ✓
- Commit — Task 6 ✓

**Placeholder scan:** none.

**Type consistency:** `Dropdown` prop name and shape match across the spec's API section, the implementation in Task 1, and the `SelectField` wrapper in Task 2 (`label`, `value`, `options`, `onChange`, `placeholder`).
