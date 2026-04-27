# Umbrella Recipient Type Picker — Contact + Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two new tabs (Contact, Group) in the umbrella editor's `{{}}` dropdown so admins can add `{type:'contact'}` and `{type:'contact_group'}` recipient entries via tenant-wide search across `organization_contacts` / `organization_groups`.

**Architecture:** Four new API endpoints (2 search + 2 batch-hydrate) that query existing `organization_*` tables with tenant scoping. UI changes are confined to `pages/settings/communications/umbrellas/[id].js`: extend `RecipientRow` with a tab bar at the top of the existing `{{}}` dropdown; add `ContactSearchPanel` + `GroupSearchPanel` sub-components rendered conditionally per active tab; extend the chip-render switch with green/contact and amber/group variants; one-shot batch-hydrate of names on editor mount so existing DB-seeded entries display human-readable labels.

**Tech Stack:** Next.js (pages router), Supabase (Postgres + service-role client), React 18 with hooks, Tailwind CSS, lucide-react icons (`User`, `Users`), plain `node tests/<file>.test.mjs` test runner with custom `check()` helper.

**Spec:** [`docs/superpowers/specs/2026-04-27-umbrella-recipient-type-picker-design.md`](../specs/2026-04-27-umbrella-recipient-type-picker-design.md)

---

## Recon Summary (verified before plan was written)

| Question from spec | Answer |
|---|---|
| Permission constant for new endpoints | `[PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` — matches `pages/api/tenant/emails/umbrellas/index.js:26-28` and other email-area endpoints |
| Supabase ilike syntax precedent | `query.ilike('name', \`%${search}%\`)` — see `pages/api/tenant/organizations/index.js:64` |
| Existing umbrella editor location | `pages/settings/communications/umbrellas/[id].js` — `RecipientRow` is at line ~1285 (post-FU-114 work, will shift) |
| Existing role-token catalog | `ROLE_TOKEN_CATALOG` const at top of the same file (added in Task 12 of load-notify-parties) |
| Existing `addRecipient` / `addTokenRecipient` | line ~959-980 |
| Test runner | `node tests/<file>.test.mjs` — same pattern as feature tests already in repo |

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `pages/api/tenant/contacts/search.js` | GET endpoint — tenant-wide contact name/email search, returns up to 25 results with org name JOINed |
| `pages/api/tenant/contacts/index.js` | GET endpoint — batch-hydrate by `?ids=<comma-list>`, max 100 ids |
| `pages/api/tenant/groups/search.js` | GET endpoint — tenant-wide group name search, includes `member_count` |
| `pages/api/tenant/groups/index.js` | GET endpoint — batch-hydrate by `?ids=<comma-list>` |
| `tests/contacts-search-api.test.mjs` | Tests for `/contacts/search` |
| `tests/groups-search-api.test.mjs` | Tests for `/groups/search` |
| `tests/contacts-groups-batch-hydrate-api.test.mjs` | Tests for both batch-hydrate endpoints |

### Modified files

| Path | Change |
|---|---|
| `pages/settings/communications/umbrellas/[id].js` | Extend `RecipientRow` with tab bar + ContactSearchPanel + GroupSearchPanel sub-components + chip variants for contact/contact_group + one-shot batch-hydrate effect; new `addContactRecipient` + `addContactGroupRecipient` helpers wired via `onAddContact` + `onAddContactGroup` props on each `<RecipientRow>` invocation |
| `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` | Move FU-114 to "Recently resolved" with commit SHA; file new FU for variable picker |

---

## Task 1: GET `/api/tenant/contacts/search` Endpoint (TDD)

**Files:**
- Create: `pages/api/tenant/contacts/search.js`
- Create: `tests/contacts-search-api.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/contacts-search-api.test.mjs`:

```js
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const handlerModule = await import('../pages/api/tenant/contacts/search.js');
const { searchContacts } = handlerModule;

function makeMockSvc(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      _ilike: null,
      _limit: null,
      _order: null,
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      ilike: (col, val) => { c._ilike = { col, val }; return c; },
      or: (expr) => { c._filters.or = expr; return c; },
      limit: (n) => { c._limit = n; return c; },
      order: (col, opts) => { c._order = { col, opts }; return c; },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, ilike: c._ilike, limit: c._limit, order: c._order, terminal: 'await' });
        if (config[table] !== undefined) resolve({ data: config[table], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('GET /api/tenant/contacts/search');

// Case 1: Basic match returns hydrated rows
{
  console.log('\nCase 1: Basic match returns hydrated rows');
  const svc = makeMockSvc({
    organization_contacts: [
      {
        id: 'c-1',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@acme.com',
        organization_id: 'org-A',
        organization: { name: 'Acme Corp' },
      },
    ],
  });
  const result = await searchContacts(svc, { tenantId: 't-1' }, 'jane');
  check('returns 1 contact', result.contacts.length === 1);
  check('first_name hydrated', result.contacts[0].first_name === 'Jane');
  check('email hydrated', result.contacts[0].email === 'jane@acme.com');
  check('organization_name hydrated', result.contacts[0].organization_name === 'Acme Corp');
  check('tenant_id filter applied', svc._calls.queries[0].filters.tenant_id === 't-1');
  check('limit 25 applied', svc._calls.queries[0].limit === 25);
}

// Case 2: Empty query throws
{
  console.log('\nCase 2: Empty query throws');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await searchContacts(svc, { tenantId: 't-1' }, ''); }
  catch (e) { thrown = e; }
  check('empty q throws', thrown != null);
  check('empty q statusCode 400', thrown?.statusCode === 400);
}

// Case 3: Whitespace-only query throws
{
  console.log('\nCase 3: Whitespace-only query throws');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await searchContacts(svc, { tenantId: 't-1' }, '   '); }
  catch (e) { thrown = e; }
  check('whitespace q throws', thrown != null);
}

// Case 4: Cross-tenant isolation
{
  console.log('\nCase 4: Cross-tenant isolation');
  const svc = makeMockSvc({ organization_contacts: [] });
  await searchContacts(svc, { tenantId: 't-A' }, 'jane');
  check('queries with tenant_id filter', svc._calls.queries[0].filters.tenant_id === 't-A');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify FAILS**

Run: `node tests/contacts-search-api.test.mjs`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the endpoint**

Create `pages/api/tenant/contacts/search.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

const PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

/**
 * Pure helper — search contacts across the tenant by name or email.
 * Returns up to 25 rows with `organization_name` joined from `customers`.
 *
 * @throws Error with statusCode=400 if q is empty/whitespace.
 */
export async function searchContacts(svc, ctx, q) {
  const trimmed = (q || '').trim();
  if (!trimmed) {
    const e = new Error('q is required');
    e.statusCode = 400;
    throw e;
  }
  const escaped = trimmed.replace(/[%_]/g, '\\$&');
  const pattern = `%${escaped}%`;

  // Use Postgres OR across first_name, last_name, email
  const { data } = await svc
    .from('organization_contacts')
    .select('id, first_name, last_name, email, organization_id, organization:customers!organization_contacts_organization_id_fkey(name)')
    .eq('tenant_id', ctx.tenantId)
    .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`)
    .order('last_name', { ascending: true, nullsFirst: false })
    .limit(25);

  const contacts = (data || []).map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    organization_id: r.organization_id,
    organization_name: r.organization?.name || null,
  }));

  return { contacts };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, PERMS, res)) return;

  const svc = getServiceClient();
  try {
    const result = await searchContacts(svc, ctx, req.query.q);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
```

**Note about the FK alias**: the `organization:customers!<fk-name>(name)` syntax uses the actual foreign-key constraint name. The plan engineer should verify the FK name in migration 028 (likely `organization_contacts_organization_id_fkey`). If the constraint has a different name or if Supabase's auto-detection works without the explicit alias, simplify to `organization:customers(name)`.

- [ ] **Step 4: Run test to verify PASSES**

Run: `node tests/contacts-search-api.test.mjs`
Expected: ~10 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add tests/contacts-search-api.test.mjs pages/api/tenant/contacts/search.js
git commit -m "feat(api): GET /api/tenant/contacts/search

Tenant-wide search across organization_contacts. Matches case-insensitive
ilike on first_name, last_name, or email. Returns up to 25 results with
organization_name joined from customers. Tenant-scoped via ctx.tenantId.
Empty/whitespace q returns 400."
```

---

## Task 2: GET `/api/tenant/groups/search` Endpoint (TDD)

**Files:**
- Create: `pages/api/tenant/groups/search.js`
- Create: `tests/groups-search-api.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/groups-search-api.test.mjs`:

```js
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const handlerModule = await import('../pages/api/tenant/groups/search.js');
const { searchGroups } = handlerModule;

function makeMockSvc(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      _ilike: null,
      _limit: null,
      _order: null,
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      ilike: (col, val) => { c._ilike = { col, val }; return c; },
      limit: (n) => { c._limit = n; return c; },
      order: (col, opts) => { c._order = { col, opts }; return c; },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, ilike: c._ilike, limit: c._limit, terminal: 'await' });
        if (config[table] !== undefined) resolve({ data: config[table], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('GET /api/tenant/groups/search');

// Case 1: Basic match
{
  console.log('\nCase 1: Basic match');
  const svc = makeMockSvc({
    organization_groups: [
      {
        id: 'g-1',
        name: 'Operations',
        organization_id: 'org-A',
        organization: { name: 'Acme Corp' },
        members: [{ count: 4 }],
      },
    ],
  });
  const result = await searchGroups(svc, { tenantId: 't-1' }, 'ops');
  check('returns 1 group', result.groups.length === 1);
  check('name hydrated', result.groups[0].name === 'Operations');
  check('organization_name hydrated', result.groups[0].organization_name === 'Acme Corp');
  check('member_count derived', result.groups[0].member_count === 4);
  check('tenant_id filter applied', svc._calls.queries[0].filters.tenant_id === 't-1');
  check('limit 25 applied', svc._calls.queries[0].limit === 25);
}

// Case 2: Empty query throws
{
  console.log('\nCase 2: Empty query throws');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await searchGroups(svc, { tenantId: 't-1' }, ''); }
  catch (e) { thrown = e; }
  check('empty q throws', thrown != null);
  check('statusCode 400', thrown?.statusCode === 400);
}

// Case 3: Group with zero members returns member_count=0
{
  console.log('\nCase 3: Group with zero members');
  const svc = makeMockSvc({
    organization_groups: [
      {
        id: 'g-empty',
        name: 'Empty Group',
        organization_id: 'org-A',
        organization: { name: 'Acme' },
        members: [],
      },
    ],
  });
  const result = await searchGroups(svc, { tenantId: 't-1' }, 'empty');
  check('member_count is 0', result.groups[0].member_count === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify FAILS**

Run: `node tests/groups-search-api.test.mjs`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the endpoint**

Create `pages/api/tenant/groups/search.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

const PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

/**
 * Pure helper — search groups across the tenant by name. Returns up to
 * 25 rows with `organization_name` and `member_count` derived.
 *
 * @throws Error with statusCode=400 if q is empty/whitespace.
 */
export async function searchGroups(svc, ctx, q) {
  const trimmed = (q || '').trim();
  if (!trimmed) {
    const e = new Error('q is required');
    e.statusCode = 400;
    throw e;
  }
  const escaped = trimmed.replace(/[%_]/g, '\\$&');
  const pattern = `%${escaped}%`;

  const { data } = await svc
    .from('organization_groups')
    .select('id, name, organization_id, organization:customers(name), members:organization_group_members(count)')
    .eq('tenant_id', ctx.tenantId)
    .ilike('name', pattern)
    .order('name', { ascending: true })
    .limit(25);

  const groups = (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    organization_id: r.organization_id,
    organization_name: r.organization?.name || null,
    member_count: r.members?.[0]?.count ?? 0,
  }));

  return { groups };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, PERMS, res)) return;

  const svc = getServiceClient();
  try {
    const result = await searchGroups(svc, ctx, req.query.q);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
```

**Note about Supabase nested aggregation**: `members:organization_group_members(count)` is the Supabase syntax for joining and counting. Returns `[{ count: N }]`. Verify by reading similar count-aggregations elsewhere in the codebase (e.g., search for `(count)` in existing `.select()` clauses). If the syntax differs, adapt accordingly — the test mock's shape can be adjusted to match actual Supabase output.

- [ ] **Step 4: Run test to verify PASSES**

Run: `node tests/groups-search-api.test.mjs`
Expected: ~9 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add tests/groups-search-api.test.mjs pages/api/tenant/groups/search.js
git commit -m "feat(api): GET /api/tenant/groups/search

Tenant-wide search across organization_groups by name. Returns up to 25
results with organization_name joined and member_count derived from
organization_group_members aggregate. Tenant-scoped. Empty q → 400."
```

---

## Task 3: GET `/api/tenant/contacts` Batch Hydrate Endpoint (TDD)

**Files:**
- Create: `pages/api/tenant/contacts/index.js`
- Create: `tests/contacts-groups-batch-hydrate-api.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/contacts-groups-batch-hydrate-api.test.mjs`:

```js
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const contactsModule = await import('../pages/api/tenant/contacts/index.js');
const { hydrateContacts } = contactsModule;

function makeMockSvc(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      in: (col, vals) => { c._filters[`in:${col}`] = vals; return c; },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, terminal: 'await' });
        if (config[table] !== undefined) resolve({ data: config[table], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('GET /api/tenant/contacts?ids=');

// Case 1: Returns hydrated rows for given ids
{
  console.log('\nCase 1: Returns hydrated rows');
  const svc = makeMockSvc({
    organization_contacts: [
      { id: 'c-1', first_name: 'Jane', last_name: 'Smith', email: 'jane@acme.com', organization_id: 'org-A', organization: { name: 'Acme' } },
      { id: 'c-2', first_name: 'Bob', last_name: 'Lee', email: 'bob@acme.com', organization_id: 'org-A', organization: { name: 'Acme' } },
    ],
  });
  const result = await hydrateContacts(svc, { tenantId: 't-1' }, ['c-1', 'c-2']);
  check('returns 2 contacts', result.contacts.length === 2);
  check('first_name hydrated', result.contacts.find((c) => c.id === 'c-1').first_name === 'Jane');
  check('organization_name hydrated', result.contacts[0].organization_name === 'Acme');
  check('tenant_id filter', svc._calls.queries[0].filters.tenant_id === 't-1');
  check('in() filter on id', Array.isArray(svc._calls.queries[0].filters['in:id']));
}

// Case 2: Empty ids array throws
{
  console.log('\nCase 2: Empty ids array throws');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await hydrateContacts(svc, { tenantId: 't-1' }, []); }
  catch (e) { thrown = e; }
  check('throws', thrown != null);
  check('statusCode 400', thrown?.statusCode === 400);
}

// Case 3: Over-100 ids throws
{
  console.log('\nCase 3: Over-100 ids throws');
  const svc = makeMockSvc({});
  const ids = Array.from({ length: 101 }, (_, i) => `c-${i}`);
  let thrown = null;
  try { await hydrateContacts(svc, { tenantId: 't-1' }, ids); }
  catch (e) { thrown = e; }
  check('throws', thrown != null);
  check('statusCode 400', thrown?.statusCode === 400);
}

// Case 4: Missing ids silently omitted (dead-ref)
{
  console.log('\nCase 4: Missing ids silently omitted');
  const svc = makeMockSvc({
    organization_contacts: [
      { id: 'c-1', first_name: 'Jane', last_name: null, email: 'j@x.com', organization_id: 'org-A', organization: null },
    ],
  });
  const result = await hydrateContacts(svc, { tenantId: 't-1' }, ['c-1', 'c-deleted']);
  check('returns only the alive row', result.contacts.length === 1);
  check('alive row id is c-1', result.contacts[0].id === 'c-1');
}

console.log(`\n${passed} passed, ${failed} failed`);
```

(Note: do NOT add a closing `if (failed > 0) process.exit(1);` here yet — Task 4 will append more cases and the same closing guard.)

- [ ] **Step 2: Run test to verify FAILS**

Run: `node tests/contacts-groups-batch-hydrate-api.test.mjs`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the endpoint**

Create `pages/api/tenant/contacts/index.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

const PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const MAX_BATCH = 100;

/**
 * Pure helper — batch-hydrate contacts by id list. Returns rows for
 * each id that exists in the tenant; missing ids are silently omitted
 * (UI handles dead-ref display).
 *
 * @throws Error with statusCode=400 if ids is empty or over MAX_BATCH.
 */
export async function hydrateContacts(svc, ctx, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('ids is required');
    e.statusCode = 400;
    throw e;
  }
  if (ids.length > MAX_BATCH) {
    const e = new Error(`ids exceeds max batch size of ${MAX_BATCH}`);
    e.statusCode = 400;
    throw e;
  }

  const { data } = await svc
    .from('organization_contacts')
    .select('id, first_name, last_name, email, organization_id, organization:customers(name)')
    .eq('tenant_id', ctx.tenantId)
    .in('id', ids);

  const contacts = (data || []).map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    organization_id: r.organization_id,
    organization_name: r.organization?.name || null,
  }));

  return { contacts };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, PERMS, res)) return;

  const svc = getServiceClient();
  const idsParam = (req.query.ids || '').toString();
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);

  try {
    const result = await hydrateContacts(svc, ctx, ids);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
```

- [ ] **Step 4: Run test to verify PASSES**

Run: `node tests/contacts-groups-batch-hydrate-api.test.mjs`
Expected: ~10 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add tests/contacts-groups-batch-hydrate-api.test.mjs pages/api/tenant/contacts/index.js
git commit -m "feat(api): GET /api/tenant/contacts?ids= batch hydrate

Returns rows for each contact id that exists in the tenant. Missing ids
are silently omitted (UI handles dead-ref display). Caps batch at 100.
Used by umbrella editor to resolve display names for existing
{type:'contact'} recipient entries on mount."
```

---

## Task 4: GET `/api/tenant/groups` Batch Hydrate Endpoint (TDD)

**Files:**
- Create: `pages/api/tenant/groups/index.js`
- Modify: `tests/contacts-groups-batch-hydrate-api.test.mjs`

- [ ] **Step 1: Append group-batch-hydrate test cases**

Append to `tests/contacts-groups-batch-hydrate-api.test.mjs`, BEFORE the final `console.log(\`\n${passed} passed...`)`:

```js
console.log('\nGET /api/tenant/groups?ids=');

const groupsModule = await import('../pages/api/tenant/groups/index.js');
const { hydrateGroups } = groupsModule;

// Case 5: Returns hydrated group rows
{
  console.log('\nCase 5: Returns hydrated groups');
  const svc = makeMockSvc({
    organization_groups: [
      { id: 'g-1', name: 'Operations', organization_id: 'org-A', organization: { name: 'Acme' }, members: [{ count: 3 }] },
      { id: 'g-2', name: 'Billing', organization_id: 'org-A', organization: { name: 'Acme' }, members: [{ count: 2 }] },
    ],
  });
  const result = await hydrateGroups(svc, { tenantId: 't-1' }, ['g-1', 'g-2']);
  check('returns 2 groups', result.groups.length === 2);
  check('name hydrated', result.groups.find((g) => g.id === 'g-1').name === 'Operations');
  check('organization_name hydrated', result.groups[0].organization_name === 'Acme');
  check('member_count derived', result.groups.find((g) => g.id === 'g-1').member_count === 3);
}

// Case 6: Empty ids throws
{
  console.log('\nCase 6: Empty ids throws (groups)');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await hydrateGroups(svc, { tenantId: 't-1' }, []); }
  catch (e) { thrown = e; }
  check('throws', thrown != null);
  check('statusCode 400', thrown?.statusCode === 400);
}

// Case 7: Over-100 ids throws (groups)
{
  console.log('\nCase 7: Over-100 ids throws (groups)');
  const svc = makeMockSvc({});
  const ids = Array.from({ length: 101 }, (_, i) => `g-${i}`);
  let thrown = null;
  try { await hydrateGroups(svc, { tenantId: 't-1' }, ids); }
  catch (e) { thrown = e; }
  check('throws', thrown != null);
}

// Case 8: Dead-ref groups silently omitted
{
  console.log('\nCase 8: Dead-ref groups omitted');
  const svc = makeMockSvc({
    organization_groups: [
      { id: 'g-alive', name: 'Alive', organization_id: 'org-A', organization: { name: 'Acme' }, members: [{ count: 1 }] },
    ],
  });
  const result = await hydrateGroups(svc, { tenantId: 't-1' }, ['g-alive', 'g-deleted']);
  check('returns only alive', result.groups.length === 1);
}
```

Now find the existing line near the bottom:

```js
console.log(`\n${passed} passed, ${failed} failed`);
```

If it doesn't already have the exit guard, ADD this line right after it:

```js
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify Cases 5-8 FAIL**

Run: `node tests/contacts-groups-batch-hydrate-api.test.mjs`
Expected: Cases 1-4 still pass (from Task 3); Cases 5-8 fail because `hydrateGroups` is not exported.

- [ ] **Step 3: Implement the endpoint**

Create `pages/api/tenant/groups/index.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

const PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const MAX_BATCH = 100;

/**
 * Pure helper — batch-hydrate groups by id list. Returns rows for each
 * id that exists in the tenant with `member_count` derived. Missing ids
 * are silently omitted (UI handles dead-ref display).
 *
 * @throws Error with statusCode=400 if ids is empty or over MAX_BATCH.
 */
export async function hydrateGroups(svc, ctx, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('ids is required');
    e.statusCode = 400;
    throw e;
  }
  if (ids.length > MAX_BATCH) {
    const e = new Error(`ids exceeds max batch size of ${MAX_BATCH}`);
    e.statusCode = 400;
    throw e;
  }

  const { data } = await svc
    .from('organization_groups')
    .select('id, name, organization_id, organization:customers(name), members:organization_group_members(count)')
    .eq('tenant_id', ctx.tenantId)
    .in('id', ids);

  const groups = (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    organization_id: r.organization_id,
    organization_name: r.organization?.name || null,
    member_count: r.members?.[0]?.count ?? 0,
  }));

  return { groups };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, PERMS, res)) return;

  const svc = getServiceClient();
  const idsParam = (req.query.ids || '').toString();
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);

  try {
    const result = await hydrateGroups(svc, ctx, ids);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
```

- [ ] **Step 4: Run test to verify all 8 cases PASS**

Run: `node tests/contacts-groups-batch-hydrate-api.test.mjs`
Expected: ~18 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add tests/contacts-groups-batch-hydrate-api.test.mjs pages/api/tenant/groups/index.js
git commit -m "feat(api): GET /api/tenant/groups?ids= batch hydrate

Mirrors the contacts batch-hydrate endpoint. Returns name, organization
name, and member_count for each group id in the tenant. Caps batch at
100. Used by umbrella editor to resolve display names for existing
{type:'contact_group'} recipient entries on mount."
```

---

## Task 5: Tab Bar + State in `RecipientRow`

**Files:**
- Modify: `pages/settings/communications/umbrellas/[id].js`

This task adds the tab-bar UI and the state hooks. Sub-panels for Contact and Group come in Task 6 (intentionally split to keep diffs reviewable).

- [ ] **Step 1: Read the current RecipientRow + dropdown structure**

Read `pages/settings/communications/umbrellas/[id].js` from `function RecipientRow` (~line 1285) to its closing `}`. Note specifically:
- The `tokenPickerOpen` state declaration
- Where `ROLE_TOKEN_CATALOG` is rendered inside the dropdown
- Where `tokenPickerRef` is attached
- The current click-outside `useEffect`

- [ ] **Step 2: Add tab state to `RecipientRow`**

Find the `RecipientRow` function. Right after `const [tokenPickerOpen, setTokenPickerOpen] = useState(false);`, add:

```js
  const [activeTab, setActiveTab] = useState('role');
  const [contactQuery, setContactQuery] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [groupResults, setGroupResults] = useState([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);
```

Also when `tokenPickerOpen` flips to `false` (user closes dropdown), reset the per-tab state. Find the existing close handlers (the click-outside effect's `setTokenPickerOpen(false)` and the role-token click-handler that closes the dropdown) — after each, add:

```js
  setActiveTab('role');
  setContactQuery('');
  setGroupQuery('');
  setContactResults([]);
  setGroupResults([]);
```

(Equivalently, add a `useEffect` watching `tokenPickerOpen` that resets all of the above when it becomes `false`.)

The `useEffect` approach is cleaner. Add this effect right after the existing click-outside effect:

```js
  useEffect(() => {
    if (!tokenPickerOpen) {
      setActiveTab('role');
      setContactQuery('');
      setGroupQuery('');
      setContactResults([]);
      setGroupResults([]);
    }
  }, [tokenPickerOpen]);
```

- [ ] **Step 3: Add the tab bar JSX inside the dropdown**

Find the existing dropdown content (the `{tokenPickerOpen && (...)}` block — currently renders `ROLE_TOKEN_CATALOG`). Wrap the role-token rendering in a conditional and add tabs above:

```jsx
{tokenPickerOpen && (
  <div
    ref={tokenPickerRef}
    className="absolute z-30 mt-1 right-0 w-80 max-h-96 overflow-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
  >
    {/* Tab bar */}
    <div className="flex border-b border-gray-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-900 z-10">
      {[
        { id: 'role', label: 'Role' },
        { id: 'contact', label: 'Contact' },
        { id: 'group', label: 'Group' },
      ].map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setActiveTab(t.id)}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === t.id
              ? 'text-purple-700 dark:text-purple-300 border-b-2 border-purple-500'
              : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800/50'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>

    {/* Role tab content (existing rendering) */}
    {activeTab === 'role' && (
      <>
        {ROLE_TOKEN_CATALOG.map((s) => (
          <div key={s.section} className="border-b border-gray-100 dark:border-slate-800 last:border-0">
            {/* ...existing rendering... */}
          </div>
        ))}
      </>
    )}

    {/* Placeholder for Contact + Group tab content (Task 6) */}
    {activeTab === 'contact' && <div className="p-3 text-xs text-gray-500 dark:text-slate-400">Contact search panel coming in Task 6</div>}
    {activeTab === 'group' && <div className="p-3 text-xs text-gray-500 dark:text-slate-400">Group search panel coming in Task 6</div>}
  </div>
)}
```

The width was originally `w-72`; bump to `w-80` for the slightly wider tab labels. Verify this doesn't break the existing role-tab layout. The actual `ROLE_TOKEN_CATALOG` rendering inside `activeTab === 'role'` should be the EXACT existing JSX — copy it verbatim from the current dropdown block.

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Open `/settings/communications/umbrellas/<some-id>`. Click the `{{}}` button on a To/Cc/Bcc input. Verify:
- Three tabs visible: Role, Contact, Group
- Role tab shows the existing token list
- Contact and Group tabs show their placeholder text
- Clicking outside closes the dropdown
- Reopening defaults back to Role tab

- [ ] **Step 5: Commit**

```bash
git add pages/settings/communications/umbrellas/[id].js
git commit -m "feat(umbrellas): tab bar + state hooks in RecipientRow dropdown

Adds [Role|Contact|Group] tab bar to the existing {{}} dropdown. Role tab
preserves the existing token catalog rendering verbatim. Contact and Group
tabs render placeholder content (panels come in Task 6). Tab state resets
on dropdown close."
```

---

## Task 6: ContactSearchPanel + GroupSearchPanel + Wired Add Handlers

**Files:**
- Modify: `pages/settings/communications/umbrellas/[id].js`

- [ ] **Step 1: Add the new add-handlers next to `addTokenRecipient`**

Find `addTokenRecipient` (the function added in load-notify-parties Task 12, ~line 970). Add these two functions immediately after:

```js
  function addContactRecipient(kind, contactId) {
    if (!contactId) return;
    const entry = { type: 'contact', value: contactId };
    const key = `${kind}_recipients`;
    const current = Array.isArray(group[key]) ? group[key] : [];
    if (current.some((r) => r.type === 'contact' && r.value === contactId)) return;
    onUpdate({ [key]: [...current, entry] });
  }

  function addContactGroupRecipient(kind, groupId) {
    if (!groupId) return;
    const entry = { type: 'contact_group', value: groupId };
    const key = `${kind}_recipients`;
    const current = Array.isArray(group[key]) ? group[key] : [];
    if (current.some((r) => r.type === 'contact_group' && r.value === groupId)) return;
    onUpdate({ [key]: [...current, entry] });
  }
```

- [ ] **Step 2: Add `onAddContact` + `onAddContactGroup` props to each `<RecipientRow>` invocation**

Find the three `<RecipientRow>` calls (To, Cc, Bcc — around lines 1041, 1054, 1066 in pre-FU-114 numbering; will shift). Add these props alongside the existing `onAddToken`:

```jsx
<RecipientRow
  label="To"
  ...
  onAddToken={(token) => addTokenRecipient('to', token)}
  onAddContact={(contactId) => addContactRecipient('to', contactId)}
  onAddContactGroup={(groupId) => addContactGroupRecipient('to', groupId)}
  onRemove={(idx) => removeRecipient('to', idx)}
/>
```

Repeat for `cc` and `bcc`.

- [ ] **Step 3: Add `onAddContact` + `onAddContactGroup` to `RecipientRow` destructured props**

In the `RecipientRow` function signature, add:

```js
function RecipientRow({
  label,
  accentColor = 'gray',
  required = false,
  recipients,
  input,
  onInputChange,
  onAdd,
  onAddToken,
  onAddContact,        // NEW
  onAddContactGroup,   // NEW
  onRemove,
}) {
```

- [ ] **Step 4: Add the search-effect hooks**

Inside `RecipientRow`, after the existing tab-state hooks (added in Task 5), add the debounced search effects:

```js
  // Contact search — 250ms debounce
  useEffect(() => {
    if (activeTab !== 'contact' || !contactQuery.trim()) {
      setContactResults([]);
      return;
    }
    const q = contactQuery.trim();
    const handle = setTimeout(async () => {
      setContactLoading(true);
      try {
        const res = await fetch(`/api/tenant/contacts/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const json = await res.json();
          setContactResults(json.contacts || []);
        } else {
          setContactResults([]);
        }
      } finally {
        setContactLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [activeTab, contactQuery]);

  // Group search — 250ms debounce
  useEffect(() => {
    if (activeTab !== 'group' || !groupQuery.trim()) {
      setGroupResults([]);
      return;
    }
    const q = groupQuery.trim();
    const handle = setTimeout(async () => {
      setGroupLoading(true);
      try {
        const res = await fetch(`/api/tenant/groups/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const json = await res.json();
          setGroupResults(json.groups || []);
        } else {
          setGroupResults([]);
        }
      } finally {
        setGroupLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [activeTab, groupQuery]);
```

- [ ] **Step 5: Replace the placeholder Contact/Group tab content with real panels**

In the dropdown JSX, find the placeholders from Task 5:

```jsx
{activeTab === 'contact' && <div className="p-3 text-xs text-gray-500 dark:text-slate-400">Contact search panel coming in Task 6</div>}
{activeTab === 'group' && <div className="p-3 text-xs text-gray-500 dark:text-slate-400">Group search panel coming in Task 6</div>}
```

Replace with:

```jsx
{activeTab === 'contact' && (
  <div className="p-2">
    <input
      type="search"
      value={contactQuery}
      onChange={(e) => setContactQuery(e.target.value)}
      placeholder="Search contacts by name or email…"
      aria-label="Search contacts"
      className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500"
    />
    <div className="mt-2">
      {!contactQuery.trim() ? (
        <div className="px-2 py-2 text-[11px] text-gray-400 dark:text-slate-500 italic">Start typing to search…</div>
      ) : contactLoading ? (
        <div className="px-2 py-2 text-[11px] text-gray-500 dark:text-slate-400">Searching…</div>
      ) : contactResults.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-gray-400 dark:text-slate-500 italic">No matches</div>
      ) : (
        contactResults.map((c) => {
          const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || '(unnamed)';
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => { onAddContact?.(c.id); setTokenPickerOpen(false); }}
              className="flex items-start gap-2 w-full px-2 py-1.5 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded"
            >
              <User className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{name}</div>
                <div className="text-[10px] text-gray-500 dark:text-slate-500 truncate">
                  {c.email}
                  {c.organization_name && <span className="ml-1">· {c.organization_name}</span>}
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  </div>
)}

{activeTab === 'group' && (
  <div className="p-2">
    <input
      type="search"
      value={groupQuery}
      onChange={(e) => setGroupQuery(e.target.value)}
      placeholder="Search groups by name…"
      aria-label="Search groups"
      className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-500"
    />
    <div className="mt-2">
      {!groupQuery.trim() ? (
        <div className="px-2 py-2 text-[11px] text-gray-400 dark:text-slate-500 italic">Start typing to search…</div>
      ) : groupLoading ? (
        <div className="px-2 py-2 text-[11px] text-gray-500 dark:text-slate-400">Searching…</div>
      ) : groupResults.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-gray-400 dark:text-slate-500 italic">No matches</div>
      ) : (
        groupResults.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => { onAddContactGroup?.(g.id); setTokenPickerOpen(false); }}
            className="flex items-start gap-2 w-full px-2 py-1.5 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded"
          >
            <Users className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {g.name}
                {g.member_count != null && (
                  <span className="ml-1 text-[10px] text-gray-500 dark:text-slate-500 font-normal">
                    ({g.member_count})
                  </span>
                )}
              </div>
              {g.organization_name && (
                <div className="text-[10px] text-gray-500 dark:text-slate-500 truncate">
                  {g.organization_name}
                </div>
              )}
            </div>
          </button>
        ))
      )}
    </div>
  </div>
)}
```

The icons `User` and `Users` from `lucide-react` should already be imported in this file (they're used elsewhere). If not, add them to the existing lucide-react import block.

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
```

Open umbrella editor. Click `{{}}`. Switch to Contact tab. Type a name → see results. Click a result → verify it gets added (chip rendering will show the raw UUID until Task 7 hydration; that's expected at this stage). Switch to Group tab. Same flow.

Verify the dropdown closes on selection.

- [ ] **Step 7: Commit**

```bash
git add pages/settings/communications/umbrellas/[id].js
git commit -m "feat(umbrellas): Contact + Group search panels in RecipientRow

Adds debounced search inputs (250ms) for contacts and groups in the
{{}} dropdown. Each panel calls the tenant-wide search endpoint, shows
loading / empty-state / no-results / results list. Click adds a
{type:'contact'} or {type:'contact_group'} entry via new
addContactRecipient + addContactGroupRecipient helpers wired through
onAddContact + onAddContactGroup props on each RecipientRow invocation.
Chips will display raw UUIDs until hydration ships in Task 7."
```

---

## Task 7: Chip Rendering Variants + One-Shot Batch Hydration

**Files:**
- Modify: `pages/settings/communications/umbrellas/[id].js`

- [ ] **Step 1: Add hydration state at the umbrella-editor (parent) level**

The hydration must run ONCE per umbrella load, NOT per `RecipientRow`. Find the parent component that owns the umbrella's `groups` array (the recipient groups list — likely a state variable named something like `umbrella` or `groups`). At its top, add:

```js
  const [hydratedNames, setHydratedNames] = useState({ contact: {}, group: {} });
```

(Adjust the variable name to avoid conflict with `groups` from the umbrella's recipient-groups list. If `groups` is the umbrella's groups variable, use `setHydratedNames` and `hydratedNames` as-is — they don't collide.)

- [ ] **Step 2: Add the one-shot hydrate effect**

Right after the hydration state declaration, add:

```js
  useEffect(() => {
    // Collect all unique contact and contact_group ids referenced across
    // all umbrella groups' to/cc/bcc recipient arrays.
    const allRecipients = (groups || []).flatMap((g) => [
      ...(g.to_recipients || []),
      ...(g.cc_recipients || []),
      ...(g.bcc_recipients || []),
    ]);
    const contactIds = Array.from(new Set(
      allRecipients.filter((r) => r.type === 'contact').map((r) => r.value).filter(Boolean)
    ));
    const groupIds = Array.from(new Set(
      allRecipients.filter((r) => r.type === 'contact_group').map((r) => r.value).filter(Boolean)
    ));

    if (contactIds.length === 0 && groupIds.length === 0) return;

    let cancelled = false;
    Promise.all([
      contactIds.length
        ? fetch(`/api/tenant/contacts?ids=${contactIds.join(',')}`).then((r) => r.ok ? r.json() : { contacts: [] }).catch(() => ({ contacts: [] }))
        : Promise.resolve({ contacts: [] }),
      groupIds.length
        ? fetch(`/api/tenant/groups?ids=${groupIds.join(',')}`).then((r) => r.ok ? r.json() : { groups: [] }).catch(() => ({ groups: [] }))
        : Promise.resolve({ groups: [] }),
    ]).then(([{ contacts }, { groups: hydratedGroups }]) => {
      if (cancelled) return;
      const contactMap = {};
      for (const id of contactIds) contactMap[id] = null;  // mark dead refs as null
      for (const c of contacts || []) {
        contactMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || '(unnamed)';
      }
      const groupMap = {};
      for (const id of groupIds) groupMap[id] = null;
      for (const g of hydratedGroups || []) {
        groupMap[g.id] = { name: g.name, member_count: g.member_count };
      }
      setHydratedNames({ contact: contactMap, group: groupMap });
    });
    return () => { cancelled = true; };
  }, [groups]);
```

(The dependency `[groups]` here is the umbrella's recipient-groups list, NOT React's group state. Verify the variable name in the parent component — it may be named differently like `umbrellaGroups` or `recipientGroups`. Use the right one.)

- [ ] **Step 3: Pass `hydratedNames` down to `RecipientRow`**

In the parent component's render block, find each `<RecipientRow ... />` invocation. Add the prop:

```jsx
hydratedNames={hydratedNames}
```

In `RecipientRow`'s destructured props signature, add `hydratedNames = { contact: {}, group: {} }`.

- [ ] **Step 4: Update the chip-rendering block in `RecipientRow`**

Find the existing chip-render `{recipients.map((r, idx) => { ... })}` block. The current logic handles `email` and `role`. Replace the entire `recipients.map` body with:

```jsx
{recipients.map((r, idx) => {
  const isToken = r.type === 'role';
  const isContact = r.type === 'contact';
  const isGroup = r.type === 'contact_group';

  const contactHydrated = isContact ? hydratedNames.contact[r.value] : undefined;
  const groupHydrated = isGroup ? hydratedNames.group[r.value] : undefined;

  let display;
  let icon = null;
  let colorClasses;

  if (isToken) {
    display = ROLE_TOKEN_LABELS[r.value] || r.value;
    icon = <span className="text-[10px] font-mono text-purple-500 dark:text-purple-400">{`{{}}`}</span>;
    colorClasses = 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900/60 text-purple-700 dark:text-purple-300';
  } else if (isContact) {
    icon = <User className="w-3 h-3" />;
    if (contactHydrated === undefined) {
      display = 'Loading…';
      colorClasses = 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-500 dark:text-slate-400';
    } else if (contactHydrated === null) {
      display = 'Deleted contact';
      colorClasses = 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-500 dark:text-slate-400 line-through';
    } else {
      display = contactHydrated;
      colorClasses = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300';
    }
  } else if (isGroup) {
    icon = <Users className="w-3 h-3" />;
    if (groupHydrated === undefined) {
      display = 'Loading…';
      colorClasses = 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-500 dark:text-slate-400';
    } else if (groupHydrated === null) {
      display = 'Deleted group';
      colorClasses = 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-500 dark:text-slate-400 line-through';
    } else {
      display = `${groupHydrated.name} (${groupHydrated.member_count})`;
      colorClasses = 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-700 dark:text-amber-300';
    }
  } else {
    // email or unknown type
    display = r.value;
    colorClasses = 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-300';
  }

  return (
    <span
      key={idx}
      className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs border ${colorClasses}`}
    >
      {icon}
      <span className="truncate max-w-[200px]">{display}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
        className="hover:text-rose-600 dark:hover:text-rose-400 p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
        aria-label={`Remove ${display}`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
})}
```

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
```

Open an umbrella that has DB-seeded `{type:'contact'}` or `{type:'contact_group'}` recipient entries (or seed one via Supabase SQL editor for testing).

Verify:
- Chips render initially as gray "Loading…"
- After a beat, contact chips become green with the person's name
- Group chips become amber with name + (N) member count
- Removing a chip works
- Adding a new contact via Contact tab — chip appears green with the name immediately (since the search response carries first_name/last_name/email)

Wait — adding a chip via the search panel doesn't currently call `setHydratedNames`. The new chip will go through the rendering path, which checks `hydratedNames.contact[r.value]`. Since hydration only ran on mount, the new id won't be in the map and will render as "Loading…" forever.

Fix this in Step 6 below.

- [ ] **Step 6: Update add-handlers to also pre-populate `hydratedNames`**

The `addContactRecipient` and `addContactGroupRecipient` helpers (added in Task 6) only push the entry into the recipients array. The chip rendering then reads `hydratedNames` to display the name — but the entry was added without updating `hydratedNames`, so the chip stays in "Loading…" forever.

Two approaches:
- (A) The add-handlers also call `setHydratedNames` with the display info. Requires the search panel to pass display data through to the handler.
- (B) After every add, refire the hydration effect. Simpler but burns an extra API call per add.

Use (A). Update the add-handlers and panel-onClick:

In the parent component:

```js
  function addContactRecipient(kind, contactId, displayHints) {
    if (!contactId) return;
    const entry = { type: 'contact', value: contactId };
    const key = `${kind}_recipients`;
    const current = Array.isArray(group[key]) ? group[key] : [];
    if (current.some((r) => r.type === 'contact' && r.value === contactId)) return;
    onUpdate({ [key]: [...current, entry] });
    if (displayHints) {
      setHydratedNames((prev) => ({
        ...prev,
        contact: { ...prev.contact, [contactId]: displayHints.name },
      }));
    }
  }

  function addContactGroupRecipient(kind, groupId, displayHints) {
    if (!groupId) return;
    const entry = { type: 'contact_group', value: groupId };
    const key = `${kind}_recipients`;
    const current = Array.isArray(group[key]) ? group[key] : [];
    if (current.some((r) => r.type === 'contact_group' && r.value === groupId)) return;
    onUpdate({ [key]: [...current, entry] });
    if (displayHints) {
      setHydratedNames((prev) => ({
        ...prev,
        group: { ...prev.group, [groupId]: { name: displayHints.name, member_count: displayHints.member_count ?? 0 } },
      }));
    }
  }
```

In the search-panel onClick handlers in `RecipientRow`:

```jsx
// Contact panel
onClick={() => {
  const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || '(unnamed)';
  onAddContact?.(c.id, { name });
  setTokenPickerOpen(false);
}}

// Group panel
onClick={() => {
  onAddContactGroup?.(g.id, { name: g.name, member_count: g.member_count });
  setTokenPickerOpen(false);
}}
```

The signature of `onAddContact` / `onAddContactGroup` props on `RecipientRow` is now `(id, displayHints?) => void`. Update each invocation site at the parent level:

```jsx
onAddContact={(contactId, displayHints) => addContactRecipient('to', contactId, displayHints)}
onAddContactGroup={(groupId, displayHints) => addContactGroupRecipient('to', groupId, displayHints)}
```

Repeat for `cc` and `bcc`.

- [ ] **Step 7: Re-run manual smoke**

```bash
npm run dev
```

- Add a contact via search → chip should render green with the name immediately (no "Loading…" flash).
- Reload page → existing contact chips on the umbrella should hydrate after a beat from gray to green.
- Delete the underlying contact → reload → verify chip renders muted gray with "Deleted contact" line-through.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/communications/umbrellas/[id].js
git commit -m "feat(umbrellas): chip variants + batch-hydrate for contact/contact_group

Extends the chip render switch in RecipientRow with green/contact and
amber/group variants. Adds a one-shot batch-hydrate effect at the
umbrella-editor level that fetches names/orgs/member counts for all
{type:'contact'} and {type:'contact_group'} entries on mount and stores
them in hydratedNames state. Pre-populates hydratedNames in the add
handlers so newly-added chips render immediately without a Loading
flash. Dead refs (entry id no longer in DB) render muted with
'Deleted contact'/'Deleted group' line-through and an X to remove."
```

---

## Task 8: dd-qa Pass + Manual End-to-End Smoke

**Files:** none (verification only — fixes go to whichever file is broken)

- [ ] **Step 1: Run dd-qa skill**

Invoke the `dd-qa` skill against the changed surface. Specifically watch for:
- New endpoints follow the existing tenant-API pattern (auth, permission gate, service client)
- Search queries are tenant-scoped
- Chip dark-mode variants on every new color
- No `overflow-hidden` ancestor that would clip the absolute-positioned dropdown (the dropdown already uses `position:fixed` via portal? — verify; if not, the dropdown might be clipped by a modal scroll-container if used inside one. Note: this picker is on a settings page, NOT inside a modal, so the clipping issue from `NotifyPartyPicker` is unlikely here — but verify.)

- [ ] **Step 2: Manual end-to-end smoke**

Run through these scenarios:

1. **Add a contact end-to-end.** Open umbrella editor → click `{{}}` → Contact tab → type "smith" → click a result → green chip appears → save umbrella → reload page → verify chip persists with the contact's name.

2. **Add a group end-to-end.** Same flow with Group tab → amber chip with `(N)` count.

3. **Existing DB-seeded entry hydration.** Use Supabase SQL editor to insert a `{type:'contact', value:'<existing-contact-uuid>'}` directly into an umbrella group's `to_recipients`. Reload editor → verify chip renders with hydrated name (not UUID) after the batch fetch completes.

4. **Dead-ref handling.** Add a contact via search → save → DELETE that contact in the org page → reload umbrella editor → verify chip renders as muted "Deleted contact" with line-through and X button.

5. **Cross-tenant isolation.** Sanity-check via Supabase: search via tenant A's session shouldn't return contacts from tenant B. (Hard to verify in dev — the test cases in Tasks 1-4 cover this.)

6. **Email send still works.** Trigger an email umbrella that includes the new contact entry. Verify the actual recipient email matches the contact's email. (Resolver path was already migrated by FU-113 to `organization_contacts` — should work unchanged.)

7. **Removing a contact chip works** and persists across reload.

- [ ] **Step 3: Fix any issues found and commit**

If a smoke scenario fails, edit the relevant file, retest, commit with `fix(umbrellas): ...` message.

---

## Task 9: File Follow-Up FU + Update Memory

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`

- [ ] **Step 1: Pick the next available FU number**

Read `followups.md` and find the highest existing FU number. Next is FU-NNN.

- [ ] **Step 2: Append the new FU to followups.md**

Append at the top of the "Open" section:

```markdown
### FU-NNN: Variable picker for `{type:'variable'}` entries in umbrella editor RecipientRow
- Source: 2026-04-27-umbrella-recipient-type-picker spec (deferred from FU-114)
- Scope: small-medium
- Area: settings / email
- Intent: FU-114 added Contact + Group tabs but explicitly skipped a Variable picker. The expander supports `{type:'variable', value:'customer.primary_contact.email'}` (dotted-path lookup against the email-context tree) but it's only reachable via direct DB seed. Build a Variable tab with autocomplete over known dotted paths (enumerated from the email context-builder output) so power users can address paths beyond the predefined role tokens. Defer until anyone actually requests it.
```

- [ ] **Step 3: Move FU-114 from "Open" to "Recently resolved"**

Find FU-114 in the Open section and move it to "Recently resolved" under a `## 2026-04-27` header (creating that header if it doesn't exist). Add the resolution annotation:

```markdown
### FU-114: Full type-picker for non-role recipient entry types in umbrella editor
- **Resolved:** 2026-04-27 in `<merge-commit-sha>` — Contact and Group tabs added to the umbrella editor's `{{}}` dropdown. Search across `organization_contacts` (by name/email) and `organization_groups` (by name) with debounced 250ms type-ahead, capped at 25 results, tenant-scoped. Click adds a `{type:'contact'}` or `{type:'contact_group'}` recipient entry; chips render green/amber with hydrated names. One-shot batch-hydrate on editor mount resolves names for existing DB-seeded entries; dead refs render muted with line-through. Variable picker intentionally deferred (filed as FU-NEW above). 4 new endpoints (2 search, 2 batch-hydrate); ~20 unit checks across 3 test files.
```

- [ ] **Step 4: No commit needed (memory file lives outside the project repo)**

The `followups.md` file lives in the user's auto-memory directory, not in the project repo. Save the file via the Edit tool; no `git add` or `git commit` is needed.

---

## Self-Review

After writing all 9 tasks, the following spec coverage check passed:

| Spec Goal | Covered by |
|---|---|
| `GET /api/tenant/contacts/search?q=` | Task 1 |
| `GET /api/tenant/groups/search?q=` | Task 2 |
| `GET /api/tenant/contacts?ids=` batch hydrate | Task 3 |
| `GET /api/tenant/groups?ids=` batch hydrate | Task 4 |
| Tab bar in `{{}}` dropdown | Task 5 |
| Contact + Group search panels | Task 6 |
| `addContactRecipient` + `addContactGroupRecipient` helpers | Task 6 |
| Chip color variants (green/contact, amber/group) | Task 7 |
| One-shot batch hydration on mount | Task 7 |
| Dead-ref handling (Loading… / Deleted) | Task 7 |
| Search endpoint tests | Tasks 1, 2 |
| Batch-hydrate endpoint tests | Tasks 3, 4 |
| dd-qa pass | Task 8 |
| Manual E2E smoke | Task 8 |
| FU filing for variable picker | Task 9 |
| Memory update | Task 9 |

Placeholder check: no TBDs / TODOs / "implement appropriately" in any code block. Every step has either complete code or an explicit follow-up note (e.g., the variable-name shadowing concern in Task 7, which the engineer is told to verify against the actual parent component).

Type consistency: `addContactRecipient(kind, contactId, displayHints)` and `addContactGroupRecipient(kind, groupId, displayHints)` match across Tasks 6, 7. `hydratedNames.contact[id] : string|null|undefined` and `hydratedNames.group[id] : {name, member_count}|null|undefined` shapes match across Tasks 7's hydration effect, chip rendering, and add-handlers.
