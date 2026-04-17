# Settings Permissions Gating — Design Spec

**Date:** 2026-04-17
**Status:** Approved — ready for implementation plan
**Scope:** Per-item permission metadata for settings nav, with both visibility filtering AND URL-access enforcement

## Goal

Tighten settings visibility and access so each item declares the permissions required to see and use it. Users see only the items they can actually use, and direct URL bookmarking of restricted pages is blocked end-to-end.

## Non-goals

- **Taxonomy/grouping reshuffle** — deferred to a separate spec. This pass does not change which items live in which group.
- **New permission types** — we use the existing enum only. No `MANAGE_USERS` permission (handoff memory proposed this; it doesn't exist in `lib/permissions.js`).
- **Server-side API-route permission gating** — each settings page's underlying API routes already follow the existing `requireTenantUser` + per-route check pattern. Out of scope for this pass.
- **Real-time permission revocation** — if a user's permissions change mid-session, stale nav is acceptable until next page load.
- **Skeleton visual polish** beyond "matches the rhythm of real nav" — follow-up if needed.

## Context (current state)

- `lib/settings-nav.js` — defines 7 groups (General, Pricing, Operations, Equipment, Team, Communications, Coming Soon) with 30+ items. Only the 8 Communications items currently have `requiredPermission`.
- `components/settings/SettingsLayout.js` — wraps `TenantLayout` with a hard-coded baseline `[SETTINGS, ALL]`. Sidebar does **not** currently filter items by permission; all items render to every settings-baseline user.
- `pages/settings/index.js` — card-grid + "What's here" summary views. Also does not filter.
- `lib/permissions.js` — has `hasPermission(user, required)` and `filterByPermissions(items, user)` helpers; both already in production use via `TenantSidebar`.
- `components/tenant/TenantSidebar.js` — reference pattern for the exact filtering pattern we'll mirror in `SettingsLayout`.

After this change, all non-Communications items get their own `requiredPermission` fields; `SettingsLayout` and the index page both filter via `filterByPermissions`; and `SettingsLayout` derives a per-page `requiredPermission` from the active pathname and forwards it to `TenantLayout` for URL-access enforcement.

## Approach

**Approach B — visibility gating + per-page URL enforcement via "derive from nav" variant.**

- **Sidebar filter** via `filterByPermissions(section.items, user)`.
- **Per-page enforcement** via a new `findItemForPath(pathname)` helper that looks up the active route's `requiredPermission` from the nav registry; `SettingsLayout` forwards that value to `TenantLayout`'s existing permission plumbing.
- **Flash prevention** via a skeleton rendered while `useAuth().loading === true`.

Single source of truth: `settings-nav.js`. Registering a new settings page in the nav automatically gives it both visibility filtering AND URL enforcement — no per-page plumbing to forget.

## Permission mapping (locked)

| Group | Item | `requiredPermission` | Strictness |
|---|---|---|---|
| General | Company Info | `[SETTINGS, ALL]` | Baseline |
| General | My Account | _(none)_ | Everyone, always |
| Pricing | Charge Profiles | `[ACCOUNTS_RECEIVABLE, ALL]` | **Stricter** — AR-only |
| Pricing | Load Tariffs | `[ACCOUNTS_RECEIVABLE, ALL]` | **Stricter** — AR-only |
| Pricing | Driver Tariffs | `[ACCOUNTS_PAYABLE, ALL]` | **Stricter** — AP-only |
| Pricing | Per Diem Pricing | `[ACCOUNTS_RECEIVABLE, ALL]` | **Stricter** — AR-only |
| Operations | Dispatcher Appearance | `[SETTINGS, ALL]` | Baseline |
| Operations | Document Validation | `[SETTINGS, ALL]` | Baseline |
| Equipment | Container Owners | `[SETTINGS, ALL]` | Baseline |
| Equipment | Chassis Owners | `[SETTINGS, ALL]` | Baseline |
| Equipment | Equipment Reference | `[SETTINGS, ALL]` | Baseline |
| Equipment | Terminal Markets | `[SETTINGS, ALL]` | Baseline |
| Equipment | Terminals | `[SETTINGS, ALL]` | Baseline |
| Team | Branches | `[MANAGE_BRANCHES, ALL]` | **Stricter** — branch admins only |
| Team | Team & Permissions | `[SETTINGS, ALL]` | Baseline |
| Communications | _(8 items)_ | `[MANAGE_SYSTEM_EMAILS, SETTINGS, ALL]` | Unchanged |
| Coming Soon | _(5 items)_ | _(none)_ | Marketing visibility |

**TenantLayout baseline:** Accessing `/settings` at all requires `[SETTINGS, ALL]` (enforced by `SettingsLayout → TenantLayout`). Per-item `requiredPermission` is _additional_ filtering on top of that baseline. Items marked "Baseline" above match the TenantLayout floor exactly — so every settings-baseline user sees them; the explicit metadata exists so per-page URL enforcement can be derived uniformly.

**Where strictness actually lands:** 5 items move above the baseline — the 4 Pricing items (split AR/AP) and Branches (`MANAGE_BRANCHES`).

## File-level changes

Three files total.

### `lib/settings-nav.js`

**Add `requiredPermission` fields** to non-Communications items per the mapping table (Communications items already have the field; Coming Soon items intentionally remain un-gated).

**Add new exported helper:**

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

No changes to existing exports (`SETTINGS_SECTIONS`, `ALL_SETTINGS_ITEMS`, `findGroupForPath`) beyond the new per-item fields.

### `components/settings/SettingsLayout.js`

**New imports:**

```js
import { SETTINGS_SECTIONS, findGroupForPath, findItemForPath } from '../../lib/settings-nav';
import { PERMISSIONS, filterByPermissions } from '../../lib/permissions';
import { useAuth } from '../../contexts/AuthContext';
```

**Inside the `SettingsLayout` component** (before the `return`):

```js
const { role, permissions, loading: authLoading } = useAuth();
const user = { role, permissions };

// Per-page enforcement — derive requiredPermission from active pathname
const activeItem = findItemForPath(pathname);
const pageRequired = activeItem?.requiredPermission ?? [PERMISSIONS.SETTINGS, PERMISSIONS.ALL];

// Sidebar filter — drop items the user can't access; drop empty groups
const filteredSections = SETTINGS_SECTIONS
  .map((section) => ({ ...section, items: filterByPermissions(section.items, user) }))
  .filter((section) => section.items.length > 0);
```

**Change the `TenantLayout` wrapper** from the hard-coded baseline to the derived `pageRequired`:

```jsx
<TenantLayout
  title={title || 'Settings'}
  requiredPermission={pageRequired}
>
```

**Pass `filteredSections` and `authLoading` into `SidebarModeShell`** via props (currently `SidebarModeShell` closes over the module-scope `SETTINGS_SECTIONS` import; this change makes filtering visible at the call site).

**Inside `SidebarModeShell`**, render a skeleton while auth is loading:

```jsx
<nav className="py-2">
  {authLoading ? (
    <SidebarSkeleton />
  ) : (
    filteredSections.map((section) => { /* existing render loop */ })
  )}
</nav>
```

**Add `SidebarSkeleton` component** (private to the file):

```jsx
function SidebarSkeleton() {
  return (
    <div className="px-5 py-2 space-y-5 animate-pulse">
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

**No change to `CardModeShell`** — its breadcrumb uses the static `findGroupForPath`, which is correct: the breadcrumb names the group of the currently-viewed page, not a user-filtered view.

### `pages/settings/index.js`

**New imports:**

```js
import { useAuth } from '../../contexts/AuthContext';
import { filterByPermissions } from '../../lib/permissions';
```

**Inside `SettingsIndex`:**

```js
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

if (viewMode === 'card') {
  return <CardGridIndex groups={groups} comingSoon={comingSoon} />;
}
// else sidebar-mode index — unchanged below
```

**Add `IndexSkeleton` component** (private to the file), matching viewMode:

```jsx
function IndexSkeleton({ viewMode }) {
  if (viewMode === 'card') {
    return (
      <div className="max-w-6xl animate-pulse">
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
    <div className="max-w-3xl animate-pulse">
      <div className="h-7 w-32 bg-gray-200 dark:bg-slate-800 rounded mb-4" />
      <div className="h-48 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/40" />
    </div>
  );
}
```

No other logic changes. `CardGridIndex` already takes `groups` + `comingSoon` as props and iterates them happily.

## Behavior (matrix)

For a user who has `[SETTINGS]` as their only permission, after this change:

- **Sidebar**: shows General (Company Info, My Account), Operations (both items), Equipment (all 5), Team (Team & Permissions only — Branches hidden), Communications (depends on MANAGE_SYSTEM_EMAILS — existing behavior), Coming Soon.
- **Hidden**: Pricing group entirely. Branches item.
- **URL direct access** to `/settings/tariffs`, `/settings/driver-tariffs`, `/settings/per-diem`, `/settings/charge-profiles`, `/settings/branches` → permission-denied screen (existing TenantLayout behavior).

For an AP-only + SETTINGS user: Pricing shows only Driver Tariffs. AR items blocked in nav AND URL.

For ALL or super_admin: everything visible, no blocks.

## Edge cases

| # | Case | Handling |
|---|---|---|
| A | Active-page-hidden (mid-session revocation) | Stale nav until next page load; accepted (matches `TenantSidebar` behavior) |
| B | Empty groups after filter | Dropped by `.filter(section => section.items.length > 0)` |
| C | `/settings` root (no matching item) | `findItemForPath` returns null → fallback `[SETTINGS, ALL]` |
| D | Coming Soon items | Intentionally no `requiredPermission`; always visible |
| E | Super admin bypass | Handled by `hasPermission` role short-circuit in `lib/permissions.js:62-67` |
| F | Loading flash | `SidebarSkeleton` / `IndexSkeleton` during `authLoading` |
| G | Group-auto-expand on active page | Still works — active group is guaranteed in `filteredSections` because the user has permission for the page they're currently on (TenantLayout enforced) |
| H | URL bookmarking a restricted page | `pageRequired` derived from pathname → TenantLayout renders existing permission-denied screen |
| I | Parallel Advanced Route Cowork session | Touches different files (tariff-engine, migrations, advanced-route UI); merge conflict risk low. Verify `git branch --show-current` before each commit |
| J | Existing page-level permission checks to reconcile | None exist. Grep confirmed no settings page has its own `hasPermission`/`requiredPermission` check. Nav metadata is the single source of truth out of the gate |

## Verification gates

### Gate 1: Permission matrix (Cowork run on dev)

Cowork logs in as six personas and verifies sidebar + card-grid contents:

| Persona | Permissions | MUST see | MUST NOT see |
|---|---|---|---|
| Super admin | `role=super_admin` or `['all']` | Everything | — |
| Settings-only | `['settings']` | Company, My Account, Dispatcher Appearance, Doc Validation, all 5 Equipment items, Team & Permissions, all 8 Communications items (SETTINGS grants them), all 5 Coming Soon items | All 4 Pricing items, Branches |
| Settings + AR | `['settings','accounts_receivable']` | Above + Charge Profiles, Load Tariffs, Per Diem | Driver Tariffs, Branches |
| Settings + AP | `['settings','accounts_payable']` | Above pattern + Driver Tariffs | AR items, Branches |
| Settings + Branches | `['settings','manage_branches']` | Settings-only items + Branches | All Pricing |
| No settings | `['dispatching']` only | Blocked at `/settings` by TenantLayout (unchanged) | — |

### Gate 2: URL enforcement (direct-bookmark test)

For a user with only `['settings']`, direct-navigate to:

- `/settings/tariffs` → permission-denied
- `/settings/driver-tariffs` → permission-denied
- `/settings/per-diem` → permission-denied
- `/settings/charge-profiles` → permission-denied
- `/settings/branches` → permission-denied
- `/settings/company` → loads OK (baseline grants)

### Gate 3: Regression smoke

- Super admin sees everything; no broken nav links
- Existing Communications items still gated as before (no regression)
- My Account always visible (no `requiredPermission`)
- Coming Soon group always visible
- Skeleton shows briefly on hard reload before full nav appears
- Group-auto-expand still fires for the active page

## Testing mechanics

No automated tests. Filter function is already well-exercised by `TenantSidebar` in production. This pass is UX metadata + one helper + one filter — manual Cowork verification per the gates above is appropriate scope.

Local sanity check for the implementer: temporarily edit own user's permissions in `/settings/team`, hard-reload `/settings`, observe filtered sidebar. Revert before committing.

## Branch discipline

Main workspace is at `C:\Users\bento\app-drayagedirect`.

The parallel Advanced Route Cowork session has intermittently swapped the workspace to `feat/advanced-route-matching`. **Before each commit**: `git branch --show-current` must return `main`. Recovery pattern if a commit lands on the wrong branch (from `session_2026_04_17_handoff.md`):

1. `git branch <backup-name> HEAD` (save the work)
2. `git switch main`
3. `git cherry-pick <commits>` onto main
4. Push main

## Risks

**Low.** UX metadata + one pure helper + one filter call. No migrations, no API surface changes, no data model changes. Failure modes:

- **Typo in permission enum values** — caught at first render via imports from `lib/permissions.js`.
- **Filter hiding the active page's group** — can't happen; user necessarily has permission for the current page.
- **Skeleton CSS regression** — visual; not a functional bug.
- **Forgetting to pass `filteredSections` to `SidebarModeShell`** — implementation vigilance; caught by Gate 1 smoke.

Pattern is already in production via `TenantSidebar`. Risk surface is essentially zero beyond implementation correctness.

## Out of scope (future work)

- **Taxonomy reshuffle** (handoff Item 1 — separate spec, potentially deferred indefinitely if the current grouping feels fine once gated).
- **Server-side API-route permission gating** consolidation (follow existing pattern, separate pass).
- **Real-time permission revocation / nav refresh on permission change** (websocket or polling).
- **Role-aware Coming Soon descriptions** (e.g., show the eventual permission requirement so users understand what they'll lose access to).

## Success criteria

- All 6 personas in the Gate 1 matrix see exactly the expected items.
- All 5 restricted URL bookmarks in Gate 2 produce permission-denied.
- No regression on super admin, Communications, My Account, or Coming Soon visibility.
- No loading flash visible on hard reload.
- Implementation ships in 1-2 commits totaling ~3 file changes.
