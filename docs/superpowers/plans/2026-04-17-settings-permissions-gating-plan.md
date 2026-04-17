# Settings Permissions Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-item `requiredPermission` metadata to settings nav, filter the sidebar + card grid by the current user's permissions, and enforce those permissions on direct URL access.

**Architecture:** Data change in `lib/settings-nav.js` (+ one pure helper), filter + enforce in `components/settings/SettingsLayout.js`, filter in `pages/settings/index.js`. Single source of truth: the nav registry. Mirrors the `TenantSidebar` filter pattern already in production. Skeleton rendered during `useAuth().loading` to prevent content flash.

**Tech Stack:** Next.js Pages Router, React 19, Tailwind v4, Supabase auth via `contexts/AuthContext.js`, `lucide-react` icons. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-17-settings-permissions-gating-design.md`

**Branch:** `main`. Before each commit: `git branch --show-current` must return `main` (parallel Advanced Route Cowork session has intermittently swapped workspace branches — recovery pattern in `session_2026_04_17_handoff.md`).

**No automated tests in this plan.** The codebase uses Cowork manual QA (per the spec). The implementer does a local sanity check after each task; Cowork runs the full permission matrix post-merge.

---

## Task 1: Extend `settings-nav.js` — per-item `requiredPermission` + `findItemForPath` helper

**Files:**
- Modify: `lib/settings-nav.js` (add fields to items in `SETTINGS_SECTIONS`, add new helper after `findGroupForPath`)

**Context for the implementer:**
- `lib/settings-nav.js` already imports `PERMISSIONS` from `./permissions` (line 26).
- Communications items already have `requiredPermission` set (do not re-add; do not change their values).
- Coming Soon items should NOT get `requiredPermission` (they are marketing visibility).
- My Account should NOT get `requiredPermission` (everyone can manage their own account).
- All other non-Communications items get a `requiredPermission` per the mapping in the spec.

**Mapping reminder (from spec):**

| Item `key` | `requiredPermission` |
|---|---|
| `company` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |
| `profile` | _(none — do not add)_ |
| `charge_profiles` | `[PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL]` |
| `tariffs` | `[PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL]` |
| `driver_tariffs` | `[PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL]` |
| `per_diem` | `[PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL]` |
| `dispatcher_colors` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |
| `document_validation` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |
| `container_owners` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |
| `chassis_owners` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |
| `equipment_reference` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |
| `terminal_markets` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |
| `terminals` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |
| `branches` | `[PERMISSIONS.MANAGE_BRANCHES, PERMISSIONS.ALL]` |
| `team` | `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` |

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

Expected: `main`. If anything else, stop and apply the recovery pattern from `session_2026_04_17_handoff.md` before proceeding.

- [ ] **Step 2: Add `requiredPermission` to the General group — Company Info only**

Edit `lib/settings-nav.js`. Change the Company Info item from:

```js
{ key: 'company', label: 'Company Info', href: '/settings/company', icon: Building2 },
```

to:

```js
{ key: 'company', label: 'Company Info', href: '/settings/company', icon: Building2, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
```

Leave the My Account item unchanged (no `requiredPermission`).

- [ ] **Step 3: Add `requiredPermission` to the Pricing group — 4 items**

Replace the entire Pricing group's items array. Before:

```js
{
  group: 'Pricing',
  items: [
    { key: 'charge_profiles', label: 'Charge Profiles', href: '/settings/charge-profiles', icon: DollarSign },
    { key: 'tariffs', label: 'Load Tariffs', href: '/settings/tariffs', icon: Tag },
    { key: 'driver_tariffs', label: 'Driver Tariffs', href: '/settings/driver-tariffs', icon: Truck },
    { key: 'per_diem', label: 'Per Diem Pricing', href: '/settings/per-diem', icon: Calculator },
  ],
},
```

After:

```js
{
  group: 'Pricing',
  items: [
    { key: 'charge_profiles', label: 'Charge Profiles', href: '/settings/charge-profiles', icon: DollarSign, requiredPermission: [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL] },
    { key: 'tariffs', label: 'Load Tariffs', href: '/settings/tariffs', icon: Tag, requiredPermission: [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL] },
    { key: 'driver_tariffs', label: 'Driver Tariffs', href: '/settings/driver-tariffs', icon: Truck, requiredPermission: [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL] },
    { key: 'per_diem', label: 'Per Diem Pricing', href: '/settings/per-diem', icon: Calculator, requiredPermission: [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL] },
  ],
},
```

Note: Driver Tariffs uses `ACCOUNTS_PAYABLE` (driver pay is AP), the other three use `ACCOUNTS_RECEIVABLE` (customer billing is AR).

- [ ] **Step 4: Add `requiredPermission` to the Operations group — 2 items**

Replace the Operations group's items. Before:

```js
{
  group: 'Operations',
  items: [
    { key: 'dispatcher_colors', label: 'Dispatcher Appearance', href: '/settings/dispatcher-colors', icon: Palette },
    { key: 'document_validation', label: 'Document Validation', href: '/settings/document-validation', icon: ShieldCheck },
  ],
},
```

After:

```js
{
  group: 'Operations',
  items: [
    { key: 'dispatcher_colors', label: 'Dispatcher Appearance', href: '/settings/dispatcher-colors', icon: Palette, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
    { key: 'document_validation', label: 'Document Validation', href: '/settings/document-validation', icon: ShieldCheck, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
  ],
},
```

- [ ] **Step 5: Add `requiredPermission` to the Equipment group — 5 items**

Replace the Equipment group's items. Before:

```js
{
  group: 'Equipment',
  items: [
    { key: 'container_owners', label: 'Container Owners', href: '/settings/container-owners', icon: Ship },
    { key: 'chassis_owners', label: 'Chassis Owners', href: '/settings/chassis-owners', icon: Truck },
    { key: 'equipment_reference', label: 'Equipment Reference', href: '/settings/equipment-reference', icon: Box },
    { key: 'terminal_markets', label: 'Terminal Markets', href: '/settings/terminal-markets', icon: Train },
    { key: 'terminals', label: 'Terminals', href: '/settings/terminals', icon: MapPinIcon },
  ],
},
```

After:

```js
{
  group: 'Equipment',
  items: [
    { key: 'container_owners', label: 'Container Owners', href: '/settings/container-owners', icon: Ship, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
    { key: 'chassis_owners', label: 'Chassis Owners', href: '/settings/chassis-owners', icon: Truck, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
    { key: 'equipment_reference', label: 'Equipment Reference', href: '/settings/equipment-reference', icon: Box, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
    { key: 'terminal_markets', label: 'Terminal Markets', href: '/settings/terminal-markets', icon: Train, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
    { key: 'terminals', label: 'Terminals', href: '/settings/terminals', icon: MapPinIcon, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
  ],
},
```

- [ ] **Step 6: Add `requiredPermission` to the Team group — Branches uses MANAGE_BRANCHES, Team uses SETTINGS**

Replace the Team group's items. Before:

```js
{
  group: 'Team',
  items: [
    { key: 'branches', label: 'Branches', href: '/settings/branches', icon: GitBranch },
    { key: 'team', label: 'Team & Permissions', href: '/settings/team', icon: Users },
  ],
},
```

After:

```js
{
  group: 'Team',
  items: [
    { key: 'branches', label: 'Branches', href: '/settings/branches', icon: GitBranch, requiredPermission: [PERMISSIONS.MANAGE_BRANCHES, PERMISSIONS.ALL] },
    { key: 'team', label: 'Team & Permissions', href: '/settings/team', icon: Users, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
  ],
},
```

- [ ] **Step 7: Add `findItemForPath` helper at the bottom of the file**

The file currently ends with the `findGroupForPath` function (around line 152-161). After the closing brace of `findGroupForPath`, add a blank line and the new helper:

```js
/**
 * Find the settings item matching a pathname. Used by SettingsLayout to
 * derive the requiredPermission for a given route.
 */
export function findItemForPath(pathname) {
  for (const section of SETTINGS_SECTIONS) {
    for (const item of section.items) {
      if (item.href === pathname || pathname.startsWith(item.href + '/')) {
        return item;
      }
    }
  }
  return null;
}
```

This mirrors the shape of `findGroupForPath` but returns the matching item object instead of its group name.

- [ ] **Step 8: Verify the data change**

Run:

```bash
git diff lib/settings-nav.js | grep -c "requiredPermission"
```

Expected: a number `>= 22`. Breakdown: 8 existing Communications items already had it → unchanged minus/plus lines cancel out; you should see `+14` new lines for the 14 newly-gated items (Company, 4 Pricing, 2 Operations, 5 Equipment, 2 Team). My Account, all Coming Soon items, and pre-existing Communications items should NOT produce new diff lines for `requiredPermission`.

Sanity check via grep:

```bash
grep -c "requiredPermission" lib/settings-nav.js
```

Expected: `22` (8 Communications + 14 new = 22).

Also verify `findItemForPath` was added:

```bash
grep -n "export function findItemForPath" lib/settings-nav.js
```

Expected: one match, line number > 160.

- [ ] **Step 9: Verify branch is still `main` before committing**

```bash
git branch --show-current
```

Expected: `main`. If not, apply recovery pattern.

- [ ] **Step 10: Commit**

```bash
git add lib/settings-nav.js
git commit -m "$(cat <<'EOF'
feat(settings-nav): add requiredPermission metadata and findItemForPath helper

Add requiredPermission fields to all non-Communications settings items
per the locked mapping (Pricing split AR/AP, Branches = MANAGE_BRANCHES,
Team and admin-y items at SETTINGS baseline). Add findItemForPath helper
so SettingsLayout can derive a per-page requiredPermission from the
current pathname.

Spec: docs/superpowers/specs/2026-04-17-settings-permissions-gating-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds on branch `main`.

---

## Task 2: Update `SettingsLayout.js` — useAuth + filter + per-page enforcement + skeleton

**Files:**
- Modify: `components/settings/SettingsLayout.js` (imports, main component body, SidebarModeShell signature + body; add new `SidebarSkeleton` component)

**Context for the implementer:**
- `useAuth` lives at `contexts/AuthContext.js` and returns `{ role, permissions, loading, branding, user }` at minimum. See `components/tenant/TenantSidebar.js:16-21` for the exact destructuring pattern — mirror it.
- `filterByPermissions(items, user)` lives in `lib/permissions.js`. It returns items where `item.requiredPermission` is undefined OR the user has at least one of the listed permissions. Super admins and `all`-permission users bypass via `hasPermission`.
- The existing `SidebarModeShell` function closes over the module-level `SETTINGS_SECTIONS` import. This task changes it to accept `filteredSections` + `authLoading` as props.
- The `useAuth().loading` state starts `true` and flips to `false` once `/api/tenant/me` resolves. During loading, `permissions` is `[]`, so without a skeleton the sidebar would flash ungated-only items first.
- Dark-mode classes: every gray/white class must have a `dark:` variant per `dev_dark_mode_convention.md`.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

Expected: `main`.

- [ ] **Step 2: Update imports**

Open `components/settings/SettingsLayout.js`. Change the existing import block.

Before (lines ~1-9):

```js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Settings } from 'lucide-react';
import TenantLayout from '../tenant/TenantLayout';
import { SETTINGS_SECTIONS, findGroupForPath } from '../../lib/settings-nav';
import { PERMISSIONS } from '../../lib/permissions';
import SettingsViewToggle from './SettingsViewToggle';
import useSettingsViewPrefs from './useSettingsViewPrefs';
```

After:

```js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Settings } from 'lucide-react';
import TenantLayout from '../tenant/TenantLayout';
import { SETTINGS_SECTIONS, findGroupForPath, findItemForPath } from '../../lib/settings-nav';
import { PERMISSIONS, filterByPermissions } from '../../lib/permissions';
import { useAuth } from '../../contexts/AuthContext';
import SettingsViewToggle from './SettingsViewToggle';
import useSettingsViewPrefs from './useSettingsViewPrefs';
```

Added: `findItemForPath` import, `filterByPermissions` import, `useAuth` import.

- [ ] **Step 3: Wire auth + compute derived values in the main `SettingsLayout` component**

Inside the main `SettingsLayout` function body, add the auth hook call and derived values. The existing body starts like this (around line 38):

```js
export default function SettingsLayout({ title, children }) {
  const router = useRouter();
  const pathname = router.pathname;
  const activeGroup = findGroupForPath(pathname);

  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const { viewMode } = useSettingsViewPrefs();
```

After that block (before the `useEffect`), insert:

```js
  const { role, permissions, loading: authLoading } = useAuth();
  const user = { role, permissions };

  const activeItem = findItemForPath(pathname);
  const pageRequired = activeItem?.requiredPermission ?? [PERMISSIONS.SETTINGS, PERMISSIONS.ALL];

  const filteredSections = SETTINGS_SECTIONS
    .map((section) => ({ ...section, items: filterByPermissions(section.items, user) }))
    .filter((section) => section.items.length > 0);
```

- [ ] **Step 4: Change the `TenantLayout` wrapper to use `pageRequired`**

In the same component, the `return` block wraps children in `<TenantLayout>`. Change the hard-coded `requiredPermission`.

Before:

```jsx
    <TenantLayout
      title={title || 'Settings'}
      requiredPermission={[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]}
    >
```

After:

```jsx
    <TenantLayout
      title={title || 'Settings'}
      requiredPermission={pageRequired}
    >
```

This is the URL enforcement — direct bookmarks to restricted pages now fail at TenantLayout's gate.

- [ ] **Step 5: Pass `filteredSections` + `authLoading` to `SidebarModeShell`**

Still inside the main component, the JSX currently has:

```jsx
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
```

Change the `SidebarModeShell` call to pass the two new props:

```jsx
      {viewMode === 'card' ? (
        <CardModeShell pathname={pathname}>{children}</CardModeShell>
      ) : (
        <SidebarModeShell
          pathname={pathname}
          collapsed={collapsed}
          toggleGroup={toggleGroup}
          filteredSections={filteredSections}
          authLoading={authLoading}
        >
          {children}
        </SidebarModeShell>
      )}
```

- [ ] **Step 6: Update `SidebarModeShell` signature to accept the new props**

Find the `SidebarModeShell` function (around line 84). Change the signature and the iteration to use `filteredSections` instead of the static import.

Before:

```js
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

          {/* Nav groups */}
          <nav className="py-2">
            {SETTINGS_SECTIONS.map((section) => {
              const isCollapsed = !!collapsed[section.group];
              return (
```

After:

```js
function SidebarModeShell({ pathname, collapsed, toggleGroup, filteredSections, authLoading, children }) {
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

          {/* Nav groups */}
          <nav className="py-2">
            {authLoading ? (
              <SidebarSkeleton />
            ) : (
              filteredSections.map((section) => {
                const isCollapsed = !!collapsed[section.group];
                return (
```

**Do not forget to update the closing of this iteration.** Find the existing closing at the end of the `.map()` callback. The existing structure has `})` at the end of the map — you must change it to `}))` (extra close paren to close the ternary's right branch).

Concretely, the tail of the current iteration looks like this:

```js
              );
            })}
          </nav>
        </div>
      </aside>
```

Change to:

```js
              );
            })
            )}
          </nav>
        </div>
      </aside>
```

(One additional `)` to close the `authLoading ? ... : (` ternary wrap around the `filteredSections.map(...)`.)

- [ ] **Step 7: Add `SidebarSkeleton` component at the bottom of the file**

After the closing brace of `CardModeShell` (last function in the file), add a new component:

```jsx
function SidebarSkeleton() {
  return (
    <div className="px-5 py-2 space-y-5 animate-pulse" aria-label="Loading settings navigation">
      {[1, 2, 3].map((g) => (
        <div key={g}>
          <div className="h-3 w-20 bg-gray-200 dark:bg-slate-800 rounded mb-2" />
          <div className="space-y-1">
            <div className="h-7 w-full bg-gray-100 dark:bg-slate-800/60 rounded" />
            <div className="h-7 w-4/5 bg-gray-100 dark:bg-slate-800/60 rounded" />
            <div className="h-7 w-full bg-gray-100 dark:bg-slate-800/60 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
```

Dark-mode variants included per codebase convention. `aria-label` for screen readers.

- [ ] **Step 8: Sanity-check the edit — imports, component compiles**

Run:

```bash
grep -n "useAuth\|filterByPermissions\|findItemForPath\|SidebarSkeleton\|pageRequired\|filteredSections\|authLoading" components/settings/SettingsLayout.js
```

Expected: at least 10 lines matching, including:
- import of `useAuth` from `../../contexts/AuthContext`
- import of `filterByPermissions` from `../../lib/permissions`
- import of `findItemForPath` from `../../lib/settings-nav`
- definition of `pageRequired`, `filteredSections`, `authLoading` in main component
- `requiredPermission={pageRequired}` on `<TenantLayout>`
- `filteredSections={filteredSections}` and `authLoading={authLoading}` passed to `<SidebarModeShell>`
- `SidebarSkeleton` component definition
- `{authLoading ? <SidebarSkeleton /> : filteredSections.map(...` in the nav

Also verify JSX balance by running the dev server:

```bash
# Only if dev server is not already running — do NOT run `npm run build`,
# as that wipes the running dev server's .next/ directory.
# If a dev server is running already, skip this step; the hot reload will
# surface any syntax error in the terminal output.
npm run dev
```

If the implementer is running a fresh session and no dev server is active, they should start one and navigate to http://localhost:3000/settings to confirm the page loads without a hydration or syntax error.

- [ ] **Step 9: Local sanity check — sidebar filters + skeleton flashes briefly**

With the dev server running:

1. Hard-reload `/settings` while logged in as a super admin or `all`-permission user. Expected: skeleton shows for <500ms, then the full sidebar appears with every group.
2. Open `/settings/team`, navigate to your own user, temporarily remove the `accounts_receivable` permission (if you have it). Save.
3. Hard-reload `/settings`. Expected: the Pricing group either disappears entirely (if you had no AP either) or shows only Driver Tariffs (if you had AP).
4. Attempt to direct-navigate to `/settings/tariffs`. Expected: TenantLayout's permission-denied screen.
5. Restore your own permissions afterwards.

If any of the above fails, revert the step that broke it and re-check. Do NOT commit until the sanity check passes.

- [ ] **Step 10: Verify branch is still `main` before committing**

```bash
git branch --show-current
```

Expected: `main`.

- [ ] **Step 11: Commit**

```bash
git add components/settings/SettingsLayout.js
git commit -m "$(cat <<'EOF'
feat(settings-layout): filter sidebar and enforce per-page permissions

Wire useAuth + filterByPermissions into SettingsLayout so the sidebar
only renders items the user has permission to access, and empty groups
drop out. Derive pageRequired from the active pathname via
findItemForPath and forward to TenantLayout — direct URL bookmarks to
restricted pages now hit the existing permission-denied screen.

Add SidebarSkeleton to prevent a brief flash of ungated-only items
during useAuth's loading state.

Spec: docs/superpowers/specs/2026-04-17-settings-permissions-gating-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds on branch `main`.

---

## Task 3: Update `pages/settings/index.js` — filter groups + skeleton

**Files:**
- Modify: `pages/settings/index.js` (imports, `SettingsIndex` component body; add new `IndexSkeleton` component)

**Context for the implementer:**
- This file renders two views: card grid (`CardGridIndex`) and sidebar-mode "What's here" summary. Both iterate the same `groups` variable.
- The current `groups` assignment is `SETTINGS_SECTIONS.filter((s) => s.group !== 'Coming Soon')`. We extend this with a `filterByPermissions` call per section.
- Coming Soon remains unfiltered — it has no `requiredPermission` by design.
- Use the same `useAuth` destructuring pattern as in Task 2.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

Expected: `main`.

- [ ] **Step 2: Update imports**

Open `pages/settings/index.js`. Add two imports to the existing import block.

Before (lines ~1-9):

```js
import { Settings } from 'lucide-react';
import Link from 'next/link';
import SettingsLayout from '../../components/settings/SettingsLayout';
import useSettingsViewPrefs from '../../components/settings/useSettingsViewPrefs';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
import { SETTINGS_SECTIONS } from '../../lib/settings-nav';
```

After:

```js
import { Settings } from 'lucide-react';
import Link from 'next/link';
import SettingsLayout from '../../components/settings/SettingsLayout';
import useSettingsViewPrefs from '../../components/settings/useSettingsViewPrefs';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
import { SETTINGS_SECTIONS } from '../../lib/settings-nav';
import { useAuth } from '../../contexts/AuthContext';
import { filterByPermissions } from '../../lib/permissions';
```

- [ ] **Step 3: Wire auth + filter + skeleton early-return in `SettingsIndex`**

The existing `SettingsIndex` function begins (line 37):

```js
function SettingsIndex() {
  const { viewMode } = useSettingsViewPrefs();
  const groups = SETTINGS_SECTIONS.filter((s) => s.group !== 'Coming Soon');
  const comingSoon = SETTINGS_SECTIONS.find((s) => s.group === 'Coming Soon')?.items || [];
```

Replace the entire head of the function with:

```js
function SettingsIndex() {
  const { viewMode } = useSettingsViewPrefs();
  const { role, permissions, loading: authLoading } = useAuth();
  const user = { role, permissions };

  const groups = SETTINGS_SECTIONS
    .filter((s) => s.group !== 'Coming Soon')
    .map((section) => ({ ...section, items: filterByPermissions(section.items, user) }))
    .filter((section) => section.items.length > 0);

  const comingSoon = SETTINGS_SECTIONS.find((s) => s.group === 'Coming Soon')?.items || [];

  if (authLoading) {
    return <IndexSkeleton viewMode={viewMode} />;
  }
```

Everything after this (the `if (viewMode === 'card')` return, the sidebar-mode JSX below it) stays unchanged.

- [ ] **Step 4: Add `IndexSkeleton` component**

After the closing brace of `CardGridIndex` (the last function before the `getLayout`/`export default` at the bottom of the file), add:

```jsx
function IndexSkeleton({ viewMode }) {
  if (viewMode === 'card') {
    return (
      <div className="max-w-6xl animate-pulse" aria-label="Loading settings">
        <div className="h-7 w-32 bg-gray-200 dark:bg-slate-800 rounded mb-6" />
        {[1, 2].map((g) => (
          <div key={g} className="mb-6">
            <div className="h-4 w-20 bg-gray-200 dark:bg-slate-800 rounded mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-field)]">
              {[1, 2, 3].map((c) => (
                <div key={c} className="h-20 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/40" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="max-w-3xl animate-pulse" aria-label="Loading settings">
      <div className="h-7 w-32 bg-gray-200 dark:bg-slate-800 rounded mb-4" />
      <div className="h-48 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/40" />
    </div>
  );
}
```

Dark-mode variants included per codebase convention.

- [ ] **Step 5: Sanity-check the edit**

Run:

```bash
grep -n "useAuth\|filterByPermissions\|IndexSkeleton\|authLoading" pages/settings/index.js
```

Expected: at least 6 matching lines, including:
- import of `useAuth` from `../../contexts/AuthContext`
- import of `filterByPermissions` from `../../lib/permissions`
- `const { role, permissions, loading: authLoading } = useAuth()`
- `filterByPermissions(section.items, user)` call
- `if (authLoading) return <IndexSkeleton viewMode={viewMode} />;`
- `function IndexSkeleton({ viewMode })` definition

- [ ] **Step 6: Local sanity check — card grid filters**

With dev server running:

1. As a user with `all` permissions, hard-reload `/settings`. Card mode should show every group card; sidebar mode should show "What's here" with every group listed.
2. Toggle view mode via the top-right toggle. Both views render correctly post-filter.
3. Temporarily strip your own `accounts_receivable` and `manage_branches` permissions. Hard-reload `/settings`.
4. In card mode: Pricing group card should show only Driver Tariffs if you kept AP, or the entire Pricing card should disappear if you also stripped AP. Branches card should disappear.
5. In sidebar mode: the "What's here" summary should mirror the same filtering.
6. Restore your permissions afterwards.

- [ ] **Step 7: Verify branch is still `main` before committing**

```bash
git branch --show-current
```

Expected: `main`.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/index.js
git commit -m "$(cat <<'EOF'
feat(settings-index): filter groups by user permissions

Apply the same filterByPermissions pattern used by SettingsLayout's
sidebar to the /settings index page so the card grid and "What's here"
summary hide groups the user can't access. Add IndexSkeleton for a
clean loading state that matches the active view mode.

Spec: docs/superpowers/specs/2026-04-17-settings-permissions-gating-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds on branch `main`.

---

## Task 4: Push + Cowork verification gates

**Files:** (none)

**Context for the implementer:** After all three commits land on `main`, push to origin and hand off to Cowork for the permission matrix. Do not close the task until Cowork has confirmed all three gates from the spec.

- [ ] **Step 1: Verify last three commits are on main**

```bash
git log --oneline -5
```

Expected: top three commits are (most recent first):
- `feat(settings-index): filter groups by user permissions`
- `feat(settings-layout): filter sidebar and enforce per-page permissions`
- `feat(settings-nav): add requiredPermission metadata and findItemForPath helper`

If any commit is missing or on the wrong branch, stop and recover per `session_2026_04_17_handoff.md`.

- [ ] **Step 2: Push to origin**

```bash
git push origin main
```

Expected: all three commits pushed, no rejections. If a remote conflict occurs (parallel Cowork session may have pushed advanced-route work), rebase onto origin/main and resolve — none of these files are touched by the advanced-route feature, so conflicts would be surprising.

- [ ] **Step 3: Request Cowork to run Gate 1 — Permission matrix**

Hand off to Cowork with a prompt along the lines of:

> Please run Gate 1 of the Settings Permissions Gating plan. Log in as each of the six personas below (create test users via /settings/team if needed) and for each one, confirm that the Sidebar at `/settings` and the Card Grid at `/settings` (card view) show exactly the expected items:
>
> | Persona | Permissions | MUST see | MUST NOT see |
> |---|---|---|---|
> | Super admin | role=super_admin | Everything | — |
> | Settings-only | ['settings'] | Company, My Account, both Operations items, all 5 Equipment items, Team & Permissions, all 8 Communications items, all 5 Coming Soon items | All 4 Pricing items, Branches |
> | Settings + AR | ['settings','accounts_receivable'] | Above + Charge Profiles, Load Tariffs, Per Diem | Driver Tariffs, Branches |
> | Settings + AP | ['settings','accounts_payable'] | Above pattern + Driver Tariffs (not AR items) | Charge Profiles, Load Tariffs, Per Diem, Branches |
> | Settings + Branches | ['settings','manage_branches'] | Settings-only items + Branches | All 4 Pricing items |
> | No settings | ['dispatching'] | Blocked at /settings by TenantLayout (unchanged behavior) | — |
>
> Report any mismatch.

Expected: Cowork confirms all six personas match expectations.

- [ ] **Step 4: Request Cowork to run Gate 2 — URL enforcement**

Prompt:

> As a user with only ['settings'] permission, direct-navigate to each of the following URLs and confirm each produces a permission-denied screen (TenantLayout's existing rejection UI):
> - /settings/tariffs
> - /settings/driver-tariffs
> - /settings/per-diem
> - /settings/charge-profiles
> - /settings/branches
>
> Then navigate to /settings/company and confirm it loads normally.
>
> Report any URL that loads when it should deny (or denies when it should load).

Expected: all 5 restricted URLs blocked; /settings/company loads.

- [ ] **Step 5: Request Cowork to run Gate 3 — Regression smoke**

Prompt:

> Confirm the following regressions are clean:
> 1. Super admin: see every sidebar item, every card; no broken links.
> 2. Communications items: still gated behind MANAGE_SYSTEM_EMAILS|SETTINGS|ALL as before (no behavior change for users who had access before).
> 3. My Account: visible to every user who can access /settings at all.
> 4. Coming Soon: visible to every user who can access /settings at all.
> 5. On a hard reload of /settings, a brief skeleton shows before the full nav appears (≤500ms, not a full second).
> 6. Click into any settings page, then back to /settings — the group containing that page stays auto-expanded in the sidebar.
>
> Report any regression.

Expected: all 6 checks clean.

- [ ] **Step 6: Mark task complete once all three gates pass**

If Gate 1, 2, or 3 fails, reopen the relevant Task (1/2/3) and fix the discovered issue, re-commit, re-push, and re-run the failing gate.

---

## Self-review (plan author)

### Spec coverage

| Spec requirement | Implementing task |
|---|---|
| Add `requiredPermission` to 14 non-Communications items per mapping | Task 1 steps 2-6 |
| Add `findItemForPath` helper | Task 1 step 7 |
| `SettingsLayout` filters sidebar via `filterByPermissions` | Task 2 steps 3, 6 |
| `SettingsLayout` derives `pageRequired` from pathname | Task 2 step 3 |
| `SettingsLayout` forwards `pageRequired` to `TenantLayout` | Task 2 step 4 |
| `SidebarSkeleton` during `authLoading` | Task 2 steps 6, 7 |
| `pages/settings/index.js` filter on `groups` | Task 3 step 3 |
| `IndexSkeleton` during `authLoading` on index page | Task 3 steps 3, 4 |
| Gate 1 permission matrix (Cowork) | Task 4 step 3 |
| Gate 2 URL enforcement (Cowork) | Task 4 step 4 |
| Gate 3 regression smoke (Cowork) | Task 4 step 5 |
| Branch discipline (`git branch --show-current`) | Tasks 1/2/3 first step; Task 4 step 1 |

No gaps.

### Placeholder scan

Scanned plan text — no "TBD", "TODO", "implement later", "similar to Task N", "add appropriate error handling". Every code step has concrete before/after code blocks. Every command step has exact commands + expected output.

### Type consistency

- `useAuth` destructures `{ role, permissions, loading: authLoading }` in Tasks 2 and 3 — consistent.
- `user = { role, permissions }` object built identically in Tasks 2 and 3 — matches `TenantSidebar`'s pattern.
- `filterByPermissions(section.items, user)` signature called identically in Tasks 2 and 3.
- `findItemForPath(pathname)` defined in Task 1, consumed in Task 2 only.
- `SidebarSkeleton` component used only in `SidebarModeShell`; `IndexSkeleton` used only in `SettingsIndex`.
- All `requiredPermission` arrays use `PERMISSIONS.FOO` imports (not raw strings) — consistent with existing Communications items.

No type/naming inconsistencies detected.
