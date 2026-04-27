# FU-111: Charge Sets Invoice FK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Load Detail → Billing tab by adding the missing `order_charge_sets.invoice_id` FK so PostgREST can resolve the nested join.

**Architecture:** Single SQL migration (`106_order_charge_sets_invoice_fk.sql`) adds `FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL` plus a partial index. DDL was already applied live to Supabase via SQL Editor by the user (orphan-count pre-flight returned 0); this plan checks in the migration file so the repo matches the DB, then verifies the endpoint returns 200, then closes FU-111.

**Tech Stack:** Postgres / Supabase / PostgREST / Next.js API routes

---

### Task 1: Create migration file 106

**Files:**
- Create: `supabase/migrations/106_order_charge_sets_invoice_fk.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 106_order_charge_sets_invoice_fk.sql
--
-- FU-111: Add the FK from order_charge_sets.invoice_id to
-- invoices(id). This column has been a plain UUID with no
-- constraint since migration 003, which made
-- pages/api/tenant/loads/[id]/charge-sets/index.js's PostgREST
-- nested join `invoice:invoices!invoice_id(...)` 500 with
-- "Could not find a relationship between 'order_charge_sets'
-- and 'invoices' in the schema cache".
--
-- Pre-flight orphan check (run 2026-04-26): 0 rows. ALTER
-- applies cleanly without data fix-up.
--
-- ON DELETE SET NULL chosen over RESTRICT because the existing
-- rollback paths in pages/api/tenant/ar/invoices/index.js
-- already null out invoice_id before deleting the invoice, so
-- SET NULL matches that lifecycle and is a safety net for any
-- future code path that forgets the manual cleanup. A charge
-- set without an invoice is already a valid state (every
-- charge set starts there).
-- ============================================================

BEGIN;

ALTER TABLE order_charge_sets
  ADD CONSTRAINT order_charge_sets_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_charge_sets_invoice_id
  ON order_charge_sets(invoice_id) WHERE invoice_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Confirm the file exists and matches the live DB**

The DDL has already been applied via Supabase SQL Editor. This step is a paper trail so future fresh-database setups via the migrations folder include the same constraint. No re-apply needed in this task.

---

### Task 2: Verify the endpoint returns 200

**Files:**
- Touch: none (verification only)

- [ ] **Step 1: Dispatch verification subagent**

Spawn an Explore subagent with explicit verification steps:
1. `grep` for `order_charge_sets_invoice_id_fkey` in the migrations folder to confirm migration 106 is in place.
2. Inspect `pages/api/tenant/loads/[id]/charge-sets/index.js` — confirm the PostgREST nested join (`invoice:invoices!invoice_id(...)`) is unchanged (we don't need to change it; the FK alone fixes the bug).
3. Read `lib/tenant-api.js` (or equivalent) to understand whether a non-running-server probe is feasible from the agent's environment, OR confirm that visual verification by the user is the right call.
4. If a service-role probe is feasible, exercise it against an order id known to have charge sets and confirm 200 + correct shape (`charge_sets: [...]`, `invoice` key present, `invoice_locked` flag set).
5. Report: pass/fail with evidence.

Expected: subagent reports the FK exists in migration 106, the endpoint code is unchanged, and (if probe feasible) a 200 response with the expected shape.

- [ ] **Step 2: If subagent verification passes**

Continue to Task 3.

- [ ] **Step 3: If subagent verification fails**

Diagnose with the agent's evidence. Most likely cause if it still 500s: PostgREST schema cache didn't reload despite `NOTIFY pgrst, 'reload schema'`. Mitigation: ask the user to restart Supabase project or wait for the cache TTL.

---

### Task 3: Run the dd-qa skill

**Files:**
- Touch: none (skill invocation)

- [ ] **Step 1: Invoke dd-qa skill**

Per `MEMORY.md` engineering convention, dd-qa runs after any file edit. Migration 106 is a schema edit; run the skill against the diff.

- [ ] **Step 2: Address findings (if any)**

dd-qa is advisory. If it surfaces actual breakage (vs nice-to-haves), fix inline. If only nice-to-haves, log them as new follow-ups in `memory/followups.md`.

---

### Task 4: Update FU-111 in followups.md

**Files:**
- Modify: `C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md`

- [ ] **Step 1: Move FU-111 to the recently-resolved section**

Remove the FU-111 block from the open section. Add it (or a brief one-liner) to whatever recently-resolved section the file uses — match the existing convention.

- [ ] **Step 2: Verify the line counts at the top of MEMORY.md still reflect reality**

`MEMORY.md` says "66 open, ~45 recently-resolved" — bump open by -1, resolved by +1, or update the wording to match what the followups file shows.

---

### Task 5: Commit

**Files:**
- Stage: migration 106, design doc, plan doc, followups update, MEMORY.md count update

- [ ] **Step 1: Stage and commit**

```bash
git add supabase/migrations/106_order_charge_sets_invoice_fk.sql \
        docs/superpowers/specs/2026-04-26-charge-sets-invoice-fk-design.md \
        docs/superpowers/plans/2026-04-26-charge-sets-invoice-fk.md
git add -- "C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md"
git add -- "C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md"

git commit -m "$(cat <<'EOF'
fix(charge-sets): add missing invoice_id FK so Billing tab loads (FU-111)

order_charge_sets.invoice_id has been a plain UUID since migration 003
with no FK to invoices(id). The Load Detail Billing tab API endpoint
does a PostgREST nested join `invoice:invoices!invoice_id(...)`, which
500s on "Could not find a relationship between 'order_charge_sets' and
'invoices' in the schema cache".

Migration 106 adds the FK with ON DELETE SET NULL plus a partial index
on (invoice_id) WHERE invoice_id IS NOT NULL. Pre-flight orphan count
returned 0; DDL applied live via Supabase SQL Editor before this commit.

Resolves: FU-111

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: clean commit, hooks pass.

- [ ] **Step 2: Verify commit landed**

`git log -1 --stat` and confirm all expected files are in the commit.

---

## Self-Review

**Spec coverage:**
- Migration 106 created → Task 1 ✓
- BEGIN/COMMIT wrapper + NOTIFY pgrst → Task 1 step 1 ✓
- ON DELETE SET NULL + partial index → Task 1 step 1 ✓
- Endpoint returns 200 verification → Task 2 ✓
- FU-111 closed → Task 4 ✓
- Repo migration matches DB → Task 1 ✓
- dd-qa run per MEMORY.md convention → Task 3 ✓

**Placeholder scan:** none.

**Type consistency:** constraint name `order_charge_sets_invoice_id_fkey` and index name `idx_charge_sets_invoice_id` consistent across the spec, plan, and migration code block.
