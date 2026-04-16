# Settings Navigation — Design Spec (Plan E)

**Date:** 2026-04-16
**Status:** Draft, awaiting plan
**Predecessors:** UI Plans A, B, C (design system) — `docs/ui-system.md`

---

## 1. Goal

Three settings-nav improvements ship together as one coherent UX pass:

1. **Smooth navigation** — clicking a sidebar item never causes the layout to re-mount. Sidebar scroll position preserved. No flash.
2. **View mode toggle** — user picks between "Sidebar view" (current default) and "Card view" (no sidebar; uses a card grid index + breadcrumb on sub-pages). Setting persists per-device.
3. **Intra-group tabs** — sub-pages can show quick-switch tabs across siblings in the same group (e.g. Container Owners | Chassis Owners | Equipment Reference | Terminal Markets | Terminals). Always shown in card mode. Hidden by default in sidebar mode, opt-in via toggle.

---

## 2. Why now

- Plan C left the settings shell visually polished, but every navigation between `/settings/*` sub-pages re-mounts `SettingsLayout`, causing a brief flash and resetting the sidebar's scroll position.
- The original `/settings` index was a card grid that mirrored the sidebar; Plan C reduced it to a "What's here" summary on the assumption a single nav style was correct. Real-world feedback: users want both, switchable.
- Once a user is deep in a group (e.g. Equipment), quickly switching siblings via the sidebar is friction-heavy. A tab strip across siblings would be faster.

These three pain points all live in the same surface (the settings shell), so bundling them into one plan keeps the design coherent.

---

## 3. Architecture

### 3.1 Persistent layout via `getLayout`

Today every settings page wraps itself:

```jsx
// pages/settings/company.js (current)
export default function CompanySettings() {
  return (
    <SettingsLayout title="Company Settings">
      …page content…
    </SettingsLayout>
  );
}
```

This means React unmounts and remounts `<SettingsLayout>` on every navigation. The sidebar (`<aside>`) loses scroll position and visibly redraws.

**Fix:** adopt the standard Next.js Pages Router persistent-layout pattern.

```jsx
// pages/settings/company.js (target)
function CompanySettings() {
  return <>…page content…</>;
}
CompanySettings.getLayout = (page) => <SettingsLayout title="Company Settings">{page}</SettingsLayout>;
export default CompanySettings;
```

```jsx
// pages/_app.js (target, additive)
export default function App({ Component, pageProps }) {
  const getLayout = Component.getLayout ?? ((page) => page);
  return (
    <AllProviders>
      {getLayout(<Component {...pageProps} />)}
    </AllProviders>
  );
}
```

When two consecutive routes share `getLayout`, React's reconciler keeps `<SettingsLayout>` mounted. The page content swaps as a child. The sidebar's scroll position, group-collapse state, and any hover/focus state all persist.

### 3.2 Two view modes, one data source

`lib/settings-nav.js`'s `SETTINGS_SECTIONS` stays the single source of truth. Both view modes consume it.

**`SettingsLayout` branches on `viewMode`:**

```
SettingsLayout
├── viewMode === 'sidebar' (default)
│   ├── <aside>             ← sticky left rail with full nav (current behavior)
│   ├── <SettingsViewToggle /> ← in the aside header
│   └── <main>{children}</main>
│
└── viewMode === 'card'
    ├── <SettingsViewToggle /> ← floating top-right corner
    └── <main>
        ├── on /settings:    <SettingsCardGrid />
        └── on /settings/<sub>:
              <SettingsBreadcrumb />
              {children}      ← page renders <SettingsTabs /> at top
```

### 3.3 Self-aware `<SettingsTabs />`

Pages always render `<SettingsTabs />` near the top of their content. The component:

1. Reads the current `pathname` via `useRouter`
2. Looks up which group it belongs to via `findGroupForPath` (already in `lib/settings-nav.js`)
3. Reads `viewMode` and `showTabsInSidebar` from `useSettingsViewPrefs()`
4. Decision table:

   | viewMode | showTabsInSidebar | Result |
   |---|---|---|
   | `'card'` | (any) | render tabs |
   | `'sidebar'` | `true` | render tabs |
   | `'sidebar'` | `false` | return `null` |

5. When rendering, shows one tab per sibling in the same group, with the current page's tab marked active. Uses the styling of `components/ui/SubTabs.js` (already a primitive in the codebase).

This keeps page code dumb — every page does `<SettingsTabs />` once and the component figures out whether to appear.

### 3.4 `<SettingsViewToggle />`

Small "View ⇣" dropdown. Two controls inside:

- **Layout:** radio between `Sidebar view` and `Card view`
- **Show sibling tabs:** checkbox. When `Card view` is selected, this checkbox is rendered in a disabled state (greyed) and shown as forced-on, because tabs are mandatory in card mode. The user can read but not change it. Re-enables when they switch back to `Sidebar view`.

In sidebar mode the toggle lives in the sidebar header (top-right of the `<aside>`). In card mode it floats in the top-right corner of the main content area. Closes on outside-click. No animation between mode switches.

### 3.5 `<SettingsCardGrid />` (card mode `/settings`)

Renders `SETTINGS_SECTIONS` as a grid of cards grouped by section header. Each card = one settings page (icon + label + short description). Click → navigate. Same data shape, same icons, no new fields needed in `settings-nav.js`. "Coming Soon" group renders as muted/disabled cards (matching current sidebar treatment).

### 3.6 `<SettingsBreadcrumb />` (card mode `/settings/<sub>`)

Two-level breadcrumb: `← All Settings` · `Equipment` (the group label). Both hoverable. Click "All Settings" → navigate to `/settings`. The group label is plain text (not a link) — within-group sibling switching is handled entirely by `<SettingsTabs />` directly below the breadcrumb, so no popover is needed.

---

## 4. State persistence

Two new localStorage keys, following the existing `dd.*` convention (`dd.theme`, `dd.compact`, `dd.settings.collapsed`):

| Key | Values | Default | Notes |
|---|---|---|---|
| `dd.settings.viewMode` | `'sidebar'` \| `'card'` | `'sidebar'` | Per-device, no server sync |
| `dd.settings.showTabsInSidebar` | `'true'` \| `'false'` | `'false'` | Only meaningful when `viewMode === 'sidebar'` |

A small hook `useSettingsViewPrefs()` lives in `components/settings/useSettingsViewPrefs.js` and exposes:

```js
const { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar } = useSettingsViewPrefs();
```

SSR-safe — returns defaults on server-render, then hydrates from localStorage on mount. Same pattern as `loadCollapsed` / `saveCollapsed` already in `SettingsLayout.js`.

No DB migration. No `tenant_settings` schema change.

---

## 5. File inventory

### New files (3)

| Path | Purpose | Approx LoC |
|---|---|---|
| `components/settings/SettingsTabs.js` | Self-aware sibling tab strip; uses SubTabs styling | 60 |
| `components/settings/SettingsViewToggle.js` | "View ⇣" dropdown with the two controls | 80 |
| `components/settings/useSettingsViewPrefs.js` | SSR-safe localStorage hook | 30 |

Optionally split out `<SettingsCardGrid />` and `<SettingsBreadcrumb />` if the rendering logic grows beyond a few dozen lines; otherwise keep them inline in `SettingsLayout` and `pages/settings/index.js` respectively.

### Changed files (15)

| Path | Change | Approx delta |
|---|---|---|
| `pages/_app.js` | Adopt `getLayout` pattern | +5 LoC |
| `components/settings/SettingsLayout.js` | Branch on `viewMode`, mount `<SettingsViewToggle />` | +80 LoC |
| `pages/settings/index.js` | Branch on `viewMode`: card grid OR current "What's here" summary | +40 LoC |
| 12 settings pages: `profile.js`, `company.js`, `team.js`, `branches.js`, `terminals.js`, `terminal-markets.js`, `per-diem.js`, `container-owners.js`, `chassis-owners.js`, `equipment-reference.js`, `dispatcher-colors.js`, `document-validation.js` | Replace inline `<SettingsLayout>` wrap with `Page.getLayout = …`; add `<SettingsTabs />` near top of content | +/- ~10 LoC each |
| `docs/ui-system.md` | Document `getLayout` pattern + new settings primitives | +30 LoC |

### Untouched

- `lib/settings-nav.js` — data shape unchanged
- `pages/settings/charge-profiles/*`, `pages/settings/tariffs/*`, `pages/settings/driver-tariffs/*` — out of Plan C scope, stay out of Plan E
- `pages/settings/communications/**` (9 sub-pages) — stay in sidebar mode regardless of toggle; will not render `<SettingsTabs />` until the communications subsystem itself is refactored. The view-mode toggle still works on the `/settings` index when navigating to/from these pages.
- `components/ui/SubTabs.js` — consumed by `SettingsTabs` as-is, no changes
- All other primitives shipped in Plans A/B/C

---

## 6. Mobile behavior

- **Sidebar mode on mobile:** unchanged from current — the sidebar collapses into the existing `<select>` dropdown nav at narrow widths
- **Card mode on mobile:** the card grid stacks 1-column. Sub-pages show breadcrumb + horizontally-scrollable `<SettingsTabs />` at the top. No new breakpoints introduced.
- The `<SettingsViewToggle />` is reachable on both via the existing top-bar overflow / sidebar header.

---

## 7. Non-goals

- No animation between view-mode switches — instant swap
- No migration of existing localStorage keys (`dd.settings.collapsed` etc.) — unchanged
- No URL state for view mode (no `?view=cards`) — pure preference, not bookmarkable
- No keyboard shortcut for switching view (could be a future polish pass)
- No server-side persistence of view mode — localStorage only, matches existing convention
- No A/B telemetry on which view mode users prefer — out of scope, can be added later
- No changes to `/settings/communications/**` chrome (Plan D candidate)
- No fix for the pre-existing equipment-reference DnD-inside-`<table>` hydration warning (separate side-task already spawned)

---

## 8. Success criteria

A user with this build can:

1. Navigate `/settings → /settings/company → /settings/team` and observe the sidebar's scroll position is preserved across each click; no visible flash of the layout itself.
2. Open the "View ⇣" dropdown in the sidebar header and pick "Card view"; the page reloads to `/settings` showing the card grid index. Pick "Sidebar view" again and revert.
3. While in sidebar mode, open the "View ⇣" dropdown and toggle "Show sibling tabs"; sibling tabs appear above page content.
4. While viewing `/settings/container-owners` (in either mode), click the "Chassis Owners" tab in the strip → navigate without scroll reset, tab strip updates active state.
5. Refresh the page → preferences persist (view mode + show-tabs).
6. Build clean (`npm run build`). No new lint errors. No new hydration warnings (the pre-existing equipment-reference warning is out of scope).
7. Dark + compact + zoom 80/100/125 all clean across the 13 settings pages.

---

## 9. Open questions

None at design time. All clarifications resolved during brainstorming:

- Q: Does the toggle apply per-page or globally? **A: Globally, per-device.**
- Q: How does the user navigate inside a sub-page in card mode? **A: Breadcrumb + intra-group tabs (Option B from mockups).**
- Q: Should tabs always render in sidebar mode? **A: No — opt-in via toggle.**
- Q: Where does the toggle live? **A: In the sidebar header (in-context).**
- Q: localStorage or server-stored prefs? **A: localStorage, matches existing `dd.*` convention.**
