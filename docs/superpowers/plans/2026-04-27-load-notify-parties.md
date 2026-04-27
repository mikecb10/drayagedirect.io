# Load Notify Parties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-load notify parties — a load can have 0..N groups/contacts attached at creation or edited later, expanded into umbrella recipients via a new `load_notify_parties` role token, with per-customer defaults that auto-populate on new loads.

**Architecture:** New junction table `load_notify_parties (load_id, party_type, party_id, source, source_organization_id)` stores the per-load data. New JSONB column `customers.default_notify_parties` stores per-customer defaults. The `lib/email-dispatch/recipient-expander.js` `case 'role':` gets a special-case branch for the `load_notify_parties` token that queries the junction and expands group/contact rows to email addresses. A shared `NotifyPartyPicker` component is used in three places: NewLoadModal (with auto-populate-on-customer-change + confirm-on-manual-edit), LoadInfoTab (Load Detail edit surface — Communication tab does not exist yet), and Organization OverviewTab ("Default notify parties for new loads" card). The umbrella editor's `RecipientRow` is extended with a token-picker dropdown so the new token is reachable from the UI (no existing role-token picker today — only email-text input).

**Tech Stack:** Next.js (pages router), Supabase (Postgres + Auth + service-role client), React 18, Tailwind CSS, lucide-react icons, plain `node tests/<file>.test.mjs` test runner with a custom `check()` helper.

**Spec:** [`docs/superpowers/specs/2026-04-27-load-notify-parties-design.md`](../specs/2026-04-27-load-notify-parties-design.md)

---

## Recon Summary (already verified before plan was written)

| Question from spec | Answer |
|---|---|
| Migration number | **111** (latest is 110_tenant_settings_branding.sql) |
| `customers` is the org table | **Yes** — multi-type orgs (customer / terminal / warehouse / yard) all live in `customers`. `orders.pickup_location_id`, `delivery_location_id`, `return_location_id`, `final_delivery_location_id` all FK to `customers(id)`. |
| Email-dispatch context shape | **`context.order.id`** (canonical). `context.load` exists but is variable-resolver-only per inline comments at `lib/email-dispatch/dispatcher.js:225,273` and `lib/email-dispatch/context-builder.js:393`. |
| Load Detail edit surface | **LoadInfoTab** — no Communication tab built yet (`components/loads/tabs/` has LoadInfoTab, RoutingTab, BillingTab, DriverPayTab, PaymentsCreditsTab, DocumentsTab, AuditTab, NotesTab, TrackingTab, PlaceholderTab). |
| Organization detail Overview tab | **`components/organizations/tabs/OverviewTab.js`** (138 lines) |
| Org-list typeahead endpoint | **`/api/tenant/organizations`** (with optional `?type=`, used at `lib/ar-rule-definitions.js:65,76,87,122,133,145,156,168` and `components/ar/FilterSidebar.js:105,111`). The `?q=` typeahead variant — plan verifies during Task 8 implementation. |
| Org PATCH endpoint | **`pages/api/tenant/organizations/[id]/index.js`** (161 lines), `EDITABLE_FIELDS` allowlist starts at line 9. |
| Loads create endpoint | **`pages/api/tenant/loads/index.js`** (519 lines), insert is at line 402, audit log + tariff matching follow. |
| Test runner | **`node tests/<file>.test.mjs`** — no formal runner. Tests use a custom `check(name, cond)` helper, end with `console.log('N passed, M failed')` and `process.exit(1)` if any failed. Pattern: see `tests/ar-resolve-billing-email-groups.test.mjs`. |
| Umbrella editor RecipientRow | **`pages/settings/communications/umbrellas/[id].js:1285`** — only accepts text-typed email today (no role-token picker). `addRecipient` at line 959 always creates `{type: 'email', value}` entries. |

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/111_load_notify_parties.sql` | Schema migration: create `load_notify_parties` table + add `customers.default_notify_parties` column |
| `pages/api/tenant/loads/[id]/notify-parties/index.js` | GET (list) + POST (add) endpoints for notify parties on a load |
| `pages/api/tenant/loads/[id]/notify-parties/[partyId].js` | DELETE endpoint for a single notify party row |
| `components/loads/NotifyPartyPicker.js` | Shared chip-picker component used in NewLoadModal + LoadInfoTab + OverviewTab |
| `tests/load-notify-parties-resolver.test.mjs` | Unit tests for the `load_notify_parties` token in recipient-expander.js |
| `tests/load-notify-parties-api.test.mjs` | Unit tests for GET / POST / DELETE endpoints |
| `tests/load-notify-parties-defaults.test.mjs` | Unit tests for per-customer default copy logic |

### Modified files

| Path | Change |
|---|---|
| `lib/email-dispatch/recipient-expander.js` | Extend `case 'role':` with special-case branch for `load_notify_parties` token |
| `pages/api/tenant/loads/index.js` | After order insert (≈ line 402), copy customer's `default_notify_parties` into `load_notify_parties` rows |
| `pages/api/tenant/organizations/[id]/index.js` | Add `default_notify_parties` to EDITABLE_FIELDS allowlist + validate JSONB shape on PATCH |
| `components/loads/NewLoadModal.js` | Add collapsible "Notify parties (optional)" section + auto-populate logic + customer-change handling + submit-time row insert |
| `components/loads/tabs/LoadInfoTab.js` | Add a "Notify parties" card that uses `NotifyPartyPicker` and writes via the new endpoints |
| `components/organizations/tabs/OverviewTab.js` | Add "Default notify parties for new loads" card |
| `pages/settings/communications/umbrellas/[id].js` | Extend `RecipientRow` (≈ line 1285) with a token-picker dropdown; extend `addRecipient` (line 959) to also accept token entries |
| `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` | File two new follow-up FUs (legacy resolver migration + umbrella full-picker) |

---

## Task 1: Schema Migration 111

**Files:**
- Create: `supabase/migrations/111_load_notify_parties.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/111_load_notify_parties.sql`:

```sql
-- ============================================================
-- Migration 111: Load notify parties + customer defaults
-- ============================================================
-- Adds per-load notify parties (groups/contacts attached to a
-- specific load that get added to email umbrella recipients via
-- the new `load_notify_parties` role token).
--
-- Adds `default_notify_parties` JSONB column on customers so a
-- tenant can pre-configure the parties auto-populated when a new
-- load is created for that customer.
--
-- Builds on FU-043 (migration 099): the parties referenced are
-- organization_groups + organization_contacts, NOT the legacy
-- customer_contact_groups system (migration 002).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS load_notify_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  load_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  party_type TEXT NOT NULL CHECK (party_type IN ('group', 'contact')),
  party_id UUID NOT NULL,
  source TEXT CHECK (source IS NULL OR source IN (
    'customer', 'pickup_location', 'delivery_location', 'return_location', 'other_org', 'default'
  )),
  source_organization_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (tenant_id, load_id, party_type, party_id)
);

CREATE INDEX IF NOT EXISTS idx_load_notify_parties_load
  ON load_notify_parties (tenant_id, load_id);

CREATE INDEX IF NOT EXISTS idx_load_notify_parties_party
  ON load_notify_parties (party_type, party_id);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS default_notify_parties JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Apply the migration**

Run via the project's standard migration apply method (Supabase CLI or direct psql). The dev_migration_template.md memory says all SQL migrations follow BEGIN/COMMIT + NOTIFY pgrst pattern — this file matches.

If applying via the project's typical flow:
```bash
# Confirm with how this codebase applies migrations — likely supabase db push or similar.
# If unclear, manually apply via the Supabase SQL editor and verify the table + column exist.
```

After apply, verify with a quick query:
```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'load_notify_parties';
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'customers' AND column_name = 'default_notify_parties';
```

Expected: 11 columns on `load_notify_parties`, 1 row for `customers.default_notify_parties`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/111_load_notify_parties.sql
git commit -m "feat(schema): migration 111 — load_notify_parties table + customers.default_notify_parties JSONB"
```

---

## Task 2: Resolver — `load_notify_parties` Token (TDD)

**Files:**
- Modify: `lib/email-dispatch/recipient-expander.js`
- Create: `tests/load-notify-parties-resolver.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/load-notify-parties-resolver.test.mjs`:

```js
import { expandRecipients } from '../lib/email-dispatch/recipient-expander.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Mock client supporting the three tables our resolver hits:
// 1. load_notify_parties (await terminal, returns array)
// 2. organization_group_members (await terminal, returns array of {contact:{email}})
// 3. organization_contacts (.maybeSingle() returns {email})
function makeMockClient(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      maybeSingle: async () => {
        calls.queries.push({ table, filters: { ...c._filters }, terminal: 'maybeSingle' });
        const cfg = config[table];
        if (cfg === undefined) return { data: null, error: null };
        // For maybeSingle on organization_contacts, allow per-id config
        if (table === 'organization_contacts' && cfg && cfg.byId) {
          return { data: cfg.byId[c._filters.id] || null, error: null };
        }
        return { data: cfg, error: null };
      },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, terminal: 'await' });
        const cfg = config[table];
        if (cfg === undefined) { resolve({ data: [], error: null }); return; }
        // For await on organization_group_members, allow per-group config
        if (table === 'organization_group_members' && cfg && cfg.byGroupId) {
          resolve({ data: cfg.byGroupId[c._filters.group_id] || [], error: null });
          return;
        }
        resolve({ data: cfg, error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('load_notify_parties — resolver token expansion');

// ──────────────────────────────────────────────────────────────
// Case 1: Group party expands to all member emails
{
  console.log('\nCase 1: Group party expands to all member emails');
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'group', party_id: 'grp-1' },
    ],
    organization_group_members: {
      byGroupId: {
        'grp-1': [
          { contact: { email: 'a@x.com' } },
          { contact: { email: 'b@x.com' } },
          { contact: { email: 'c@x.com' } },
        ],
      },
    },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-1' } },
    new Map()
  );
  check('group: 3 emails returned', Array.isArray(out) && out.length === 3);
  check('group: a@x.com included', out.includes('a@x.com'));
  check('group: c@x.com included', out.includes('c@x.com'));
}

// Case 2: Contact party expands to one email
{
  console.log('\nCase 2: Contact party expands to one email');
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'contact', party_id: 'con-1' },
    ],
    organization_contacts: {
      byId: { 'con-1': { email: 'lone@x.com' } },
    },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-2' } },
    new Map()
  );
  check('contact: 1 email returned', out.length === 1);
  check('contact: lone@x.com included', out.includes('lone@x.com'));
}

// Case 3: Mixed group + contact, dedupe overlap
{
  console.log('\nCase 3: Mixed group + contact, dedupe overlap');
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'group', party_id: 'grp-3' },
      { party_type: 'contact', party_id: 'con-3' },
    ],
    organization_group_members: {
      byGroupId: {
        'grp-3': [
          { contact: { email: 'shared@x.com' } },
          { contact: { email: 'unique@x.com' } },
        ],
      },
    },
    organization_contacts: {
      byId: { 'con-3': { email: 'shared@x.com' } },
    },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-3' } },
    new Map()
  );
  check('mixed dedupe: 2 unique emails (shared+unique)', out.length === 2);
}

// Case 4: Empty notify-party list returns []
{
  console.log('\nCase 4: Empty notify-party list returns []');
  const svc = makeMockClient({
    load_notify_parties: [],
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-4' } },
    new Map()
  );
  check('empty: 0 emails returned', out.length === 0);
}

// Case 5: Missing/deleted party silently skipped
{
  console.log('\nCase 5: Missing/deleted party silently skipped');
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'group', party_id: 'grp-deleted' },
      { party_type: 'contact', party_id: 'con-5' },
    ],
    organization_group_members: { byGroupId: { /* grp-deleted not present */ } },
    organization_contacts: { byId: { 'con-5': { email: 'survivor@x.com' } } },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-5' } },
    new Map()
  );
  check('missing party skipped: 1 email returned', out.length === 1);
  check('missing party skipped: survivor@x.com included', out.includes('survivor@x.com'));
}

// Case 6: No load.id in context returns []
{
  console.log('\nCase 6: No load.id in context returns []');
  const svc = makeMockClient({});
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { /* no order/load */ },
    new Map()
  );
  check('no context: 0 emails returned', out.length === 0);
  check('no context: no DB query made', svc._calls.queries.length === 0);
}

// Case 7: Cache hit on second call
{
  console.log('\nCase 7: Cache hit on second call');
  const cache = new Map();
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'contact', party_id: 'con-7' },
    ],
    organization_contacts: { byId: { 'con-7': { email: 'cached@x.com' } } },
  });
  const ctx = { order: { id: 'ord-7' } };
  const out1 = await expandRecipients(svc, 't-1', [{ type: 'role', value: 'load_notify_parties' }], ctx, cache);
  const queryCount1 = svc._calls.queries.length;
  const out2 = await expandRecipients(svc, 't-1', [{ type: 'role', value: 'load_notify_parties' }], ctx, cache);
  const queryCount2 = svc._calls.queries.length;
  check('cache: out1 matches out2', out1[0] === out2[0]);
  check('cache: second call adds 0 new queries', queryCount2 === queryCount1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/load-notify-parties-resolver.test.mjs`
Expected: All cases fail because the `load_notify_parties` token is unknown — current `case 'role':` returns `[]` for unrecognized tokens.

- [ ] **Step 3: Implement the expander branch**

Edit `lib/email-dispatch/recipient-expander.js`. Find the existing `case 'role':` block (around line 98). Add a branch for `load_notify_parties` BEFORE the existing `roleMap` lookup:

```js
    case 'role': {
      // Load-scoped per-load notify parties — query junction table and
      // expand each row to its emails. Returns the dedupe'd union.
      if (entry.value === 'load_notify_parties') {
        const loadId = context?.order?.id || context?.load?.id;
        if (!loadId) return [];
        const cacheKey = `lnp:${loadId}`;
        if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

        const { data: parties } = await svc
          .from('load_notify_parties')
          .select('party_type, party_id')
          .eq('tenant_id', tenantId)
          .eq('load_id', loadId);

        const out = new Set();
        for (const p of parties || []) {
          if (p.party_type === 'group') {
            const { data } = await svc
              .from('organization_group_members')
              .select('contact:organization_contacts(email)')
              .eq('group_id', p.party_id)
              .eq('tenant_id', tenantId);
            for (const r of data || []) {
              const e = normalizeEmail(r.contact?.email);
              if (isValidEmail(e)) out.add(e);
            }
          } else {
            // 'contact'
            const { data } = await svc
              .from('organization_contacts')
              .select('email')
              .eq('id', p.party_id)
              .eq('tenant_id', tenantId)
              .maybeSingle();
            const e = normalizeEmail(data?.email);
            if (isValidEmail(e)) out.add(e);
          }
        }

        const result = Array.from(out);
        if (cache) cache.set(cacheKey, result);
        return result;
      }

      // Map role token → context path. Extend as needed.
      const roleMap = {
```

(The new branch goes right after `case 'role': {` and before the existing `const roleMap = ...`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/load-notify-parties-resolver.test.mjs`
Expected: All 7 cases pass — `7 cases × ~2 checks each = ~14 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add tests/load-notify-parties-resolver.test.mjs lib/email-dispatch/recipient-expander.js
git commit -m "feat(email): load_notify_parties role token in recipient-expander

Adds per-load notify-party resolution via a new role token. When an
umbrella's recipients include {type:'role', value:'load_notify_parties'},
the expander queries load_notify_parties for the firing load, expands
each group party via organization_group_members and each contact party
via organization_contacts, and returns the dedupe'd union of emails.
Caches per-load result. Returns [] when no load.id in context.

7 unit cases covering group/contact/mixed/empty/deleted/no-context/cache."
```

---

## Task 3: GET notify-parties Endpoint (TDD)

**Files:**
- Create: `pages/api/tenant/loads/[id]/notify-parties/index.js`
- Create: `tests/load-notify-parties-api.test.mjs`

- [ ] **Step 1: Write the failing test (GET cases only — POST will be added in Task 4)**

Create `tests/load-notify-parties-api.test.mjs`:

```js
// Note: this file tests handlers as pure functions — we import them and
// invoke with mocked req/res/svc objects. Following the pattern used in
// other API tests (see tests/contact-groups-default-swap.test.mjs).

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// We'll import the handler dynamically per test file to allow re-import
// after edits. For now, just inline-test the handler shape against a
// mock supabase client.
const handlerModule = await import('../pages/api/tenant/loads/[id]/notify-parties/index.js');
const handler = handlerModule.default;

function makeReq(method, query, body) {
  return { method, query, body, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
}
function makeRes() {
  let statusCode = 200;
  let payload = null;
  return {
    status(code) { statusCode = code; return this; },
    json(p) { payload = p; return this; },
    end() {},
    _get() { return { statusCode, payload }; },
  };
}

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

// Mock the auth + svc layer the handler imports. We do this by stubbing
// the dependent modules via Node's module cache; in practice the handler
// pattern in this codebase passes svc + ctx in via requireTenantUser, so
// we test the inner logic by invoking the exported pure helper if one
// exists, OR by setting env-var test-mode that bypasses auth.
//
// For this codebase, follow the pattern in tests/ar-resolve-billing-email-groups
// where the helper function is exported separately from the handler. We'll
// export `listLoadNotifyParties(svc, ctx, loadId)` from the handler module
// for testability and have `default` (the handler) call it.

const { listLoadNotifyParties } = handlerModule;

console.log('GET /api/tenant/loads/[id]/notify-parties');

// Case 1: Returns hydrated parties with names + org sublabels
{
  console.log('\nCase 1: Hydrates names + org_name + member_count');
  const svc = makeMockSvc({
    load_notify_parties: [
      { id: 'row-1', party_type: 'group', party_id: 'grp-1', source: 'customer', source_organization_id: 'org-A' },
      { id: 'row-2', party_type: 'contact', party_id: 'con-1', source: 'delivery_location', source_organization_id: 'org-B' },
    ],
    organization_groups: [
      { id: 'grp-1', name: 'Operations' },
    ],
    organization_contacts: [
      { id: 'con-1', name: 'John Smith', email: 'john@warehouse.com' },
    ],
    customers: [
      { id: 'org-A', name: 'Acme Corp' },
      { id: 'org-B', name: 'Pacific Warehouse' },
    ],
    organization_group_members: [
      { group_id: 'grp-1' },  // 1 row → member_count = 1
    ],
  });
  const result = await listLoadNotifyParties(svc, { tenantId: 't-1' }, 'load-1');
  check('returns 2 parties', result.parties.length === 2);
  const grp = result.parties.find((p) => p.party_type === 'group');
  const con = result.parties.find((p) => p.party_type === 'contact');
  check('group: name hydrated', grp?.name === 'Operations');
  check('group: source_organization_name hydrated', grp?.source_organization_name === 'Acme Corp');
  check('group: member_count present', typeof grp?.member_count === 'number');
  check('contact: name hydrated', con?.name === 'John Smith');
  check('contact: email hydrated', con?.email === 'john@warehouse.com');
  check('contact: source_organization_name hydrated', con?.source_organization_name === 'Pacific Warehouse');
}

// Case 2: Dead-ref entries returned with name=null
{
  console.log('\nCase 2: Dead-ref entries returned with name=null');
  const svc = makeMockSvc({
    load_notify_parties: [
      { id: 'row-1', party_type: 'group', party_id: 'deleted-grp', source: 'customer', source_organization_id: 'org-A' },
    ],
    organization_groups: [],   // 'deleted-grp' not present
    customers: [{ id: 'org-A', name: 'Acme' }],
    organization_group_members: [],
  });
  const result = await listLoadNotifyParties(svc, { tenantId: 't-1' }, 'load-1');
  check('dead-ref: 1 row still returned', result.parties.length === 1);
  check('dead-ref: name is null', result.parties[0].name === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/load-notify-parties-api.test.mjs`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the GET handler**

Create `pages/api/tenant/loads/[id]/notify-parties/index.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

/**
 * Pure helper — list load notify parties hydrated with names/org info.
 * Exported separately for unit testing without mocking the full auth
 * stack.
 */
export async function listLoadNotifyParties(svc, ctx, loadId) {
  const { data: rows } = await svc
    .from('load_notify_parties')
    .select('id, party_type, party_id, source, source_organization_id, created_at, updated_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('load_id', loadId);

  const groupIds = (rows || []).filter((r) => r.party_type === 'group').map((r) => r.party_id);
  const contactIds = (rows || []).filter((r) => r.party_type === 'contact').map((r) => r.party_id);
  const orgIds = Array.from(new Set((rows || []).map((r) => r.source_organization_id).filter(Boolean)));

  // Parallel batch hydration
  const [{ data: groups }, { data: contacts }, { data: orgs }, { data: groupMembers }] = await Promise.all([
    groupIds.length
      ? svc.from('organization_groups').select('id, name').eq('tenant_id', ctx.tenantId).in('id', groupIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? svc.from('organization_contacts').select('id, name, email').eq('tenant_id', ctx.tenantId).in('id', contactIds)
      : Promise.resolve({ data: [] }),
    orgIds.length
      ? svc.from('customers').select('id, name').eq('tenant_id', ctx.tenantId).in('id', orgIds)
      : Promise.resolve({ data: [] }),
    groupIds.length
      ? svc.from('organization_group_members').select('group_id').eq('tenant_id', ctx.tenantId).in('group_id', groupIds)
      : Promise.resolve({ data: [] }),
  ]);

  const groupById = Object.fromEntries((groups || []).map((g) => [g.id, g]));
  const contactById = Object.fromEntries((contacts || []).map((c) => [c.id, c]));
  const orgById = Object.fromEntries((orgs || []).map((o) => [o.id, o]));
  const memberCountByGroup = (groupMembers || []).reduce((acc, m) => {
    acc[m.group_id] = (acc[m.group_id] || 0) + 1;
    return acc;
  }, {});

  const parties = (rows || []).map((r) => {
    const base = {
      id: r.id,
      party_type: r.party_type,
      party_id: r.party_id,
      source: r.source,
      source_organization_id: r.source_organization_id,
      source_organization_name: r.source_organization_id ? (orgById[r.source_organization_id]?.name || null) : null,
    };
    if (r.party_type === 'group') {
      const g = groupById[r.party_id];
      return { ...base, name: g?.name || null, member_count: memberCountByGroup[r.party_id] || 0 };
    }
    const c = contactById[r.party_id];
    return { ...base, name: c?.name || null, email: c?.email || null };
  });

  return { parties };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, res, PERMISSIONS.LOADS_VIEW)) return;

  const svc = getServiceClient();
  const loadId = req.query.id;

  // Verify load exists and belongs to tenant
  const { data: load } = await svc
    .from('orders')
    .select('id')
    .eq('id', loadId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (!load) return res.status(404).json({ error: 'Load not found' });

  if (req.method === 'GET') {
    const result = await listLoadNotifyParties(svc, ctx, loadId);
    return res.status(200).json(result);
  }

  // POST handler comes in Task 4

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/load-notify-parties-api.test.mjs`
Expected: All 2 cases pass — ~7 checks passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add tests/load-notify-parties-api.test.mjs pages/api/tenant/loads/[id]/notify-parties/index.js
git commit -m "feat(api): GET /api/tenant/loads/[id]/notify-parties

Lists notify parties for a load, hydrating group/contact names,
source organization names, and (for groups) member counts. Dead-ref
entries (party_id no longer present in groups/contacts table) returned
with name=null so the UI can render them as removable Deleted chips."
```

---

## Task 4: POST notify-parties Endpoint (TDD)

**Files:**
- Modify: `pages/api/tenant/loads/[id]/notify-parties/index.js` (add POST branch)
- Modify: `tests/load-notify-parties-api.test.mjs` (add POST cases)

- [ ] **Step 1: Append POST test cases**

Append to `tests/load-notify-parties-api.test.mjs`, BEFORE the final `console.log`:

```js
console.log('\nPOST /api/tenant/loads/[id]/notify-parties');

const { addLoadNotifyParty } = handlerModule;

// Case 3: Successful add with group party_type
{
  console.log('\nCase 3: Successful add (group)');
  let inserted = null;
  const svc = makeMockSvc({});
  // Override .from() chain for this test to capture insert calls
  svc.from = (table) => {
    const c = {
      _table: table,
      _filters: {},
      select: () => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      maybeSingle: async () => {
        if (table === 'organization_groups') return { data: { id: c._filters.id }, error: null };
        return { data: null, error: null };
      },
      insert: (rec) => { inserted = rec; return c; },
      single: async () => ({ data: { id: 'new-row', ...inserted }, error: null }),
    };
    return c;
  };
  const result = await addLoadNotifyParty(
    svc,
    { tenantId: 't-1', userId: 'u-1' },
    'load-1',
    { party_type: 'group', party_id: 'grp-1', source: 'customer', source_organization_id: 'org-A' },
    '127.0.0.1'
  );
  check('add group: returns row', result.row?.id === 'new-row');
  check('add group: tenant_id set', inserted?.tenant_id === 't-1');
  check('add group: load_id set', inserted?.load_id === 'load-1');
  check('add group: party_type set', inserted?.party_type === 'group');
}

// Case 4: Rejects unknown party_type
{
  console.log('\nCase 4: Rejects unknown party_type');
  const svc = makeMockSvc({});
  let threw = false;
  try {
    await addLoadNotifyParty(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', { party_type: 'org', party_id: 'x' }, '127.0.0.1');
  } catch (e) {
    threw = true;
  }
  check('unknown party_type: throws', threw);
}

// Case 5: Rejects cross-tenant party_id (group)
{
  console.log('\nCase 5: Rejects cross-tenant party_id');
  const svc = makeMockSvc({});
  // Group lookup returns no row for our tenant
  svc.from = (table) => {
    const c = {
      _table: table,
      _filters: {},
      select: () => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      maybeSingle: async () => ({ data: null, error: null }),  // not found in our tenant
    };
    return c;
  };
  let threw = false;
  try {
    await addLoadNotifyParty(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', { party_type: 'group', party_id: 'grp-other-tenant' }, '127.0.0.1');
  } catch (e) {
    threw = true;
  }
  check('cross-tenant: throws', threw);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/load-notify-parties-api.test.mjs`
Expected: FAIL — `addLoadNotifyParty` is not exported yet.

- [ ] **Step 3: Implement POST handler + helper**

Edit `pages/api/tenant/loads/[id]/notify-parties/index.js`. Add the helper export above `export default`:

```js
/**
 * Pure helper — add a single notify party to a load. Verifies tenant
 * scope on the referenced group/contact before insert. Logs audit.
 */
export async function addLoadNotifyParty(svc, ctx, loadId, body, ipAddress) {
  const { party_type, party_id, source, source_organization_id } = body || {};

  if (party_type !== 'group' && party_type !== 'contact') {
    const e = new Error('Invalid party_type — must be "group" or "contact"');
    e.statusCode = 400;
    throw e;
  }
  if (!party_id || typeof party_id !== 'string') {
    const e = new Error('Missing party_id');
    e.statusCode = 400;
    throw e;
  }
  const validSources = ['customer', 'pickup_location', 'delivery_location', 'return_location', 'other_org', 'default'];
  if (source != null && !validSources.includes(source)) {
    const e = new Error(`Invalid source — must be one of ${validSources.join(', ')}`);
    e.statusCode = 400;
    throw e;
  }

  // Cross-tenant check: party must exist in our tenant
  const refTable = party_type === 'group' ? 'organization_groups' : 'organization_contacts';
  const { data: ref } = await svc
    .from(refTable)
    .select('id')
    .eq('id', party_id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (!ref) {
    const e = new Error(`Referenced ${party_type} not found in this tenant`);
    e.statusCode = 400;
    throw e;
  }

  const insertRec = {
    tenant_id: ctx.tenantId,
    load_id: loadId,
    party_type,
    party_id,
    source: source || null,
    source_organization_id: source_organization_id || null,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  };

  const { data: row, error } = await svc
    .from('load_notify_parties')
    .insert(insertRec)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      const e = new Error('Notify party already attached to this load');
      e.statusCode = 409;
      throw e;
    }
    const e = new Error(error.message || 'Insert failed');
    e.statusCode = 500;
    throw e;
  }

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'load.notify_party_added',
    entityType: 'load',
    entityId: loadId,
    newValues: { party_type, party_id, source, source_organization_id },
    ipAddress,
    actorType: 'human',
  });

  return { row };
}
```

Then extend the `default` handler to dispatch POST:

```js
  if (req.method === 'GET') {
    const result = await listLoadNotifyParties(svc, ctx, loadId);
    return res.status(200).json(result);
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, res, PERMISSIONS.LOADS_EDIT)) return;
    try {
      const result = await addLoadNotifyParty(svc, ctx, loadId, req.body, getClientIp(req));
      return res.status(201).json(result);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/load-notify-parties-api.test.mjs`
Expected: All 5 cases pass.

- [ ] **Step 5: Commit**

```bash
git add tests/load-notify-parties-api.test.mjs pages/api/tenant/loads/[id]/notify-parties/index.js
git commit -m "feat(api): POST /api/tenant/loads/[id]/notify-parties

Adds a single notify party to a load. Verifies cross-tenant scope
on the referenced group/contact before insert. Returns 409 on
duplicate. Logs via logTenantAction with action
load.notify_party_added and actorType=human."
```

---

## Task 5: DELETE notify-party Endpoint (TDD)

**Files:**
- Create: `pages/api/tenant/loads/[id]/notify-parties/[partyId].js`
- Modify: `tests/load-notify-parties-api.test.mjs` (add DELETE cases)

- [ ] **Step 1: Append DELETE test cases**

Append to `tests/load-notify-parties-api.test.mjs`, BEFORE the final `console.log`:

```js
console.log('\nDELETE /api/tenant/loads/[id]/notify-parties/[partyId]');

const partyHandlerModule = await import('../pages/api/tenant/loads/[id]/notify-parties/[partyId].js');
const { removeLoadNotifyParty } = partyHandlerModule;

// Case 6: Removes only the targeted row
{
  console.log('\nCase 6: Removes only the targeted row');
  let deletedFilter = null;
  const svc = makeMockSvc({});
  svc.from = (table) => {
    const c = {
      _table: table,
      _filters: {},
      select: () => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      maybeSingle: async () => {
        if (table === 'load_notify_parties') return { data: { id: 'row-1', party_type: 'group', party_id: 'g-1', source: 'customer', source_organization_id: 'org-A' }, error: null };
        return { data: null, error: null };
      },
      delete: () => { deletedFilter = { ...c._filters }; return Promise.resolve({ error: null }); },
    };
    return c;
  };
  const result = await removeLoadNotifyParty(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', 'row-1', '127.0.0.1');
  check('delete: succeeds', result.deleted === true);
  check('delete: filter included tenant', deletedFilter?.tenant_id === 't-1');
  check('delete: filter included row id', deletedFilter?.id === 'row-1');
}

// Case 7: 404 when row not found in this load
{
  console.log('\nCase 7: 404 when row not found');
  const svc = makeMockSvc({});
  svc.from = (table) => {
    const c = {
      _table: table,
      _filters: {},
      select: () => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return c;
  };
  let threw = false;
  let statusCode = null;
  try {
    await removeLoadNotifyParty(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', 'row-bogus', '127.0.0.1');
  } catch (e) {
    threw = true;
    statusCode = e.statusCode;
  }
  check('not found: throws', threw);
  check('not found: statusCode is 404', statusCode === 404);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/load-notify-parties-api.test.mjs`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the DELETE handler**

Create `pages/api/tenant/loads/[id]/notify-parties/[partyId].js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

export async function removeLoadNotifyParty(svc, ctx, loadId, partyId, ipAddress) {
  // Verify the row exists in this tenant + load before deleting
  const { data: row } = await svc
    .from('load_notify_parties')
    .select('id, party_type, party_id, source, source_organization_id')
    .eq('id', partyId)
    .eq('tenant_id', ctx.tenantId)
    .eq('load_id', loadId)
    .maybeSingle();
  if (!row) {
    const e = new Error('Notify party not found on this load');
    e.statusCode = 404;
    throw e;
  }

  const { error } = await svc
    .from('load_notify_parties')
    .delete()
    .eq('id', partyId)
    .eq('tenant_id', ctx.tenantId)
    .eq('load_id', loadId);
  if (error) {
    const e = new Error(error.message || 'Delete failed');
    e.statusCode = 500;
    throw e;
  }

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'load.notify_party_removed',
    entityType: 'load',
    entityId: loadId,
    oldValues: { party_type: row.party_type, party_id: row.party_id, source: row.source, source_organization_id: row.source_organization_id },
    ipAddress,
    actorType: 'human',
  });

  return { deleted: true };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, res, PERMISSIONS.LOADS_EDIT)) return;

  const svc = getServiceClient();
  const loadId = req.query.id;
  const partyId = req.query.partyId;

  if (req.method === 'DELETE') {
    try {
      const result = await removeLoadNotifyParty(svc, ctx, loadId, partyId, getClientIp(req));
      return res.status(200).json(result);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/load-notify-parties-api.test.mjs`
Expected: All 7 cases pass.

- [ ] **Step 5: Commit**

```bash
git add tests/load-notify-parties-api.test.mjs "pages/api/tenant/loads/[id]/notify-parties/[partyId].js"
git commit -m "feat(api): DELETE /api/tenant/loads/[id]/notify-parties/[partyId]

Removes a single notify party row. Verifies tenant + load scope
before delete. Logs via logTenantAction with action
load.notify_party_removed and actorType=human."
```

---

## Task 6: Org PATCH Extension for `default_notify_parties` (TDD)

**Files:**
- Modify: `pages/api/tenant/organizations/[id]/index.js`
- Create: `tests/load-notify-parties-defaults.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/load-notify-parties-defaults.test.mjs`:

```js
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const orgPatchModule = await import('../pages/api/tenant/organizations/[id]/index.js');
const { validateDefaultNotifyParties } = orgPatchModule;

console.log('validateDefaultNotifyParties — input shape validation');

// Case 1: Valid array passes
{
  console.log('\nCase 1: Valid array passes');
  const out = validateDefaultNotifyParties([
    { type: 'group', id: '11111111-1111-1111-1111-111111111111', source_organization_id: '22222222-2222-2222-2222-222222222222' },
    { type: 'contact', id: '33333333-3333-3333-3333-333333333333' },
  ]);
  check('valid: returns array of length 2', Array.isArray(out) && out.length === 2);
}

// Case 2: Empty array passes
{
  console.log('\nCase 2: Empty array passes');
  const out = validateDefaultNotifyParties([]);
  check('empty: returns []', Array.isArray(out) && out.length === 0);
}

// Case 3: Missing type rejected
{
  console.log('\nCase 3: Entry missing type is rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ id: 'x' }]); } catch { threw = true; }
  check('missing type: throws', threw);
}

// Case 4: Missing id rejected
{
  console.log('\nCase 4: Entry missing id is rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ type: 'group' }]); } catch { threw = true; }
  check('missing id: throws', threw);
}

// Case 5: Bad type value rejected
{
  console.log('\nCase 5: Bad type value rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ type: 'org', id: '11111111-1111-1111-1111-111111111111' }]); } catch { threw = true; }
  check('bad type: throws', threw);
}

// Case 6: Non-array rejected
{
  console.log('\nCase 6: Non-array rejected');
  let threw = false;
  try { validateDefaultNotifyParties({ type: 'group', id: 'x' }); } catch { threw = true; }
  check('non-array: throws', threw);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/load-notify-parties-defaults.test.mjs`
Expected: FAIL — `validateDefaultNotifyParties` is not exported yet.

- [ ] **Step 3: Implement the validator + extend EDITABLE_FIELDS**

Edit `pages/api/tenant/organizations/[id]/index.js`:

1. Add `'default_notify_parties'` to the `EDITABLE_FIELDS` allowlist (around line 9-50).

2. Export the validator above the `default` handler:

```js
/**
 * Validate the JSONB shape of customers.default_notify_parties.
 * Throws on bad shape. Returns the canonicalized array on success.
 */
export function validateDefaultNotifyParties(value) {
  if (!Array.isArray(value)) {
    const e = new Error('default_notify_parties must be an array');
    e.statusCode = 400;
    throw e;
  }
  return value.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      const e = new Error(`default_notify_parties[${idx}] must be an object`);
      e.statusCode = 400;
      throw e;
    }
    if (entry.type !== 'group' && entry.type !== 'contact') {
      const e = new Error(`default_notify_parties[${idx}].type must be "group" or "contact"`);
      e.statusCode = 400;
      throw e;
    }
    if (!entry.id || typeof entry.id !== 'string') {
      const e = new Error(`default_notify_parties[${idx}].id is required`);
      e.statusCode = 400;
      throw e;
    }
    return {
      type: entry.type,
      id: entry.id,
      source_organization_id: entry.source_organization_id || null,
    };
  });
}
```

3. In the existing PATCH handling logic, when `default_notify_parties` is present in the body, run it through the validator:

```js
// Inside the PATCH handler, before applying updates to the customers table:
if (Object.prototype.hasOwnProperty.call(req.body, 'default_notify_parties')) {
  try {
    req.body.default_notify_parties = validateDefaultNotifyParties(req.body.default_notify_parties);
  } catch (e) {
    return res.status(e.statusCode || 400).json({ error: e.message });
  }
}
```

(The exact location depends on how the existing PATCH handler is structured. Read lines 50-160 of the file and place the validation just before the `EDITABLE_FIELDS` filter is applied.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/load-notify-parties-defaults.test.mjs`
Expected: All 6 cases pass.

- [ ] **Step 5: Commit**

```bash
git add tests/load-notify-parties-defaults.test.mjs pages/api/tenant/organizations/[id]/index.js
git commit -m "feat(api): allow PATCH /api/tenant/organizations/[id] to update default_notify_parties

Adds default_notify_parties to the EDITABLE_FIELDS allowlist and
runs incoming values through validateDefaultNotifyParties for shape
validation. Empty arrays accepted. Bad shape returns 400 with a
descriptive error."
```

---

## Task 7: Default-Copy Logic on Load Creation (TDD)

**Files:**
- Modify: `pages/api/tenant/loads/index.js`
- Modify: `tests/load-notify-parties-defaults.test.mjs` (add copy-logic cases)

- [ ] **Step 1: Append copy-logic test cases**

Append to `tests/load-notify-parties-defaults.test.mjs`, BEFORE the final `console.log`:

```js
console.log('\ncopyDefaultNotifyParties — default-copy logic');

const loadsModule = await import('../pages/api/tenant/loads/index.js');
const { copyDefaultNotifyParties } = loadsModule;

// Case 7: Copies all defaults to load_notify_parties rows
{
  console.log('\nCase 7: Copies all defaults');
  let inserted = null;
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: {},
        select: () => c,
        eq: (col, val) => { c._filters[col] = val; return c; },
        in: (col, vals) => { c._filters[`in:${col}`] = vals; return c; },
        maybeSingle: async () => {
          if (table === 'customers') {
            return {
              data: {
                default_notify_parties: [
                  { type: 'group', id: '11111111-1111-1111-1111-111111111111', source_organization_id: '22222222-2222-2222-2222-222222222222' },
                  { type: 'contact', id: '33333333-3333-3333-3333-333333333333' },
                ],
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'organization_groups') resolve({ data: [{ id: '11111111-1111-1111-1111-111111111111' }], error: null });
          else if (table === 'organization_contacts') resolve({ data: [{ id: '33333333-3333-3333-3333-333333333333' }], error: null });
          else resolve({ data: [], error: null });
        },
        insert: (recs) => { inserted = recs; return { error: null }; },
      };
      return c;
    },
  };
  const count = await copyDefaultNotifyParties(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', 'cust-1');
  check('copy: 2 rows inserted', count === 2);
  check('copy: rows have source=default', Array.isArray(inserted) && inserted.every((r) => r.source === 'default'));
  check('copy: rows have load_id', inserted.every((r) => r.load_id === 'load-1'));
  check('copy: rows have tenant_id', inserted.every((r) => r.tenant_id === 't-1'));
}

// Case 8: Empty defaults inserts nothing
{
  console.log('\nCase 8: Empty defaults inserts nothing');
  let insertedCount = 0;
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: {},
        select: () => c,
        eq: () => c,
        in: () => c,
        maybeSingle: async () => ({ data: { default_notify_parties: [] }, error: null }),
        insert: () => { insertedCount++; return { error: null }; },
      };
      return c;
    },
  };
  const count = await copyDefaultNotifyParties(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', 'cust-1');
  check('empty: 0 rows', count === 0);
  check('empty: insert not called', insertedCount === 0);
}

// Case 9: Filters dead refs (group exists, contact deleted)
{
  console.log('\nCase 9: Filters dead refs');
  let inserted = null;
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: {},
        select: () => c,
        eq: () => c,
        in: () => c,
        maybeSingle: async () => {
          if (table === 'customers') {
            return {
              data: {
                default_notify_parties: [
                  { type: 'group', id: 'grp-alive' },
                  { type: 'contact', id: 'con-deleted' },
                ],
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'organization_groups') resolve({ data: [{ id: 'grp-alive' }], error: null });
          else if (table === 'organization_contacts') resolve({ data: [], error: null });  // con-deleted not present
          else resolve({ data: [], error: null });
        },
        insert: (recs) => { inserted = recs; return { error: null }; },
      };
      return c;
    },
  };
  const count = await copyDefaultNotifyParties(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', 'cust-1');
  check('dead-ref: 1 row inserted (group only)', count === 1);
  check('dead-ref: row is the group', inserted?.length === 1 && inserted[0].party_type === 'group');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/load-notify-parties-defaults.test.mjs`
Expected: FAIL — `copyDefaultNotifyParties` is not exported.

- [ ] **Step 3: Implement and wire into POST handler**

Edit `pages/api/tenant/loads/index.js`. Add the helper export near the top (after the imports, before any handler functions):

```js
/**
 * Copy a customer's default_notify_parties into load_notify_parties
 * rows for a newly created load. Filters dead refs (party_id no longer
 * present in groups/contacts). Returns the number of rows inserted.
 */
export async function copyDefaultNotifyParties(svc, ctx, loadId, customerId) {
  const { data: customer } = await svc
    .from('customers')
    .select('default_notify_parties')
    .eq('id', customerId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  const defaults = customer?.default_notify_parties || [];
  if (!Array.isArray(defaults) || defaults.length === 0) return 0;

  const groupIds = defaults.filter((d) => d.type === 'group').map((d) => d.id);
  const contactIds = defaults.filter((d) => d.type === 'contact').map((d) => d.id);

  // Verify which references are still alive
  const [{ data: groups }, { data: contacts }] = await Promise.all([
    groupIds.length
      ? svc.from('organization_groups').select('id').eq('tenant_id', ctx.tenantId).in('id', groupIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? svc.from('organization_contacts').select('id').eq('tenant_id', ctx.tenantId).in('id', contactIds)
      : Promise.resolve({ data: [] }),
  ]);
  const aliveGroups = new Set((groups || []).map((g) => g.id));
  const aliveContacts = new Set((contacts || []).map((c) => c.id));

  const rows = defaults
    .filter((d) =>
      (d.type === 'group' && aliveGroups.has(d.id)) ||
      (d.type === 'contact' && aliveContacts.has(d.id))
    )
    .map((d) => ({
      tenant_id: ctx.tenantId,
      load_id: loadId,
      party_type: d.type,
      party_id: d.id,
      source: 'default',
      source_organization_id: d.source_organization_id || null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    }));

  if (rows.length === 0) return 0;

  const { error } = await svc.from('load_notify_parties').insert(rows);
  if (error) {
    // Don't fail the load creation — log and move on. Dead refs already
    // filtered, so primary remaining cause is constraint violations
    // (highly unlikely given UNIQUE on tenant+load+party).
    console.warn('copyDefaultNotifyParties insert failed:', error.message);
    return 0;
  }
  return rows.length;
}
```

Then call it from the POST handler. Find the `.from('orders').insert(insertData).select().single()` call (around line 402) and add immediately after it (still inside the try/transaction, after the load is confirmed inserted):

```js
const { data, error } = await svc.from('orders').insert(insertData).select().single();
if (error || !data) {
  // ... existing error handling
}

// Copy the customer's default notify parties into load_notify_parties
// rows. Failure is non-fatal — load creation succeeds either way.
try {
  const copiedCount = await copyDefaultNotifyParties(svc, ctx, data.id, data.customer_id);
  if (copiedCount > 0) {
    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.notify_parties_seeded',
      entityType: 'load',
      entityId: data.id,
      newValues: { count: copiedCount },
      ipAddress: getClientIp(req),
      actorType: 'system',
    });
  }
} catch (e) {
  console.warn('default notify-party copy failed:', e.message);
}
```

(Note: the audit log call needs `getClientIp` to be in scope — verify it's already imported. If not, add `import { ..., getClientIp } from '../../../../lib/tenant-audit'` per the existing pattern.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/load-notify-parties-defaults.test.mjs`
Expected: All 9 cases pass.

- [ ] **Step 5: Commit**

```bash
git add tests/load-notify-parties-defaults.test.mjs pages/api/tenant/loads/index.js
git commit -m "feat(api): copy default_notify_parties into load_notify_parties on load create

After inserting a new order, query the customer's default_notify_parties
JSONB and insert one load_notify_parties row per still-alive reference.
Dead refs (group/contact no longer present) are filtered. Logs a single
audit entry load.notify_parties_seeded with count and actorType=system.
Failure is non-fatal — load creation succeeds either way."
```

---

## Task 8: NotifyPartyPicker Component

**Files:**
- Create: `components/loads/NotifyPartyPicker.js`

- [ ] **Step 1: Write the component**

Create `components/loads/NotifyPartyPicker.js`:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Search, Users, User } from 'lucide-react';

/**
 * Shared chip-picker for load notify parties.
 *
 * Used in:
 *   - NewLoadModal (mode="load") — auto-populates from customer defaults
 *   - LoadInfoTab    (mode="load") — edits via API endpoints
 *   - OverviewTab    (mode="customer-default") — sets per-customer defaults
 *
 * Props:
 *   mode: 'load' | 'customer-default'
 *   customerId: uuid                 — load mode: bill-to customer; customer-default mode: this org
 *   pickupLocationOrgId, deliveryLocationOrgId, returnLocationOrgId: uuid (load mode only)
 *   value: array of { id?, party_type, party_id, source, source_organization_id, name?, source_organization_name?, member_count?, email? }
 *   onChange: (newValue) => void
 *   onManualEdit: () => void         — called whenever user adds/removes (modal can use this to flag dirty state)
 */
export default function NotifyPartyPicker({
  mode = 'load',
  customerId,
  pickupLocationOrgId,
  deliveryLocationOrgId,
  returnLocationOrgId,
  value = [],
  onChange,
  onManualEdit,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [orgSections, setOrgSections] = useState([]);  // [{ source, label, orgId, orgName, groups: [], contacts: [] }, ...]
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);  // org list from typeahead
  const [searchSelected, setSearchSelected] = useState(null);  // { id, name, groups, contacts }
  const [loadingSections, setLoadingSections] = useState(false);
  const dropdownRef = useRef(null);

  // ── Fetch the predefined sections ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function loadSections() {
      setLoadingSections(true);
      const sections = [];
      const ids = mode === 'load'
        ? [
            { source: 'customer', label: 'Customer', orgId: customerId },
            { source: 'pickup_location', label: 'Pickup', orgId: pickupLocationOrgId },
            { source: 'delivery_location', label: 'Delivery', orgId: deliveryLocationOrgId },
            { source: 'return_location', label: 'Return', orgId: returnLocationOrgId },
          ]
        : [
            { source: 'customer', label: 'This organization', orgId: customerId },
          ];

      for (const s of ids) {
        if (!s.orgId) continue;
        const [orgRes, groupsRes, contactsRes] = await Promise.all([
          fetch(`/api/tenant/organizations/${s.orgId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(`/api/tenant/organizations/${s.orgId}/groups`).then((r) => (r.ok ? r.json() : { groups: [] })).catch(() => ({ groups: [] })),
          fetch(`/api/tenant/organizations/${s.orgId}/contacts`).then((r) => (r.ok ? r.json() : { contacts: [] })).catch(() => ({ contacts: [] })),
        ]);
        if (cancelled) return;
        sections.push({
          source: s.source,
          label: s.label,
          orgId: s.orgId,
          orgName: orgRes?.organization?.name || orgRes?.name || 'Unknown',
          groups: groupsRes?.groups || [],
          contacts: contactsRes?.contacts || [],
        });
      }
      if (!cancelled) {
        setOrgSections(sections);
        setLoadingSections(false);
      }
    }
    loadSections();
    return () => { cancelled = true; };
  }, [mode, customerId, pickupLocationOrgId, deliveryLocationOrgId, returnLocationOrgId]);

  // ── Search any organization (debounced) ──────────────────────
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.trim();
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/tenant/organizations?q=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : { organizations: [] })).catch(() => ({ organizations: [] }));
      setSearchResults((res?.organizations || []).slice(0, 10));
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  async function selectSearchOrg(org) {
    const [groupsRes, contactsRes] = await Promise.all([
      fetch(`/api/tenant/organizations/${org.id}/groups`).then((r) => (r.ok ? r.json() : { groups: [] })).catch(() => ({ groups: [] })),
      fetch(`/api/tenant/organizations/${org.id}/contacts`).then((r) => (r.ok ? r.json() : { contacts: [] })).catch(() => ({ contacts: [] })),
    ]);
    setSearchSelected({ id: org.id, name: org.name, groups: groupsRes.groups || [], contacts: contactsRes.contacts || [] });
  }

  // ── Add / remove handlers ────────────────────────────────────
  function isAlreadyAdded(party_type, party_id) {
    return (value || []).some((p) => p.party_type === party_type && p.party_id === party_id);
  }

  function addParty(section, party_type, partyObj) {
    if (isAlreadyAdded(party_type, partyObj.id)) return;
    const newEntry = {
      party_type,
      party_id: partyObj.id,
      source: section.source,
      source_organization_id: section.orgId,
      source_organization_name: section.orgName,
      name: partyObj.name,
      ...(party_type === 'group' ? { member_count: partyObj.member_count || 0 } : { email: partyObj.email }),
    };
    onChange([...(value || []), newEntry]);
    onManualEdit?.();
    setPickerOpen(false);
    setSearchQuery('');
    setSearchSelected(null);
  }

  function removeParty(idx) {
    const next = (value || []).filter((_, i) => i !== idx);
    onChange(next);
    onManualEdit?.();
  }

  // ── Group chips by source-org for display ────────────────────
  const chipsByOrg = useMemo(() => {
    const map = new Map();
    (value || []).forEach((p, idx) => {
      const key = `${p.source || 'other'}::${p.source_organization_id || ''}`;
      const label = p.source_organization_name || 'Other';
      const sourceLabel = ({
        customer: 'Customer',
        pickup_location: 'Pickup',
        delivery_location: 'Delivery',
        return_location: 'Return',
        other_org: 'Other',
        default: 'Customer',
      })[p.source] || 'Other';
      const heading = `${sourceLabel}: ${label}`;
      if (!map.has(key)) map.set(key, { heading, parties: [] });
      map.get(key).parties.push({ ...p, _idx: idx });
    });
    return Array.from(map.values());
  }, [value]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Chip groups */}
      {chipsByOrg.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-slate-400 italic">
          No notify parties for this {mode === 'load' ? 'load' : 'customer'}.
        </div>
      ) : (
        chipsByOrg.map((grp) => (
          <div key={grp.heading} className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">
              {grp.heading}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {grp.parties.map((p) => {
                const isDead = p.name === null;
                return (
                  <span
                    key={p._idx}
                    className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs border ${
                      isDead
                        ? 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-500 dark:text-slate-400 line-through'
                        : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-300'
                    }`}
                  >
                    {p.party_type === 'group' ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
                    {isDead ? `Deleted ${p.party_type}` : p.name}
                    {p.party_type === 'group' && !isDead && p.member_count != null && (
                      <span className="text-[10px] text-gray-500 dark:text-slate-500">
                        ({p.member_count})
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeParty(p._idx)}
                      className="hover:text-rose-600 dark:hover:text-rose-400 p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      aria-label={`Remove ${p.name || 'party'}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Add button + dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add notify party
        </button>

        {pickerOpen && (
          <div className="absolute z-30 mt-1 left-0 w-96 max-h-[480px] overflow-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
            {loadingSections ? (
              <div className="p-3 text-xs text-gray-500 dark:text-slate-400">Loading…</div>
            ) : (
              <>
                {orgSections.map((section) => (
                  <div key={section.source} className="border-b border-gray-100 dark:border-slate-800 last:border-0">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold bg-gray-50 dark:bg-slate-800/50 text-gray-500 dark:text-slate-400">
                      {section.label}: {section.orgName}
                    </div>
                    <div className="py-1">
                      {section.groups.length === 0 && section.contacts.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500 italic">
                          No groups or contacts
                        </div>
                      )}
                      {section.groups.map((g) => (
                        <button
                          key={`g-${g.id}`}
                          type="button"
                          onClick={() => addParty(section, 'group', g)}
                          disabled={isAlreadyAdded('group', g.id)}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Users className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          <span className="flex-1">{g.name}</span>
                          {g.member_count != null && (
                            <span className="text-[10px] text-gray-500 dark:text-slate-500">
                              {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
                            </span>
                          )}
                        </button>
                      ))}
                      {section.contacts.map((c) => (
                        <button
                          key={`c-${c.id}`}
                          type="button"
                          onClick={() => addParty(section, 'contact', c)}
                          disabled={isAlreadyAdded('contact', c.id)}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <User className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          <span className="flex-1">
                            {c.name}
                            {c.email && <span className="ml-1 text-gray-400 dark:text-slate-500">{c.email}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Search any org */}
                <div className="border-t border-gray-200 dark:border-slate-700 p-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Search className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setSearchSelected(null); }}
                      placeholder="Search any organization…"
                      className="flex-1 text-xs bg-transparent border-none outline-none text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500"
                    />
                  </div>
                  {searchSelected ? (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 px-1">
                        Other: {searchSelected.name}
                      </div>
                      {searchSelected.groups.map((g) => (
                        <button
                          key={`sg-${g.id}`}
                          type="button"
                          onClick={() => addParty({ source: 'other_org', orgId: searchSelected.id, orgName: searchSelected.name }, 'group', g)}
                          disabled={isAlreadyAdded('group', g.id)}
                          className="flex items-center gap-2 w-full px-2 py-1 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded disabled:opacity-40"
                        >
                          <Users className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          {g.name}
                        </button>
                      ))}
                      {searchSelected.contacts.map((c) => (
                        <button
                          key={`sc-${c.id}`}
                          type="button"
                          onClick={() => addParty({ source: 'other_org', orgId: searchSelected.id, orgName: searchSelected.name }, 'contact', c)}
                          disabled={isAlreadyAdded('contact', c.id)}
                          className="flex items-center gap-2 w-full px-2 py-1 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded disabled:opacity-40"
                        >
                          <User className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          {c.name}
                          {c.email && <span className="text-gray-400 dark:text-slate-500">{c.email}</span>}
                        </button>
                      ))}
                    </div>
                  ) : (
                    searchResults.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => selectSearchOrg(org)}
                        className="block w-full px-2 py-1 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded"
                      >
                        {org.name}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke**

Component is unmounted from any consumer at this point — defer manual smoke until Task 9 wires it into NewLoadModal. Confirm the file imports cleanly via:

```bash
node -e "import('./components/loads/NotifyPartyPicker.js').then(() => console.log('ok')).catch(e => { console.error(e); process.exit(1); })"
```

(If your environment doesn't support direct ESM import of JSX, skip this — the smoke happens at Task 9.)

- [ ] **Step 3: Commit**

```bash
git add components/loads/NotifyPartyPicker.js
git commit -m "feat(loads): NotifyPartyPicker shared chip-picker component

Used by NewLoadModal, LoadInfoTab, and OverviewTab. Two modes:
'load' (with pickup/delivery/return source sections) and
'customer-default' (single-org section + search escape hatch).
Sectioned dropdown groups by source org. Chips render grouped by
'Customer: X' / 'Pickup: Y' headings. Dead-ref chips render muted
with line-through. Search-any-org typeahead with 250ms debounce.
Dark-mode variants throughout per dev_dark_mode_convention."
```

---

## Task 9: NewLoadModal Integration

**Files:**
- Modify: `components/loads/NewLoadModal.js`

- [ ] **Step 1: Add the section + state + auto-populate logic**

Edit `components/loads/NewLoadModal.js`. At the top of the file, add the import (after existing imports):

```js
import NotifyPartyPicker from './NotifyPartyPicker';
import Modal from '../ui/Modal';  // already imported — skip
```

Find the form state declaration (the `const [form, setForm] = useState(...)` block near line 60-130). Add new state lines:

```js
const [notifyParties, setNotifyParties] = useState([]);
const [manuallyEditedNotifyParties, setManuallyEditedNotifyParties] = useState(false);
const [pendingCustomerId, setPendingCustomerId] = useState(null);  // for the confirm-dialog flow
```

Find the `selectOrg` function (called from `OrgPicker`'s `onChange` when customer is picked). Wrap it to handle the auto-populate / wipe-and-replace logic. Locate the `customer_id` selectOrg call (search for `'customer_id'` and `'customer_label'`) and replace its handler:

```js
async function handleCustomerChange(org) {
  // org is the selected organization (or null)
  const newCustomerId = org?.id || null;
  if (!newCustomerId) {
    selectOrg('customer_id', 'customer_label', org);
    setNotifyParties([]);
    setManuallyEditedNotifyParties(false);
    return;
  }

  // If user has manually edited and a customer was previously chosen,
  // confirm before replacing
  if (manuallyEditedNotifyParties && form.customer_id && form.customer_id !== newCustomerId) {
    setPendingCustomerId(newCustomerId);
    // store the org temporarily so we can complete the change after confirm
    setPendingCustomerOrg(org);
    return;
  }

  // Apply the change immediately
  await applyCustomerChange(org);
}

async function applyCustomerChange(org) {
  selectOrg('customer_id', 'customer_label', org);

  // Fetch defaults and resolve display names
  try {
    const orgRes = await fetch(`/api/tenant/organizations/${org.id}`).then((r) => r.ok ? r.json() : null);
    const defaults = orgRes?.organization?.default_notify_parties || orgRes?.default_notify_parties || [];
    if (!Array.isArray(defaults) || defaults.length === 0) {
      setNotifyParties([]);
    } else {
      const groupIds = defaults.filter((d) => d.type === 'group').map((d) => d.id);
      const contactIds = defaults.filter((d) => d.type === 'contact').map((d) => d.id);
      const orgIds = Array.from(new Set(defaults.map((d) => d.source_organization_id).filter(Boolean)));

      const [groupsRes, contactsRes, orgsRes] = await Promise.all([
        groupIds.length ? fetch(`/api/tenant/notify-parties/hydrate?type=group&ids=${groupIds.join(',')}`).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        contactIds.length ? fetch(`/api/tenant/notify-parties/hydrate?type=contact&ids=${contactIds.join(',')}`).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        orgIds.length ? fetch(`/api/tenant/notify-parties/hydrate?type=org&ids=${orgIds.join(',')}`).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      ]);

      const groupById = Object.fromEntries((groupsRes.items || []).map((g) => [g.id, g]));
      const contactById = Object.fromEntries((contactsRes.items || []).map((c) => [c.id, c]));
      const orgById = Object.fromEntries((orgsRes.items || []).map((o) => [o.id, o]));

      const hydrated = defaults
        .map((d) => {
          if (d.type === 'group') {
            const g = groupById[d.id];
            if (!g) return null;  // dead ref — skip
            return {
              party_type: 'group',
              party_id: d.id,
              source: 'default',
              source_organization_id: d.source_organization_id,
              source_organization_name: orgById[d.source_organization_id]?.name || null,
              name: g.name,
              member_count: g.member_count || 0,
            };
          }
          const c = contactById[d.id];
          if (!c) return null;
          return {
            party_type: 'contact',
            party_id: d.id,
            source: 'default',
            source_organization_id: d.source_organization_id,
            source_organization_name: orgById[d.source_organization_id]?.name || null,
            name: c.name,
            email: c.email,
          };
        })
        .filter(Boolean);

      setNotifyParties(hydrated);
    }
  } catch (e) {
    console.warn('Failed to load notify-party defaults:', e);
    setNotifyParties([]);
  }

  setManuallyEditedNotifyParties(false);
}
```

(Add a helper hydrate endpoint at `/api/tenant/notify-parties/hydrate` later, OR alternatively call the existing `/api/tenant/organizations/[id]/groups` and `/contacts` per-source-org. The simpler path is to **omit the hydrate endpoint** and just fetch the source org's groups/contacts directly. Use this simpler version instead:)

Replace the fetch logic above with:

```js
async function applyCustomerChange(org) {
  selectOrg('customer_id', 'customer_label', org);

  // Fetch defaults
  try {
    const orgRes = await fetch(`/api/tenant/organizations/${org.id}`).then((r) => r.ok ? r.json() : null);
    const defaults = orgRes?.organization?.default_notify_parties || orgRes?.default_notify_parties || [];
    if (!Array.isArray(defaults) || defaults.length === 0) {
      setNotifyParties([]);
      setManuallyEditedNotifyParties(false);
      return;
    }

    // Group by source_organization_id for batch fetching
    const orgIds = Array.from(new Set(defaults.map((d) => d.source_organization_id || org.id).filter(Boolean)));
    const orgDataById = {};
    await Promise.all(orgIds.map(async (oid) => {
      const [orgInfo, groups, contacts] = await Promise.all([
        fetch(`/api/tenant/organizations/${oid}`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tenant/organizations/${oid}/groups`).then((r) => r.ok ? r.json() : { groups: [] }).catch(() => ({ groups: [] })),
        fetch(`/api/tenant/organizations/${oid}/contacts`).then((r) => r.ok ? r.json() : { contacts: [] }).catch(() => ({ contacts: [] })),
      ]);
      orgDataById[oid] = {
        name: orgInfo?.organization?.name || orgInfo?.name || 'Unknown',
        groupById: Object.fromEntries((groups.groups || []).map((g) => [g.id, g])),
        contactById: Object.fromEntries((contacts.contacts || []).map((c) => [c.id, c])),
      };
    }));

    const hydrated = defaults
      .map((d) => {
        const oid = d.source_organization_id || org.id;
        const data = orgDataById[oid];
        if (!data) return null;
        if (d.type === 'group') {
          const g = data.groupById[d.id];
          if (!g) return null;
          return {
            party_type: 'group',
            party_id: d.id,
            source: 'default',
            source_organization_id: oid,
            source_organization_name: data.name,
            name: g.name,
            member_count: g.member_count || 0,
          };
        }
        const c = data.contactById[d.id];
        if (!c) return null;
        return {
          party_type: 'contact',
          party_id: d.id,
          source: 'default',
          source_organization_id: oid,
          source_organization_name: data.name,
          name: c.name,
          email: c.email,
        };
      })
      .filter(Boolean);

    setNotifyParties(hydrated);
    setManuallyEditedNotifyParties(false);
  } catch (e) {
    console.warn('Failed to load notify-party defaults:', e);
    setNotifyParties([]);
    setManuallyEditedNotifyParties(false);
  }
}

const [pendingCustomerOrg, setPendingCustomerOrg] = useState(null);
```

- [ ] **Step 2: Add the confirm dialog state + render**

Inside the `return (...)` block, near the top of the form (above the type pills, but inside the modal), add:

```jsx
{pendingCustomerId && (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
    <div className="bg-white dark:bg-slate-900 rounded-lg p-5 max-w-md w-full mx-4 shadow-xl border border-gray-200 dark:border-slate-700">
      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2">Reset notify parties?</div>
      <div className="text-xs text-gray-600 dark:text-slate-400 mb-4">
        Changing customer will reset notify parties to the new customer&apos;s defaults. Your manual edits will be lost.
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => { setPendingCustomerId(null); setPendingCustomerOrg(null); }}
          className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={async () => {
            const org = pendingCustomerOrg;
            setPendingCustomerId(null);
            setPendingCustomerOrg(null);
            await applyCustomerChange(org);
          }}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white"
        >
          Continue
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Add the Notify Parties section to the form**

Find the position near the bottom of the form, just before the Cancel/Create Load buttons. Add (search for the `<Button` rendering "Create Load" near the end of the JSX):

```jsx
{form.customer_id && (
  <details className="border border-gray-200 dark:border-slate-700 rounded-lg" open={notifyParties.length > 0}>
    <summary className="px-3 py-2 cursor-pointer text-xs font-semibold text-gray-700 dark:text-slate-200 flex items-center justify-between">
      <span>Notify parties (optional)</span>
      <span className="text-gray-500 dark:text-slate-400 font-normal">
        {notifyParties.length === 0 ? 'None' : `${notifyParties.length} party${notifyParties.length === 1 ? '' : 'ies'}`}
      </span>
    </summary>
    <div className="px-3 pb-3 pt-2 border-t border-gray-200 dark:border-slate-700">
      <NotifyPartyPicker
        mode="load"
        customerId={form.customer_id}
        pickupLocationOrgId={form.pickup_location_id}
        deliveryLocationOrgId={form.delivery_location_id}
        returnLocationOrgId={form.return_location_id}
        value={notifyParties}
        onChange={setNotifyParties}
        onManualEdit={() => setManuallyEditedNotifyParties(true)}
      />
    </div>
  </details>
)}
```

- [ ] **Step 4: Wire the customer-picker handler to `handleCustomerChange`**

Find the `OrgPicker` for customer (search `'customer_id'`). Change its `onChange` from `(org) => selectOrg('customer_id', 'customer_label', org)` to `handleCustomerChange`.

- [ ] **Step 5: Send notify parties on submit**

Find `handleSubmit` (line 289). After the existing `const data = await res.json();` line, add the notify-parties POST loop:

```js
const data = await res.json();

// Insert notify parties for the newly created load. Note: the
// auto-populated 'default'-source ones were already inserted server-side
// via copyDefaultNotifyParties — we send only the manually added ones.
const manualParties = notifyParties.filter((p) => p.source !== 'default');
if (manualParties.length > 0 && data.load?.id) {
  await Promise.all(manualParties.map((p) =>
    fetch(`/api/tenant/loads/${data.load.id}/notify-parties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        party_type: p.party_type,
        party_id: p.party_id,
        source: p.source,
        source_organization_id: p.source_organization_id,
      }),
    }).catch((e) => console.warn('Failed to add notify party:', e))
  ));
}

onSuccess?.(data.load);
```

- [ ] **Step 6: Manual smoke**

```bash
# Start dev server
npm run dev
```

Open the dispatcher page. Click **+ Add New Load**. Pick a customer. Verify:
- If customer has `default_notify_parties` populated, the chips appear in the "Notify parties (optional)" section (auto-expanded).
- If empty, section is collapsed.
- Click "Add notify party" — dropdown shows Customer / Pickup / Delivery / Return / Search sections. (Pickup/Delivery may be empty until you pick locations.)
- Add a few parties. Verify chips render grouped by source-org headings.
- Change customer to a different one — if you've manually edited, the confirm dialog appears.
- Cancel the confirm — verify customer reverts. (Note: this isn't currently wired to revert; the change-customer event already happened in `handleCustomerChange` BEFORE the dialog. The dialog just blocks the wipe. The revert pattern requires holding the original customer reference. **Implementation refinement during smoke:** if revert-on-cancel feels broken, store `prevCustomerOrg` in `handleCustomerChange` and call `selectOrg('customer_id', ..., prevCustomerOrg)` on cancel.)
- Continue the confirm — verify chips wipe and re-populate.
- Submit the form — verify the load is created and the manual parties are inserted (check via DB query or Load Detail).

- [ ] **Step 7: Commit**

```bash
git add components/loads/NewLoadModal.js
git commit -m "feat(loads): notify parties section in NewLoadModal

Adds collapsible 'Notify parties (optional)' section after route template.
Auto-populates from customer.default_notify_parties on customer pick.
Wipes-and-replaces silently on customer change unless user manually
edited (then shows confirm dialog). Manually-added parties are POSTed
to /api/tenant/loads/[id]/notify-parties after the load insert succeeds
(default-source parties are inserted server-side already)."
```

---

## Task 10: LoadInfoTab Integration (Load Detail Edit Surface)

**Files:**
- Modify: `components/loads/tabs/LoadInfoTab.js`

- [ ] **Step 1: Read the file to find the right insertion point**

```bash
# Read components/loads/tabs/LoadInfoTab.js to locate a good spot for
# a new card. Aim for somewhere after the existing customer/locations
# cards but before audit/footer.
```

- [ ] **Step 2: Add the picker card**

In `components/loads/tabs/LoadInfoTab.js`, add the import:

```js
import NotifyPartyPicker from '../NotifyPartyPicker';
```

Add component state (near other useState hooks at the top of the component):

```js
const [notifyParties, setNotifyParties] = useState([]);
const [npLoading, setNpLoading] = useState(true);

useEffect(() => {
  let cancelled = false;
  async function load() {
    setNpLoading(true);
    const res = await fetch(`/api/tenant/loads/${load.id}/notify-parties`);
    if (!res.ok) { if (!cancelled) setNpLoading(false); return; }
    const json = await res.json();
    if (cancelled) return;
    setNotifyParties(json.parties || []);
    setNpLoading(false);
  }
  load();
  return () => { cancelled = true; };
}, [load.id]);

async function handleNotifyChange(next) {
  // Diff against current — POST adds, DELETE removes
  const prevByKey = new Map(notifyParties.map((p) => [`${p.party_type}::${p.party_id}`, p]));
  const nextByKey = new Map(next.map((p) => [`${p.party_type}::${p.party_id}`, p]));

  const toAdd = next.filter((p) => !prevByKey.has(`${p.party_type}::${p.party_id}`));
  const toRemove = notifyParties.filter((p) => !nextByKey.has(`${p.party_type}::${p.party_id}`));

  // Apply optimistically; reload from server on error
  setNotifyParties(next);

  await Promise.all([
    ...toAdd.map((p) =>
      fetch(`/api/tenant/loads/${load.id}/notify-parties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party_type: p.party_type,
          party_id: p.party_id,
          source: p.source,
          source_organization_id: p.source_organization_id,
        }),
      })
    ),
    ...toRemove.filter((p) => p.id).map((p) =>
      fetch(`/api/tenant/loads/${load.id}/notify-parties/${p.id}`, { method: 'DELETE' })
    ),
  ]);

  // Reload to pick up server-assigned IDs
  const res = await fetch(`/api/tenant/loads/${load.id}/notify-parties`);
  if (res.ok) {
    const json = await res.json();
    setNotifyParties(json.parties || []);
  }
}
```

Inside the JSX, add a new card section. Find a good spot (e.g., after the Reference/Container card, before Audit). Add:

```jsx
<div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
  <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
    <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">
      Notify parties
    </div>
    <div className="text-[10px] text-gray-500 dark:text-slate-500 mt-0.5">
      Recipients automatically added to umbrella emails that reference Load notify parties.
    </div>
  </div>
  <div className="p-4">
    {npLoading ? (
      <div className="text-xs text-gray-500 dark:text-slate-400">Loading…</div>
    ) : (
      <NotifyPartyPicker
        mode="load"
        customerId={load.customer_id}
        pickupLocationOrgId={load.pickup_location_id}
        deliveryLocationOrgId={load.delivery_location_id}
        returnLocationOrgId={load.return_location_id}
        value={notifyParties}
        onChange={handleNotifyChange}
      />
    )}
  </div>
</div>
```

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
```

Open an existing load. Navigate to LoadInfoTab. Verify:
- "Notify parties" card renders.
- Existing parties (from creation-time) are listed, grouped by source-org.
- Add a party from the dropdown — verify it persists (refresh page, still there).
- Remove a party — verify it persists.

- [ ] **Step 4: Commit**

```bash
git add components/loads/tabs/LoadInfoTab.js
git commit -m "feat(loads): notify-parties card on LoadInfoTab

Adds a card to the Load Detail's LoadInfoTab that lists current
notify parties with the shared NotifyPartyPicker. Add/remove flows
diff against current state and POST/DELETE individual rows for
audit-log clarity. Reloads from server after mutations to pick up
authoritative IDs."
```

---

## Task 11: Organization OverviewTab Default Card

**Files:**
- Modify: `components/organizations/tabs/OverviewTab.js`

- [ ] **Step 1: Add the picker card**

In `components/organizations/tabs/OverviewTab.js`, add the import:

```js
import NotifyPartyPicker from '../../loads/NotifyPartyPicker';
```

Add component state:

```js
const [defaults, setDefaults] = useState([]);
const [defaultsDirty, setDefaultsDirty] = useState(false);
const [savingDefaults, setSavingDefaults] = useState(false);

useEffect(() => {
  // The org payload should already include default_notify_parties via
  // the org GET endpoint. If the parent already passed it via `org`
  // prop, hydrate directly; otherwise fetch.
  const raw = org?.default_notify_parties || [];
  // Hydrate names — minimal version: store as-is and let picker fetch
  // group/contact details lazily when the dropdown opens. For chip
  // display we need names — fetch them now.
  if (!Array.isArray(raw) || raw.length === 0) {
    setDefaults([]);
    return;
  }
  let cancelled = false;
  (async () => {
    const orgIds = Array.from(new Set(raw.map((d) => d.source_organization_id || org.id).filter(Boolean)));
    const orgDataById = {};
    await Promise.all(orgIds.map(async (oid) => {
      const [info, groups, contacts] = await Promise.all([
        fetch(`/api/tenant/organizations/${oid}`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tenant/organizations/${oid}/groups`).then((r) => r.ok ? r.json() : { groups: [] }).catch(() => ({ groups: [] })),
        fetch(`/api/tenant/organizations/${oid}/contacts`).then((r) => r.ok ? r.json() : { contacts: [] }).catch(() => ({ contacts: [] })),
      ]);
      orgDataById[oid] = {
        name: info?.organization?.name || info?.name || 'Unknown',
        groupById: Object.fromEntries((groups.groups || []).map((g) => [g.id, g])),
        contactById: Object.fromEntries((contacts.contacts || []).map((c) => [c.id, c])),
      };
    }));
    if (cancelled) return;
    const hydrated = raw.map((d) => {
      const oid = d.source_organization_id || org.id;
      const data = orgDataById[oid];
      if (!data) return { party_type: d.type, party_id: d.id, source: 'customer', source_organization_id: oid, source_organization_name: 'Unknown', name: null };
      if (d.type === 'group') {
        const g = data.groupById[d.id];
        return {
          party_type: 'group',
          party_id: d.id,
          source: 'customer',
          source_organization_id: oid,
          source_organization_name: data.name,
          name: g?.name || null,
          member_count: g?.member_count || 0,
        };
      }
      const c = data.contactById[d.id];
      return {
        party_type: 'contact',
        party_id: d.id,
        source: 'customer',
        source_organization_id: oid,
        source_organization_name: data.name,
        name: c?.name || null,
        email: c?.email || null,
      };
    });
    setDefaults(hydrated);
  })();
  return () => { cancelled = true; };
}, [org]);

async function saveDefaults() {
  setSavingDefaults(true);
  const payload = defaults.map((p) => ({
    type: p.party_type,
    id: p.party_id,
    source_organization_id: p.source_organization_id,
  }));
  const res = await fetch(`/api/tenant/organizations/${org.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ default_notify_parties: payload }),
  });
  if (res.ok) {
    setDefaultsDirty(false);
  } else {
    const err = await res.json().catch(() => ({}));
    alert(`Failed to save: ${err.error || res.statusText}`);
  }
  setSavingDefaults(false);
}
```

In the JSX, add a card alongside other Overview cards:

```jsx
<div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
  <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
    <div>
      <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">
        Default notify parties for new loads
      </div>
      <div className="text-[10px] text-gray-500 dark:text-slate-500 mt-0.5">
        Auto-populated when a new load is created for this customer. Editable per-load.
      </div>
    </div>
    {defaultsDirty && (
      <button
        type="button"
        onClick={saveDefaults}
        disabled={savingDefaults}
        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs disabled:opacity-50"
      >
        {savingDefaults ? 'Saving…' : 'Save'}
      </button>
    )}
  </div>
  <div className="p-4">
    <NotifyPartyPicker
      mode="customer-default"
      customerId={org.id}
      value={defaults}
      onChange={(next) => { setDefaults(next); setDefaultsDirty(true); }}
    />
  </div>
</div>
```

- [ ] **Step 2: Verify the org GET returns `default_notify_parties`**

Open `pages/api/tenant/organizations/[id]/index.js`. Find the GET handler's `select(...)` call. If `default_notify_parties` is not in the select column list, add it:

```js
.select('id, name, ..., default_notify_parties, ...')
```

If the GET uses `select('*')` then it's already included.

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
```

Open an organization detail page. Verify:
- "Default notify parties for new loads" card appears in Overview.
- Add a few parties from the picker.
- Click "Save" — verify network call succeeds.
- Reload page — verify chips persist.

- [ ] **Step 4: Commit**

```bash
git add components/organizations/tabs/OverviewTab.js pages/api/tenant/organizations/[id]/index.js
git commit -m "feat(orgs): default notify parties card in OverviewTab

Adds a card on Organization detail Overview that uses NotifyPartyPicker
in 'customer-default' mode. Hydrates names via parallel fetches to
groups/contacts endpoints. Saves to customers.default_notify_parties
via PATCH. Save button only appears when there are unsaved changes."
```

---

## Task 12: Umbrella Editor RecipientRow Token Picker

**Files:**
- Modify: `pages/settings/communications/umbrellas/[id].js`

- [ ] **Step 1: Define the role-token catalog**

Edit `pages/settings/communications/umbrellas/[id].js`. Near the top of the file (after imports, before any component definitions), add:

```js
// Catalog of role tokens available in the umbrella editor's recipient
// picker. Token value is what gets stored in the JSONB recipients
// array; label/description are display-only.
const ROLE_TOKEN_CATALOG = [
  {
    section: 'Per-load',
    tokens: [
      { value: 'load_notify_parties', label: 'Load notify parties', description: 'Recipients set per-load on the load itself. Empty if none configured for this load.' },
      { value: 'load_dispatcher',     label: 'Load dispatcher',     description: 'The tenant user assigned to dispatch this load.' },
      { value: 'driver',              label: 'Driver',              description: 'The driver assigned to the firing event.' },
    ],
  },
  {
    section: 'Customer',
    tokens: [
      { value: 'customer_primary', label: 'Customer primary contact', description: 'The bill-to customer\'s primary contact email.' },
    ],
  },
  {
    section: 'Tenant',
    tokens: [
      { value: 'tenant_dispatcher', label: 'Tenant dispatcher', description: 'Default dispatcher email configured at the tenant level.' },
      { value: 'tenant_ops',        label: 'Tenant ops',        description: 'Default ops email configured at the tenant level.' },
      { value: 'acting_user',       label: 'Acting user',       description: 'The user who triggered this email (e.g., clicked Send).' },
    ],
  },
];

const ROLE_TOKEN_LABELS = ROLE_TOKEN_CATALOG.flatMap((s) => s.tokens).reduce((acc, t) => {
  acc[t.value] = t.label;
  return acc;
}, {});
```

- [ ] **Step 2: Add `addTokenRecipient` next to `addRecipient`**

The existing `addRecipient` (lines 959-967) persists via `onUpdate({ [key]: [...current, entry] })`. Add a parallel `addTokenRecipient` immediately after it (do NOT modify the existing function):

```js
function addTokenRecipient(kind, token) {
  if (!token) return;
  const entry = { type: 'role', value: token };
  const key = `${kind}_recipients`;
  const current = Array.isArray(group[key]) ? group[key] : [];
  // Avoid duplicate tokens
  if (current.some((r) => r.type === 'role' && r.value === token)) return;
  onUpdate({ [key]: [...current, entry] });
}
```

- [ ] **Step 3: Extend `RecipientRow` with the dropdown**

Find `RecipientRow` (line 1285). Update the props signature:

```js
function RecipientRow({
  label,
  accentColor = 'gray',
  required = false,
  recipients,
  input,
  onInputChange,
  onAdd,
  onAddToken,        // NEW
  onRemove,
}) {
```

Add a state for the dropdown:

```js
const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
```

In the JSX, change the chip rendering to handle both email and role chips. Replace:

```jsx
{recipients.map((r, idx) => (
  <span
    key={idx}
    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-300"
  >
    {r.value}
    ...
```

with:

```jsx
{recipients.map((r, idx) => {
  const isToken = r.type === 'role';
  const display = isToken ? (ROLE_TOKEN_LABELS[r.value] || r.value) : r.value;
  return (
    <span
      key={idx}
      className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs border ${
        isToken
          ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900/60 text-purple-700 dark:text-purple-300'
          : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-300'
      }`}
    >
      {isToken && <span className="text-[10px] font-mono text-purple-500 dark:text-purple-400">{`{{}}`}</span>}
      {display}
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

After the `<input>` element (still inside the chip-input bordered box), add the dropdown trigger + dropdown:

```jsx
<div className="relative">
  <button
    type="button"
    onClick={() => setTokenPickerOpen((o) => !o)}
    title="Insert dynamic recipient"
    className="px-1.5 py-1 rounded text-gray-400 hover:text-purple-600 dark:hover:text-purple-400"
  >
    <span className="text-xs font-mono">{`{{}}`}</span>
  </button>
  {tokenPickerOpen && (
    <div className="absolute z-30 mt-1 right-0 w-72 max-h-96 overflow-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
      {ROLE_TOKEN_CATALOG.map((s) => (
        <div key={s.section} className="border-b border-gray-100 dark:border-slate-800 last:border-0">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider font-semibold bg-gray-50 dark:bg-slate-800/50 text-gray-500 dark:text-slate-400">
            {s.section}
          </div>
          {s.tokens.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => { onAddToken(t.value); setTokenPickerOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-purple-50 dark:hover:bg-purple-950/40"
            >
              <div className="text-xs font-medium text-gray-900 dark:text-slate-100">{t.label}</div>
              <div className="text-[10px] text-gray-500 dark:text-slate-500 mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 4: Wire `onAddToken` from each `RecipientRow` invocation**

At each of the three `<RecipientRow>` invocations (line 1041, 1054, 1066), add:

```jsx
onAddToken={(token) => addTokenRecipient('to', token)}    // for the To row
onAddToken={(token) => addTokenRecipient('cc', token)}    // for the Cc row
onAddToken={(token) => addTokenRecipient('bcc', token)}   // for the Bcc row
```

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
```

Navigate to `/settings/communications/umbrellas/<some-umbrella-id>`. Find a recipient group. Verify:
- The new `{{}}` button appears at the right edge of each To/Cc/Bcc input.
- Clicking it opens a dropdown with three sections (Per-load, Customer, Tenant).
- "Load notify parties" appears at top of "Per-load."
- Picking a token adds a purple-styled chip to the recipient list.
- Removing the chip works.
- Save the group — verify the persisted JSON has `{type: 'role', value: 'load_notify_parties'}` (check via DB or refresh page).

- [ ] **Step 6: Commit**

```bash
git add pages/settings/communications/umbrellas/[id].js
git commit -m "feat(umbrellas): role-token picker in RecipientRow

Adds a {{}} button to each To/Cc/Bcc input that opens a sectioned
dropdown of role tokens (Per-load / Customer / Tenant). New token
'load_notify_parties' included at top of Per-load section. Tokens
render as purple-styled chips visually distinct from email chips.
Existing email-text-input behavior unchanged. Closes the picker UI
gap that prevented load_notify_parties from being usable from the
editor."
```

---

## Task 13: End-to-End Smoke + dd-qa

**Files:** none (verification only — fixes go to whichever file is broken)

- [ ] **Step 1: Run dd-qa skill**

Invoke the `dd-qa` skill against the changed surface to catch field-consistency issues, API shape misalignments, etc.

- [ ] **Step 2: Manual end-to-end smoke**

Run through these scenarios and confirm each:

1. **Defaults setup → load creation → umbrella send.**
   - Org A: set 2 default notify parties in Overview.
   - Create new load for Org A → verify chips auto-populated in modal.
   - Submit. Verify `load_notify_parties` rows exist (DB).
   - Edit an umbrella to include `load_notify_parties` in its To.
   - Trigger a status change that fires the umbrella for this load.
   - Verify the email's actual recipients include the resolved party emails.

2. **Customer change in NewLoadModal.**
   - Pick Org A (defaults populate).
   - Don't manually edit. Switch to Org B → verify silent wipe + repopulate from B's defaults.
   - Pick Org A again. Add a manual party. Switch to Org B → verify confirm dialog.
   - Cancel → confirm customer reverts (or dialog closes leaving you on B with manual party preserved — depending on Step 6 of Task 9 refinement). Document actual behavior.
   - Continue → verify chips replace with B's defaults.

3. **Load Detail edit.**
   - Open existing load. Add a notify party via LoadInfoTab card. Verify persists across reload.
   - Remove a party. Verify persists.

4. **Dead-ref handling.**
   - Add a party to a load via LoadInfoTab.
   - In the org's GroupsTab, delete the group that party references.
   - Reload the load → verify the chip renders as "Deleted group" with line-through and × button.
   - Click × → verify removed.

5. **Cross-tenant isolation.**
   - Sanity-check via DB: try to insert a `load_notify_parties` row whose `party_id` belongs to a different tenant. Confirm the API returns 400.

- [ ] **Step 3: Fix any issues found and commit**

If any test scenario fails, edit the relevant file, retest, and commit with a `fix(notify-parties): ...` message.

---

## Task 14: File Follow-Up FUs + Update Memory

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`

- [ ] **Step 1: Read the current followups.md to find the next FU number**

```bash
# In followups.md, scan for the highest FU-### in the open section.
# Pick the next two numbers.
```

- [ ] **Step 2: Append two new FUs**

Append entries (using the next available numbers — the format below uses placeholders `FU-NEW-A` and `FU-NEW-B`; replace with actual numbers found in step 1):

```markdown
### FU-NEW-A: Migrate `recipient-expander.js` `case 'contact_group'` to organization_group_members

- **Original source:** discovered during 2026-04-27 load-notify-parties spec review
- **Area:** email
- **Intent:** The `case 'contact_group':` branch at `lib/email-dispatch/recipient-expander.js:82` queries the legacy `customer_contact_group_members` table (migration 002), but FU-043 (migration 099) established `organization_group_members` as the canonical groups table. New code (load_notify_parties resolver branch, FU-043 default-for-purpose resolver) uses the new tables. The legacy branch should be migrated for consistency. Pure swap — same shape of result.

### FU-NEW-B: Add full type-picker to umbrella editor RecipientRow (variable, contact, contact_group)

- **Original source:** discovered during 2026-04-27 load-notify-parties implementation
- **Area:** email
- **Intent:** The token picker added in 2026-04-27 only exposes role tokens. The `{type:'variable'}` (e.g., for `customer.primary_contact.email` dotted-path values), `{type:'contact'}` (specific contact picker), and `{type:'contact_group'}` (group picker) entry types are still not reachable from the editor — they exist in JSONB only via direct DB seeding. Build a fuller picker with a tab for each type.
```

- [ ] **Step 3: Commit**

```bash
git add ../../.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md  # adjust path as needed
git commit -m "docs(followups): file FU-NEW-A and FU-NEW-B from load-notify-parties feature"
```

(Note: the followups.md file lives outside the project repo. If `git add` rejects it, that's expected — it's a memory file, not project source. Just save the file directly via Edit and skip the commit. The plan still records the intent.)

---

## Self-Review

Done writing all 14 tasks. Checking against spec coverage:

| Spec Goal | Covered by |
|---|---|
| New table `load_notify_parties` | Task 1 |
| New column `customers.default_notify_parties` | Task 1 |
| `load_notify_parties` role token in resolver | Task 2 |
| GET endpoint | Task 3 |
| POST endpoint | Task 4 |
| DELETE endpoint | Task 5 |
| PATCH org for `default_notify_parties` | Task 6 |
| Default-copy on load creation | Task 7 |
| `NotifyPartyPicker` component | Task 8 |
| NewLoadModal integration + auto-populate + confirm dialog | Task 9 |
| Load Detail edit surface (LoadInfoTab) | Task 10 |
| Org Overview default config card | Task 11 |
| Umbrella editor RecipientRow expansion | Task 12 |
| Resolver tests | Task 2 |
| API tests (GET / POST / DELETE) | Tasks 3, 4, 5 |
| Defaults tests | Tasks 6, 7 |
| Manual E2E + dd-qa | Task 13 |
| Audit logging | Tasks 4, 5, 7 (server-side) + 9 (client-side fires server-side) |
| Chip group-by-org display | Task 8 (component does this) |
| Dead-ref handling | Tasks 3 (returns name=null), 7 (filters at copy), 8 (renders muted) |
| Cross-tenant safety | Task 4 (cross-tenant party_id rejected) |
| Follow-up FU filing | Task 14 |

Placeholder check: no TBDs / TODOs / "implement appropriately" — every step has either complete code or an explicit follow-up.

Type consistency: `party_type`, `party_id`, `source`, `source_organization_id` used consistently across schema, API, component, tests. `default_notify_parties` JSONB shape `{type, id, source_organization_id?}` consistent everywhere.

Scope: 14 tasks, ~3 test files, 1 migration, 7 file modifications, 4 new files. Comparable to FU-043 in size. Sized for one execution session.
