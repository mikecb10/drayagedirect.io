# dd-ai-ready Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `dd-ai-ready` skill — a lightweight, advisory-only guardrail that auto-runs after `dd-qa` on file edits, filters through a 5-check gate, produces categorized adaptive findings, and logs them to `followups.md` with `[ai-ready]` prefix — without blocking velocity or requiring any runtime code.

**Architecture:** This is a documentation / skill-authoring task, not a code task. The deliverable is a single Markdown runbook at `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md` that Claude reads and executes when the skill fires. Supporting changes: one memory file (`dev_ai_ready_skill.md`), a `MEMORY.md` index entry, a schema addendum to `followups.md`, and an FU-045 entry for post-ship monitoring. No source code, no migrations, no runtime component.

**Tech Stack:** Claude Code skill format (YAML frontmatter + Markdown body). Memory filesystem under `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\`. No build step, no tests, no package.json touched.

**Spec:** [docs/superpowers/specs/2026-04-24-dd-ai-ready-skill-design.md](docs/superpowers/specs/2026-04-24-dd-ai-ready-skill-design.md)

**FU number assignment:** Current max open FU is `FU-044`. This work opens `FU-045` (post-ship monitoring / gate tuning at 2-week mark). The skill itself, once live, will start producing findings numbered from `FU-046` onward as engineers make edits.

**File paths used throughout:**
- Skill: `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md` (user-level, mirrors `dd-qa` location)
- Memory root: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\`
  - `followups.md` — ledger (schema addendum)
  - `MEMORY.md` — index (new pointer)
  - `dev_ai_ready_skill.md` — new engineering-convention file
- Repo: `C:\Users\bento\app-drayagedirect\` — no repo commits needed (all skill + memory files live under `.claude`, outside the project repo). The spec is already committed as `33ab644`.

**Testing approach:** This skill is a runbook, not code. "Testing" means walking through the 3 worked examples from the spec and confirming the skill's written instructions, when read by Claude, produce the exact expected output in each case. This is a structured review, not automated tests.

---

## Phase 1 — Memory scaffolding (3 tasks)

### Task 1: Document `[ai-ready]` prefix convention in `followups.md`

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (add addendum to schema section)

**Context for the engineer:** `followups.md` is the user's living follow-up ledger across sessions. It has a documented schema at the top of the file. We need to extend that schema to note the new `[ai-ready]` prefix convention so entries produced by `dd-ai-ready` are parseable and filterable.

- [ ] **Step 1: Read the current schema section**

Run: `grep -n "^## Schema" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md`

Find the `## Schema per entry` heading and locate the end of its code block. The addendum goes immediately after.

- [ ] **Step 2: Insert the AI-readiness prefix addendum**

After the `## Schema per entry` code block and before the `Use Status:` line, insert this new subsection:

```markdown
### AI-readiness entries (produced by `dd-ai-ready` skill)

Entries produced by the `dd-ai-ready` skill carry a `[ai-ready]` prefix in the
title immediately after the FU number. Example:

    ### FU-046: [ai-ready] State: Emit load.status.changed from pages/api/loads/[id].js:87

Each `[ai-ready]` entry also tags a category after the prefix (one of
`API`, `Schema`, `State`, `Business-logic`, `Rules-engine`) so the ledger
can be filtered per-category when Stream B (architecture audit) runs.

Spec: `docs/superpowers/specs/2026-04-24-dd-ai-ready-skill-design.md`.
```

- [ ] **Step 3: Verify the insertion**

Run: `grep -nA 10 "### AI-readiness entries" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md`

Expected: the new subsection appears, followed by the unchanged `Use Status:` line.

---

### Task 2: Create `dev_ai_ready_skill.md` memory file

**Files:**
- Create: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\dev_ai_ready_skill.md`

**Context for the engineer:** The DrayageDirect memory system organizes skills/conventions under the `dev_*` prefix (see `dev_migration_template.md`, `dev_dark_mode_convention.md`, `dev_pricing_detail_restructure.md`). We're adding the AI-readiness convention as a peer file.

- [ ] **Step 1: Write the file**

Create `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\dev_ai_ready_skill.md` with this content:

```markdown
---
name: dev_ai_ready_skill
description: dd-ai-ready skill auto-runs after dd-qa on file edits in pages/, components/, lib/, pages/api/. Filters through a 5-check gate (API, schema, state, business-logic, rules-engine) and produces categorized findings logged to followups.md with [ai-ready] prefix. Advisory only — never blocks shipping. Preserves optionality for future per-tenant AI agent integration.
type: feedback
---

# dd-ai-ready skill — engineering convention

**Skill location:** `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md`

**Trigger:** Auto-runs after `dd-qa` completes, on any file edit in `pages/`, `components/`, `lib/`, `pages/api/`. Same trigger scope as `dd-qa`.

**What it does:** Applies a 5-check gate to the edit. If zero gates match → emits one-line "no concerns" and exits. If any match → runs adaptive per-branch checks and produces categorized findings.

**The 5 gate checks:**
1. API contract — edit touches `pages/api/**`
2. Data schema — edit touches `migrations/**/*.sql`
3. State / event spine — diff mentions `status`, `state`, `transition`, `.update(`, or `.insert(` in state-relevant code
4. Hardcoded business logic — conditional expressions outside `lib/rules/**` that look like business rules
5. Rules engine — edit touches `lib/rules/**`, tariff, charge-profile, or driver-pay-rule engine

**Findings format:** Written to `followups.md` with title:
`FU-XXX: [ai-ready] <Category>: <one-line description>`

**Categories:** `API`, `Schema`, `State`, `Business-logic`, `Rules-engine`.

**Closure:** Same as other follow-ups — commit with `Resolves: FU-XXX`. Stream B (architecture audit) may batch-close dozens of entries when infrastructure ships.

**Advisory only:** The skill never blocks a commit, gate, or "feature complete" claim. Findings pile up — this is expected and becomes Stream B's input.

**Spec:** `docs/superpowers/specs/2026-04-24-dd-ai-ready-skill-design.md`
**Plan:** `docs/superpowers/plans/2026-04-24-dd-ai-ready-skill.md`

**Three streams of AI-readiness work:**
- **A.** `dd-ai-ready` skill (this — shipped)
- **B.** Architecture audit → gap roadmap (future, uses accumulated `[ai-ready]` findings as input)
- **C.** AI agent runtime + SOP framework + admin feature flag (future product feature)
```

- [ ] **Step 2: Verify the file exists and is readable**

Run: `ls -la "C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/dev_ai_ready_skill.md"`

Expected: file listed with non-zero size.

Run: `head -5 "C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/dev_ai_ready_skill.md"`

Expected: frontmatter shows `name: dev_ai_ready_skill` and `type: feedback`.

---

### Task 3: Update `MEMORY.md` index

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (add one line under "Engineering conventions")

**Context for the engineer:** `MEMORY.md` is the auto-loaded index. It has a section `## Engineering conventions (MANDATORY for new work)` with entries like `[dev_migration_template.md]`. We're adding `dev_ai_ready_skill.md` to that list.

- [ ] **Step 1: Find the Engineering conventions section**

Run: `grep -nA 5 "^## Engineering conventions" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md`

You'll see something like:
```
## Engineering conventions (MANDATORY for new work)

- [dev_migration_template.md](dev_migration_template.md) — All SQL migrations: ...
- [dev_dark_mode_convention.md](dev_dark_mode_convention.md) — Every component MUST include ...
- [dev_pricing_detail_restructure.md](dev_pricing_detail_restructure.md) — G-family pattern: ...
```

- [ ] **Step 2: Insert the new index line**

Add this line to that section (order it alphabetically — goes after `dev_dark_mode_convention.md`, before `dev_migration_template.md`, before `dev_pricing_detail_restructure.md`):

```markdown
- [dev_ai_ready_skill.md](dev_ai_ready_skill.md) — dd-ai-ready skill: auto-runs after dd-qa, 5-check gate, `[ai-ready]` findings to followups.md, advisory only
```

Final ordering should be:
```markdown
- [dev_ai_ready_skill.md](dev_ai_ready_skill.md) — dd-ai-ready skill: auto-runs after dd-qa, 5-check gate, `[ai-ready]` findings to followups.md, advisory only
- [dev_dark_mode_convention.md](dev_dark_mode_convention.md) — Every component MUST include ...
- [dev_migration_template.md](dev_migration_template.md) — All SQL migrations: ...
- [dev_pricing_detail_restructure.md](dev_pricing_detail_restructure.md) — G-family pattern: ...
```

- [ ] **Step 3: Verify**

Run: `grep -n "dev_ai_ready" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md`

Expected: one match, showing the new line.

---

## Phase 2 — Write the Skill (3 tasks)

The skill file is built in three passes so each is reviewable on its own. The engineer executing this plan should NOT try to write the whole file in one step — each pass is a commit-worthy unit.

### Task 4: Create `SKILL.md` with frontmatter, purpose, and the 5-check gate

**Files:**
- Create: `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md`

**Context for the engineer:** The skill lives at user-level (same parent directory as `dd-qa`). The skill file needs a specific frontmatter shape so Claude's skill discovery picks it up. Look at `C:\Users\bento\.claude\skills\dd-qa\SKILL.md` as a reference for the frontmatter format.

- [ ] **Step 1: Create the skill directory**

Run: `mkdir -p "C:/Users/bento/.claude/skills/dd-ai-ready"`

Expected: directory exists. If it already exists (no error), continue.

- [ ] **Step 2: Write frontmatter + purpose + 5-check gate**

Create `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md` with this content:

```markdown
---
name: dd-ai-ready
description: DrayageDirect AI-Readiness Checker — auto-runs after dd-qa on file edits in pages/, components/, lib/, pages/api/. Filters through a 5-check gate (API / schema / state / business-logic / rules-engine) and produces categorized adaptive findings logged to followups.md with `[ai-ready]` prefix. Advisory only — never blocks shipping. Preserves optionality for future per-tenant AI agent integration. Trigger after dd-qa on ANY file edit in the DrayageDirect codebase.
---

# DrayageDirect AI-Readiness Checker

You are a forward-looking architect for DrayageDirect, a multi-tenant drayage/intermodal trucking SaaS being built with a long-term vision of offering per-tenant AI agents that automate operational flows. Your job: catch design decisions at the moment they're introduced that would either (a) foreclose future AI integration or (b) be cheap to do "AI-ready" now but expensive to retrofit later.

You are **advisory only**. You never block shipping. You never add inline TODO comments. Every finding is logged to `followups.md` with a `[ai-ready]` prefix for later triage.

This skill auto-runs AFTER `dd-qa` has completed. Read the edit that was just made (using git diff against HEAD or the in-context Edit/Write tool call that just happened). Then run through the gate below.

## Context loading

Read these memory files first so findings are grounded in the actual architecture, not guesses:
- `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` — index
- `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` — to find the next FU-NNN number (current max + 1)
- `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\dev_ai_ready_skill.md` — this skill's convention doc

## The 5-check gate

Examine the edit that was just made. Apply each of these 5 gate checks. If **zero** match, emit `✓ dd-ai-ready: No AI-readiness concerns in this edit.` and exit. If **one or more** match, proceed to the matching adaptive branches.

| # | Gate | Triggers when the edit... |
|---|---|---|
| G1 | **API contract** | Modifies or adds a file under `pages/api/**` |
| G2 | **Data schema** | Modifies or adds a file matching `supabase/migrations/**/*.sql` |
| G3 | **State / event spine** | Diff contains `status`, `state`, `transition`, `.update(`, or `.insert(` AND the file path is in a state-relevant area (`lib/loads/`, `lib/orders/`, `lib/invoices/`, `lib/charge-sets/`, `lib/driver-pay/`, `lib/routing/`, or `pages/api/` paths touching those entities) |
| G4 | **Hardcoded business logic** | Diff contains conditionals that encode business rules: `if (customer === '...')`, `if (commodity === '...')`, magic-number thresholds in pricing/routing code, tenant-specific branches — AND the file is **outside** `lib/rules/**` |
| G5 | **Rules engine** | Edit touches `lib/rules/**`, `lib/tariffs/`, `lib/charge-profiles/`, `lib/driver-pay-rules/`, or any file explicitly part of the tariff / charge-profile / driver-pay-rule engine |

Gate checks are OR-combined. Multiple matches → multiple adaptive branches run in sequence. The gate is deliberately generous; false positives (a skippable finding) are preferable to false negatives (a missed AI-readiness concern).

[continued in next task]
```

- [ ] **Step 3: Verify the frontmatter parses and the gate section is present**

Run: `head -10 "C:/Users/bento/.claude/skills/dd-ai-ready/SKILL.md"`

Expected: `---` on line 1, `name: dd-ai-ready` on line 2, `description: ...` on line 3, `---` on line 4, blank line, `# DrayageDirect AI-Readiness Checker` on line 6.

Run: `grep -c "^| G[1-5] |" "C:/Users/bento/.claude/skills/dd-ai-ready/SKILL.md"`

Expected: `5`.

---

### Task 5: Add the 5 adaptive check branches

**Files:**
- Modify: `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md` (append adaptive-check sections)

**Context for the engineer:** Each of the 5 gate branches has 3–4 specific questions. This task adds all 5 branches in one pass because they share structure (heading + numbered questions + example finding format).

- [ ] **Step 1: Append the adaptive checks section**

Replace the line `[continued in next task]` with the following (everything below — a large block):

```markdown
## Adaptive checks

Only the branches matching a gate hit run. Skip the rest.

Each question can produce zero or one finding. Every finding gets a category tag, a file:line reference, a one-sentence observation, and a one-sentence recommendation. Each finding is also written to `followups.md` using the title format `FU-XXX: [ai-ready] <Category>: <title>`.

### API branch (triggered by G1)

1. **Is this endpoint versioned?** Check for `/api/v1/`, `/api/v2/`, or a documented versioning strategy. If the endpoint is under `pages/api/` with no version prefix AND no known versioning-in-a-comment convention → finding: "Endpoint not versioned. When the stable external API ships, this needs an /api/v1/ prefix."
2. **Is the contract documented?** Check for an adjacent `.md` file, JSDoc block above the handler, or an OpenAPI entry describing request shape, response shape, error cases. If fully absent → finding: "No contract documentation. Add JSDoc describing request/response/error shapes."
3. **Is the response shape UI-coupled?** If the handler returns fields like `displayLabel`, `isSelected`, `uiSortKey`, `badgeColor` designed for a specific screen — that's UI coupling. Agents need canonical domain shapes, not UI scaffolding. → finding: "Response is UI-coupled (fields X, Y, Z). An agent-facing API should return canonical domain data and let consumers format display."
4. **Does the handler do business logic inline, or does it delegate to `lib/*`?** Inline business logic in the handler means the logic is only callable via HTTP, not by a future agent runtime. → finding: "Handler performs business logic inline. Extract to a library function in `lib/*` so agents can call the same logic without going through the HTTP layer." (Note: this overlaps G4 — flag once, not twice.)

### Schema branch (triggered by G2)

1. **Does the migration add a canonical entity or column that agents will need to query?** If yes (a new status column, a new reference-data table, a new foreign-key relationship) → finding: "Schema addition X is agent-relevant. Flag for inclusion in the future agent-facing schema catalog."
2. **Is the column naming agent-friendly?** Names like `flag_1`, `misc_data`, `extra_jsonb`, `tmp_col`, `field_7` are opaque. Names like `dispatch_priority`, `detention_reason_code`, `commodity_hazmat_class` are parseable. If any opaque name → finding: "Column name X is opaque. Rename to something an agent can reason about without reading the source of truth."
3. **Does the migration add a state column WITHOUT an audit / history trail?** E.g., adding `status` to a table with no corresponding `*_history` table, no trigger-based audit, and no event emit point. → finding: "New state column X has no audit / history trail. An agent needs to answer 'what was the status 3 days ago?' — flag for event-spine emit location."
4. **Does the migration hardcode enum values that should be tenant-extensible reference data?** E.g., `CHECK (status IN ('a', 'b', 'c'))` when customers would benefit from defining their own statuses. → finding: "Hardcoded enum values in CHECK constraint. Consider a lookup table with `tenant_id` so customers can extend the set."

### State / event spine branch (triggered by G3)

1. **Will this transition need to emit an event when the event spine ships?** For every code path that writes a status change or state transition, flag the exact `file_path:line_number`. Format: finding message: "State transition at {file}:{line} has no event emit. When the event spine ships, this location will need to emit `<entity>.<event>.changed` (e.g., `load.status.changed`, `invoice.status.changed`)."
2. **Is the transition logic centralized?** If the same state change happens in 3 places with slightly different side effects, that's a pre-event-spine refactor candidate. → finding: "State transition X is duplicated across {file1, file2, file3}. Centralize before the event spine ships so emissions are consistent."
3. **Does the transition have side effects an agent would need to know about?** E.g., auto-creating a charge set on load completion, auto-sending a rate confirmation on acceptance, auto-dispatching an email on status change. Flag each side effect. → finding: "Transition X triggers side effect Y (auto-charge-set creation / auto-email / etc.). Document for future event payload design so agents can predict cascade."

### Business-logic branch (triggered by G4)

1. **Can this rule move to the rules engine NOW?** Check if the existing rules engine (tariff engine, charge profile engine, driver-pay-rule engine) already supports the rule's shape. If yes → finding: "Move rule from {file}:{line} to the {which} engine. Existing engine already supports this rule type."
2. **If NOT now, is the engine missing a supported rule type this logic would need?** → finding: "Rules engine extension candidate: to support this rule type, the engine needs {what is missing — new operator / new condition / new action type}. File as rules-engine work item."
3. **Is the conditional tenant-specific?** `if (tenantId === 'acme-trucking')` is a **critical** finding — it breaks multi-tenant correctness regardless of AI readiness. Elevate severity in the report and mark the FU entry `Scope: large`. → finding: "CRITICAL: Tenant-specific hardcoded logic. This breaks multi-tenant isolation and must move to tenant-scoped config or rules engine."
4. **Is there a magic number?** Thresholds like `if (days > 14)` or `if (amount > 500)` should come from tenant config. → finding: "Magic number {N} in {file}:{line}. Extract to tenant config so different customers can set different thresholds."

### Rules-engine branch (triggered by G5)

1. **Is the rule schema exportable as a machine-readable document?** An agent runtime needs to read a tenant's active rules to reason about what it's allowed to do. If the rule is stored as executable code (JS function, stored procedure) rather than a declarative JSON/YAML structure → finding: "Rule shape is executable-code, not declarative. An agent can't read this to plan actions. Consider declarative schema."
2. **Does the new rule type have a stable, documented schema?** If adding a new rule variant, check whether its `operator` / `condition` / `action` shape is documented somewhere an agent (or a human) could consume. → finding: "New rule type X has no documented schema. Add entry to `docs/rules-schema/` (or wherever rule schemas are documented) describing operator / condition / action."
3. **Is the rule evaluator pure (free of side effects during evaluation)?** Agents need deterministic rule evaluation for dry-run scenarios ("what would happen if I applied this rule?"). If the evaluator writes to the DB, sends emails, or calls external APIs during evaluation → finding: "Rule evaluator has side effects during evaluation (writes to X / sends email / calls API). Agents need side-effect-free evaluation for dry-run. Split evaluation from application."
```

- [ ] **Step 2: Verify all 5 branches are present**

Run: `grep -cE "^### (API|Schema|State|Business-logic|Rules-engine) branch" "C:/Users/bento/.claude/skills/dd-ai-ready/SKILL.md"`

Expected: `5`.

Run: `grep -cE "^[0-9]+\. \*\*" "C:/Users/bento/.claude/skills/dd-ai-ready/SKILL.md"`

Expected: at least `17` (4 API + 4 Schema + 3 State + 4 Business-logic + 3 Rules-engine = 18, allow for slight variance).

---

### Task 6: Finalize `SKILL.md` with output format, findings protocol, and non-goals

**Files:**
- Modify: `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md` (append)

**Context for the engineer:** This task closes out the skill with the runbook sections Claude needs to know when producing the final report: what the output format looks like, how to write to `followups.md`, and the explicit "do NOT do this" list.

- [ ] **Step 1: Append output format, findings protocol, non-goals**

Append the following to the end of `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md`:

```markdown
## Output format

After the gate + any triggered branches, emit a short markdown report to the conversation. Mirror `dd-qa`'s format.

**Zero findings case:**

```
✓ dd-ai-ready: No AI-readiness concerns in this edit.
```

**One or more findings case:**

```
⚠ dd-ai-ready: N AI-readiness findings

1. [<Category>] <file_path>:<line> — <observation sentence> <recommendation sentence> → FU-XXX

2. [<Category>] <file_path>:<line> — <observation sentence> <recommendation sentence> → FU-XXX

...
```

Category is one of: `API`, `Schema`, `State`, `Business-logic`, `Rules-engine`.

Findings are numbered sequentially per run (1, 2, 3…), not across runs.

The `→ FU-XXX` pointer links the report finding to its ledger entry. You must create the ledger entries in the next step.

## Findings protocol — writing to `followups.md`

For every finding in the report, add an entry to `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` under the "Open" section.

**Determine the next FU number:** grep the current max FU-NNN and add 1.

```bash
grep -oE "FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md \
  | sort -t- -k2 -n -u | tail -1
```

**Entry format** (matches the existing followups.md schema):

```markdown
### FU-XXX: [ai-ready] <Category>: <title>
- Source: conversation (dd-ai-ready skill, edit on <date>)
- Scope: small | medium | large
- Area: infra | other  (use `infra` for API/Schema/State findings; `other` for business-logic / rules-engine)
- Intent: <observation + recommendation combined into one sentence>
- Notes: File `<file_path>:<line>`. <any relevant context>. Blocked on: <event spine | stable API | nothing — can fix now>.
```

**Scope heuristic:**
- **small** — move one hardcoded rule to the rules engine; rename one opaque column; add JSDoc to one endpoint
- **medium** — centralize a duplicated state transition; add an audit trail to one table
- **large** — anything that blocks on event spine / stable API / agent runtime infrastructure; any `CRITICAL` tenant-specific finding

## Non-goals (explicitly do NOT do)

- Do NOT add inline `// TODO(ai-ready): ...` comments in the source code. The ledger is the single source of truth.
- Do NOT block a commit, gate a merge, or stop the user from claiming "feature complete." Findings are advisory.
- Do NOT edit the source code to "fix" findings automatically. The engineer decides whether and when to act.
- Do NOT run a retroactive audit of the whole codebase. This skill runs on the edit that was just made, not on the repo at rest.
- Do NOT re-flag the same file:line across multiple runs. If an edit touches a file that already has open `[ai-ready]` FU entries for the same concern, mention that in the report ("pre-existing FU-XXX already open for this") rather than creating a duplicate.
- Do NOT fire on pure styling, copy, or comment changes. The 5-check gate should catch these — if the gate gets through anyway, exit with the "no concerns" one-liner.
- Do NOT invent categories beyond the 5 defined. If a finding doesn't fit any of the 5, the gate shouldn't have matched — re-examine the gate.

## When to skip this skill

Skip entirely if:
- The edit is to a `*.md` file (documentation only).
- The edit is to `package.json`, `package-lock.json`, or `yarn.lock` (dependency update).
- The edit is to a test file (`*.test.mjs`, `*.test.js`, `tests/**`).
- The edit is to `.gitignore`, CI config (`.github/workflows/`), or other tooling.
- `dd-qa` reported a correctness issue that the user hasn't addressed yet — run after the correctness issue is fixed, not before.

In any of these cases, emit `✓ dd-ai-ready: Skipped (non-code / test / tooling edit).` and exit.
```

- [ ] **Step 2: Verify the skill file is complete**

Run: `wc -l "C:/Users/bento/.claude/skills/dd-ai-ready/SKILL.md"`

Expected: at least 150 lines (frontmatter + purpose + gate table + 5 branches + output + protocol + non-goals + when-to-skip).

Run: `grep -c "^##" "C:/Users/bento/.claude/skills/dd-ai-ready/SKILL.md"`

Expected: at least `6` (Context loading, The 5-check gate, Adaptive checks, Output format, Findings protocol, Non-goals, When to skip).

---

## Phase 3 — Verification against the spec's worked examples (3 tasks)

Each worked example in the spec is a test case. "Running" the test = reading the skill file from top to bottom with the example's edit in mind, executing each gate check mentally, and confirming the produced output matches the spec's expected output exactly.

### Task 7: Verify Example 1 — dark-mode fix (expect: no findings)

**Files:** none modified; this is a review exercise.

**Context for the engineer:** Spec Example 1 is an edit that adds `dark:text-gray-300` to 4 spans in `pages/settings/accounting.js`. Expected skill output: `✓ dd-ai-ready: No AI-readiness concerns in this edit.`

- [ ] **Step 1: Simulate the edit against the gate**

Walk through each gate check with the edit in mind:

| Gate | Does it match? | Why / why not |
|---|---|---|
| G1 (API) | no | File is `pages/settings/accounting.js`, not under `pages/api/` |
| G2 (Schema) | no | No `.sql` file touched |
| G3 (State) | no | Diff is purely styling (`dark:` utility classes); no `status`/`state`/`transition` keywords |
| G4 (Hardcoded logic) | no | Diff has no conditionals |
| G5 (Rules engine) | no | File is not in `lib/rules/` |

- [ ] **Step 2: Confirm expected output**

Expected: `✓ dd-ai-ready: No AI-readiness concerns in this edit.`

If your reading of the skill produces anything else (e.g., you'd fire a branch that shouldn't have matched) → **stop and fix the skill's gate language** before proceeding. The gate must not false-positive on pure styling.

- [ ] **Step 3: Document the verification**

In the commit body for Task 10, include: "Verified Example 1: dark-mode edit → gate correctly exits with no findings."

---

### Task 8: Verify Example 2 — new unassign endpoint (expect: 4 findings across API + State)

**Files:** none modified; this is a review exercise.

**Context for the engineer:** Spec Example 2 is a new file `pages/api/loads/[id]/unassign.js` with a POST handler that sets `assigned_driver_id = null` and creates an audit record. Expected skill output: **4 findings** — 2 from API branch, 2 from State branch.

- [ ] **Step 1: Simulate the edit against the gate**

| Gate | Match? | Why |
|---|---|---|
| G1 (API) | **YES** | New file under `pages/api/` |
| G3 (State) | **YES** | Diff contains `.update(` + touches load state |
| G2, G4, G5 | no | No migration, no hardcoded business rule outside rules engine, not a rules-engine file |

→ Run API branch + State branch.

- [ ] **Step 2: Walk through API branch checks**

| Check | Finding? |
|---|---|
| API-1 versioned | **YES** — `/api/loads/.../unassign`, no `/api/v1/` prefix |
| API-2 documented | **YES** — no JSDoc, no adjacent `.md` |
| API-3 UI-coupled | no — response is `{ success: true }`, not UI-specific |
| API-4 inline business logic | no (assumed) — handler delegates to `lib/loads/unassign.js` |

→ 2 API findings.

- [ ] **Step 3: Walk through State branch checks**

| Check | Finding? |
|---|---|
| State-1 event emit | **YES** — `.update({ assigned_driver_id: null })` has no event emit; flag for `load.driver.unassigned` |
| State-2 centralized | no — only one unassign path exists |
| State-3 side effects | **YES** — unassignment auto-creates an audit record |

→ 2 State findings.

- [ ] **Step 4: Confirm expected output**

Expected report:
```
⚠ dd-ai-ready: 4 AI-readiness findings

1. [API] pages/api/loads/[id]/unassign.js:1 — Endpoint not versioned. ... → FU-XXX
2. [API] pages/api/loads/[id]/unassign.js:1 — No contract documentation. ... → FU-XXX
3. [State] pages/api/loads/[id]/unassign.js:23 — Driver unassignment has no event emit. ... → FU-XXX
4. [State] pages/api/loads/[id]/unassign.js:23 — Unassignment creates an audit record as a side effect. ... → FU-XXX
```

Four new `followups.md` entries with `[ai-ready]` prefix.

If the skill's language as written produces a different count (e.g., fewer than 4 findings, or extra findings in branches that shouldn't have matched) → **go back and tighten the skill's check descriptions** so they produce exactly this count for this input.

- [ ] **Step 5: Document the verification**

In the commit body for Task 10, include: "Verified Example 2: unassign endpoint → API + State branches fire; 4 findings produced as spec expects."

---

### Task 9: Verify Example 3 — hardcoded hazmat surcharge (expect: 1 finding from Business-logic)

**Files:** none modified; this is a review exercise.

**Context for the engineer:** Spec Example 3 is an edit adding `if (load.commodity === 'HAZMAT') total += 250;` in `lib/pricing/calculate-invoice.js:134`. Expected skill output: **1 finding** from Business-logic branch.

- [ ] **Step 1: Simulate the edit against the gate**

| Gate | Match? | Why |
|---|---|---|
| G4 (Hardcoded logic) | **YES** | Conditional with commodity check + magic number, file is `lib/pricing/` not `lib/rules/` |
| G1, G2, G3, G5 | no | Not API, not migration, no state keyword, not rules engine |

→ Run Business-logic branch only.

- [ ] **Step 2: Walk through Business-logic branch checks**

| Check | Finding? |
|---|---|
| BL-1 can move to rules engine now | **YES** — charge profile engine already supports commodity-based rules |
| BL-2 missing engine rule type | skip — BL-1 answered YES |
| BL-3 tenant-specific | no — not tenant-gated |
| BL-4 magic number | already covered by BL-1's recommendation (moving to engine makes the $250 tenant-configurable) |

→ 1 finding.

- [ ] **Step 3: Confirm expected output**

Expected report:
```
⚠ dd-ai-ready: 1 AI-readiness finding

1. [Business-logic] lib/pricing/calculate-invoice.js:134 — Hardcoded hazmat commodity surcharge. Move to the charge profile engine, which already supports commodity-based rules. → FU-XXX
```

One new `followups.md` entry.

- [ ] **Step 4: Document the verification**

In the commit body for Task 10, include: "Verified Example 3: hardcoded hazmat rule → 1 Business-logic finding produced as spec expects."

---

## Phase 4 — Open the post-ship monitoring FU and commit (1 task)

### Task 10: Open FU-045 and commit all changes

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (append one new entry)
- Commit: none in the project repo. User-level `.claude` files are already saved; they live outside the project git repo.

**Context for the engineer:** The skill ships with one follow-up of its own: a 2-week gate-tuning revisit. This is not an `[ai-ready]` finding — it's a meta follow-up about the skill itself.

- [ ] **Step 1: Find the next FU number**

Run:
```bash
grep -oE "FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md \
  | sort -t- -k2 -n -u | tail -1
```

Expected: `FU-044`. Next available: `FU-045`. (If something higher exists, use that + 1.)

- [ ] **Step 2: Add FU-045 to `followups.md`**

Insert this entry at the top of the "Open" section of `followups.md`:

```markdown
### FU-045: dd-ai-ready 2-week gate tuning revisit
- Source: conversation (dd-ai-ready skill ship, 2026-04-24)
- Scope: small
- Area: infra
- Intent: After 2 weeks of `dd-ai-ready` running alongside `dd-qa`, audit the skill's firing pattern. Target: > 90% of runs produce zero findings (gate is quiet on irrelevant edits) and < 5% produce > 5 findings in a single run (not noisy). If out of range, tune gate keyword list.
- Notes: Track in a scratch file: `(findings_produced, total_runs)` per week. Revisit ~2026-05-08. Skill spec: `docs/superpowers/specs/2026-04-24-dd-ai-ready-skill-design.md`. Plan: `docs/superpowers/plans/2026-04-24-dd-ai-ready-skill.md`.
```

- [ ] **Step 3: Verify `followups.md` is well-formed**

Run: `grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md`

Expected: one more than before (you added exactly one entry).

Run: `grep -nA 5 "^### FU-045" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md`

Expected: the new entry, correctly formatted.

- [ ] **Step 4: No project-repo commit needed**

All files modified in this plan live under `C:\Users\bento\.claude\` — they're user-level, not in the DrayageDirect git repo. No `git add` / `git commit` from the project directory.

The project repo's only artifact is the spec file (already committed as `33ab644`) and this plan file (which Task 10 of the writing-plans skill will commit next, outside this plan's execution).

- [ ] **Step 5: Update MEMORY.md "Last audited" line**

Since we touched `followups.md`, bump the audit marker. Find this line in `MEMORY.md`:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `a60200c`). 44 open, ~15 recently-resolved.
```

Update to:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<current HEAD SHA>`). 45 open, ~15 recently-resolved.
```

To get `<current HEAD SHA>`:

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

- [ ] **Step 6: Announce completion to the user**

Report back with:
- Files created: `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md`, `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\dev_ai_ready_skill.md`
- Files modified: `followups.md`, `MEMORY.md`
- FU-045 opened for 2-week revisit
- All 3 spec examples verified in Phase 3
- Next edit to `pages/api/`, `pages/`, `components/`, `lib/`, or a migration file will trigger both `dd-qa` and `dd-ai-ready` in sequence.

---

## Rollout note

The skill becomes active the moment `SKILL.md` is saved — Claude's skill discovery picks it up on the next conversation. The first edit made after the skill is saved will be its first live run.

If the first live run produces confusing output (e.g., too many findings, branches firing incorrectly), go back to Task 5 or Task 6 and tighten the check descriptions. The skill's body is the only thing that controls the behavior — no rebuild, no deploy, no restart.

## Open questions surfaced during planning

1. **Project-local vs. user-level skill install.** `dd-qa` lives at user level (`C:\Users\bento\.claude\skills\`). A project-local `.claude\skills\dd-qa\` directory exists in the DrayageDirect repo but is empty. This plan ships `dd-ai-ready` at user level for consistency with `dd-qa`. If at some point the user wants skills versioned with the project, both `dd-qa` and `dd-ai-ready` should move to `app-drayagedirect\.claude\skills\` together as a single rehoming PR — don't split them.
2. **`dd-qa` failure handling.** If `dd-qa` reports a correctness ISSUE, should `dd-ai-ready` still run, or wait until the ISSUE is resolved? This plan ships with "skip until correctness is fixed" per the skill's "When to skip" section — a code-correctness issue upstream makes AI-readiness findings noisy. If this proves wrong in practice, revisit as part of FU-045.
3. **Duplicate finding suppression.** The skill says "Do NOT re-flag the same file:line across multiple runs" but the mechanism for detecting duplicates is "grep followups.md before writing." This works at small scale; if the ledger grows to hundreds of `[ai-ready]` entries, the grep may slow the skill down. Revisit if it becomes a problem.
