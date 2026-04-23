# AI-Readiness Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a single markdown audit document at `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` that maps the DrayageDirect codebase against per-tenant AI-agent readiness across 6 dimensions, names a single Stream B.1 deep-dive target in the synthesis, and opens one `[ai-ready]` FU entry per identified gap.

**Architecture:** This is a static-analysis + technical-writing task, not a code task. The implementer reads the codebase, runs grep patterns, writes markdown findings per dimension, synthesizes a priority ranking, and opens FU entries. Output is one new markdown file plus FU appendices to `followups.md`. Zero source-code changes.

**Tech Stack:** Read-only tools (Read, Glob, Grep, Bash for `wc`/`ls`). Output is GitHub-flavored markdown. No build step, no tests, no package.json touched. FU numbering continues sequentially from the current ledger max.

**Spec:** [docs/superpowers/specs/2026-04-24-ai-readiness-audit-design.md](docs/superpowers/specs/2026-04-24-ai-readiness-audit-design.md)

**FU number baseline:** Current max is `FU-046` (verified via `grep -oE "FU-[0-9]+" followups.md | sort | tail -1`). The audit will consume FU-047 onward. Likely total: 20–40 new entries; exact count depends on findings.

**Files touched by this plan:**
- **Create:** `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (main deliverable, ~5,000 words)
- **Create:** `docs/superpowers/audits/README.md` (one-time, explaining the audits directory)
- **Modify:** `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (append N new `[ai-ready]` entries)
- **Modify:** `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (new pointer under a new "Audits" section + bump the audit-line)

**Verification mindset:** Every claim in the audit needs a `file_path:line_number` reference. If the implementer can't cite a file:line, they either verified the claim via grep (cite the grep) or shouldn't include the claim. Hand-wavy statements ("most endpoints are UI-coupled") without evidence don't belong in the audit.

---

## Phase 0 — Setup (1 task)

### Task 1: Create audit directory + doc skeleton + directory README

**Files:**
- Create: `C:\Users\bento\app-drayagedirect\docs\superpowers\audits\README.md`
- Create: `C:\Users\bento\app-drayagedirect\docs\superpowers\audits\2026-04-24-ai-readiness-audit.md` (skeleton only; filled in by subsequent tasks)

- [ ] **Step 1: Create the directory**

Run: `mkdir -p "C:/Users/bento/app-drayagedirect/docs/superpowers/audits"`

Expected: directory exists. If already exists (no error), continue.

- [ ] **Step 2: Write the directory README**

Create `C:\Users\bento\app-drayagedirect\docs\superpowers\audits\README.md`:

```markdown
# Audits

Retrospective analyses of the codebase against a specific concern (AI-readiness, security, accessibility, etc.). Each audit is a point-in-time snapshot with `file_path:line_number` references.

Audits are complementary to specs (`../specs/`) and plans (`../plans/`):
- **Specs** describe what we're about to build.
- **Plans** describe how we'll build it.
- **Audits** describe what already exists and where the gaps are.

Each audit filename follows the pattern `YYYY-MM-DD-<topic>-audit.md` and references the git commit SHA it was run against.
```

- [ ] **Step 3: Write the audit-doc skeleton**

Create `C:\Users\bento\app-drayagedirect\docs\superpowers\audits\2026-04-24-ai-readiness-audit.md` with this skeleton. Each `<!-- filled in Task N -->` marker is a placeholder the next tasks will replace. The final audit contains no `<!--` markers.

```markdown
---
name: 2026-04-24-ai-readiness-audit
description: One-time retrospective audit of the DrayageDirect codebase against per-tenant AI-agent-readiness across 6 dimensions. Identifies gaps between current state and future agent runtime requirements, opens one FU entry per gap, and recommends one Stream B.1 deep-dive target in the synthesis.
type: audit
commit_sha: <!-- filled in Task 11 -->
---

# DrayageDirect AI-Readiness Audit

**Run date:** 2026-04-24
**Against commit:** `<!-- filled in Task 11 -->`
**Spec:** `docs/superpowers/specs/2026-04-24-ai-readiness-audit-design.md`
**Plan:** `docs/superpowers/plans/2026-04-24-ai-readiness-audit.md`

## Bottom line (read this first)

<!-- filled in Task 8 -->

---

## 1. API surface

<!-- filled in Task 2 -->

---

## 2. Data schema

<!-- filled in Task 3 -->

---

## 3. State / event spine

<!-- filled in Task 4 -->

---

## 4. Business logic

<!-- filled in Task 5 -->

---

## 5. Rules engine

<!-- filled in Task 6 -->

---

## 6. AI-runtime cross-cutting

<!-- filled in Task 7 -->

---

## Synthesis

<!-- filled in Task 8 -->

---

## Tracked follow-ups (opened by this audit)

<!-- filled in Task 9 -->
```

- [ ] **Step 4: Verify both files exist**

Run: `ls -la "C:/Users/bento/app-drayagedirect/docs/superpowers/audits/"`

Expected: two files listed — `README.md` and `2026-04-24-ai-readiness-audit.md`.

---

## Phase 1 — Dimension analyses (6 tasks)

Each of Tasks 2–7 produces a section of the audit. Each section uses the uniform 6-part format from the spec: **Current state / Future state / Gap / Priority / Dependencies / Tracked follow-ups**. Target ~400–600 words per section. Every claim must cite `file_path:line_number` or a grep command that verifies it.

### Task 2: Dimension 1 — API surface

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (replace `<!-- filled in Task 2 -->` under `## 1. API surface`)

- [ ] **Step 1: Inventory `pages/api/`**

Run these commands and capture their output — you'll use the results to write the section:

```bash
# Total file count per subtree
find C:/Users/bento/app-drayagedirect/pages/api -name "*.js" -type f | sed 's|.*pages/api/||' | awk -F/ '{print $1}' | sort | uniq -c | sort -rn

# Total endpoint count
find C:/Users/bento/app-drayagedirect/pages/api -name "*.js" -type f | wc -l

# Any /api/v*/ versioned prefixes?
find C:/Users/bento/app-drayagedirect/pages/api -type d -name "v*"
```

Expected: ~100-200 endpoint files across admin / auth / cron / driver / tenant / webhooks; zero versioned subdirectories.

- [ ] **Step 2: Sample 10 representative endpoints for deep inspection**

Pick 10 endpoints spanning the subtrees (don't just pick `tenant/*`). Use this Read-first list as a starter; substitute if any file doesn't exist:

```
pages/api/tenant/loads/index.js
pages/api/tenant/loads/[id]/index.js
pages/api/tenant/loads/[id]/assign.js  (if exists)
pages/api/tenant/ar/invoices/[id].js
pages/api/tenant/ar/charge-sets/[id].js
pages/api/admin/tenants/index.js
pages/api/admin/features.js
pages/api/auth/login.js  (or whichever auth entrypoint exists)
pages/api/driver/health.js  (or equivalent)
pages/api/webhooks/sendgrid-delivery.js  (or equivalent)
```

If any of these don't exist, find the closest equivalent via `ls pages/api/<subtree>/`.

For each endpoint read, note:
- Does it have a JSDoc block above the handler? (look for `/**`)
- Does the response include UI-coupled fields (`displayLabel`, `isSelected`, `uiSortKey`, `badgeColor`, `formatted*`, `*Display`)?
- Does the handler perform business logic inline, or does it call into `lib/*`?

- [ ] **Step 3: Grep for UI-coupled response fields across all endpoints**

Run:

```bash
grep -rnE "(displayLabel|isSelected|uiSortKey|badgeColor|formattedTotal|formattedDate|_display|Display:)" C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | wc -l

grep -rnE "(displayLabel|isSelected|uiSortKey|badgeColor)" C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | head -10
```

Capture both the count and the sample of 10 actual matches.

- [ ] **Step 4: Grep for documentation coverage**

Run:

```bash
# Files with at least one JSDoc block
grep -rlE "^\s*/\*\*" C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | wc -l

# Adjacent .md files
find C:/Users/bento/app-drayagedirect/pages/api -name "*.md" | wc -l
```

- [ ] **Step 5: Write the section**

Replace `<!-- filled in Task 2 -->` under `## 1. API surface` with:

```markdown
### Current state

- **Endpoint count:** `<TOTAL>` files across `pages/api/**`, distributed as `<subtree counts from Step 1>` (verified: `find pages/api -name "*.js" | wc -l`).
- **Versioning:** zero `/api/v*/` prefixed subdirectories (verified: `find pages/api -type d -name "v*"` returns empty). All endpoints live under their domain root (e.g., `/api/tenant/loads`).
- **Documentation coverage:** `<FILES_WITH_JSDOC>` of `<TOTAL>` endpoint files have at least one JSDoc block (`<PCT>%`). `<MD_COUNT>` adjacent `.md` contract files exist.
- **UI coupling in responses:** grep across all handlers finds `<UI_COUPLED_COUNT>` lines matching UI-specific field patterns. Sample: `<file:line>`, `<file:line>`, `<file:line>` (pick 3 representative from Step 3 output).
- **Business-logic-inline vs. lib-delegated:** from the 10-endpoint sample, `<N>` of 10 delegate to `lib/*` helpers; `<M>` of 10 perform non-trivial business logic inline (cite specific handlers).
- **Representative handler shape:** most endpoints in `pages/api/tenant/**` follow the pattern "parse `req.body` → RBAC check via `lib/permissions.js` → Supabase query with `tenant_id` scoping → return result." (Cite 2–3 example files.)

### Future state (what AI agents will need)

- A **versioned, stable API surface** (`/api/v1/*`) that agent runtimes can bind against without breaking when UI screens change.
- **Documented request/response contracts** per endpoint — either JSDoc, OpenAPI, or adjacent `.md` — agents need machine-readable schemas for tool registration.
- **Canonical domain responses** (stripped of UI scaffolding) so agents consume the same data format regardless of which UI screen is calling.
- **Handler → library delegation** everywhere, so the same business logic is reachable from an agent runtime without going through HTTP.
- Per-endpoint **permission semantics** exposed as metadata (what RBAC roles can call it, what actions it performs, what it mutates).

### Gap

- No versioned prefix today. Full refactor to `/api/v1/*` is a breaking change for the UI unless done with aliasing.
- JSDoc coverage is `<PCT>%` — most handlers are undocumented or covered only by variable naming.
- `<UI_COUPLED_COUNT>` UI-coupling hits across the surface means a non-trivial fraction of responses would need canonical-shape alternatives for agent consumers.
- `<M>/10` sampled endpoints have business logic inline; agents can't reach that logic except via HTTP.
- No endpoint metadata registry exists (no single source of "what does each endpoint do, what RBAC, what side effects?").

### Priority

**<H/M/L>** — reasoning: AI agents have zero path to the system without a stable API surface; this is either the first or second thing Stream B.1 must produce. Effort is large (rewriting or aliasing every endpoint) but can be phased.

### Dependencies

- API response canonicalization depends on the data-schema audit (Dim 2) — the canonical shape is the schema's first-class entity shape.
- Handler → library extraction overlaps with the business-logic audit (Dim 4) — findings will correlate.

### Tracked follow-ups

- `<FU-XXX>` — Versioning strategy and `/api/v1/*` aliasing plan
- `<FU-XXX>` — JSDoc / OpenAPI contract coverage for top-20 most-called endpoints
- `<FU-XXX>` — Canonical response shapes for agent consumers
- `<FU-XXX>` — Endpoint metadata registry (RBAC, side effects, mutation targets)
- (FU numbers allocated in Task 9; leave as `<FU-XXX>` placeholders for now)
```

Fill in the `<ALL_CAPS>` placeholders with actual numbers/examples from Steps 1–4. Leave `<FU-XXX>` markers — Task 9 replaces these.

- [ ] **Step 6: Verify the section is present and has no other `<!--` placeholders for Task 2**

Run: `grep -n "filled in Task 2" "C:/Users/bento/app-drayagedirect/docs/superpowers/audits/2026-04-24-ai-readiness-audit.md"`

Expected: no matches (the placeholder has been replaced).

---

### Task 3: Dimension 2 — Data schema

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (replace `<!-- filled in Task 3 -->` under `## 2. Data schema`)

- [ ] **Step 1: Inventory migrations**

Run:

```bash
# Count and chronological sample
ls C:/Users/bento/app-drayagedirect/supabase/migrations/*.sql | wc -l
ls C:/Users/bento/app-drayagedirect/supabase/migrations/ | head -5
ls C:/Users/bento/app-drayagedirect/supabase/migrations/ | tail -5
```

Expected: ~95 migrations. Note the earliest and latest numbered migrations.

- [ ] **Step 2: Identify canonical entities**

Grep for all CREATE TABLE statements across migrations:

```bash
grep -rnE "^CREATE TABLE" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql" | head -50
```

Record the list of table names. Group them by domain area (loads/orders, billing/AR, drivers, organizations, rules, etc.).

- [ ] **Step 3: Check audit-trail coverage**

Grep for `*_history`, `*_audit`, `*_log` tables:

```bash
grep -rnE "^CREATE TABLE.*(_history|_audit|_log|_events)" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql"
```

For each state-bearing table identified in Step 2 (tables with a `status` column), note whether a corresponding history/audit table exists.

```bash
# Find tables with status columns
grep -rnB1 "status" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql" | grep -E "CREATE TABLE|ADD COLUMN.*status" | head -20
```

- [ ] **Step 4: Enum vs lookup-table ratio**

Count hardcoded enums vs reference data tables:

```bash
# Hardcoded enum types
grep -rcE "^CREATE TYPE.*AS ENUM" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql" | awk -F: '{sum += $2} END {print sum}'

# Tenant-scoped lookup tables (proxy: tables with tenant_id + name/label columns that look like reference data)
grep -rlE "tenant_id" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql" | xargs grep -lE "CREATE TABLE.*(types|sizes|codes|categories|tags|statuses)" | wc -l
```

- [ ] **Step 5: Agent-friendly naming sample**

Pick 3 recent migrations (e.g., the last 3 numbered). Read each. Score each newly-added column:
- **Agent-friendly** — name conveys purpose (`dispatch_priority`, `detention_reason_code`)
- **Workable** — name conveys domain (`container_size`, `pickup_time`)
- **Opaque** — name is a flag/number/misc (`flag_1`, `misc_data`, `extra_jsonb`, `tmp_col`)

Report the ratio.

- [ ] **Step 6: Write the section**

Replace `<!-- filled in Task 3 -->` with:

```markdown
### Current state

- **Migration count:** `<N>` total migrations (`001_*` through `<HIGHEST>_*`), spanning approximately `<time span inferred from earliest migration>` to 2026-04. (Verified: `ls supabase/migrations/*.sql | wc -l`)
- **Canonical entities:** approximately `<E>` tables grouped as:
  - Loads/orders: `orders`, `order_charge_sets`, `order_driver_pay_lines`, `<...>`
  - Billing/AR: `<list>`
  - Drivers: `<list>`
  - Organizations: `<list>`
  - Routing: `<list>`
  - Rules/reference: `<list>`
- **Audit-trail coverage:** `<X>` tables with `status` or state columns; of those, `<Y>` have a corresponding `*_history` or `*_audit` table (`<PCT>%` coverage). Examples of state tables WITHOUT audit trails: `<table:migration>`, `<table:migration>`, `<table:migration>`.
- **Enum vs lookup-table ratio:** `<ENUM_COUNT>` hardcoded enum types vs `<LOOKUP_COUNT>` tenant-scoped reference tables. (Enums block tenant-level customization; lookup tables permit it.)
- **Naming quality (sample of 3 recent migrations):** `<AGENT>` agent-friendly / `<WORKABLE>` workable / `<OPAQUE>` opaque out of `<TOTAL_SAMPLED>` columns. (Cite 2 examples of opaque names.)

### Future state (what AI agents will need)

- A **schema catalog** agents can read to understand the domain — ideally machine-generated from the live schema.
- **Complete audit trails** for every state-bearing entity so an agent can answer "what was X's state on Y date?"
- **Tenant-extensible reference data** — hardcoded enums should become lookup tables with `tenant_id` so agents can respect tenant-specific vocabularies.
- **Agent-friendly column names** — when an agent reads `detention_reason_code`, it should be able to infer what the field is without reading the schema docs.
- **Canonical entity IDs with stable references** (already largely true — UUIDs everywhere) — no regression concerns here.

### Gap

- No machine-readable schema catalog today. The spec `feature_rules_engine.md` etc. describe entities informally, but nothing agents can parse.
- `<PCT>%` audit-trail coverage means many state-bearing entities have no history.
- `<ENUM_COUNT>` hardcoded enums block tenant customization.
- A fraction of columns use opaque names (cite 1–2).

### Priority

**<H/M/L>** — reasoning: `<reason>`. Data schema is typically more stable than API surface, so retrofit cost is moderate if deferred. However, audit-trail gaps compound with every new state entity added.

### Dependencies

- Audit-trail completion overlaps with State/event spine (Dim 3) — a single event-emission layer could close both gaps simultaneously.
- Schema catalog generation could block on API versioning decisions (Dim 1) — they may share format.

### Tracked follow-ups

- `<FU-XXX>` — Machine-readable schema catalog (autogenerated from live schema)
- `<FU-XXX>` — Audit-trail gap closure for `<specific tables>`
- `<FU-XXX>` — Migrate `<N>` hardcoded enums to tenant-scoped lookup tables
- `<FU-XXX>` — Rename opaque columns `<list>`
- (FU numbers allocated in Task 9)
```

---

### Task 4: Dimension 3 — State / event spine

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (replace `<!-- filled in Task 4 -->` under `## 3. State / event spine`)

- [ ] **Step 1: Catalog state-write locations**

Run:

```bash
# All Supabase .update() calls with status-column writes
grep -rnE "\.update\(\s*\{[^}]*status" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | head -30

# Count total
grep -rnE "\.update\(\s*\{[^}]*status" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | wc -l
```

Record file paths + line numbers of the first 20 matches.

- [ ] **Step 2: Find triggers (DB-level state propagation)**

```bash
grep -rnE "(CREATE|REPLACE) (TRIGGER|FUNCTION)" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql" | head -30
```

Record which state transitions already have DB-level trigger logic (if any).

- [ ] **Step 3: Find side-effect-triggering code**

Common patterns in DrayageDirect:
- Status transition → auto-create charge set (grep for `charge_sets.*insert|insert.*charge_sets`)
- Status transition → auto-send email (grep for `sendEmail|dispatchEmail|triggerEmail` near status-update code)
- Status transition → auto-update downstream (grep for `.update(` clustered near status transitions)

Run:

```bash
# Auto-charge-set patterns
grep -rnE "charge_sets.*insert|insert.*charge_sets" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | head -10

# Email dispatch near state changes
grep -rnE "(sendEmail|dispatchEmail|triggerEmail)" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | head -10
```

List 3–5 concrete "transition X triggers side effect Y" findings with file:line refs.

- [ ] **Step 4: Duplicate transition paths**

From Step 1's output, identify any entity (loads, invoices, charge_sets, etc.) whose status is updated from more than one file. If `orders.status = 'completed'` is written from 3 different locations, that's a duplicate-transition flag.

Group Step 1's output by entity and count locations per entity.

- [ ] **Step 5: Write the section**

Replace `<!-- filled in Task 4 -->` with:

```markdown
### Current state

- **State-write locations:** `<TOTAL>` distinct `.update({ status: ... })` call sites across `lib/` and `pages/api/` (verified: grep `.update(.*status`). Top-20 locations cited below:
  - `orders` status: `<N>` locations — e.g., `pages/api/tenant/loads/[id]/index.js:<line>`, `<file:line>`, `<file:line>`
  - `order_charge_sets` status: `<N>` locations — e.g., `<file:line>`, `<file:line>`
  - `ar_invoices` status: `<N>` locations
  - (etc. for each state-bearing entity)
- **DB-level triggers:** `<Y>` trigger/function definitions in migrations (verified: grep `CREATE TRIGGER|CREATE FUNCTION`). Notable: `<trigger name>` propagates `<X>` to `<Y>`.
- **Side-effect catalog** (transition → effect):
  - `orders.status = 'accepted'` → auto-creates initial charge set via `<file:line>`
  - `orders.status = 'completed'` → triggers rate-con email via `<file:line>` (or: "no automatic email currently")
  - `ar_invoices.status = 'sent'` → writes `sent_at` timestamp, dispatches SendGrid email
  - (list 3–5 concrete examples)
- **Duplicate transition paths:** `<COUNT>` entities have status-update paths from 2+ locations. Most notable: `<entity>` is updated from `<N>` places (list them).

### Future state (what AI agents will need)

- A **canonical event spine** where every state transition emits a structured event (`load.status.changed`, `invoice.status.changed`, `charge_set.status.changed`, etc.) with a stable payload shape.
- Events include: `entity_id`, `tenant_id`, `from_state`, `to_state`, `actor_id`, `actor_type` (human / system / agent), `caused_by` (causative event if any), `side_effects_triggered` (what else changed).
- **Event subscription API** so agents (and downstream systems) can react to state changes without polling.
- **At-least-once delivery** guarantees with an outbox pattern.
- **Dry-run mode** on state transitions so agents can preview "if I accept this load, what cascades?"

### Gap

- No event spine today. Every state transition is a point-write with no signal to downstream consumers.
- Duplicate transition paths mean a future event spine has to be added at every one of them, OR the paths need centralizing first.
- No outbox / event queue infrastructure. (Closest existing pattern: `pages/api/webhooks/*` for incoming events; no outbound event bus.)
- Dry-run pattern exists for specific features (`lib/dry-run-engine.js`, `feature_load_margin.md` dry-run toggle) but isn't a general capability for state transitions.

### Priority

**<H/M/L>** — reasoning: State/event spine is the single highest-leverage gap. Most agent use cases ("when load X transitions to Y, do Z") depend on event-driven execution. Effort is large (N transition points need emitters), but the design is well-understood (outbox pattern).

### Dependencies

- **Unblocks:** subscription-style agent triggers, audit-trail completion (Dim 2), real-time observability (Dim 6 cross-cutting).
- **Depends on:** centralizing duplicate transition paths first (a pre-requisite refactor).

### Tracked follow-ups

- `<FU-XXX>` — Design canonical event shape + emit-from-where decision (**candidate Stream B.1 target**)
- `<FU-XXX>` — Centralize `<entity>` status-update (currently updated from `<N>` locations)
- `<FU-XXX>` — Outbox pattern / event bus selection
- `<FU-XXX>` — General dry-run capability on state transitions
- (FU numbers allocated in Task 9)
```

---

### Task 5: Dimension 4 — Business logic

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (replace `<!-- filled in Task 5 -->` under `## 4. Business logic`)

- [ ] **Step 1: Find hardcoded business-rule patterns**

Rules-engine files (exclude from the search — these are where rules SHOULD live):
`lib/tariff-engine.js`, `lib/driver-tariff-engine.js`, `lib/charge-profile-*.js`, `lib/driver-charge-profile-*.js`, `lib/routing-rules.js`, `lib/ar-rule-definitions.js`, `lib/condition-evaluator.js`, `lib/dry-run-engine.js`, `lib/advanced-route-matcher.js`, `lib/advanced-route-validator.js`.

Run:

```bash
# Hardcoded commodity-based conditions outside rules engines
grep -rnE "commodity\s*===" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" --exclude="tariff-engine.js" --exclude="driver-tariff-engine.js" --exclude="charge-profile-*.js" --exclude="driver-charge-profile-*.js" --exclude="routing-rules.js" --exclude="ar-rule-definitions.js" --exclude="condition-evaluator.js" --exclude="dry-run-engine.js" --exclude="advanced-route-matcher.js" --exclude="advanced-route-validator.js" | head -10

# Hardcoded customer-based conditions
grep -rnE "customer(Id|_id|Name)\s*===?\s*['\"]" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | head -10

# Pricing/surcharge magic numbers (literal numbers with comparison)
grep -rnE "(surcharge|fee|rate|charge|total)\s*[+\-*/]=\s*[0-9]+" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | head -10
```

- [ ] **Step 2: Find tenant-specific branches (CRITICAL — this is also a multi-tenant correctness issue)**

```bash
grep -rnE "tenant(Id|_id)\s*===?\s*['\"]" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js"
```

Any non-zero hit here is a critical finding — it's a correctness bug, not just an AI-readiness gap. Elevate in priority.

- [ ] **Step 3: Find magic numbers in pricing/routing**

```bash
# Day/hour thresholds
grep -rnE "days?\s*>\s*[0-9]+|hours?\s*>\s*[0-9]+" C:/Users/bento/app-drayagedirect/lib --include="*.js" | grep -v ".test." | head -10

# Dollar/amount thresholds
grep -rnE "amount\s*>\s*[0-9]+|total\s*>\s*[0-9]+|cents\s*>\s*[0-9]+" C:/Users/bento/app-drayagedirect/lib --include="*.js" | grep -v ".test." | head -10
```

- [ ] **Step 4: Classify findings**

For each hardcoded rule found, tag it as one of:
- **MOVE NOW:** Rules engine (tariff / charge-profile / driver-pay / routing) already supports this shape. Low-effort move.
- **ENGINE EXTENSION:** Rules engine needs a new operator / condition / action to express this.
- **TOO IRREGULAR:** Nested conditions with side effects; stays as code for now.

- [ ] **Step 5: Write the section**

Replace `<!-- filled in Task 5 -->` with:

```markdown
### Current state

- **Hardcoded business rules outside rules engines:** `<TOTAL>` distinct conditional patterns found. Breakdown:
  - Commodity-based conditions: `<N>` (examples: `<file:line>`, `<file:line>`)
  - Customer-specific conditions: `<N>` (examples: `<file:line>`)
  - Surcharge/fee magic numbers: `<N>` (examples: `<file:line>: amount += 250`, `<file:line>: surcharge *= 1.5`)
- **Tenant-specific hardcoded logic:** `<N>` matches for `tenantId ===` / `tenant_id ===`. `<N == 0 ? "CLEAN" : "CRITICAL — multi-tenant correctness risk">`. (Verified: grep `tenant(Id|_id)\s*===`.)
- **Magic-number thresholds:** `<N>` day/hour comparisons, `<M>` dollar/amount comparisons. Examples: `<file:line>: if (days > 14)`, `<file:line>: if (cents > 50000)`.
- **Classification:**
  - MOVE NOW (rules engine supports the shape): `<N>` rules
  - ENGINE EXTENSION (new rule type needed): `<N>` rules
  - TOO IRREGULAR (stays as code): `<N>` rules

### Future state (what AI agents will need)

- All business rules **externalized** into the rules engine so agents can read the current rule set and reason about outcomes.
- **Declarative rule schema** (operator + condition + action) so rules are machine-parseable.
- **Tenant-extensible rules** — every rule bound to a `tenant_id` so customers can customize without code changes.
- **Zero tenant-specific hardcoded branches** — multi-tenant correctness independent of AI readiness.
- **Thresholds and magic numbers** pulled from tenant config, not code.

### Gap

- `<TOTAL>` hardcoded rules need migration. `<MOVE_NOW_COUNT>` can move today; the rest wait on rules-engine extensions.
- Tenant-specific hardcoded branches: `<N>`. If non-zero, this is a P0 correctness bug — flag regardless of AI readiness.
- Magic numbers should become tenant config entries but no systematic pattern exists for introducing new tenant-config fields.

### Priority

**<H/M/L>** — reasoning: `<reason>`. If tenant-specific hardcoded branches exist, this jumps to CRITICAL. Otherwise, this is a slow-leak category — each new hardcoded rule added is one more future-migration cost.

### Dependencies

- MOVE-NOW rules can be migrated independently; no infrastructure blocker.
- ENGINE-EXTENSION rules depend on rules-engine capability additions (Dim 5).
- Tenant-config magic-number extraction has no dependency; needs a config-pattern decision.

### Tracked follow-ups

- `<FU-XXX>` — Migrate `<MOVE_NOW_COUNT>` "move-now" hardcoded rules to rules engines
- `<FU-XXX>` — Rules-engine extension design for `<engine-ext categories>`
- `<FU-XXX>` — Extract `<MAGIC_COUNT>` magic numbers to tenant config
- `<FU-XXX>` — [IF non-zero] **CRITICAL**: Remove tenant-specific hardcoded branches in `<file:line>`, `<file:line>`
- (FU numbers allocated in Task 9)
```

---

### Task 6: Dimension 5 — Rules engine

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (replace `<!-- filled in Task 6 -->` under `## 5. Rules engine`)

- [ ] **Step 1: Read the rules-engine files**

Read these files to understand shape:
- `lib/tariff-engine.js`
- `lib/driver-tariff-engine.js`
- `lib/charge-profile-constants.js` + `lib/charge-profile-row-shapes.js`
- `lib/driver-charge-profile-constants.js`
- `lib/routing-rules.js`
- `lib/ar-rule-definitions.js`
- `lib/condition-evaluator.js`
- `lib/dry-run-engine.js`
- `lib/advanced-route-matcher.js` + `lib/advanced-route-validator.js`

For each, note:
- What rule shape does it accept? (operator types, condition inputs, action outputs)
- Declarative (JSON-describable) vs executable (code / function)?
- Does it have a dry-run mode?
- Does it have side effects during evaluation (DB writes, email sends)?

- [ ] **Step 2: Check for declarative rule storage in DB**

Grep migrations for tables that store rules:

```bash
grep -rnE "CREATE TABLE.*(rule|tariff|profile|pricing)" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql" | head -10
```

For each rules table found, note:
- Is the rule body a structured JSON column, or a raw SQL/JS string?
- Are operators/conditions stored as discrete columns or blobbed?

- [ ] **Step 3: Check for rule schema documentation**

```bash
find C:/Users/bento/app-drayagedirect -name "*.md" -path "*/docs/*" | xargs grep -l "operator\|condition\|rule" 2>/dev/null | head -5

# Also check memory files
ls C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/feature_rules*.md C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/feature_tariff*.md C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/feature_charge*.md C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/feature_driver*.md 2>/dev/null
```

- [ ] **Step 4: Write the section**

Replace `<!-- filled in Task 6 -->` with:

```markdown
### Current state

- **Engine inventory (per domain):**
  - **Tariff engine** (`lib/tariff-engine.js`, `<LOC>` lines) — rule shape: `<describe: what operators, what conditions, what actions>`. Declarative: `<Y/N>`. Dry-run: `<Y/N>`. Pure evaluator: `<Y/N>`.
  - **Driver tariff engine** (`lib/driver-tariff-engine.js`) — `<describe>`.
  - **Charge profile engine** (`lib/charge-profile-constants.js` + `lib/charge-profile-row-shapes.js` + `lib/driver-charge-profile-constants.js`) — `<describe>`.
  - **Routing rules** (`lib/routing-rules.js`, `lib/advanced-route-matcher.js`, `lib/advanced-route-validator.js`) — `<describe>`.
  - **AR rules** (`lib/ar-rule-definitions.js`) — `<describe>`.
  - **Condition evaluator** (`lib/condition-evaluator.js`) — general-purpose operator applicator? Feeds into which engines?
  - **Dry-run engine** (`lib/dry-run-engine.js`) — what does this actually dry-run? See `feature_dry_run.md` / `session_2026_04_22_dry_run_ship.md`.
- **DB rule storage:** `<N>` tables store rules (`<list: table:migration>`). Rule bodies stored as: `<JSON columns / SQL strings / JS function refs>`.
- **Schema documentation:** rule shape described in `<list of docs: feature_rules_engine.md, feature_tariffs_charges.md, feature_driver_charge_profiles.md>`. Not machine-readable.
- **Dry-run coverage:** `<N>` of the engines support a pure "what would happen" mode. (Names the ones that do.)
- **Evaluator purity:** `<N>` engines have side-effect-free evaluation; `<M>` have side effects during evaluation.

### Future state (what AI agents will need)

- **Declarative rule schemas** (JSON/YAML) for every engine so agents can read a tenant's active rule set.
- **Exportable-per-tenant** — given a `tenant_id`, an agent can fetch "all tariff rules that apply to you."
- **Pure evaluators** — agents need deterministic rule evaluation for "dry-run what would this rule produce on input X" without triggering side effects.
- **Unified rule language** — across engines, operators and conditions should share vocabulary (same way `equals` / `contains` / `between` works in all of them).
- **SOP-compatibility** — the rule structure should be extensible to represent "when X situation, perform Y sequence of actions" (a.k.a. SOPs), not just "when X, charge Y."

### Gap

- `<N>` engines are executable-code-based, not declarative. Agents can't read those rules.
- Rule storage format varies across engines (JSON blob, SQL string, JS function). No unification.
- Schema docs exist in memory files but aren't machine-parseable.
- Dry-run coverage is partial (`<fraction>`).
- Rule language is NOT unified across engines — `operator` terminology differs between tariff and charge-profile engines.
- No SOP-shape work yet. SOPs are a natural extension of the rules-engine mental model but would need engine-level abstraction to work cleanly.

### Priority

**<H/M/L>** — reasoning: The rules engine is where AI agents do the most useful work (reading rules to plan actions). Gap here is mostly about consolidation — existing engines largely work, but they need declarative-export + vocabulary unification + SOP extensibility.

### Dependencies

- SOP schema design (Dim 6 cross-cutting) depends on rules-engine declarative shape.
- API exposure of rule sets (Dim 1) depends on a canonical rule serialization.

### Tracked follow-ups

- `<FU-XXX>` — Declarative rule schema design (unified across engines)
- `<FU-XXX>` — Per-tenant rule export API
- `<FU-XXX>` — Evaluator purity audit + split evaluation-vs-application
- `<FU-XXX>` — Vocabulary unification across engines (operator/condition/action)
- `<FU-XXX>` — SOP-shape design (Stream C seed, but rule structure pre-work)
- (FU numbers allocated in Task 9)
```

---

### Task 7: Dimension 6 — AI-runtime cross-cutting

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (replace `<!-- filled in Task 7 -->` under `## 6. AI-runtime cross-cutting`)

- [ ] **Step 1: Feature-flag infrastructure**

Read to understand how tiered features are gated today:
- `lib/permissions.js` — RBAC
- `lib/rbac.js` — permission definitions
- `pages/api/admin/features.js` — admin-level feature flags
- Memory: `feature_branches.md`, `project_email_sender_architecture.md`, `project_resilience_plan.md`

```bash
# Feature-flag-like column patterns in migrations
grep -rnE "enable_|has_access|is_enabled|feature_" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql" | head -15

# Permission checks
grep -rnE "hasPermission|canAccess|isEnabled" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | head -10
```

Determine: is there a consistent "per-tenant feature-flag" pattern, or does every feature roll its own?

- [ ] **Step 2: Audit / log infrastructure**

```bash
# Audit log tables
grep -rnE "CREATE TABLE.*(audit|log|event)" C:/Users/bento/app-drayagedirect/supabase/migrations --include="*.sql"

# Audit function/helpers
grep -rnE "logAudit|auditLog|recordEvent" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | head -10

# Specific known helpers per memory
ls C:/Users/bento/app-drayagedirect/lib/admin-audit.js C:/Users/bento/app-drayagedirect/lib/tenant-audit.js 2>/dev/null
```

Identify the best "landing spot" for future intent/outcome logs.

- [ ] **Step 3: Rate limiting / quota infrastructure**

```bash
grep -rlE "rateLimit|throttle|quota|cooldown" C:/Users/bento/app-drayagedirect/lib C:/Users/bento/app-drayagedirect/pages/api 2>/dev/null
```

If no hits, note the absence.

- [ ] **Step 4: Observability hooks**

Read `pages/api/webhooks/*` and `pages/api/cron/*` to see what operational patterns exist for "something happened, tell someone." Also check `lib/resilience/` per the Tier-0 resilience plan.

- [ ] **Step 5: Write the section**

Replace `<!-- filled in Task 7 -->` with:

```markdown
### Current state

- **Feature-flag infrastructure:**
  - RBAC is defined in `lib/rbac.js` and `lib/permissions.js`. Per-role permissions map granularly to endpoints.
  - Per-tenant feature flags: `<describe — is there a `tenant_features` table, or are flags bolted onto the `tenants` table directly?>` Examples: `<col or table>`, `<col or table>`.
  - Admin-level flag management lives at `pages/api/admin/features.js` — used for `<describe>`.
  - Tiered features already shipped: branches (`feature_branches.md`), email sender tiers (`project_email_sender_architecture.md`), resilience tiers (`project_resilience_plan.md`). Pattern: each gate is a boolean column on `tenants`.
- **Audit / log infrastructure:**
  - Audit-log tables: `<list from migration grep>`.
  - Generic audit helpers: `lib/admin-audit.js`, `lib/tenant-audit.js`. Shape: `<describe what they log>`.
  - Event-shaped logs: `<none / partial — describe>`.
- **Rate limiting / quota:** `<PRESENT / ABSENT>`. If absent, note for Stream C design.
- **Observability:**
  - Resilience / error tracking: `lib/resilience/` per Tier-0 plan.
  - Webhooks (incoming events): `pages/api/webhooks/*` — used for SendGrid delivery, etc.
  - Cron: `pages/api/cron/*` — scheduled jobs.

### Future state (what AI agents will need)

- A **per-tenant "AI agents enabled" feature flag** that slots into the existing tiered-features pattern (one boolean on `tenants`).
- A **per-tenant AI configuration table** (active SOPs, allowed-action whitelist, escalation thresholds, rate caps).
- **Intent / outcome logging** — "agent wanted to do X, attempted Y via Z, got W, took N ms, cost M tokens." Enables operational oversight and cost attribution.
- **SOP schema storage** — live next to rules-engine tables, queryable by tenant.
- **Agent rate limiting / cost caps** — prevent a runaway agent from racking up huge LLM bills.
- **Real-time observability** — dashboard of recent agent actions per tenant, last-seen error, open disputes.

### Gap

- No dedicated AI-flag pattern today. Existing feature-flag pattern (boolean column on `tenants`) will extend naturally.
- No AI-configuration table. Needs design from scratch.
- No intent/outcome log. `tenant_audit` is the closest starting point but doesn't carry agent-specific semantics.
- SOP schema storage — entirely new.
- Rate limiting — entirely new.
- Observability dashboard — builds on existing admin dashboards (`pages/admin/*`).

### Priority

**<H/M/L>** — reasoning: This dimension is mostly "net-new infrastructure" rather than "retrofit existing." Feature-flag extension is trivially deferrable; observability / rate limiting / intent log are what Stream C's agent runtime needs on day one.

### Dependencies

- Intent/outcome log depends on the event spine (Dim 3) — share the infrastructure.
- SOP schema depends on rules-engine declarative shape (Dim 5).
- Rate limiting can be independent.

### Tracked follow-ups

- `<FU-XXX>` — Per-tenant AI-enabled feature flag (column on `tenants`)
- `<FU-XXX>` — AI configuration table design (SOPs, allowed actions, thresholds)
- `<FU-XXX>` — Intent/outcome log design (extends `tenant_audit` or new table)
- `<FU-XXX>` — SOP schema storage design
- `<FU-XXX>` — Agent rate limiting / cost cap infrastructure
- `<FU-XXX>` — Agent observability dashboard (admin-side)
- (FU numbers allocated in Task 9)
```

---

## Phase 2 — Synthesis (1 task)

### Task 8: Priority matrix + dependency graph + B.1 recommendation + bottom-line

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (replace `<!-- filled in Task 8 -->` under `## Synthesis` AND under `## Bottom line (read this first)`)

- [ ] **Step 1: Score each dimension**

Review Tasks 2–7's output. For each of the 6 dimensions, assign:
- Priority (H / M / L) — already assigned in each section, collect them
- Agent-impact (H / M / L) — how much does this unblock for AI agents?
- Cost-of-delay (H / M / L) — how much more expensive is retrofit later vs. now?
- Effort bucket (S / M / L / XL) — rough build size

- [ ] **Step 2: Build dependency graph**

Walk through each dimension's "Dependencies" subsection. Draw text graph of "X unblocks Y" relationships.

- [ ] **Step 3: Identify single Stream B.1 target**

The B.1 target is the infrastructure piece with the highest (agent-impact × cost-of-delay) / effort ratio AND the most downstream-unblocking.

Based on general patterns (confirm against your audit findings): the event spine (Dim 3) typically wins because:
- Most agent use cases are event-driven
- Audit trails (Dim 2) and intent logs (Dim 6) can share infrastructure
- API stability (Dim 1) is valuable but can be achieved via aliasing without rebuilding — lower cost-of-delay

If your audit findings contradict this, pick what the data says instead. Do not force the event spine recommendation if findings don't support it.

- [ ] **Step 4: Write the Synthesis section**

Replace `<!-- filled in Task 8 -->` under `## Synthesis` with:

```markdown
### Priority matrix

| # | Dimension | Priority | Agent-impact | Cost-of-delay | Effort |
|---|---|---|---|---|---|
| 1 | API surface | `<H/M/L>` | `<H/M/L>` | `<H/M/L>` | `<S/M/L/XL>` |
| 2 | Data schema | `<...>` | `<...>` | `<...>` | `<...>` |
| 3 | State / event spine | `<...>` | `<...>` | `<...>` | `<...>` |
| 4 | Business logic | `<...>` | `<...>` | `<...>` | `<...>` |
| 5 | Rules engine | `<...>` | `<...>` | `<...>` | `<...>` |
| 6 | AI-runtime cross-cutting | `<...>` | `<...>` | `<...>` | `<...>` |

### Dependency graph

```text
<draw actual graph here based on findings; example shape — update to match audit>

Event spine (Dim 3) ──┬──> Audit-trail completion (Dim 2)
                      ├──> Intent/outcome log (Dim 6)
                      └──> API canonical-response shape (Dim 1)

Rules-engine declarative export (Dim 5) ──┬──> SOP schema (Dim 6)
                                          └──> Business-logic migration (Dim 4)

AI-enabled feature flag (Dim 6) ──> independent; gates everything
```

### Recommended Stream B.1 target

**<name the one piece of infrastructure — likely "Canonical event spine" based on typical findings, but confirm against actual audit results>**

**What it is:** `<2-3 sentences describing the deliverable — not how to build it, just what it is>`

**Why it's first:** `<2-3 sentences: unblocks N downstream items; highest (impact × cost-of-delay) / effort ratio; well-understood design space (outbox pattern)>`

**Approximate effort:** `<S/M/L/XL>` — reasoning: `<sentence>`

**What the Stream B.1 spec should cover:** `<4-6 bullet points — e.g., event payload shape, emit-from-where decision, outbox vs. in-band, consumer pattern, migration strategy from N duplicated transition paths, test strategy>`

### Alternatives considered

- **<second-best dimension>** — `<why not first: 1 sentence>`
- **<third-best dimension>** — `<why not first: 1 sentence>`

### Why not [each of the remaining 3–4 dimensions]

Each remaining dimension gets a one-line "why it waits" rationale. Keeps the logic transparent — the reader can disagree and re-rank.
```

- [ ] **Step 5: Write the Bottom Line section**

Replace `<!-- filled in Task 8 -->` under `## Bottom line (read this first)` with a 3-sentence summary. Shape:

```markdown
The DrayageDirect codebase is **<characterization>** for AI-agent readiness: <1 sentence overall take>. The highest-leverage gap is <the B.1 recommendation>; closing it unblocks <N> downstream items across <list dimensions>. <N> `[ai-ready]` follow-ups have been opened to track every identified gap — see `followups.md` or the per-dimension "Tracked follow-ups" subsections below.
```

Example (adjust based on actual findings):

> The DrayageDirect codebase is **structurally promising** for AI-agent readiness — multi-tenant, RBAC, and the rules-engine foundations are in place — but lacks the canonical event spine and stable external API surface that per-tenant agents will need. The highest-leverage gap is the canonical event spine; closing it unblocks audit-trail completion, intent/outcome logging, and agent-subscription triggers. 27 `[ai-ready]` follow-ups have been opened to track every identified gap — see `followups.md` or the per-dimension "Tracked follow-ups" subsections below.

- [ ] **Step 6: Verify no Task 8 placeholders remain**

Run: `grep -n "filled in Task 8" "C:/Users/bento/app-drayagedirect/docs/superpowers/audits/2026-04-24-ai-readiness-audit.md"`

Expected: no matches.

---

## Phase 3 — Ledger integration (2 tasks)

### Task 9: Open FU entries for all gaps

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (append new `[ai-ready]` entries at the top of Open section)
- Modify: `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (replace `<FU-XXX>` placeholders + fill in "Tracked follow-ups (opened by this audit)" aggregate list)

- [ ] **Step 1: Collect all `<FU-XXX>` placeholders from the audit doc**

Run:

```bash
grep -nE "<FU-XXX>" "C:/Users/bento/app-drayagedirect/docs/superpowers/audits/2026-04-24-ai-readiness-audit.md" | wc -l
```

Record the count — this is N (number of FUs to open).

- [ ] **Step 2: Determine next available FU number**

Run:

```bash
grep -oE "FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md \
  | sort -t- -k2 -n -u | tail -1
```

Expected: `FU-046` (from Stream A ship). Next available: `FU-047`. If something higher exists (another session opened entries), start from max+1.

- [ ] **Step 3: For each audit finding, check for pre-existing Stream A findings before opening a new FU**

Walk through each `<FU-XXX>` placeholder in the audit doc. For each, determine:
- **What's the gap?** (extract from context of the "Tracked follow-ups" bullet)
- **What file:line does it reference?** (from the Current-state section of that dimension)

Then grep `followups.md` for existing `[ai-ready]` entries matching the same topic:

```bash
# Example — adapt the pattern to the actual gap
grep -nE "\[ai-ready\].*(event emit|status change|centralize)" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

- **If match exists:** replace the audit doc's `<FU-XXX>` placeholder with `(pre-existing FU-NNN)` and skip opening a new entry.
- **If no match:** allocate the next FU number and open a new entry.

Given Stream A has been running for ~1 day, there are likely zero or very few pre-existing matches.

- [ ] **Step 4: Write each new FU entry**

For each new FU, insert at the top of the Open section of `followups.md` (above existing FU-046):

```markdown
### FU-XXX: [ai-ready] <Category>: <title>
- Source: docs/superpowers/audits/2026-04-24-ai-readiness-audit.md (audit run 2026-04-24)
- Scope: small | medium | large  (matches audit's effort bucket for this gap: S=small, M=medium, L/XL=large)
- Area: infra
- Intent: <the gap, in one sentence>
- Notes: <file references from Current-state section>. See audit Dim N, "Tracked follow-ups" subsection.
```

Use these category tags in the title (match the 5 Stream A categories plus a new "Cross-cutting" tag for Dim 6):
- `[ai-ready] API: ...`
- `[ai-ready] Schema: ...`
- `[ai-ready] State: ...`
- `[ai-ready] Business-logic: ...`
- `[ai-ready] Rules-engine: ...`
- `[ai-ready] Cross-cutting: ...`

Insert order: chronologically newest first, so the first entry opened is closest to the top. After all inserts, existing FU-046 is below all new ones.

- [ ] **Step 5: Replace `<FU-XXX>` placeholders in the audit doc**

For each placeholder, substitute the actual FU number allocated in Step 4. E.g., `<FU-XXX>` on the first "Versioning strategy" bullet under Dimension 1 becomes `FU-047`.

Verify no placeholders remain:

```bash
grep -nE "<FU-XXX>" "C:/Users/bento/app-drayagedirect/docs/superpowers/audits/2026-04-24-ai-readiness-audit.md"
```

Expected: no matches.

- [ ] **Step 6: Populate the audit's aggregate "Tracked follow-ups" section**

At the bottom of the audit doc (under `## Tracked follow-ups (opened by this audit)`), produce a flat list of every FU opened by this audit:

```markdown
This audit opened `<N>` new `[ai-ready]` follow-ups and referenced `<M>` pre-existing ones. Full list:

**New entries:**
- [FU-047] [ai-ready] API: Versioning strategy and /api/v1/* aliasing plan
- [FU-048] [ai-ready] API: JSDoc / OpenAPI contract coverage for top-20 endpoints
- ...
(complete list in opening order)

**Referenced pre-existing entries (no new FU opened):**
- [FU-NNN] <title> — (existing Stream A finding; already tracks this gap)

**By category:**
- API: `<N>` entries
- Schema: `<N>` entries
- State: `<N>` entries
- Business-logic: `<N>` entries
- Rules-engine: `<N>` entries
- Cross-cutting: `<N>` entries
```

- [ ] **Step 7: Verify total FU count matches**

Run:

```bash
# Count new FU entries in the followups ledger with source pointing to this audit
grep -nE "Source: docs/superpowers/audits/2026-04-24" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md | wc -l

# Count FU references in the audit doc (excluding pre-existing refs)
grep -oE "FU-[0-9]+" C:/Users/bento/app-drayagedirect/docs/superpowers/audits/2026-04-24-ai-readiness-audit.md | sort -u | wc -l
```

Expected: the two counts should agree (within the difference of any pre-existing references).

---

### Task 10: Update MEMORY.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`

- [ ] **Step 1: Determine the updated FU count**

Run:

```bash
grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Note the total open count (including recently-resolved if the schema counts both; use existing pattern).

Previous MEMORY.md audit line said `45 open`. New count is `45 + <N>` where N is entries opened by Task 9.

- [ ] **Step 2: Determine current HEAD SHA**

Run:

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

Note the SHA.

- [ ] **Step 3: Update the audit-line in MEMORY.md**

Find the line in `MEMORY.md`:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `f83c049`). 45 open, ~15 recently-resolved.
```

Update to:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<current SHA>`). `<new count>` open, ~15 recently-resolved.
```

- [ ] **Step 4: Add Audits section to MEMORY.md**

After the "Session history" section (or in an appropriate location — look for the last `## ...` section), insert:

```markdown
## Audits (retrospective codebase analyses)

- [2026-04-24-ai-readiness-audit.md](../../../../app-drayagedirect/docs/superpowers/audits/2026-04-24-ai-readiness-audit.md) — AI-readiness audit across 6 dimensions. Identified `<N>` gaps, recommended Stream B.1 target: `<target name>`. Run against HEAD `<SHA>`.
```

The relative path `../../../../app-drayagedirect/...` may need adjustment — verify by opening the link from the MEMORY.md location.

- [ ] **Step 5: Verify**

```bash
grep -nE "Last audited 2026-04-24 \(HEAD" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md
grep -nE "^## Audits" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md
```

Both should return exactly one match each.

---

## Phase 4 — Commit and finalize (1 task)

### Task 11: Commit audit doc + spot-check accuracy

**Files:**
- Commit: `docs/superpowers/audits/README.md`, `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md`

- [ ] **Step 1: Get HEAD SHA and fill in audit frontmatter**

Run:

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

Edit the audit doc's frontmatter — replace `commit_sha: <!-- filled in Task 11 -->` with `commit_sha: <actual SHA>`. Also replace the `**Against commit:** \`<!-- filled in Task 11 -->\`` line at the top of the body with the same SHA.

- [ ] **Step 2: Final self-verification pass on the audit**

Before committing, spot-check 5 claims across different dimensions:
- Pick a Dim 1 claim that cites `file_path:line_number` — `Read` that file at that line and verify the code supports the claim.
- Same for Dim 2 (a migration claim)
- Same for Dim 3 (a state-write claim)
- Same for Dim 4 (a hardcoded-rule claim)
- Same for Dim 5 (a rules-engine claim)

If any claim doesn't hold up, fix the audit text before committing.

- [ ] **Step 3: Verify no orphaned placeholders remain**

```bash
grep -nE "<!--|<FU-XXX>|<N>|<TOTAL>|<H/M/L>|<S/M/L/XL>|<file:line>|<describe>" "C:/Users/bento/app-drayagedirect/docs/superpowers/audits/2026-04-24-ai-readiness-audit.md"
```

Expected: no matches. Any match indicates an unfilled template placeholder — fix before committing.

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add docs/superpowers/audits/README.md docs/superpowers/audits/2026-04-24-ai-readiness-audit.md
```

Build the commit message from the actual findings. Template:

```bash
git -C C:/Users/bento/app-drayagedirect commit -m "$(cat <<'EOF'
docs(ai-ready): Stream B — AI-readiness audit

6-dimension audit of the codebase against per-tenant AI-agent-readiness:
  Dim 1 — API surface       | Priority: <H/M/L>
  Dim 2 — Data schema       | Priority: <H/M/L>
  Dim 3 — State/event spine | Priority: <H/M/L>
  Dim 4 — Business logic    | Priority: <H/M/L>
  Dim 5 — Rules engine      | Priority: <H/M/L>
  Dim 6 — AI-runtime cross  | Priority: <H/M/L>

Opened <N> new [ai-ready] follow-ups (FU-047..FU-<last>) — full list in
audit "Tracked follow-ups" section.

Recommended Stream B.1 target: <target name>. Reasoning: <one sentence>.

Spec: docs/superpowers/specs/2026-04-24-ai-readiness-audit-design.md
Plan: docs/superpowers/plans/2026-04-24-ai-readiness-audit.md
Audit: docs/superpowers/audits/2026-04-24-ai-readiness-audit.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Fill in the `<angle bracket>` values from your audit's actual findings.

- [ ] **Step 5: Report completion**

Summarize for the controller:
- Files committed (paths + commit SHA)
- FU range opened (FU-047..FU-???)
- Stream B.1 recommendation (in one sentence)
- Any notable surprises during the audit (things that turned out very different from expectations)

---

## Rollout note

The audit is a static artifact — once committed, it doesn't "run" anywhere. Its value comes from:
1. The **Synthesis / Bottom-line** section pointing at Stream B.1
2. The **FU entries** feeding into Stream A's ongoing ledger
3. The **per-dimension file:line refs** serving as a snapshot for future "has this drifted?" comparisons

The audit does NOT need to be re-run periodically. If the codebase changes substantially (e.g., after Stream B.1 ships), run a NEW audit as a fresh deliverable (`2026-XX-XX-ai-readiness-audit-v2.md`), don't edit this one. This keeps each audit a point-in-time snapshot.

## Open questions — addressed by this plan

1. **Depth of "scan every file" vs. sample:** plan uses sample-based approach for API (10 endpoints), migrations (3 recent + canonical entity extraction across all), business logic (grep-exhaustive). Rules engines get full-read coverage because there are only ~11 engine files.
2. **Who verifies accuracy:** Task 11 Step 2 requires the implementer to spot-check 5 claims before committing. The spec-compliance reviewer (post-execution) does a second, independent pass.
3. **Synthesis confidence:** if the implementer is unsure of the single B.1 target, Task 8 Step 3 allows reporting as top-3 ranked with a preferred choice. The Synthesis section has an "Alternatives considered" slot for this.
4. **Directory README:** yes, created in Task 1.
