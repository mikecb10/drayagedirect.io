---
name: 2026-04-27-umbrella-recipient-type-picker-design
description: FU-114. Extend the umbrella editor's `{{}}` dropdown with two new tabs (Contact, Group) so admins can add `{type:'contact'}` and `{type:'contact_group'}` recipient entries by searching across all `organization_contacts` / `organization_groups` in the tenant. Variable type picker explicitly out of scope. Closes the gap where these entry types are otherwise only reachable via direct DB seeding.
type: spec
---

# Umbrella Recipient Type Picker — Contact + Group (FU-114)

## Summary

The umbrella editor's `RecipientRow` was extended in the load-notify-parties feature (commit `be171f5`, Task 12) with a `{{}}` dropdown that lets admins insert role tokens (e.g., `customer_primary`, `load_notify_parties`, `tenant_dispatcher`) into a recipient list. The recipient-expander (`lib/email-dispatch/recipient-expander.js`) supports five entry types — `email`, `role`, `contact`, `contact_group`, `variable` — but only two are reachable from the editor UI: `email` (text-typed in the input) and `role` (picked from the dropdown). The other three are only addable via direct DB seeding, which means tenants who want a specific person or specific group on an umbrella have no self-service path.

This spec extends the existing `{{}}` dropdown with two new tabs — **Contact** and **Group** — that let admins type-ahead-search across all `organization_contacts` and `organization_groups` in the tenant and click to add them as `{type:'contact', value:<uuid>}` and `{type:'contact_group', value:<uuid>}` entries. The third unreachable type (`variable`) is explicitly skipped — it's a power-user dotted-path escape hatch that's rarely needed in practice (the existing role tokens cover the common cases like `customer.primary_contact_email`), and the UX cost of a good variable autocomplete (enumerating known context-tree paths, validating them) outweighs the benefit. If a tenant ever asks for variables, file as a follow-up.

The picker reuses the existing `{{}}` button and dropdown shell — adds a tab bar at the top (`Role | Contact | Group`) so the role-picker UX stays one click away. Each tab has its own focused content: Role keeps the current sectioned token list; Contact and Group each show a search input + result list (debounced 250ms, capped at 25 results). Two new tenant-wide search endpoints back the type-aheads. Existing chips (which today only render for email and role types) are extended with green/contact and amber/group variants; on umbrella load, the editor batch-hydrates contact and group display names so existing DB-seeded entries render with human-readable labels instead of UUIDs.

This builds on top of FU-113's resolver migration: the `case 'contact'` and `case 'contact_group'` branches in `recipient-expander.js` already query the canonical `organization_contacts` and `organization_group_members` tables (commit `52549fb`), so adding entries that reference those IDs flows correctly through email send at fire time without further resolver work.

## Goals

- **Two new tenant-wide search endpoints:**
  - `GET /api/tenant/contacts/search?q=<name>` — case-insensitive `ilike` match across `first_name`, `last_name`, `email`. Returns up to 25 rows with shape `{ contacts: [{ id, first_name, last_name, email, organization_id, organization_name }] }`.
  - `GET /api/tenant/groups/search?q=<name>` — case-insensitive `ilike` match on `organization_groups.name`. Returns up to 25 rows with shape `{ groups: [{ id, name, organization_id, organization_name, member_count }] }`. `member_count` derived from `organization_group_members` via subquery or batch count.
- **Two new ID-batch hydration endpoints** (used on umbrella load to resolve display names for existing entries):
  - `GET /api/tenant/contacts?ids=<comma-uuids>` — returns name + email + org for the listed ids.
  - `GET /api/tenant/groups?ids=<comma-uuids>` — returns name + org + member_count for the listed ids.
- **Tab bar** in the existing `{{}}` dropdown of `RecipientRow`: three tabs `[Role] [Contact] [Group]`. Default to Role (preserves current behavior on first open).
- **Contact tab**: search input + debounced result list. Each row shows: `👤` icon, full name (constructed `${first_name} ${last_name}`.trim() with email fallback), email in muted text, organization name as a sublabel. Click = add `{type:'contact', value:<contact_id>}` to the recipients array via a new `addContactRecipient(kind, id, displayHints)` helper.
- **Group tab**: search input + debounced result list. Each row shows: `📋` icon, group name, member count badge, organization name as a sublabel. Click = add `{type:'contact_group', value:<group_id>}` via a new `addContactGroupRecipient(kind, id, displayHints)` helper.
- **Chip styling** — extend the existing chip-render switch in `RecipientRow` with two new variants:
  - Contact: green (`bg-emerald-50 dark:bg-emerald-950/40`, `border-emerald-200 dark:border-emerald-900/60`, `text-emerald-700 dark:text-emerald-300`), `👤` icon prefix, display = hydrated name.
  - Group: amber (`bg-amber-50 dark:bg-amber-950/40`, `border-amber-200 dark:border-amber-900/60`, `text-amber-700 dark:text-amber-300`), `📋` icon prefix, display = hydrated name + `(N)` member-count badge.
- **One-shot hydration on umbrella load**: when the editor mounts, scan all groups' `to_recipients` / `cc_recipients` / `bcc_recipients` arrays for `{type:'contact'}` and `{type:'contact_group'}` entries; batch their unique IDs; fetch via the new ID-batch endpoints; cache the resolved name+org+(member_count for groups) in component state. Chips render immediately as gray "Loading…" then update once hydration resolves. Dead refs (entry's id no longer exists in DB) render as muted gray with `Deleted contact` / `Deleted group` labels and an X to remove.
- **Tests**:
  - `tests/contacts-search-api.test.mjs` — cases for the search endpoint (basic match, 25-row cap, empty query, cross-tenant filtering).
  - `tests/groups-search-api.test.mjs` — same for groups (plus member-count derivation).
  - `tests/contacts-groups-batch-hydrate-api.test.mjs` — cases for the two batch-hydrate endpoints (basic ids resolution, cross-tenant filtering, dead-ref handling returns name=null).

## Non-Goals (explicitly out of scope)

1. **No `variable` picker.** Power-user escape hatch; rarely needed; deferring to a separate FU if anyone asks.
2. **No org-then-contact drill-down browsing.** Search-by-name is enough for v1. The `NotifyPartyPicker`-style drill-down makes sense in load-context (where "the customer's contacts" is a meaningful sub-list) but not for tenant-admin-level umbrella configuration.
3. **No cross-tenant contact/group picking.** Both new endpoints filter by `tenant_id = ctx.tenantId`. Same multi-tenant safety pattern as everywhere else.
4. **No bulk-add.** ("Add all contacts in org X" or "Add all groups marked for billing.") Single click = single entry.
5. **No filter chips on search results** (e.g., "only show billing-purpose groups", "only show contacts at customer-type orgs"). Free-text search is enough.
6. **No keyboard navigation beyond what the existing dropdown supports.** Same a11y baseline as Task 12's role picker.
7. **No inline editing of contact/group attributes from the picker.** Edits go through the existing organization detail page.
8. **No new entries created from inside the picker.** Admins must already have created the contact/group on the org page; the picker just selects from existing rows.
9. **No per-tab search state preservation across dropdown open/close.** Each open of the dropdown starts with empty search inputs.
10. **No "recently picked" or "favorites" list at the top of the search.** Pure search-results-only.
11. **No Postgres `pg_trgm` or full-text indexing for search.** Plain `ilike '%q%'` is sufficient at the scale we expect (most tenants have <500 contacts and <100 groups). If performance becomes an issue at scale, file a follow-up to add `gin_trgm_ops` indexes.
12. **No deletion of dead-ref chips on save** — the chip stays in the JSONB recipients array (consistent with how email entries to deleted addresses behave). User can manually × them.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Two tenant-wide search endpoints (`/contacts/search`, `/groups/search`), not a single combined endpoint | Different result shapes (contacts have email; groups have member_count); separating keeps response shapes clean and lets the UI tab-switch without re-querying when toggling |
| D2 | Two ID-batch hydration endpoints (`/contacts?ids=`, `/groups?ids=`), not piggyback on the search endpoints | The search endpoints filter by `q`; hydration filters by ids. Mixing the two via "either q OR ids" makes the contract harder to reason about. Two simple endpoints > one polymorphic one. |
| D3 | Tabs at top of the existing dropdown (Option B from brainstorm), NOT a modal | Modal is heavier than needed for a single-search-input UX; tabs keep entry one click away |
| D4 | Search uses `ilike '%q%'` on a concatenated name+email (contacts) or just name (groups), no trigram or FTS | Most tenants have <500 contacts; index scan is fast enough. Defer pg_trgm to follow-up if needed |
| D5 | Result limit hard-coded to 25 (no "load more") | Simpler UI; a search that returns 25+ matches is a search query that needs refinement, not a pagination problem |
| D6 | Skip variable picker (Option D from brainstorm) | Rarely needed; existing role tokens cover the common dotted-path cases (`customer_primary` etc.); the UX cost of a good variable autocomplete (enumerating known context-tree paths, validating them) outweighs the benefit at v1 |
| D7 | One-shot batch hydration on umbrella load, not lazy per-chip fetch | The umbrella editor opens with all chips visible at once; lazy per-chip would N+1 the network. Batch is one query of ids. |
| D8 | Hydrated names cached in editor component state, NOT fetched fresh on every render | Display name doesn't change during an editing session; refetch on next mount is sufficient |
| D9 | Contact chip color = green (emerald), Group chip color = amber | Distinct from blue (email) and purple (role); color-blind-safe via icon prefixes (`👤` and `📋`) on top of color |
| D10 | Dead-ref chips render with line-through + muted gray + "Deleted [type]" label | Consistent with how `NotifyPartyPicker` handles dead refs; familiar pattern |
| D11 | Default tab = Role (preserves current behavior) | Most existing umbrellas use role tokens; opening the dropdown defaults to the most-used view |
| D12 | Each dropdown open resets to empty search inputs (no persistence) | Simpler state model; resets are cheap |
| D13 | New endpoints use the same `[PERMISSIONS.ALL_SETTINGS, PERMISSIONS.ALL]` permission gate as the umbrella editor itself | Reads only; same access tier that already views the umbrella |
| D14 | Display name for contacts = `${first_name} ${last_name}`.trim() with email fallback if both names empty, then "(unnamed)" if even email is empty | Same fallback chain established in `NotifyPartyPicker` |

## Data Model

**No schema changes.** This spec is pure-additive UI + API on top of existing tables (`organization_contacts`, `organization_groups`, `organization_group_members`). All four new endpoints query existing tables only.

## API Contracts

### `GET /api/tenant/contacts/search?q=<query>`

**Auth:** `requireTenantUser` + `requirePermission([PERMISSIONS.ALL_SETTINGS, PERMISSIONS.ALL])`.

**Query params:**
- `q` (required, non-empty after trim) — search string

**Response shape:**

```json
{
  "contacts": [
    {
      "id": "uuid",
      "first_name": "Jane",
      "last_name": "Smith",
      "email": "jane@acme.com",
      "organization_id": "uuid",
      "organization_name": "Acme Corp"
    }
  ]
}
```

**Behavior:**
- Empty/missing `q` → 400 `{ error: 'q is required' }`.
- Match query: `ilike` on `concat(first_name, ' ', coalesce(last_name, ''), ' ', coalesce(email, ''))` (or equivalent OR-joined `ilike` if concat is awkward in Supabase JS client).
- Tenant-scoped: `tenant_id = ctx.tenantId`.
- Order by relevance approximation: starts-with-q first, then contains-q, then alphabetical by last_name. Acceptable simpler ordering: alphabetical by last_name asc.
- Limit 25 hard-coded.
- JOIN to `customers` for `organization_name`.

### `GET /api/tenant/groups/search?q=<query>`

**Auth:** same as above.

**Response shape:**

```json
{
  "groups": [
    {
      "id": "uuid",
      "name": "Operations",
      "organization_id": "uuid",
      "organization_name": "Acme Corp",
      "member_count": 4
    }
  ]
}
```

**Behavior:**
- Empty/missing `q` → 400.
- Match: `organization_groups.name ilike '%q%'`.
- Tenant-scoped.
- Order alphabetical by name.
- Limit 25.
- JOIN to `customers` for `organization_name`.
- `member_count` derived from `organization_group_members` (count rows with matching `group_id`). Either via `select('id, name, ..., members:organization_group_members(count)')` or a separate aggregate query.

### `GET /api/tenant/contacts?ids=<comma-list>`

**Auth:** same.

**Query params:**
- `ids` (required, comma-separated UUIDs, max 100) — list of contact IDs to hydrate

**Response shape:**

```json
{
  "contacts": [
    {
      "id": "uuid",
      "first_name": "Jane",
      "last_name": "Smith",
      "email": "jane@acme.com",
      "organization_id": "uuid",
      "organization_name": "Acme Corp"
    }
  ]
}
```

**Behavior:**
- Tenant-scoped.
- Returns rows for each id that exists; missing ids are silently omitted (the UI handles dead refs).
- No order guarantee; UI keys by id for lookup.

### `GET /api/tenant/groups?ids=<comma-list>`

**Auth + behavior:** parallel to contacts batch endpoint, returning groups with `member_count`.

## UI Changes

### `RecipientRow` (in `pages/settings/communications/umbrellas/[id].js`)

**New props:**
- `onAddContact(kind, contactId, displayHints)` — wired from each invocation site.
- `onAddContactGroup(kind, groupId, displayHints)` — same.

**New internal state:**
- `activeTab: 'role' | 'contact' | 'group'` — defaults to `'role'`.
- `contactQuery`, `groupQuery` — controlled inputs for each search.
- `contactResults`, `groupResults` — debounced server-fetched arrays.
- `contactLoading`, `groupLoading` — per-tab loading flags.

**Tab bar JSX** (replaces the static "ROLE TOKEN CATALOG" rendering):

```jsx
<div className="flex border-b border-gray-200 dark:border-slate-700">
  {['role', 'contact', 'group'].map((t) => (
    <button
      key={t}
      type="button"
      onClick={() => setActiveTab(t)}
      className={`flex-1 px-3 py-2 text-xs font-medium ${
        activeTab === t
          ? 'text-purple-700 dark:text-purple-300 border-b-2 border-purple-500'
          : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800/50'
      }`}
    >
      {t === 'role' ? 'Role' : t === 'contact' ? 'Contact' : 'Group'}
    </button>
  ))}
</div>
```

**Tab content rendering:**

```jsx
{activeTab === 'role' && (
  // existing ROLE_TOKEN_CATALOG sectioned list — UNCHANGED
)}
{activeTab === 'contact' && <ContactSearchPanel
  query={contactQuery}
  onQueryChange={setContactQuery}
  results={contactResults}
  loading={contactLoading}
  onPick={(c) => { onAddContact(kind, c.id, { display_name: ..., email: c.email, organization_name: c.organization_name }); setTokenPickerOpen(false); }}
/>}
{activeTab === 'group' && <GroupSearchPanel ... />}
```

`ContactSearchPanel` and `GroupSearchPanel` are small render-only sub-components inside the same file (no new external file). Each:
- Renders an `<input type="search">` with placeholder "Search contacts by name or email…" / "Search groups by name…"
- 250ms-debounced `useEffect` that calls the search endpoint and updates results
- Renders a list (max 25) of clickable buttons; each shows the icon, name, sublabels per the design above
- Empty query state: "Start typing to search…" muted text
- Loading state: "Searching…"
- Empty result state: "No matches" muted text

### Chip rendering update

In `RecipientRow`'s chip render block (currently handles email/role), extend to handle contact and group:

```jsx
// hydratedNames shape: { contact: { [id]: string | null }, group: { [id]: { name, member_count } | null } }
const contactHydrated = hydratedNames.contact[r.value];   // string or null or undefined
const groupHydrated = hydratedNames.group[r.value];        // {name, member_count} or null or undefined

const chipMeta = ({
  email: { color: 'blue', icon: null, display: r.value },
  role:  { color: 'purple', icon: <span className="text-[10px] font-mono">{`{{}}`}</span>, display: ROLE_TOKEN_LABELS[r.value] || r.value },
  contact: {
    color: 'emerald',
    icon: <User className="w-3 h-3" />,
    display: contactHydrated === undefined ? 'Loading…' : (contactHydrated || 'Deleted contact'),
  },
  contact_group: {
    color: 'amber',
    icon: <Users className="w-3 h-3" />,
    display: groupHydrated === undefined
      ? 'Loading…'
      : groupHydrated
        ? `${groupHydrated.name} (${groupHydrated.member_count})`
        : 'Deleted group',
  },
})[r.type];

const isDead = (r.type === 'contact' && contactHydrated === null)
  || (r.type === 'contact_group' && groupHydrated === null);
// ... render with color + icon + display + isDead muted styling
```

`hydratedNames` is component-level state populated by the one-shot batch hydrate effect on mount.

### One-shot hydration effect

```js
useEffect(() => {
  const allRecipients = (groups || []).flatMap((g) => [
    ...(g.to_recipients || []),
    ...(g.cc_recipients || []),
    ...(g.bcc_recipients || []),
  ]);
  const contactIds = Array.from(new Set(allRecipients.filter((r) => r.type === 'contact').map((r) => r.value)));
  const groupIds = Array.from(new Set(allRecipients.filter((r) => r.type === 'contact_group').map((r) => r.value)));

  Promise.all([
    contactIds.length
      ? fetch(`/api/tenant/contacts?ids=${contactIds.join(',')}`).then((r) => r.ok ? r.json() : { contacts: [] })
      : Promise.resolve({ contacts: [] }),
    groupIds.length
      ? fetch(`/api/tenant/groups?ids=${groupIds.join(',')}`).then((r) => r.ok ? r.json() : { groups: [] })
      : Promise.resolve({ groups: [] }),
  ]).then(([{ contacts }, { groups }]) => {
    const contactMap = {};
    for (const id of contactIds) contactMap[id] = null;  // mark dead refs as null
    for (const c of contacts || []) {
      contactMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || '(unnamed)';
    }
    const groupMap = {};
    for (const id of groupIds) groupMap[id] = null;
    for (const g of groups || []) {
      groupMap[g.id] = { name: g.name, member_count: g.member_count };
    }
    setHydratedNames({ contact: contactMap, group: groupMap });
  });
}, [groups /* the umbrella's groups list */]);
```

`groups` here refers to the umbrella's recipient groups, not org groups. The variable shadowing is awkward — the implementation should rename one or the other for clarity.

## Testing

### `tests/contacts-search-api.test.mjs` (new)

1. **Basic match** — query "jane" returns contacts whose first_name/last_name/email contains "jane".
2. **25-row cap** — seed 30 matching contacts, query returns 25.
3. **Empty query** — `q=""` returns 400.
4. **Cross-tenant filter** — seed contacts in tenants A and B; query as tenant A returns only A's contacts.
5. **Organization name hydrated** — response includes `organization_name` joined from `customers`.

### `tests/groups-search-api.test.mjs` (new)

1. **Basic match** — query "ops" returns groups whose name contains "ops".
2. **25-row cap**.
3. **Empty query** — 400.
4. **Cross-tenant filter**.
5. **Member count** — group with 3 members in `organization_group_members` returns `member_count: 3`.

### `tests/contacts-groups-batch-hydrate-api.test.mjs` (new)

1. **Batch contact hydration** — `?ids=a,b,c` returns matching rows.
2. **Cross-tenant filter** — id in another tenant is silently omitted.
3. **Dead-ref omission** — id that doesn't exist anywhere is silently omitted (UI infers dead from missing).
4. **Same for groups**.
5. **Empty `ids` param** — returns 400.
6. **`ids` over 100 entries** — returns 400.

### Integration (manual smoke via dd-qa)

- Open umbrella editor → click `{{}}` → switch to Contact tab → type "jane" → see results → click → green chip appears.
- Save umbrella → reload page → verify chip persists with the contact's name (hydrated).
- Repeat for Group tab.
- Open an umbrella that already has DB-seeded contact/group entries → verify chips render with hydrated names (not UUIDs).
- Delete the underlying contact in the org page → reload umbrella editor → verify the chip renders as muted "Deleted contact" with × button.

## Risks

1. **Search performance at scale.** A tenant with 10,000+ contacts will see slow `ilike '%q%'` queries (no trigram index). Mitigation: 25-row hard limit caps response time; if reported, add `gin_trgm_ops` index in a follow-up migration.

2. **Hydration network cost on umbrella editor open.** Tenants with many existing contact/group entries see two batch fetches on each editor mount. Acceptable — `.in()` queries scale to ~100 ids comfortably; spec caps batch size at 100.

3. **Color-blind accessibility.** Four chip colors (blue/purple/green/amber). Mitigation: each chip type has a distinct icon prefix (`{{}}`, `👤`, `📋`); color is supplementary, not the only visual differentiator.

4. **Dead-ref chips silent at fire time.** A `{type:'contact', value:<deleted_uuid>}` entry resolves to `[]` in the expander (no row found), silently contributing zero recipients. Same behavior as today; consistent with how `customer_primary` resolves to `[]` if the customer's primary contact is missing. Mitigation: dead-ref chips are visually distinct in the editor so admins can clean them up.

5. **JOIN to `customers` adds query cost.** Each search response runs a JOIN. Mitigation: result set is capped at 25; modern Postgres with FK index makes this trivial.

6. **Variable picker omitted may surprise some users.** If a tenant relies on `{type:'variable'}` entries today (only via DB seed), this picker doesn't help them. Mitigation: existing variable entries continue to render correctly via the expander; they're just not addable from the UI. File a follow-up if anyone asks.

## Open Questions (deferred to plan)

1. **Permission constant for the new endpoints.** Spec says `[PERMISSIONS.ALL_SETTINGS, PERMISSIONS.ALL]` — plan verifies this matches the umbrella editor's existing permission gate.
2. **Exact Supabase ilike-on-concat syntax.** Plan reads existing search queries in the codebase (e.g., `pages/api/tenant/organizations/index.js` `?search=` handling) and matches the pattern.
3. **Component name for the search panels.** Spec uses `ContactSearchPanel` / `GroupSearchPanel`. Plan picks final names and decides whether to extract to separate files or inline in the umbrella editor file.
4. **Variable shadowing fix** — the umbrella editor uses `groups` for the recipient-groups list. The hydration effect needs to use that same variable. Plan picks a clear local rename if needed.
5. **Tab bar a11y** — should the tabs use `role="tablist"` + `aria-selected`? Plan decides based on existing tab usage in the codebase.

## New follow-up FU candidate

- **FU-NEW-VARIABLE-PICKER**: Add a Variable tab to `RecipientRow` dropdown with autocomplete over known dotted-path values (`customer.primary_contact_email`, `tenant.dispatcher_email`, etc.). Defer until anyone actually requests it.
