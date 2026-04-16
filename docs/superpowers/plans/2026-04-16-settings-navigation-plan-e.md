# Settings Navigation — Plan E Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three settings-nav improvements bundled as one coherent UX pass — smooth navigation (no layout re-mount), Sidebar-vs-Card view toggle, and self-aware intra-group sibling tabs.

**Architecture:** Adopt Next.js Pages-Router `getLayout` pattern so `<SettingsLayout>` becomes persistent across `/settings/*` routes. Branch the layout's chrome on a `viewMode` preference (sidebar | card). Add a small self-aware `<SettingsTabs />` primitive that pages always render unconditionally — it decides whether to show based on view mode + a "show tabs in sidebar mode" preference. Both prefs persist to `localStorage` under the existing `dd.*` convention.

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4. Primitives live in `components/ui/`; settings shell + new settings-only primitives live in `components/settings/`.

**Spec:** `docs/superpowers/specs/2026-04-16-settings-navigation-design.md`

**Exemplars:**
- `pages/settings/profile.js` — settings page composition exemplar (Plan A)
- `components/ui/SubTabs.js` — visual styling reference for the new `<SettingsTabs />` (controlled-prop pattern, blue-pill active state)
- `pages/settings/SettingsLayout.js`'s `loadCollapsed` / `saveCollapsed` (lines 11–24) — SSR-safe localStorage pattern for the new hook

---

## Scope

### In scope (3 new files + 15 modified files)

**New files:**
- `components/settings/useSettingsViewPrefs.js` — SSR-safe localStorage hook
- `components/settings/SettingsTabs.js` — self-aware sibling tab strip
- `components/settings/SettingsViewToggle.js` — "View ⇣" dropdown (mode + show-tabs)

**Modified files:**
- `pages/_app.js` — adopt `getLayout` pattern (additive)
- `components/settings/SettingsLayout.js` — branch on `viewMode`, mount `<SettingsViewToggle />`
- `pages/settings/index.js` — branch on `viewMode`: card grid OR current "What's here" summary
- 12 settings pages — convert from inline `<SettingsLayout>` wrap to `Page.getLayout = …`, add `<SettingsTabs />` near top of content
- `docs/ui-system.md` — document `getLayout` pattern + new settings primitives

### Out of scope

- `pages/settings/communications/**` (9 sub-pages) — stay in sidebar mode regardless of toggle, will not render `<SettingsTabs />`. Plan F candidate.
- `pages/settings/charge-profiles/*`, `pages/settings/tariffs/*`, `pages/settings/driver-tariffs/*` — same as Plan C (out of scope, deferred)
- DB-backed pref persistence — localStorage only, matches existing `dd.theme` / `dd.compact` / `dd.settings.collapsed` convention
- URL state for view mode — pure preference, not bookmarkable
- View-mode transition animations — instant swap
- Equipment Reference DnD-inside-`<table>` hydration warning — pre-existing, separate side-task

### Success criteria

1. Navigating `/settings → /settings/company → /settings/team` keeps the sidebar mounted; scroll position preserved; no visible flash.
2. "View ⇣" dropdown in the sidebar header switches between Sidebar view and Card view; choice persists across reloads.
3. Card view: `/settings` renders the card grid; sub-pages render breadcrumb + `<SettingsTabs />` at top, no left rail.
4. Sidebar view + "Show sibling tabs" off (default): no tabs visible.
5. Sidebar view + "Show sibling tabs" on: tabs appear above each page's content.
6. Clicking a sibling tab navigates without scroll reset and updates the active tab.
7. `npm run build` clean for the 3 new and 15 modified files. No new lint errors. No new hydration warnings.
8. Dark + compact + zoom 80/100/125 clean across all 13 settings pages, in both view modes.

---

## Phase 1: Foundation primitives

Three small primitives, no app integration yet. Each builds in isolation and is testable via temporary import.

---

### Task 1.1: Create `useSettingsViewPrefs` hook

**Context:** SSR-safe hook that reads + writes the two new localStorage keys. Same pattern as the inline `loadCollapsed`/`saveCollapsed` already in `SettingsLayout.js` lines 11–24, factored out for reuse.

**Files:**
- Create: `components/settings/useSettingsViewPrefs.js` (~50 LoC)

- [ ] **Step 1: Create the hook file**

Write `components/settings/useSettingsViewPrefs.js`:

```jsx
import { useState, useEffect, useCallback } from 'react';

const VIEW_MODE_KEY = 'dd.settings.viewMode';
const SHOW_TABS_KEY = 'dd.settings.showTabsInSidebar';

const DEFAULT_VIEW_MODE = 'sidebar';
const DEFAULT_SHOW_TABS = false;

function readViewMode() {
  if (typeof window === 'undefined') return DEFAULT_VIEW_MODE;
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === 'card' ? 'card' : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

function readShowTabs() {
  if (typeof window === 'undefined') return DEFAULT_SHOW_TABS;
  try {
    return localStorage.getItem(SHOW_TABS_KEY) === 'true';
  } catch {
    return DEFAULT_SHOW_TABS;
  }
}

/**
 * SSR-safe hook for the two settings nav preferences. Returns defaults during
 * server render, then hydrates from localStorage on mount. Setters write
 * through to localStorage immediately and update local state.
 *
 *   const { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar } =
 *     useSettingsViewPrefs();
 *
 * viewMode:           'sidebar' | 'card'   (default 'sidebar')
 * showTabsInSidebar:  boolean              (default false)
 *
 * The two prefs are independent. showTabsInSidebar is only meaningful when
 * viewMode === 'sidebar'; in card mode the sibling tabs always render
 * regardless of this pref.
 */
export default function useSettingsViewPrefs() {
  const [viewMode, setViewModeState] = useState(DEFAULT_VIEW_MODE);
  const [showTabsInSidebar, setShowTabsState] = useState(DEFAULT_SHOW_TABS);

  // Hydrate from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    setViewModeState(readViewMode());
    setShowTabsState(readShowTabs());
  }, []);

  const setViewMode = useCallback((next) => {
    const value = next === 'card' ? 'card' : 'sidebar';
    setViewModeState(value);
    try {
      localStorage.setItem(VIEW_MODE_KEY, value);
    } catch {}
  }, []);

  const setShowTabsInSidebar = useCallback((next) => {
    const value = !!next;
    setShowTabsState(value);
    try {
      localStorage.setItem(SHOW_TABS_KEY, String(value));
    } catch {}
  }, []);

  return { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar };
}
```

- [ ] **Step 2: Verify compile**

Run: `npm run build 2>&1 | grep "useSettingsViewPrefs"`
Expected: empty output (no errors). Pre-existing lint errors elsewhere are unrelated.

- [ ] **Step 3: Commit**

```bash
git add components/settings/useSettingsViewPrefs.js
git commit -m "$(cat <<'EOF'
feat(settings): add useSettingsViewPrefs hook

SSR-safe localStorage wrapper for the two new settings nav prefs:
- dd.settings.viewMode ('sidebar' | 'card', default sidebar)
- dd.settings.showTabsInSidebar (boolean, default false)

Same pattern as the existing inline loadCollapsed/saveCollapsed in
SettingsLayout.js. Returns defaults during SSR, hydrates on mount.

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Create `<SettingsTabs />` primitive

**Context:** Self-aware sibling tab strip. The page renders it once near the top with no props. The component looks up the current pathname, finds its group via `findGroupForPath`, reads view-mode prefs, and decides whether to render. When it renders, shows one tab per sibling in the group (excluding "Coming Soon"), with the current page marked active.

Visual styling matches `components/ui/SubTabs.js` (the existing top-of-page tab pattern in this app — pill-style active state, blue-600 background).

**Files:**
- Create: `components/settings/SettingsTabs.js` (~80 LoC)

- [ ] **Step 1: Create the component file**

Write `components/settings/SettingsTabs.js`:

```jsx
import { useRouter } from 'next/router';
import Link from 'next/link';
import { SETTINGS_SECTIONS, findGroupForPath } from '../../lib/settings-nav';
import useSettingsViewPrefs from './useSettingsViewPrefs';

/**
 * Self-aware intra-group sibling tab strip for settings pages.
 *
 * Reads the current pathname and view-mode prefs to decide whether to render.
 * In card mode it always renders. In sidebar mode it renders only when the
 * showTabsInSidebar pref is on. Returns null otherwise.
 *
 * When rendering, shows one tab per sibling page in the same group (excluding
 * the "Coming Soon" group). Current page's tab is marked active.
 *
 * Pages just call <SettingsTabs /> once near the top of their content; no
 * props needed. The component figures out the rest.
 */
export default function SettingsTabs({ className = '' }) {
  const router = useRouter();
  const pathname = router.pathname;
  const { viewMode, showTabsInSidebar } = useSettingsViewPrefs();

  // Decide whether to render at all
  const shouldRender =
    viewMode === 'card' || (viewMode === 'sidebar' && showTabsInSidebar);
  if (!shouldRender) return null;

  // Find the group for this path
  const groupName = findGroupForPath(pathname);
  if (!groupName || groupName === 'Coming Soon') return null;

  const section = SETTINGS_SECTIONS.find((s) => s.group === groupName);
  if (!section || section.items.length < 2) return null; // single-item groups don't need tabs

  return (
    <div
      className={`mb-[var(--space-section)] rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 inline-flex flex-wrap gap-1 ${className}`}
    >
      {section.items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + '/');
        const baseClasses =
          'flex items-center gap-2 px-4 py-2 text-body font-medium rounded-lg transition-all';
        const stateClasses = isActive
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-muted hover:text-strong hover:bg-gray-100 dark:hover:bg-slate-800';
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`${baseClasses} ${stateClasses}`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npm run build 2>&1 | grep "SettingsTabs"`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add components/settings/SettingsTabs.js
git commit -m "$(cat <<'EOF'
feat(settings): add SettingsTabs self-aware tab strip

Pages render <SettingsTabs /> with no props. The component:
- Reads pathname and finds the group via findGroupForPath
- Reads viewMode + showTabsInSidebar from useSettingsViewPrefs
- Returns null in sidebar mode when tabs are off, or when the group
  has fewer than 2 items, or for the Coming Soon group
- Otherwise renders a pill-style tab per sibling using design-system
  tokens (text-body, text-muted, text-strong)

Visual styling matches components/ui/SubTabs.js. Pages can mount this
unconditionally; it decides whether to appear.

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Create `<SettingsViewToggle />` dropdown

**Context:** Small "View ⇣" dropdown that controls the two prefs. In sidebar mode it lives in the sidebar header (mounted later in Task 3.4). In card mode it floats top-right of the main content (also mounted in Task 3.4). For Phase 1, just build the component in isolation.

**Files:**
- Create: `components/settings/SettingsViewToggle.js` (~110 LoC)

- [ ] **Step 1: Create the component file**

Write `components/settings/SettingsViewToggle.js`:

```jsx
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, LayoutGrid, SidebarOpen } from 'lucide-react';
import useSettingsViewPrefs from './useSettingsViewPrefs';

/**
 * "View ⇣" dropdown for settings nav preferences. Two controls:
 *   - Layout: radio between Sidebar view and Card view
 *   - Show sibling tabs: checkbox; disabled (forced-on) when Card view
 *     is selected, since tabs are mandatory in card mode
 *
 * Self-contained — reads/writes prefs via useSettingsViewPrefs. Closes
 * on outside click. No props required.
 */
export default function SettingsViewToggle({ className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar } =
    useSettingsViewPrefs();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const tabsForcedOn = viewMode === 'card';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-helper text-muted hover:text-strong px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
      >
        View
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-3 z-50">
          {/* Layout radios */}
          <div className="text-field-label text-muted mb-[var(--space-field-label)]">Layout</div>
          <div className="space-y-1 mb-3">
            <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-800/60">
              <input
                type="radio"
                name="dd-settings-view-mode"
                checked={viewMode === 'sidebar'}
                onChange={() => setViewMode('sidebar')}
                className="text-blue-600"
              />
              <SidebarOpen className="w-4 h-4 text-muted" />
              <span className="text-body text-strong">Sidebar view</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-800/60">
              <input
                type="radio"
                name="dd-settings-view-mode"
                checked={viewMode === 'card'}
                onChange={() => setViewMode('card')}
                className="text-blue-600"
              />
              <LayoutGrid className="w-4 h-4 text-muted" />
              <span className="text-body text-strong">Card view</span>
            </label>
          </div>

          <div className="border-t border-gray-100 dark:border-slate-800 pt-3">
            <label
              className={`flex items-center gap-2 p-1.5 rounded ${
                tabsForcedOn ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <input
                type="checkbox"
                checked={tabsForcedOn || showTabsInSidebar}
                disabled={tabsForcedOn}
                onChange={(e) => setShowTabsInSidebar(e.target.checked)}
                className="text-blue-600"
              />
              <span className="text-body text-strong">Show sibling tabs</span>
            </label>
            {tabsForcedOn && (
              <p className="text-helper text-muted mt-[var(--space-field-helper)] pl-7">
                Always shown in card view.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npm run build 2>&1 | grep "SettingsViewToggle"`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add components/settings/SettingsViewToggle.js
git commit -m "$(cat <<'EOF'
feat(settings): add SettingsViewToggle dropdown

"View ⇣" dropdown with two controls:
- Layout radio: Sidebar view vs Card view
- Show sibling tabs checkbox; disabled (forced-on) in Card view

Self-contained — reads/writes via useSettingsViewPrefs. Closes on
outside click. No props required. Will be mounted in SettingsLayout
(sidebar header in sidebar mode; floats top-right in card mode) in
a later phase.

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Persistent layout (smooth nav fix)

The `getLayout` pattern is additive — adding it to `_app.js` is a no-op for pages that don't define `Page.getLayout`. So we ship `_app.js` first, then convert all 12 settings pages in a single atomic commit (so smooth-nav lights up at once and bisecting stays clean).

---

### Task 2.1: Add `getLayout` support to `pages/_app.js`

**Context:** Make `_app.js` look for `Component.getLayout` and use it when present, falling back to identity. Backward-compatible — existing pages that don't define `getLayout` are unaffected.

**Files:**
- Modify: `pages/_app.js`

- [ ] **Step 1: Read current state**

Read `pages/_app.js` (39 LoC). Note the two render branches: admin route and tenant route.

- [ ] **Step 2: Apply the change**

Replace the entire file with:

```jsx
import '@/styles/globals.css';
import { useRouter } from 'next/router';
import { AuthProvider } from '../contexts/AuthContext';
import { AdminAuthProvider } from '../contexts/AdminAuthContext';
import { CompactModeProvider } from '../contexts/CompactModeContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { OverlayProvider } from '../contexts/OverlayContext';
import ImpersonationBanner from '../components/ImpersonationBanner';
import OverlayRenderer from '../components/OverlayRenderer';

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const isAdminRoute = router.pathname.startsWith('/admin');

  // Per-page layout opt-in: pages may export Component.getLayout to wrap
  // themselves in a persistent layout that survives route changes (e.g. the
  // settings shell). Pages that don't export it use the identity wrapper.
  const getLayout = Component.getLayout ?? ((page) => page);
  const page = getLayout(<Component {...pageProps} />);

  if (isAdminRoute) {
    return (
      <ThemeProvider>
        <AdminAuthProvider>{page}</AdminAuthProvider>
      </ThemeProvider>
    );
  }

  return (
    <AuthProvider>
      <ThemeProvider>
        <CompactModeProvider>
          <OverlayProvider>
            <ImpersonationBanner />
            {page}
            <OverlayRenderer />
          </OverlayProvider>
        </CompactModeProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Verify compile**

Run: `npm run build 2>&1 | grep "_app\.js"`
Expected: empty output.

- [ ] **Step 4: Verify nothing broke at runtime**

Start preview server (or reuse existing). Navigate to `/dashboard` (or any non-settings page). Should render exactly as before — no visible change.

- [ ] **Step 5: Commit**

```bash
git add pages/_app.js
git commit -m "$(cat <<'EOF'
feat(app): add per-page getLayout support in _app.js

Pages can now export Component.getLayout to wrap themselves in a
persistent layout that survives route changes. Backward-compatible:
pages without getLayout use the identity wrapper (existing behavior).

Used in the next commit by all 12 settings pages to make the settings
shell persistent across /settings/* navigation, eliminating the visible
flash and sidebar scroll reset.

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Convert all 12 settings pages to `getLayout`

**Context:** Replace each page's inline `<SettingsLayout>{...}</SettingsLayout>` wrap with a `Page.getLayout = (page) => <SettingsLayout title="…">{page}</SettingsLayout>` export. Single atomic commit — partial conversion would mean some sub-page transitions still re-mount the layout, which is worse than fully-old or fully-new.

**Files (modify all 12):**
- `pages/settings/profile.js`
- `pages/settings/company.js`
- `pages/settings/team.js`
- `pages/settings/branches.js`
- `pages/settings/terminals.js`
- `pages/settings/terminal-markets.js`
- `pages/settings/per-diem.js`
- `pages/settings/container-owners.js`
- `pages/settings/chassis-owners.js`
- `pages/settings/equipment-reference.js`
- `pages/settings/dispatcher-colors.js`
- `pages/settings/document-validation.js`
- `pages/settings/index.js`

(13 files including index — included for consistency even though the index has slightly different rendering.)

- [ ] **Step 1: Pattern reference**

For each page, the conversion follows this exact pattern:

**Before:**
```jsx
export default function CompanySettings() {
  return (
    <SettingsLayout title="Company Settings">
      <div className="max-w-4xl">
        …page content…
      </div>
    </SettingsLayout>
  );
}
```

**After:**
```jsx
function CompanySettings() {
  return (
    <div className="max-w-4xl">
      …page content…
    </div>
  );
}

CompanySettings.getLayout = (page) => (
  <SettingsLayout title="Company Settings">{page}</SettingsLayout>
);

export default CompanySettings;
```

The `SettingsLayout` import stays. The component itself just stops wrapping; the wrap moves to `getLayout`. The `title` prop value carries over verbatim.

- [ ] **Step 2: Apply the conversion to each of the 13 files**

For each file in the list above:

1. Read the file
2. Find the outermost JSX expression `<SettingsLayout title="…">…</SettingsLayout>`
3. Note the exact `title` value
4. Remove `<SettingsLayout>` wrapping from the return
5. Convert `export default function FooName()` to `function FooName()`
6. Add at the bottom (after the function):
   ```jsx
   FooName.getLayout = (page) => (
     <SettingsLayout title="…exact title…">{page}</SettingsLayout>
   );

   export default FooName;
   ```

For pages that pass additional props to `SettingsLayout` (none currently do — `title` is the only one), preserve them in the `getLayout` wrapper.

For `/settings/index.js`, the `SettingsLayout title="Settings"` wrap moves to `SettingsIndex.getLayout`; the function returns just the inner `<div className="max-w-3xl">…</div>`.

- [ ] **Step 3: Verify compile**

Run: `npm run build 2>&1 | grep -E "settings/(profile|company|team|branches|terminals|terminal-markets|per-diem|container-owners|chassis-owners|equipment-reference|dispatcher-colors|document-validation|index)\.js"`
Expected: only pre-existing lint errors (the four `react/no-unescaped-entities` apostrophes/quotes flagged in Plan C). No new errors.

- [ ] **Step 4: Verify smooth navigation**

Start the dev server (preview tool). Log in. Navigate `/settings → /settings/company → /settings/team → /settings/per-diem`. Confirm:

- The sidebar's `<aside>` does not visibly redraw between transitions
- If you scroll the sidebar partway down (e.g. expand all groups so it's tall) and then click a sibling, scroll position is preserved
- No console hydration warnings

If a transition still flashes, the page wasn't converted correctly — re-check that file.

- [ ] **Step 5: Commit**

```bash
git add pages/settings/*.js
git commit -m "$(cat <<'EOF'
refactor(settings): convert 13 settings pages to getLayout pattern

Replaces inline <SettingsLayout> wrap with Page.getLayout export so
the settings shell becomes a persistent layout. Sidebar scroll
position, group-collapse state, and any focus state now survive
navigation between /settings/* sub-pages — no more re-mount flash.

Atomic conversion: partial state would mean some transitions still
re-mount the layout, breaking the smoothness selectively. Single
commit so the behavior change is bisectable as a single point.

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: View modes

Add the `viewMode === 'card'` branch to `SettingsLayout`, build the card grid for `/settings`, and wire the toggle so the user can flip between modes.

---

### Task 3.1: Wire `<SettingsViewToggle />` into `SettingsLayout` (sidebar mode only)

**Context:** Mount the toggle in the sidebar header so users can change the pref. View mode branching itself comes in Task 3.3 — this task only mounts the toggle in the existing sidebar shell so the pref can be flipped (and observed via DevTools / localStorage) before the card-mode branch lights up.

**Files:**
- Modify: `components/settings/SettingsLayout.js`

- [ ] **Step 1: Read current state**

Read `components/settings/SettingsLayout.js` (162 LoC). Note the sidebar header at lines 71–76:

```jsx
<div className="px-5 py-4 border-b border-gray-200 dark:border-slate-800">
  <div className="flex items-center gap-2">
    <Settings className="w-5 h-5 text-gray-400 dark:text-slate-500" />
    <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Settings</h2>
  </div>
</div>
```

- [ ] **Step 2: Add the import**

At the top of the file, after the existing imports, add:

```jsx
import SettingsViewToggle from './SettingsViewToggle';
```

- [ ] **Step 3: Mount the toggle in the sidebar header**

Replace the sidebar header block with:

```jsx
<div className="px-5 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
  <div className="flex items-center gap-2">
    <Settings className="w-5 h-5 text-gray-400 dark:text-slate-500" />
    <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Settings</h2>
  </div>
  <SettingsViewToggle />
</div>
```

- [ ] **Step 4: Verify compile**

Run: `npm run build 2>&1 | grep "SettingsLayout"`
Expected: empty output.

- [ ] **Step 5: Verify the toggle works**

Reload `/settings/profile` in the preview. The "View ⇣" dropdown should appear in the top-right of the sidebar header. Click it; the dropdown opens. Flip "Card view"; the dropdown closes (or stays open per its UX), and `localStorage.getItem('dd.settings.viewMode')` returns `"card"`. Flip back; returns `"sidebar"`. Toggle "Show sibling tabs"; `dd.settings.showTabsInSidebar` toggles between `"true"` and `"false"`.

The page chrome itself does not visually change yet — that's the next task.

- [ ] **Step 6: Commit**

```bash
git add components/settings/SettingsLayout.js
git commit -m "$(cat <<'EOF'
feat(settings): mount SettingsViewToggle in sidebar header

Adds the "View ⇣" dropdown to the sidebar header so users can flip
the viewMode and showTabsInSidebar prefs. Doesn't change rendering
yet — view-mode branching lands in the next commit. This split lets
the pref-writing path be tested independently from the rendering
branch.

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: Add `viewMode === 'card'` branch to `SettingsLayout`

**Context:** When `viewMode === 'card'`, hide the `<aside>` sidebar entirely. Render a top breadcrumb (`← All Settings · {Group}`) above the children for sub-pages, and float the `<SettingsViewToggle />` in the top-right of the main content area. The `/settings` index gets special handling in Task 3.3.

**Files:**
- Modify: `components/settings/SettingsLayout.js`

- [ ] **Step 1: Add imports**

At the top of `SettingsLayout.js`, after the existing imports, add:

```jsx
import { ArrowLeft } from 'lucide-react';
import useSettingsViewPrefs from './useSettingsViewPrefs';
```

- [ ] **Step 2: Read prefs in the component**

Inside `SettingsLayout`, after the existing `const [collapsed, setCollapsed] = useState(...)` line, add:

```jsx
const { viewMode } = useSettingsViewPrefs();
```

- [ ] **Step 3: Branch the render**

Replace the entire `return (...)` block of `SettingsLayout` with:

```jsx
return (
  <TenantLayout
    title={title || 'Settings'}
    requiredPermission={[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]}
  >
    {viewMode === 'card' ? (
      <CardModeShell pathname={pathname}>{children}</CardModeShell>
    ) : (
      <SidebarModeShell
        pathname={pathname}
        collapsed={collapsed}
        toggleGroup={toggleGroup}
      >
        {children}
      </SidebarModeShell>
    )}
  </TenantLayout>
);
```

- [ ] **Step 4: Extract `SidebarModeShell` from the existing JSX**

At the bottom of `SettingsLayout.js`, after the `export default function SettingsLayout(...)` block, add the existing layout JSX as a sub-component:

```jsx
function SidebarModeShell({ pathname, collapsed, toggleGroup, children }) {
  return (
    <div className="flex gap-0 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 min-h-[calc(100vh-64px)]">
      {/* Left sidebar */}
      <aside className="w-[180px] sm:w-[220px] lg:w-[260px] shrink-0 border-r border-gray-200 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-900/60">
        <div className="sticky top-0 overflow-y-auto max-h-screen">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-400 dark:text-slate-500" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Settings</h2>
            </div>
            <SettingsViewToggle />
          </div>

          {/* Nav groups — existing JSX from lines 79–131 of the pre-Task-3.1 file */}
          <nav className="py-2">
            {SETTINGS_SECTIONS.map((section) => {
              const isCollapsed = !!collapsed[section.group];
              return (
                <div key={section.group} className="mb-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(section.group)}
                    className="w-full flex items-center justify-between px-5 py-2 text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
                  >
                    {section.group}
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    />
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5 pb-1">
                      {section.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                        return (
                          <Link
                            key={item.key}
                            href={item.href}
                            className={`flex items-center gap-2.5 px-5 py-2 text-sm transition-colors ${
                              isActive
                                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium border-r-2 border-blue-600 dark:border-blue-400'
                                : item.comingSoon
                                  ? 'text-gray-400 dark:text-slate-500 hover:text-gray-500 dark:hover:text-slate-400 hover:bg-gray-100/60 dark:hover:bg-slate-800/60'
                                  : 'text-gray-700 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100/60 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-slate-500'}`} />
                            <span className="truncate">{item.label}</span>
                            {item.comingSoon && (
                              <span className="ml-auto text-[9px] uppercase tracking-wide font-semibold bg-gray-200 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded shrink-0">
                                Soon
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Right content */}
      <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
```

Then remove the old inline JSX from the top-level `return` of `SettingsLayout` (already replaced in Step 3). The mobile select dropdown (currently `hidden` and unused) can be removed at the same time.

- [ ] **Step 5: Add `CardModeShell`**

At the bottom of the file, add:

```jsx
function CardModeShell({ pathname, children }) {
  const isIndex = pathname === '/settings';
  const groupName = isIndex ? null : findGroupForPath(pathname);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8 min-h-[calc(100vh-64px)]">
      {/* Top header row: breadcrumb (left) + view toggle (right) */}
      <div className="flex items-start justify-between mb-[var(--space-section)] gap-3">
        {!isIndex ? (
          <div className="flex items-center gap-2 text-helper text-muted">
            <Link href="/settings" className="flex items-center gap-1 hover:text-strong">
              <ArrowLeft className="w-3.5 h-3.5" />
              All Settings
            </Link>
            {groupName && groupName !== 'Coming Soon' && (
              <>
                <span aria-hidden="true">·</span>
                <span>{groupName}</span>
              </>
            )}
          </div>
        ) : (
          <div /> /* spacer so the toggle stays right-aligned on the index */
        )}
        <SettingsViewToggle />
      </div>

      {children}
    </main>
  );
}
```

The toggle sits in a flex header row alongside the breadcrumb (or a spacer on the index). Avoids the `absolute`-positioning fragility of overlay-style placement and lets the layout reflow naturally at narrow widths.

- [ ] **Step 6: Verify compile**

Run: `npm run build 2>&1 | grep "SettingsLayout"`
Expected: empty output.

- [ ] **Step 7: Verify both modes work**

In the preview:

1. With `viewMode === 'sidebar'` (default): `/settings/profile` renders the same as before — sidebar visible, content in main.
2. Open the toggle, pick `Card view`. The page should re-render: sidebar disappears, the floating "View ⇣" appears top-right, and a breadcrumb "← All Settings · General" appears above the profile content.
3. Pick `Sidebar view` again. Sidebar comes back.

The `/settings` index itself will look broken in card mode at this stage (it still renders the "What's here" SectionCard) — that gets fixed in the next task.

- [ ] **Step 8: Commit**

```bash
git add components/settings/SettingsLayout.js
git commit -m "$(cat <<'EOF'
feat(settings): branch SettingsLayout on viewMode

Splits the layout into SidebarModeShell (existing sticky-aside chrome)
and CardModeShell (no sidebar; breadcrumb + floating SettingsViewToggle).
SettingsLayout itself becomes a thin dispatcher that picks the shell
based on the viewMode pref.

Card mode renders breadcrumb "← All Settings · {Group}" above each
sub-page and floats the View toggle top-right. The /settings index
in card mode still renders the legacy "What's here" content — the
card grid itself ships in the next commit.

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.3: Build the card grid for `/settings` index

**Context:** When in card mode, `/settings` should render a card grid with one card per settings page (icon + label + short description), grouped by section. When in sidebar mode, it keeps the current "What's here" SectionCard layout from Plan C.

**Files:**
- Modify: `pages/settings/index.js`

- [ ] **Step 1: Read current state**

Read `pages/settings/index.js` (51 LoC after Plan C). Note its current structure: imports, `SettingsIndex` function returning the SectionCard summary, and the `getLayout` export added in Task 2.2.

- [ ] **Step 2: Add imports + descriptions**

The `SETTINGS_SECTIONS` items don't have descriptions. Rather than schema-changing `lib/settings-nav.js` (out of scope per spec), build a small description map inline in `index.js`. At the top:

```jsx
// Card-mode descriptions, keyed by item.key. New items default to '' (no description).
const ITEM_DESCRIPTIONS = {
  company: 'Company info, invoice defaults, branding, regional settings.',
  profile: 'Your name, email, password, and personal preferences.',
  charge_profiles: 'AR pricing rules and charge sets.',
  tariffs: 'Customer-facing rate sheets.',
  per_diem: 'Tiered per-diem free day pricing rules.',
  dispatcher_colors: 'Customize how loads appear on the Dispatcher board.',
  document_validation: 'Choose which document types require dispatcher approval.',
  container_owners: 'Steamship lines and container owner directory.',
  chassis_owners: 'Pool operators, leased fleets, and your own chassis fleet.',
  equipment_reference: 'Container types, container sizes, chassis types, chassis sizes.',
  terminal_markets: 'Enable the geographic markets where your operation runs.',
  terminals: 'Individual port and rail terminals; toggle and customize names.',
  branches: 'Regional offices or divisions for scoping users and loads.',
  team: 'Users, roles, and granular permissions.',
  comm_formatting: 'Email signature and template formatting defaults.',
  comm_templates: 'Outbound email template library.',
  comm_umbrellas: 'Email triggering rules grouped by event.',
  comm_configurations: 'Per-trigger email configuration.',
  comm_shared_accounts: 'Inbox accounts shared by the team.',
  comm_sender_domains: 'Verified sending domains.',
  comm_sender_addresses: 'Configured sender email addresses.',
  comm_trigger_activity: 'Recent automation trigger activity log.',
};
```

Also add the import:

```jsx
import useSettingsViewPrefs from '../../components/settings/useSettingsViewPrefs';
```

- [ ] **Step 3: Branch the render on `viewMode`**

Replace the body of `SettingsIndex` with:

```jsx
function SettingsIndex() {
  const { viewMode } = useSettingsViewPrefs();
  const groups = SETTINGS_SECTIONS.filter((s) => s.group !== 'Coming Soon');
  const comingSoon = SETTINGS_SECTIONS.find((s) => s.group === 'Coming Soon')?.items || [];

  if (viewMode === 'card') {
    return <CardGridIndex groups={groups} comingSoon={comingSoon} />;
  }

  // Sidebar-mode index — current Plan C "What's here" summary
  return (
    <div className="max-w-3xl">
      <PageHeader
        variant="plain"
        title={<><Settings className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Settings</>}
        description="Configure your company, team, and operational preferences. Pick a section from the sidebar to get started."
        className="mb-[var(--space-section)]"
      />
      <div className="space-y-[var(--space-section)]">
        <SectionCard title="What's here" columns={0}>
          <DetailPane>
            {groups.map((section) => (
              <DetailRow
                key={section.group}
                label={section.group}
                value={section.items.map((i) => i.label).join(' · ')}
              />
            ))}
          </DetailPane>
        </SectionCard>
        {comingSoon.length > 0 && (
          <SectionCard
            title="Coming soon"
            description="Planned features not yet available."
            columns={0}
          >
            <p className="text-helper text-muted">
              {comingSoon.map((i) => i.label).join(' · ')}
            </p>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add `CardGridIndex` sub-component**

Below `SettingsIndex` (and before the `getLayout` export), add:

```jsx
function CardGridIndex({ groups, comingSoon }) {
  return (
    <div className="max-w-6xl">
      <PageHeader
        variant="plain"
        title={<><Settings className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Settings</>}
        description="Configure your company, team, and operational preferences."
        className="mb-[var(--space-section)]"
      />
      <div className="space-y-[var(--space-section)]">
        {groups.map((section) => (
          <div key={section.group}>
            <h2 className="text-field-label text-muted mb-[var(--space-field-label)]">{section.group}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-field)]">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="block rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-[var(--space-section-pad)] hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-body font-semibold text-strong group-hover:text-blue-700 dark:group-hover:text-blue-300">
                          {item.label}
                        </div>
                        {ITEM_DESCRIPTIONS[item.key] && (
                          <p className="text-helper text-muted mt-[var(--space-field-helper)]">
                            {ITEM_DESCRIPTIONS[item.key]}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {comingSoon.length > 0 && (
          <div>
            <h2 className="text-field-label text-muted mb-[var(--space-field-label)]">Coming Soon</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-field)]">
              {comingSoon.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.key}
                    className="block rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-900/40 p-[var(--space-section-pad)] opacity-60"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 text-muted shrink-0 mt-0.5" />
                      <div>
                        <div className="text-body font-semibold text-muted">{item.label}</div>
                        <p className="text-helper text-muted mt-[var(--space-field-helper)]">Coming soon</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

Add `Link` to the imports if not already present: `import Link from 'next/link';`.

- [ ] **Step 5: Verify compile**

Run: `npm run build 2>&1 | grep "settings/index"`
Expected: empty output.

- [ ] **Step 6: Verify both modes**

In the preview:

1. Sidebar mode: `/settings` renders the existing "What's here" summary (no change).
2. Card mode: `/settings` renders the card grid grouped by section. Each card has icon + label + description. Hovering a card highlights the border. Clicking navigates to the sub-page (verified by changing pathname).
3. "Coming Soon" group renders as muted/disabled cards in both modes.

- [ ] **Step 7: Commit**

```bash
git add pages/settings/index.js
git commit -m "$(cat <<'EOF'
feat(settings): card-grid index in card view mode

When viewMode === 'card', /settings renders a 3-column card grid:
one card per settings page (icon + label + short description),
grouped by section. Sidebar mode keeps the current Plan C "What's here"
summary unchanged.

Coming Soon items render as muted/disabled cards in both modes.
Inline ITEM_DESCRIPTIONS map keeps lib/settings-nav.js schema
unchanged (per spec — non-goal to schema-change nav data).

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Tabs integration

Add `<SettingsTabs />` near the top of each of the 12 settings pages. It self-decides whether to render based on view-mode + pref. Single atomic commit, mechanical change.

---

### Task 4.1: Mount `<SettingsTabs />` on all 12 settings pages

**Context:** Each page renders `<SettingsTabs />` once near the top of its content (after PageHeader, before SectionCards). The component decides whether to actually appear based on view mode and the showTabsInSidebar pref.

The `/settings/index.js` index does NOT need `<SettingsTabs />` — it has no group siblings to switch between (it IS the group switcher). Skip it.

**Files (modify all 12):**
- `pages/settings/profile.js`
- `pages/settings/company.js`
- `pages/settings/team.js`
- `pages/settings/branches.js`
- `pages/settings/terminals.js`
- `pages/settings/terminal-markets.js`
- `pages/settings/per-diem.js`
- `pages/settings/container-owners.js`
- `pages/settings/chassis-owners.js`
- `pages/settings/equipment-reference.js`
- `pages/settings/dispatcher-colors.js`
- `pages/settings/document-validation.js`

- [ ] **Step 1: Pattern reference**

For each page, the change is:

1. Add import at top: `import SettingsTabs from '../../components/settings/SettingsTabs';`
2. Render `<SettingsTabs />` immediately after the page's `<PageHeader>` (or after the SCAC banner / error alerts if those sit between PageHeader and the first SectionCard — `<SettingsTabs />` belongs *above* the first SectionCard but *below* PageHeader and any page-level alerts).

Example (using `pages/settings/per-diem.js` as a template):

**Before (post-Phase-3 state):**
```jsx
return (
  <div className="space-y-[var(--space-section)]">
    <PageHeader … />
    {error && <Alert … />}
    {/* stats grid */}
    <div className="grid grid-cols-2 …">…</div>
    <SectionCard title="Filter" columns={0}>…</SectionCard>
    …
  </div>
);
```

**After:**
```jsx
return (
  <div className="space-y-[var(--space-section)]">
    <PageHeader … />
    <SettingsTabs />
    {error && <Alert … />}
    {/* stats grid */}
    <div className="grid grid-cols-2 …">…</div>
    <SectionCard title="Filter" columns={0}>…</SectionCard>
    …
  </div>
);
```

The component returns `null` in sidebar mode (default), so this insertion is a no-op for the default view. It activates when:
- `viewMode === 'card'` (always shows in card mode), OR
- `viewMode === 'sidebar'` AND `showTabsInSidebar === true`

- [ ] **Step 2: Apply to each of the 12 files**

For each page in the list above:

1. Read the file
2. Add the import
3. Insert `<SettingsTabs />` immediately after the page's `<PageHeader … />` JSX (and before any alerts/banners that follow PageHeader)

For `pages/settings/company.js`, the SCAC warning banner sits between PageHeader and the first SectionCard. Place `<SettingsTabs />` between the PageHeader and the SCAC banner so it lives at the very top of page content.

For `pages/settings/equipment-reference.js`, place `<SettingsTabs />` between PageHeader and the existing `<SubTabs>` (the sub-tabs for Container Types / Container Sizes / etc. are intra-page, not intra-group). The visual will be: SettingsTabs (group nav) above SubTabs (in-page nav) — nested but distinct.

- [ ] **Step 3: Verify compile**

Run: `npm run build 2>&1 | grep -E "pages/settings/(profile|company|team|branches|terminals|terminal-markets|per-diem|container-owners|chassis-owners|equipment-reference|dispatcher-colors|document-validation)\.js"`
Expected: only pre-existing lint errors (apostrophes/quotes). No new errors.

- [ ] **Step 4: Verify tabs work in card mode**

In the preview, with `viewMode === 'card'`:

- Navigate to `/settings/container-owners`. A tab strip should appear at the top showing: Container Owners | Chassis Owners | Equipment Reference | Terminal Markets | Terminals (the 5 items in the Equipment group). Container Owners is active (blue pill). Click "Chassis Owners" — page navigates, active tab updates, sidebar (which is hidden in card mode) doesn't try to update.
- Navigate to `/settings/profile`. Group is "General" with 2 items: Company Info | My Account. Tab strip shows both.
- Navigate to `/settings/dispatcher-colors`. Group is "Operations" with 2 items: Dispatcher Appearance | Document Validation. Tab strip shows both.

- [ ] **Step 5: Verify tabs in sidebar mode (default off)**

Switch to `viewMode === 'sidebar'`. Confirm `showTabsInSidebar` is `false`. Visit the same pages — no tab strip should appear (the sidebar is the sibling switcher).

- [ ] **Step 6: Verify tabs in sidebar mode with toggle on**

Switch on "Show sibling tabs". The tabs should now appear above each page's content, in addition to the sidebar.

- [ ] **Step 7: Commit**

```bash
git add pages/settings/*.js
git commit -m "$(cat <<'EOF'
feat(settings): mount <SettingsTabs /> on 12 settings pages

Each page renders <SettingsTabs /> once near the top of content. The
component decides whether to actually appear based on viewMode +
showTabsInSidebar prefs:

  - card mode: always shows
  - sidebar mode + showTabsInSidebar=true: shows
  - sidebar mode + showTabsInSidebar=false (default): null

Pages stay dumb — no per-page mode logic. Atomic single commit so
the tabs light up across all sub-pages at the same moment.

The /settings index does not get tabs (it has no group siblings).
The communications subsystem (9 sub-pages) does not get tabs (out
of Plan E scope).

Part of UI Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Polish + verification

---

### Task 5.1: Update `docs/ui-system.md`

**Context:** Document the new `getLayout` pattern + the two new settings primitives so future contributors find them.

**Files:**
- Modify: `docs/ui-system.md`

- [ ] **Step 1: Read the current doc**

Read `docs/ui-system.md`. Note the structure: tokens, primitives, governance, dark mode, compact mode, when to add a primitive, consumers, FAQ.

- [ ] **Step 2: Append a new section before "## 8. FAQ"**

Insert this new section immediately before the FAQ section (just before the line `## 8. FAQ`):

```markdown
## 8. Settings shell (Plan E, 2026-04-16)

The settings shell uses three additional primitives + a Pages Router pattern. They live in `components/settings/` rather than `components/ui/` because they're scoped to `/settings/*` only.

### `useSettingsViewPrefs()` — view preferences hook

```jsx
import useSettingsViewPrefs from '../../components/settings/useSettingsViewPrefs';

const { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar } = useSettingsViewPrefs();
```

- `viewMode` — `'sidebar'` (default) or `'card'`. Persists to `dd.settings.viewMode` localStorage.
- `showTabsInSidebar` — boolean. Only meaningful when `viewMode === 'sidebar'`. Persists to `dd.settings.showTabsInSidebar`.
- SSR-safe — returns defaults during server render, hydrates on mount.

### `<SettingsTabs />` — self-aware sibling tabs

```jsx
import SettingsTabs from '../../components/settings/SettingsTabs';

<SettingsTabs />
```

Pages render this once near the top of content. No props. The component reads pathname, finds the group via `findGroupForPath`, reads view-mode prefs, and decides whether to render. In card mode it always renders; in sidebar mode it renders only when `showTabsInSidebar` is on.

### `<SettingsViewToggle />` — view dropdown

```jsx
import SettingsViewToggle from '../../components/settings/SettingsViewToggle';

<SettingsViewToggle />
```

Mounted once per layout (sidebar header in sidebar mode; floating top-right in card mode). Self-contained — reads/writes via `useSettingsViewPrefs`.

### Pages Router persistent layout pattern

Settings pages use Next.js Pages Router's `getLayout` opt-in to keep `<SettingsLayout>` mounted across `/settings/*` route changes:

```jsx
function CompanySettings() {
  return <>…page content…</>;
}

CompanySettings.getLayout = (page) => (
  <SettingsLayout title="Company Settings">{page}</SettingsLayout>
);

export default CompanySettings;
```

`pages/_app.js` reads `Component.getLayout` and applies it before rendering. Pages without `getLayout` use the identity wrapper, so this is backward-compatible. Keeping the layout mounted preserves sidebar scroll position, group-collapse state, and any focus state across navigation.
```

- [ ] **Step 3: Update Section 7 "Consumers" to mention Plan E**

In Section 7, append after the "Settings pages — Plan C" line:

```markdown
- **Settings shell — Plan E (2026-04-16):** persistent layout via `getLayout`, view-mode toggle (sidebar / card), self-aware `<SettingsTabs />` for intra-group sibling switching. See Section 8 below.
```

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | grep "ui-system"`
Expected: empty output (markdown isn't lint-checked, but worth a sanity check).

- [ ] **Step 5: Commit**

```bash
git add docs/ui-system.md
git commit -m "$(cat <<'EOF'
docs(ui-system): document Plan E settings shell additions

Adds Section 8 covering:
- useSettingsViewPrefs hook
- <SettingsTabs /> self-aware tab strip
- <SettingsViewToggle /> dropdown
- Next.js Pages Router getLayout persistent-layout pattern

Updates Section 7 consumers list with Plan E.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2: Final verification + push

**Context:** Whole-plan QA. Build, dev server walk in both view modes, light/dark/compact/zoom passes, then push.

- [ ] **Step 1: Clean build**

Run: `npm run build`
Expected: no NEW lint errors introduced. The pre-existing `react/no-unescaped-entities` errors in 4 settings files predate Plan C and are out of scope.

- [ ] **Step 2: Smooth-nav verification**

In the preview (logged in), open `/settings/profile`. Open DevTools console. Navigate sequentially:

1. `/settings/profile` → `/settings/company` → `/settings/team` → `/settings/per-diem` → `/settings/dispatcher-colors`

Confirm:
- The settings sidebar `<aside>` does not unmount/remount between any of these clicks (you can verify by adding a temporary `console.log('SettingsLayout mount')` to a `useEffect(() => …, [])` inside SettingsLayout — should fire only once across all five clicks; remove the log after verifying)
- No console hydration warnings introduced by Plan E (the pre-existing equipment-reference DnD warning may still fire — out of scope)
- No visible flash of the layout itself between navigations

- [ ] **Step 3: Card mode walk**

Open the View ⇣ toggle, switch to Card view. Walk:

- `/settings` → card grid renders. Hover a card; border highlights; click navigates.
- Each of the 12 sub-pages → renders without sidebar; breadcrumb at top reads `← All Settings · {Group}`; SettingsTabs strip renders below for groups with multiple items.
- Click "All Settings" in the breadcrumb → returns to card grid.
- Click a sibling tab → navigates without scroll reset.

- [ ] **Step 4: Sidebar mode + tabs toggle**

Switch back to Sidebar view. Confirm tabs are hidden by default. Open View ⇣, toggle "Show sibling tabs" on. Tabs now appear above each page's content. Toggle off; they disappear.

- [ ] **Step 5: Persistence**

Hard reload the browser. View mode and show-tabs preference both persist (read from localStorage). Confirm via DevTools: `localStorage.getItem('dd.settings.viewMode')` and `localStorage.getItem('dd.settings.showTabsInSidebar')` reflect last-chosen values.

- [ ] **Step 6: Dark mode pass**

Toggle dark mode (theme switcher in top bar). Walk a few pages in each view mode. Confirm:

- Card grid cards have proper dark backgrounds + light text
- Tab strip is readable (text-muted on hover-strong, blue-600 active)
- Breadcrumb text-muted is readable on dark
- Toggle dropdown panel renders correctly on dark

- [ ] **Step 7: Compact mode pass**

Toggle compact mode (existing UI). Confirm spacing tightens across both view modes.

- [ ] **Step 8: Zoom 80/100/125 pass**

Browser zoom to 80%, 100%, 125%. Confirm no horizontal scrollbars on the content pane in either view mode. Card grid reflows correctly. Tab strip wraps if too wide (the `flex-wrap` in `SettingsTabs.js` handles this).

- [ ] **Step 9: Git log sanity**

Run: `git log --oneline bfed6e4..HEAD` (range starts after the spec commit)
Expected: 10 commits — Phase 1 (3) + Phase 2 (2) + Phase 3 (3) + Phase 4 (1) + Phase 5 (1). All ending with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.

- [ ] **Step 10: Push**

```bash
git push origin main
```

No PR — solo-dev workflow per Plans A/B/C convention.

Write a brief release note in chat summarizing what shipped.

---

## Summary

11 commits across 5 phases. 3 new files in `components/settings/`, 14 modified files (`_app.js` + 12 settings pages + `docs/ui-system.md`). Zero new design-system tokens or `components/ui/` primitives — all new pieces are settings-scoped and live in `components/settings/`. Smooth navigation via the standard Pages Router persistent-layout pattern. Two view modes backed by the same `SETTINGS_SECTIONS` data. Self-aware tab strip means pages stay dumb.

When a user opens `/settings` after this lands, they get whichever view mode they last chose, no flash on click, and (if they've opted into card mode or the sidebar-mode tab toggle) one-click switching between sibling pages within a group.
