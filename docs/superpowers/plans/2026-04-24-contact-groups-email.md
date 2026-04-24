# Contact Groups Email Implementation Plan (FU-043)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish FU-043 by enriching `organization_groups` schema + auto-seeding default groups on org creation + extending `resolveBillingEmails` with a group-aware Step 0 + polishing GroupsTab UI with purpose badges.

**Architecture:** Additive — UI in `GroupModal.js` already sends `purpose` + `is_default_for_purpose` in the request body; API + schema need to accept them. Migration 099 adds the columns + backfills 4 default groups per existing organization. Resolver gains one new step that queries the default group and falls through to existing Steps 1–4 if empty. GroupsTab gets purpose-badge display + default-group indicator.

**Tech Stack:** Supabase PostgreSQL + Node.js ESM + React/Tailwind (dark-mode variants mandatory per `dev_dark_mode_convention.md`) + hand-rolled `.test.mjs` pattern.

**Spec:** [docs/superpowers/specs/2026-04-24-contact-groups-email-design.md](docs/superpowers/specs/2026-04-24-contact-groups-email-design.md)

**Commit baseline:** HEAD = `62a9d0c` (spec). Each task commits separately.

**FU outcome:** closes FU-043.

**Files touched:**

| Type | File |
|---|---|
| Create | `supabase/migrations/099_contact_groups_purpose.sql` |
| Modify | `pages/api/tenant/organizations/index.js` (POST handler adds auto-seed) |
| Modify | `pages/api/tenant/organizations/[id]/groups/index.js` (POST accepts purpose + default + swap) |
| Modify | `pages/api/tenant/organizations/[id]/groups/[groupId]/index.js` (PUT accepts purpose + default + swap) |
| Modify | `lib/ar/resolve-billing-email.js` (new Step 0) |
| Modify | `components/organizations/tabs/GroupsTab.js` (purpose badge + default indicator) |
| Create | `tests/ar-resolve-billing-email-groups.test.mjs` (6 cases) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (close FU-043) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (audit-line bump) |

**Not touched:**
- `components/organizations/GroupModal.js` — form ALREADY has purpose dropdown + is_default_for_purpose checkbox. No changes needed to the modal itself.

---

## Phase 1 — Schema (1 task)

### Task 1: Migration 099 — `organization_groups` purpose + default + backfill

**Files:**
- Create: `supabase/migrations/099_contact_groups_purpose.sql`

- [ ] **Step 1: Verify migration 099 is free**

Run: `ls C:/Users/bento/app-drayagedirect/supabase/migrations/ | grep "^099"`

Expected: no match. If collision, bump to next available.

- [ ] **Step 2: Write the migration**

Create `C:\Users\bento\app-drayagedirect\supabase\migrations\099_contact_groups_purpose.sql`:

```sql
-- ============================================================
-- Migration 099: Contact groups purpose + default-for-purpose
-- ============================================================
-- Adds `purpose` + `is_default_for_purpose` columns to
-- organization_groups so the AR recipient resolver can prefer
-- group members over legacy customer_billing_emails.
--
-- Backfills 4 default groups for every existing customer:
-- Billing, Operations, Dispatch, Rate Confirmation.
--
-- Part of FU-043 (contact groups email feature).
-- ============================================================

BEGIN;

ALTER TABLE organization_groups
  ADD COLUMN IF NOT EXISTS purpose TEXT;

ALTER TABLE organization_groups
  DROP CONSTRAINT IF EXISTS chk_org_groups_purpose;

ALTER TABLE organization_groups
  ADD CONSTRAINT chk_org_groups_purpose
  CHECK (purpose IS NULL OR purpose IN (
    'billing', 'operations', 'dispatch', 'rate_confirmation', 'management', 'custom'
  ));

ALTER TABLE organization_groups
  ADD COLUMN IF NOT EXISTS is_default_for_purpose BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_groups_default_purpose
  ON organization_groups (tenant_id, organization_id, purpose)
  WHERE is_default_for_purpose = true AND purpose IS NOT NULL;

-- Backfill 4 default groups per existing (non-deleted) organization.
-- NOT EXISTS guard makes this idempotent on re-run.
INSERT INTO organization_groups
  (tenant_id, organization_id, name, purpose, is_default_for_purpose, description)
SELECT
  c.tenant_id,
  c.id,
  defaults.group_name,
  defaults.purpose_value,
  true,
  defaults.default_description
FROM customers c
CROSS JOIN (VALUES
  ('Billing',            'billing',            'Default billing group — receives invoice emails'),
  ('Operations',         'operations',         'Default operations group — receives operational notifications'),
  ('Dispatch',           'dispatch',           'Default dispatch group — receives dispatch notifications'),
  ('Rate Confirmation',  'rate_confirmation',  'Default rate-confirmation group — receives rate con emails')
) AS defaults(group_name, purpose_value, default_description)
WHERE c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM organization_groups g
    WHERE g.tenant_id = c.tenant_id
      AND g.organization_id = c.id
      AND g.purpose = defaults.purpose_value
      AND g.is_default_for_purpose = true
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 3: Apply via Supabase SQL editor**

Paste into Supabase SQL editor. Expected: "Success. No rows returned."

- [ ] **Step 4: Verify**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'organization_groups' AND column_name IN ('purpose', 'is_default_for_purpose');
```

Expected: 2 rows. `purpose` TEXT nullable; `is_default_for_purpose` BOOLEAN NOT NULL with `false` default.

```sql
SELECT purpose, is_default_for_purpose, COUNT(*)
FROM organization_groups
WHERE is_default_for_purpose = true
GROUP BY purpose, is_default_for_purpose;
```

Expected: 4 rows (billing, operations, dispatch, rate_confirmation), each with count = (total non-deleted customers).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add supabase/migrations/099_contact_groups_purpose.sql
git -C C:/Users/bento/app-drayagedirect commit -m "feat(contacts): migration 099 — organization_groups purpose + default + backfill

Adds purpose TEXT (CHECK: billing/operations/dispatch/rate_confirmation/
management/custom) + is_default_for_purpose BOOLEAN to organization_groups.
Partial unique index enforces at-most-one default per (tenant, org, purpose).

Backfills 4 default groups (Billing, Operations, Dispatch, Rate Confirmation)
for every existing non-deleted organization. Idempotent via NOT EXISTS.

Part of FU-043."
```

---

## Phase 2 — API handler updates (3 tasks)

### Task 2: `POST /api/tenant/organizations/[id]/groups` — accept purpose + default + swap

**Files:**
- Modify: `pages/api/tenant/organizations/[id]/groups/index.js`

- [ ] **Step 1: Read the existing POST handler**

Open `C:\Users\bento\app-drayagedirect\pages\api\tenant\organizations\[id]\groups\index.js`. The existing POST destructures `{ name, description, member_ids }` from `req.body`. You'll extend to also read `purpose` + `is_default_for_purpose`.

- [ ] **Step 2: Add purpose + default swap logic**

Find the POST handler block. Replace the request-body destructure + insert block with:

```js
if (req.method === 'POST') {
  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  const {
    name,
    description,
    member_ids,
    purpose,
    is_default_for_purpose,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Group name is required' });

  // Validate purpose if provided
  const validPurposes = ['billing', 'operations', 'dispatch', 'rate_confirmation', 'management', 'custom'];
  if (purpose && !validPurposes.includes(purpose)) {
    return res.status(400).json({ error: `Invalid purpose. Must be one of: ${validPurposes.join(', ')}` });
  }

  // If setting as default for a purpose, unset any existing default first
  // (partial unique index would reject otherwise; also keeps API behavior
  //  matching user intent)
  if (is_default_for_purpose && purpose) {
    const { error: swapErr } = await svc
      .from('organization_groups')
      .update({ is_default_for_purpose: false })
      .eq('tenant_id', ctx.tenantId)
      .eq('organization_id', id)
      .eq('purpose', purpose)
      .eq('is_default_for_purpose', true);
    if (swapErr) {
      return res.status(500).json({ error: `Default swap failed: ${swapErr.message}` });
    }
  }

  const { data: group, error } = await svc
    .from('organization_groups')
    .insert({
      tenant_id: ctx.tenantId,
      organization_id: id,
      name,
      description: description || null,
      purpose: purpose || null,
      is_default_for_purpose: !!is_default_for_purpose,
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Add members if provided
  if (member_ids?.length > 0) {
    await svc.from('organization_group_members').insert(
      member_ids.map((cid) => ({ group_id: group.id, contact_id: cid }))
    );
  }

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'contact_group.create',
    entityType: 'contact_group',
    entityId: group.id,
    newValues: { name, organization_id: id, purpose, is_default_for_purpose },
    ipAddress: getClientIp(req),
    // actorType defaults to 'human' (human-initiated via UI)
  });

  return res.status(201).json({ group: { ...group, members: [], member_count: 0 } });
}
```

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add pages/api/tenant/organizations/[id]/groups/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "feat(contacts): POST /groups accepts purpose + is_default_for_purpose

Extends the group-create API to accept purpose + is_default_for_purpose.
When is_default_for_purpose=true, first unsets any existing default for
the same (tenant, org, purpose) tuple to avoid partial-unique-index
collision.

logTenantAction writes actor_type='human' (default) — user-initiated
via GroupModal UI.

Part of FU-043."
```

---

### Task 3: `PUT /api/tenant/organizations/[id]/groups/[groupId]` — accept purpose + default + swap

**Files:**
- Modify: `pages/api/tenant/organizations/[id]/groups/[groupId]/index.js`

- [ ] **Step 1: Read the existing PUT handler**

Open the file. Note the current UPDATE fields the handler accepts (likely `name`, `description`, maybe members).

- [ ] **Step 2: Extend PUT to accept purpose + default + swap**

In the PUT handler branch, add the same destructure + swap pattern. Critical difference: the swap logic must exclude the group being updated (otherwise updating a group to is_default=true that's ALREADY the default for its purpose would unset itself):

```js
if (req.method === 'PUT') {
  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  const {
    name,
    description,
    purpose,
    is_default_for_purpose,
  } = req.body || {};

  const validPurposes = ['billing', 'operations', 'dispatch', 'rate_confirmation', 'management', 'custom'];
  if (purpose !== undefined && purpose !== null && !validPurposes.includes(purpose)) {
    return res.status(400).json({ error: `Invalid purpose. Must be one of: ${validPurposes.join(', ')}` });
  }

  // Swap logic: if setting default, unset any OTHER group with same purpose as default
  if (is_default_for_purpose && purpose) {
    const { error: swapErr } = await svc
      .from('organization_groups')
      .update({ is_default_for_purpose: false })
      .eq('tenant_id', ctx.tenantId)
      .eq('organization_id', id)
      .eq('purpose', purpose)
      .eq('is_default_for_purpose', true)
      .neq('id', groupId);  // exclude the group we're updating
    if (swapErr) {
      return res.status(500).json({ error: `Default swap failed: ${swapErr.message}` });
    }
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (purpose !== undefined) updates.purpose = purpose || null;
  if (is_default_for_purpose !== undefined) updates.is_default_for_purpose = !!is_default_for_purpose;
  updates.updated_at = new Date().toISOString();

  const { data: updated, error } = await svc
    .from('organization_groups')
    .update(updates)
    .eq('tenant_id', ctx.tenantId)
    .eq('organization_id', id)
    .eq('id', groupId)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'contact_group.update',
    entityType: 'contact_group',
    entityId: groupId,
    newValues: updates,
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ group: updated });
}
```

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add pages/api/tenant/organizations/[id]/groups/[groupId]/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "feat(contacts): PUT /groups/[id] accepts purpose + is_default_for_purpose

Mirror of the POST change with swap logic that excludes the group being
updated (so setting is_default=true on a group that's already the default
doesn't unset itself).

Part of FU-043."
```

---

### Task 4: `POST /api/tenant/organizations/index.js` — auto-seed 4 default groups

**Files:**
- Modify: `pages/api/tenant/organizations/index.js`

- [ ] **Step 1: Find the POST handler**

Open the file and locate the POST handler (the insert into `customers` that creates a new org). It's below the GET handler you read earlier. Find the line where the new org row is returned from `.insert().select().single()`.

- [ ] **Step 2: Add auto-seed after successful org insert**

After the `newOrg` (or whatever the variable is called) is successfully returned from the insert, insert 4 default groups. Place this BEFORE the existing `logTenantAction` call for the org creation (or after — either works, but before is cleaner because it creates the full state before the audit log row is written):

```js
// Auto-seed 4 default groups for the new organization.
// These are empty (no members) until admins populate them.
// actorType='system' because seeding is automation following from
// the human's org-creation action.
const DEFAULT_GROUPS = [
  { name: 'Billing',            purpose: 'billing',            description: 'Default billing group — receives invoice emails' },
  { name: 'Operations',         purpose: 'operations',         description: 'Default operations group — receives operational notifications' },
  { name: 'Dispatch',           purpose: 'dispatch',           description: 'Default dispatch group — receives dispatch notifications' },
  { name: 'Rate Confirmation',  purpose: 'rate_confirmation',  description: 'Default rate-confirmation group — receives rate con emails' },
];

const { error: seedErr } = await svc.from('organization_groups').insert(
  DEFAULT_GROUPS.map((g) => ({
    tenant_id: ctx.tenantId,
    organization_id: newOrg.id,  // replace `newOrg` with the actual variable name from Step 1
    name: g.name,
    purpose: g.purpose,
    is_default_for_purpose: true,
    description: g.description,
  }))
);

if (seedErr) {
  // Non-fatal: the org was created successfully. Log the seed failure
  // and continue. Admin can manually create groups via GroupsTab.
  console.error(`Default-group seed failed for org ${newOrg.id}:`, seedErr.message);
} else {
  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'organization.default_groups_seeded',
    entityType: 'organization',
    entityId: newOrg.id,
    newValues: { groups: DEFAULT_GROUPS.map((g) => g.name) },
    ipAddress: getClientIp(req),
    actorType: 'system',  // auto-seed = system action
  });
}
```

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add pages/api/tenant/organizations/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "feat(contacts): auto-seed 4 default groups on org creation

New organizations get Billing/Operations/Dispatch/Rate Confirmation
default groups auto-seeded (all empty, is_default_for_purpose=true).

Seed is best-effort: failure is logged but doesn't fail the org
creation. Separate logTenantAction records the seed with
actorType='system' (automation following the human's org-creation).

Part of FU-043."
```

---

## Phase 3 — Resolver (1 task, TDD)

### Task 5: `resolveBillingEmails` — add Step 0 (group-aware recipient resolution)

**Files:**
- Modify: `lib/ar/resolve-billing-email.js`
- Create: `tests/ar-resolve-billing-email-groups.test.mjs` (6 cases)

- [ ] **Step 1: Write the failing test file**

Create `C:\Users\bento\app-drayagedirect\tests\ar-resolve-billing-email-groups.test.mjs`:

```js
import { resolveBillingEmails } from '../lib/ar/resolve-billing-email.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Minimal mock Supabase client. Supports .from().select().eq().maybeSingle()
// and chained fallbacks the resolver uses.
function makeMockClient(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      maybeSingle: async () => {
        calls.queries.push({ table, filters: { ...c._filters } });
        const key = table + ':' + JSON.stringify(c._filters);
        // Try exact match first, then table-only fallback
        if (config[key] !== undefined) return { data: config[key], error: null };
        if (config[table] !== undefined) return { data: config[table], error: null };
        return { data: null, error: null };
      },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters } });
        const key = table + ':' + JSON.stringify(c._filters);
        if (config[key] !== undefined) resolve({ data: config[key], error: null });
        else if (config[table] !== undefined) resolve({ data: config[table], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('resolveBillingEmails — Step 0 (group-aware)');

// Case 1: Group with members wins
{
  const svc = makeMockClient({
    organization_groups: {
      id: 'grp-1',
      members: [
        { contact: { email: 'jane@acme.com', is_active: true } },
        { contact: { email: 'billing@acme.com', is_active: true } },
      ],
    },
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-1', 'invoice');
  check('group wins: 2 emails', Array.isArray(result?.to) && result.to.length === 2);
  check('group wins: jane@ present', result?.to?.includes('jane@acme.com'));
  check('group wins: billing@ present', result?.to?.includes('billing@acme.com'));
  check('group wins: source=organization_groups', result?.source === 'organization_groups');
}

// Case 2: Empty group falls through
{
  const svc = makeMockClient({
    // Group exists but has no members
    organization_groups: { id: 'grp-2', members: [] },
    // Fallback Step 1: customer_billing_emails returns 1 match
    customer_billing_emails: [{ email: 'fallback@acme.com' }],
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-2', 'invoice');
  check('empty group: falls through', result?.source !== 'organization_groups');
  check('empty group: source is legacy', result?.source === 'customer_billing_emails');
  check('empty group: returns fallback email', result?.to?.includes('fallback@acme.com'));
}

// Case 3: Members with null emails fall through
{
  const svc = makeMockClient({
    organization_groups: {
      id: 'grp-3',
      members: [
        { contact: { email: null, is_active: true } },
        { contact: { email: '', is_active: true } },
      ],
    },
    customer_billing_emails: [{ email: 'fallback2@acme.com' }],
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-3', 'invoice');
  check('null emails: falls through', result?.source !== 'organization_groups');
}

// Case 4: No default group falls through
{
  const svc = makeMockClient({
    // organization_groups lookup returns null (no default configured)
    organization_groups: null,
    customer_billing_emails: [{ email: 'nogroup@acme.com' }],
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-4', 'invoice');
  check('no default group: falls through', result?.source !== 'organization_groups');
  check('no default group: returns customer_billing_emails', result?.to?.includes('nogroup@acme.com'));
}

// Case 5: rate_confirmation maps to rate_confirmation group
{
  const svc = makeMockClient({
    organization_groups: {
      id: 'grp-5',
      members: [{ contact: { email: 'ratecon@acme.com', is_active: true } }],
    },
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-5', 'rate_confirmation');
  check('rate_confirmation: group wins', result?.source === 'organization_groups');
  check('rate_confirmation: email returned', result?.to?.includes('ratecon@acme.com'));
}

// Case 6: statement maps to billing group (shares billing purpose)
{
  const svc = makeMockClient({
    organization_groups: {
      id: 'grp-6',
      members: [{ contact: { email: 'statement-to-billing@acme.com', is_active: true } }],
    },
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-6', 'statement');
  check('statement: resolves via billing group', result?.source === 'organization_groups');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/ar-resolve-billing-email-groups.test.mjs
```

Expected: FAIL. The existing `resolveBillingEmails` doesn't check `organization_groups` — every Case 1–6 returns the legacy fallback result.

- [ ] **Step 3: Modify `lib/ar/resolve-billing-email.js`**

Open `C:\Users\bento\app-drayagedirect\lib\ar\resolve-billing-email.js`. The existing function starts at line 33 with 4-step chain. Add a new Step 0 BEFORE Step 1.

Find this code near the top of the function:

```js
export async function resolveBillingEmails(svc, tenantId, customerId, emailType) {
  if (!customerId) return { to: [], source: 'none' };

  // Step 1: type-specific active billing emails (array)
  const { data: typed, error: typedErr } = await svc
    .from('customer_billing_emails')
    .select('email')
    .eq('tenant_id', tenantId)
```

Insert Step 0 between the `if (!customerId)` guard and the `// Step 1:` comment:

```js
export async function resolveBillingEmails(svc, tenantId, customerId, emailType) {
  if (!customerId) return { to: [], source: 'none' };

  // Step 0: default organization group for this email purpose.
  // If the organization has a group marked is_default_for_purpose=true
  // with members having emails, those members are the recipients.
  // Falls through to the legacy chain if the group doesn't exist or
  // has no members with emails.
  const purposeByEmailType = {
    invoice: 'billing',
    rate_confirmation: 'rate_confirmation',
    statement: 'billing',  // statements use the billing group (no separate purpose)
  };
  const groupPurpose = purposeByEmailType[emailType];

  if (groupPurpose) {
    const { data: defaultGroup } = await svc
      .from('organization_groups')
      .select('id, members:organization_group_members(contact:organization_contacts(email, is_active))')
      .eq('tenant_id', tenantId)
      .eq('organization_id', customerId)
      .eq('purpose', groupPurpose)
      .eq('is_default_for_purpose', true)
      .maybeSingle();

    if (defaultGroup?.members?.length > 0) {
      const emails = defaultGroup.members
        .map((m) => m.contact?.email)
        .filter((e) => typeof e === 'string' && e.length > 0);
      if (emails.length > 0) {
        return { to: emails, source: 'organization_groups' };
      }
    }
  }

  // Step 1: type-specific active billing emails (array)
  // (existing code unchanged from here)
  const { data: typed, error: typedErr } = await svc
    .from('customer_billing_emails')
    .select('email')
    .eq('tenant_id', tenantId)
```

Keep everything below Step 1 unchanged.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/ar-resolve-billing-email-groups.test.mjs
```

Expected: all 6 cases pass. If any fail, iterate on the resolver (the mock's chainable behavior needs to match the actual resolver's call pattern).

- [ ] **Step 5: Regression check**

```bash
cd C:/Users/bento/app-drayagedirect && for f in tests/*.test.mjs; do [ -f "$f" ] && node "$f" >/dev/null 2>&1 && echo "OK $f" || echo "FAIL $f"; done
```

Expected: every file green (new tests included).

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/ar/resolve-billing-email.js tests/ar-resolve-billing-email-groups.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(contacts): resolveBillingEmails prefers default group members (Step 0)

New Step 0 queries organization_groups for a default-for-purpose group
matching the emailType (invoice->billing, rate_confirmation->rate_confirmation,
statement->billing). If found and the group has members with emails,
those emails are the recipients. Falls through to the existing 4-step
legacy chain on any miss.

6 test cases, all pass. Full suite regression-checked.

Part of FU-043."
```

---

## Phase 4 — UI polish (1 task)

### Task 6: `GroupsTab` — purpose badges + default indicator

**Files:**
- Modify: `components/organizations/tabs/GroupsTab.js`

- [ ] **Step 1: Read the current render logic**

Open `C:\Users\bento\app-drayagedirect\components\organizations\tabs\GroupsTab.js`. Locate the section that renders each group (likely a `.map()` over `groups` producing a card/row per group).

- [ ] **Step 2: Add a purpose-to-color mapping constant at the top of the file**

After the imports, add:

```js
const PURPOSE_BADGE_COLORS = {
  billing:           'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  operations:        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  dispatch:          'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  rate_confirmation: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  management:        'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  custom:            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
};

const PURPOSE_LABELS = {
  billing:           'Billing',
  operations:        'Operations',
  dispatch:          'Dispatch',
  rate_confirmation: 'Rate Con',
  management:        'Management',
  custom:            'Custom',
};
```

- [ ] **Step 3: Add badge + default-indicator rendering inside the group card**

Find the JSX that renders a single group (likely something like `<div className="..." key={group.id}><h3>{group.name}</h3>...`). Add the purpose badge + default star inline with the group name:

```jsx
<div className="flex items-center gap-2">
  <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
    {group.name}
  </h3>
  {group.purpose && (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PURPOSE_BADGE_COLORS[group.purpose] || PURPOSE_BADGE_COLORS.custom}`}>
      {PURPOSE_LABELS[group.purpose] || group.purpose}
    </span>
  )}
  {group.is_default_for_purpose && (
    <span
      className="text-yellow-500 dark:text-yellow-400"
      title="Default group for this purpose"
      aria-label="Default group"
    >
      ⭐
    </span>
  )}
</div>
```

Note: all classes have dark-mode variants per `dev_dark_mode_convention.md`. The emoji star is accessible via `title` + `aria-label`.

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add components/organizations/tabs/GroupsTab.js
git -C C:/Users/bento/app-drayagedirect commit -m "feat(contacts): GroupsTab shows purpose badge + default indicator

Each group row now displays a color-coded purpose badge (green=billing,
blue=rate_con, yellow=ops, orange=dispatch, purple=management, gray=custom)
and a ⭐ when is_default_for_purpose=true.

All classes have dark-mode variants per dev_dark_mode_convention.md.

Part of FU-043."
```

---

## Phase 5 — Ledger + close (1 task)

### Task 7: Close FU-043 + bump MEMORY.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`

- [ ] **Step 1: Get current HEAD SHA**

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

- [ ] **Step 2: Move FU-043 to Recently Resolved**

Open `followups.md`. Find `### FU-043:` in the Open section. Move to `## Recently resolved` with the format:

```markdown
### FU-043: Contact groups email
- Source: (preserve existing)
- Resolved: 2026-04-24 in <SHA from Step 1>
- Area: (preserve)
- Intent: (preserve existing Intent)
- Notes: Shipped via commits 62a9d0c (spec) through <SHA>. Migration 099 enriches organization_groups with purpose + is_default_for_purpose; 4 default groups auto-seed on org creation and backfill existing orgs. resolveBillingEmails gains Step 0 that prefers default-group members over legacy customer_billing_emails fallback. GroupsTab UI shows purpose badges + default indicator. No new email composer modal — invoice + rate-con send UX remains one-click.
```

Preserve the original Intent text verbatim. Just replace the Scope + Area lines with a Resolved line.

- [ ] **Step 3: Bump MEMORY.md audit-line**

Count Open FU entries:

```bash
grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Previous count was 69 (post-B.1d). New count = 68 (FU-043 moved).

Update the audit-line in `MEMORY.md`:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<new SHA>`). 68 open, ~23 recently-resolved.
```

- [ ] **Step 4: Verify**

```bash
grep -nE "^### FU-043" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Expected: 1 match in Recently Resolved section.

- [ ] **Step 5: No commit needed**

Memory files live outside the repo. No `git add`.

- [ ] **Step 6: Final report**

Summarize:
- All 7 tasks completed
- Commit SHAs (Tasks 1-6)
- Tests: new + regression-checked
- Migration 099 applied via Supabase SQL editor (or flagged for manual)
- FU-043 closed in `<SHA>`
- MEMORY.md bumped

---

## Rollout note

After this plan ships:
- Every new organization gets 4 default groups auto-seeded (empty, is_default=true)
- Existing organizations get the same via migration backfill
- Admins populate groups via the existing GroupsTab UI
- Invoice + rate-con sends invisibly pick up group-based recipients when configured
- Falls through to legacy `customer_billing_emails` when groups are empty or not configured — no behavior regression for tenants who haven't migrated

**Deploy order:** migration 099 FIRST, then code deploy. Safe both directions.

## Open questions — addressed by this plan

1. **`POST /api/tenant/organizations/index.js` POST handler location** — Task 4 Step 1 instructs reading the file to locate the POST branch; the spec doesn't hardcode a line number because the file may have evolved.
2. **`newOrg` variable naming** — Task 4 Step 2 calls this out; implementer substitutes the actual variable name.
3. **GroupModal unchanged** — confirmed upfront in the files-touched table; form is ready.
4. **Migration 099 availability** — Task 1 Step 1 verifies.

## Risks during plan execution

1. **Migration backfill is heavy** — creates 4 × (customer count) new rows. Acceptable at current scale. Mitigation: migration wraps in BEGIN/COMMIT; single long transaction is acceptable for a one-time backfill.
2. **Default-swap isn't atomic** — UPDATE (unset existing default) then INSERT/UPDATE (set new default). Brief window where no default exists. Low probability (two admins rarely set the default simultaneously). Mitigation: accept; revisit via stored procedure if needed.
3. **Test mock thenable behavior** — the chain's `then()` implementation must match what the resolver actually does (the real resolver uses `await svc.from(...).select(...).eq(...)` patterns that terminate with `.maybeSingle()`). If the mock doesn't return data as expected, iterate on the mock — not the resolver.
4. **Auto-seed on org creation is best-effort** — if the seed INSERT fails, the org still exists but has no default groups. Admin must create them manually via GroupsTab. Mitigation: Task 4 logs the error; non-fatal to org creation.
