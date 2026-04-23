---
name: 2026-04-24-dd-ai-ready-skill-design
description: Lightweight guardrail skill that auto-runs alongside dd-qa, filters edits through a 5-check gate for AI-relevance (API/schema/state/business-logic/rules-engine), and produces categorized adaptive findings logged to followups.md with [ai-ready] prefix — preserves optionality for future per-tenant AI agent integration without blocking current feature velocity.
type: spec
---

# dd-ai-ready Skill — Design Spec

## Summary

DrayageDirect is being built as a multi-tenant drayage SaaS with a long-term vision of offering per-tenant AI agents that can automate operational flows (dispatching, billing, exception handling, customer communication) per trucking carrier's configured SOPs. That vision is future state — gated behind an admin-portal feature flag, dependent on infrastructure that doesn't yet exist (stable external API, canonical event spine, machine-readable SOP schema, agent runtime, intent/outcome log).

The risk today is that every feature we ship between now and the AI rollout either (a) makes decisions that quietly foreclose AI integration (hardcoding business logic that should be in the rules engine, shipping UI-coupled API endpoints with no versioned contract, adding state transitions that never emit events) or (b) makes decisions that would be cheap to do "AI-ready" in the moment but expensive to retrofit later.

This skill is the guardrail. It auto-runs after `dd-qa` on every file edit in the DrayageDirect codebase, applies a **5-check gate** to decide if the edit touches AI-relevant concerns, and — if it does — runs **adaptive checks** that produce categorized findings. Findings are logged to `followups.md` with an `[ai-ready]` prefix and closed via the existing `Resolves: FU-XXX` commit convention. The skill is advisory only: it never blocks, never gates shipping, and never adds inline TODOs.

The accumulating ledger of findings becomes the input to Stream B (architecture audit → gap roadmap) — the skill effectively generates Stream B's source material as a byproduct of normal feature work.

## Goals

- Catch AI-readiness concerns at the moment they're introduced, before they get buried in the codebase.
- Produce categorized, actionable findings — not vague "needs work" notes — so Stream B can later cluster them into a concrete gap roadmap.
- Zero noise on edits that don't touch AI-relevant concerns (typos, CSS fixes, dark-mode variants, copy changes).
- Same operational pattern as `dd-qa`: auto-trigger after file edits, produce a short markdown report at the end of a run, log items to the existing `followups.md` ledger.
- Advisory only — never blocks a merge, a commit, or a "feature complete" claim.
- File lives in the same skills directory as `dd-qa` so both are discoverable and maintainable together.

## Non-Goals (explicitly out of scope for this skill)

1. **Building the event spine.** The skill will repeatedly flag "this state transition should emit an event" — it will NOT implement the event bus, emitter helper, or subscriber runtime. That's a Stream B/C deliverable.
2. **Building the stable external API surface.** The skill will flag "this endpoint is UI-coupled and not versioned" — it will NOT scaffold an `/api/v1/*` prefix, generate OpenAPI specs, or rewrite endpoints. Stream B decides the API contract strategy.
3. **Building the agent runtime.** No agent framework, no LLM routing, no tool registry, no prompt management.
4. **Building the machine-readable SOP schema.** The skill will flag "this rule schema isn't exportable" — it will NOT design the SOP DSL.
5. **Blocking or gating.** Findings are never errors. A feature can ship with 20 open AI-readiness findings. The ledger absorbs them.
6. **Inline code TODOs.** `// TODO(ai-ready): ...` comments rot and pollute the codebase. The ledger is the single source of truth.
7. **Retroactive audit of existing code.** The skill runs on edits, not on the codebase as a whole. A full audit is Stream B's job and is a separate, manual pass.
8. **Enforcing specific implementation patterns.** The skill asks questions ("does this emit an event?") — it does not dictate how events get emitted, what the event payload looks like, or which library to use.
9. **Cross-tenant behavior.** The skill is a development-time tool. It has no runtime presence in the app, no tenant awareness, no feature-flag check.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Auto-triggers after `dd-qa` on the same file-edit paths (`pages/`, `components/`, `lib/`, `pages/api/`) | Proven pattern; no new trigger infrastructure needed |
| D2 | Self-filters via a 5-check gate; exits one-liner if no match | Prevents noise on CSS/copy/dark-mode edits |
| D3 | Adaptive checks per gate branch (API / schema / state / business-logic / rules-engine), not a fixed 3-question list | Stream B needs categorized findings to build a roadmap; blanket "events missing" is not actionable granularity |
| D4 | Findings written to `followups.md` with `[ai-ready]` title prefix | Single ledger; filterable by prefix; closes via existing `Resolves: FU-XXX` convention |
| D5 | No inline `// TODO(ai-ready)` comments | Ledger is source of truth; inline TODOs rot |
| D6 | Output format mirrors `dd-qa`: markdown report to conversation; zero findings → one-line "✓ No AI-readiness concerns in this edit." | Consistency with existing dev UX |
| D7 | Advisory only — never blocks a commit or a "feature complete" claim | AI readiness is future-state; forcing it today would kill velocity |
| D8 | Sibling skill to `dd-qa`, not integrated into it | Different concerns (correctness vs. future-readiness); mixing muddies both |
| D9 | No runtime presence; purely a dev-time guardrail | The skill has nothing to do with production code paths |
| D10 | Findings pile accepted as a feature, not a bug | The pile IS Stream B's input |

## The 5-Check Gate

When the skill fires, its first step is a cheap gate that determines whether the edit touches AI-relevant concerns. If **zero** checks match → skill emits `✓ No AI-readiness concerns in this edit.` and exits. If **one or more** match → the matching adaptive check branches run.

| # | Gate check | Triggered when the edit... | Maps to adaptive check |
|---|---|---|---|
| G1 | **API contract** | Modifies or adds a file under `pages/api/**` | API branch |
| G2 | **Data schema** | Modifies or adds a file matching `migrations/**/*.sql` | Schema branch |
| G3 | **State / event spine** | Diff contains keywords `status`, `state`, `transition`, `.update(`, or `.insert(` in a file path matching load / invoice / charge-set / driver-pay / routing state code | State branch |
| G4 | **Hardcoded business logic** | Diff contains conditional expressions that look like business rules (e.g., `if (customer === '...')`, `if (commodity === '...') charge = ...`, magic-number thresholds in pricing/routing code) **outside** `lib/rules/**` | Business-logic branch |
| G5 | **Rules engine** | Edit touches `lib/rules/**`, tariff engine files, charge-profile engine files, or driver-pay-rule engine files | Rules-engine branch |

Gate checks are **OR**-combined: any match triggers the skill's main pass. Multiple matches → multiple branches run in sequence.

The gate is deliberately generous — false positives (skill runs when it didn't need to) are preferable to false negatives (skill misses an AI-relevant edit). The worst case from a false positive is one or two findings the user dismisses; the worst case from a false negative is a hardcoded business rule buried in production for 6 months.

## Adaptive Checks (per branch)

Each branch runs a small number of targeted questions. Each question can produce zero or one finding. Every finding gets written both to the conversation report and to `followups.md`.

### API branch (G1)

1. **Is this endpoint versioned?** Check for `/api/v1/`, `/api/v2/`, or a documented versioning strategy. If the endpoint is under `pages/api/` with no version prefix → finding.
2. **Is the contract documented?** Check for an adjacent `.md` or JSDoc block describing the request shape, response shape, error cases. Absent → finding.
3. **Is the response shape UI-coupled?** Check if the response is designed for a specific page (e.g., returns denormalized data specifically for a table) rather than for an agent / third-party consumer. Heuristic: if the handler shapes the response with `displayLabel`, `isSelected`, `uiSortKey`-style fields, it's UI-coupled. Present → finding.
4. **Does the handler perform business logic inline?** Or does it call into a shared library (`lib/*`) that could also be called by an agent runtime? Inline business logic → finding (overlaps G4).

### Schema branch (G2)

1. **Does the migration add a new canonical entity or column that agents will need to query?** If yes, flag for inclusion in the future agent-facing schema catalog.
2. **Is the column naming agent-friendly?** Names like `flag_1`, `misc_data`, `extra_jsonb` are opaque. Names like `dispatch_priority`, `detention_reason_code` are parseable. Opaque naming → finding.
3. **Does the migration add a state column without an audit/history trail?** If adding a status column with no corresponding `*_history` table or event emit point → finding.
4. **Does the migration hardcode enum values that should be reference data?** E.g., `CHECK (status IN ('a', 'b', 'c'))` when a `statuses` lookup table with a `tenant_id` column would let customers extend the set. Hardcoded → finding.

### State / event spine branch (G3)

1. **Will this transition need to emit an event when the event spine ships?** For every `UPDATE ... SET status = ...` or status-change code path, flag the exact file:line. Format: `FU-XXX [ai-ready] Emit load.status.changed from pages/api/loads/[id].js:87`.
2. **Is the transition logic centralized?** If the same status change happens in 3 places with slightly different side effects, flag as a "pre-event-spine refactor candidate."
3. **Does the transition have side effects that an agent would need to be aware of?** (E.g., auto-creating charge sets on load completion, auto-sending rate confirmations on acceptance.) Flag the side effect for future event payload design.

### Business-logic branch (G4)

1. **Can this rule move to the rules engine now?** For each hardcoded conditional, assess if the existing rules engine (tariffs / charge profiles / driver pay) could already express it. If yes → finding: "move to rules engine." If no (e.g., rules engine doesn't yet support this rule type) → finding: "rules-engine extension candidate."
2. **Is the conditional tenant-agnostic or tenant-specific?** Tenant-specific hardcoded logic (`if (tenantId === 'acme-trucking')`) is a critical finding — it breaks multi-tenant correctness regardless of AI readiness. Elevate severity.
3. **Is there a magic number?** Thresholds like `if (days > 14)` or `if (amount > 500)` should come from tenant config. Flag as config-extraction candidate.

### Rules-engine branch (G5)

1. **Is the rule schema exportable as a machine-readable document?** An agent runtime will need to read a tenant's active rules to reason about what it's allowed to do. If the rule is stored as a blob of executable code rather than a declarative structure → finding.
2. **Does the new rule type have a stable, documented schema?** If adding a new rule category (e.g., a new driver-pay rule variant), check whether the rule's `operator` / `condition` / `action` shape is documented somewhere an agent could consume.
3. **Is the rule evaluator pure?** Agents need deterministic rule evaluation for dry-run ("what would happen if I applied this rule?"). If the evaluator has side effects (DB writes during evaluation) → finding.

## Output Format

After the 5-check gate + any triggered branches, the skill emits a short markdown report to the conversation. Format mirrors `dd-qa` for consistency.

**Zero findings case:**

```
✓ dd-ai-ready: No AI-readiness concerns in this edit.
```

**Findings case:**

```
⚠ dd-ai-ready: 3 AI-readiness findings

1. [API] pages/api/loads/[id]/assign.js:42 — Endpoint not versioned. Consider /api/v1/ prefix when the stable external API surface ships. → FU-XXX

2. [State] pages/api/loads/[id].js:87 — UPDATE loads SET status = 'completed' has no event emit. Flag this location for load.status.changed emission when the event spine ships. → FU-XXX

3. [Business-logic] lib/pricing/calculate.js:134 — Hardcoded `if (commodity === 'HAZMAT') surcharge = 250` — this rule should live in the charge profile engine. The engine already supports commodity-based rules. → FU-XXX
```

Each finding has:
- A category tag in brackets (`[API]`, `[Schema]`, `[State]`, `[Business-logic]`, `[Rules-engine]`)
- A `file_path:line_number` reference
- A one-sentence observation + a one-sentence recommendation
- A pointer to the FU-XXX entry in `followups.md`

Findings are numbered sequentially per run, not across runs.

## Findings Protocol (followups.md integration)

Each finding from the skill becomes an entry in the user's existing `memory/followups.md` ledger.

**Title format:**
```
FU-XXX [ai-ready] <category>: <one-line description>
```

Examples:
- `FU-142 [ai-ready] State: Emit load.status.changed from pages/api/loads/[id].js:87`
- `FU-143 [ai-ready] API: Version pages/api/drivers/[id]/pay-rules endpoint`
- `FU-144 [ai-ready] Business-logic: Move hazmat surcharge rule from lib/pricing/calculate.js:134 to charge profile engine`

**Body format** (per existing followups.md conventions):
```
FU-XXX [ai-ready] <category>: <title>
  File: pages/api/loads/[id].js:87
  Found: 2026-04-24
  Category: state-event-spine
  Context: UPDATE loads SET status = ... called from the accept handler
  Recommendation: <one-sentence>
  Blocked on: <event spine infrastructure | nothing — can fix now>
```

**Closure:**
Same as all other follow-ups — a commit body line `Resolves: FU-XXX` closes the entry. No separate closure ceremony for AI-readiness entries.

**Bulk closure from Stream B:**
When Stream B (the architecture audit) runs and produces the gap roadmap, it may resolve dozens of `[ai-ready]` entries as a batch ("event spine shipped → all FU-XXX [ai-ready] State entries resolved"). Standard batch-close commit format: `Resolves: FU-142, FU-143, ..., FU-198`.

## Skill File Structure

The skill file lives alongside `dd-qa` (location TBD in the implementation plan — matches wherever `dd-qa` is installed). Standard frontmatter + body format.

**Frontmatter:**
```yaml
---
name: dd-ai-ready
description: DrayageDirect AI-Readiness Checker — auto-runs after dd-qa on file edits in pages/, components/, lib/, pages/api/. Filters through a 5-check gate (API / schema / state / business-logic / rules-engine) and produces categorized adaptive findings logged to followups.md with [ai-ready] prefix. Advisory only — never blocks shipping. Preserves optionality for future per-tenant AI agent integration.
---
```

**Body structure:**

1. **Purpose & scope** (1 paragraph): why this skill exists, what it does, what it does NOT do.
2. **The 5-check gate** (the table from this spec, plus the exit rule).
3. **Adaptive checks** (one section per branch, with each branch's questions and the exact finding format for that branch).
4. **Output format** (markdown template).
5. **Findings protocol** (followups.md write format).
6. **Explicit non-goals** (advisory only, not a gate, no inline TODOs).

The skill body is a **runbook** — I (Claude) read it when the skill fires and execute the checks. It's not code. It's plain language instructions that I follow.

## Examples

### Example 1: dark-mode fix on a settings page

**Edit:** Added `dark:text-gray-300` to 4 spans in `pages/settings/accounting.js`.

**Gate evaluation:**
- G1 (API): no, file is not under `pages/api/`
- G2 (Schema): no
- G3 (State): no, diff mentions no status/state keywords
- G4 (Business logic): no, diff is pure styling
- G5 (Rules engine): no

**Output:**
```
✓ dd-ai-ready: No AI-readiness concerns in this edit.
```

### Example 2: new "unassign driver" endpoint

**Edit:** New file `pages/api/loads/[id]/unassign.js` — POST handler that sets `assigned_driver_id = null` on the load and creates an audit record.

**Gate evaluation:**
- G1 (API): YES — new file under `pages/api/`
- G3 (State): YES — diff contains `.update(` and touches load state

**Adaptive checks:**
- API-1 (versioned): endpoint is at `/api/loads/.../unassign`, not `/api/v1/...` → finding
- API-2 (documented): no JSDoc block, no adjacent `.md` → finding
- API-3 (UI-coupled): response is `{ success: true }` — not UI-coupled, no finding
- API-4 (inline business logic): handler calls `lib/loads/unassign.js` helper → no finding
- State-1 (event emit): the `.update({ assigned_driver_id: null })` has no event emit → finding
- State-2 (centralized): only one unassign path in the codebase → no finding
- State-3 (side effects): unassignment auto-creates an audit record — this side effect is something an agent would need to know about → finding

**Output:**
```
⚠ dd-ai-ready: 4 AI-readiness findings

1. [API] pages/api/loads/[id]/unassign.js:1 — Endpoint not versioned. When the stable external API ships, this needs an /api/v1/ prefix. → FU-145
2. [API] pages/api/loads/[id]/unassign.js:1 — No contract documentation. Add JSDoc describing request/response/error shapes. → FU-146
3. [State] pages/api/loads/[id]/unassign.js:23 — Driver unassignment has no event emit. Flag for load.driver.unassigned emission when event spine ships. → FU-147
4. [State] pages/api/loads/[id]/unassign.js:23 — Unassignment creates an audit record as a side effect. Document this side effect for future event payload design. → FU-148
```

Four new `followups.md` entries written.

### Example 3: hardcoded hazmat surcharge

**Edit:** Added `if (load.commodity === 'HAZMAT') total += 250;` in `lib/pricing/calculate-invoice.js:134`.

**Gate evaluation:**
- G4 (Business logic): YES — hardcoded conditional in pricing code outside the rules-engine file set (see G5 for authoritative list)

**Adaptive checks:**
- BL-1 (shape-based move candidate): the conditional has a clear `operator` (equals), `condition` field (`load.commodity`), and `action` (add 250) — shape matches the `operator + condition + action` pattern the tariff / charge-profile / driver-pay-rule engines use → finding: "move to rules engine, specific engine TBD during review"
- BL-2 (tenant-specific): not tenant-specific → no elevation
- BL-3 (magic number): $250 is a magic number → already covered by BL-1's recommendation (moving to rules engine makes it tenant-configurable)

**Output:**
```
⚠ dd-ai-ready: 1 AI-readiness finding

1. [Business-logic] lib/pricing/calculate-invoice.js:134 — Move rule from lib/pricing/calculate-invoice.js:134 to the rules engine — shape matches the operator + condition + action pattern the tariff / charge-profile / driver-pay-rule engines use. Specific engine selection to be determined during review. → FU-149
```

## Relationship to Stream B and Stream C

**Stream A** (this skill) → generates categorized findings as a byproduct of normal feature work. Findings accumulate in `followups.md`.

**Stream B** (architecture audit → gap roadmap) → reads the accumulated `[ai-ready]` findings, clusters them by category, produces a prioritized roadmap of infrastructure to build. Stream B is a manual pass run periodically (e.g., quarterly) — it's the user + Claude sitting down and saying "we have 47 State findings; it's time to design the event spine."

**Stream C** (AI agent runtime + SOP framework + admin feature flag) → the actual product feature. Built after Stream B produces enough infrastructure (stable API, event spine, machine-readable rules). Scoped as a separate spec when the time comes.

This skill unblocks Stream B by giving it source material. It does not itself do the audit or build the roadmap.

## Testing / Verification

The skill has no runtime code — it's a set of instructions Claude follows. Verification is done by:

1. **Worked examples** — the 3 examples above define expected behavior on canonical edit types. During skill authoring, walk through each and confirm the gate + checks produce the expected findings.
2. **Edge cases** — a handful of edits that should and should not trigger each gate check, confirmed by dry-run invocation:
   - Edit to a `.css` file → no gate triggers → one-liner output.
   - Edit to `pages/api/health.js` (trivial health check) → G1 triggers → API branch runs → findings for versioning/docs, no state/BL findings.
   - Edit to `migrations/099_add_index.sql` (just adds an index) → G2 triggers → Schema branch runs → likely zero findings since no new columns.
   - Edit that touches 3 gates at once (e.g., a new API endpoint that updates state and adds a migration) → all 3 branches run in sequence, findings grouped by branch in the report.
3. **Integration with `dd-qa`** — confirm `dd-qa` runs first, completes, then `dd-ai-ready` runs. Order preserved even if the user re-invokes manually.

No automated test suite. The skill is a runbook, not code.

## Rollout

The skill ships in a single PR:

1. Skill file created in the appropriate skills directory.
2. Skill registered / discoverable by Claude (mechanism TBD based on dd-qa's current installation — implementation plan addresses this).
3. A single smoke-test edit in the DrayageDirect codebase confirms the skill fires after `dd-qa` and produces the expected output.
4. An initial entry is added to `followups.md`'s header noting that the `[ai-ready]` prefix is now a reserved tag.
5. Memory update: add `dev_ai_ready_skill.md` under the "Engineering conventions" section of the memory index (alongside `dev_migration_template.md`, `dev_dark_mode_convention.md`), noting that dd-ai-ready now runs alongside dd-qa and findings accumulate with the `[ai-ready]` prefix.

**Post-ship monitoring** (first 2 weeks):
- Track the ratio of "no concerns" exits vs. findings-produced runs. If > 90% are "no concerns," the gate is correctly quiet. If < 50% are "no concerns," the gate is too broad and should be tightened.
- Track whether the user is acting on findings vs. ignoring them. If findings pile up with no closures, either (a) the findings aren't useful or (b) the infrastructure to fix them doesn't exist yet (expected). Revisit the skill's check list if (a).

## Open Questions (deferred to implementation plan)

1. **Exact skill file location** — wherever `dd-qa` lives. Implementation plan verifies.
2. **FU-XXX numbering source** — the skill writes to `followups.md`; the numbering convention should continue the existing sequence. Implementation plan verifies the current max FU number and the skill's "next number" logic.
3. **Diff source for gate checks** — the skill needs access to the diff of what was just edited. For Edit tool calls this is straightforward; for Write tool calls (new files) the whole file is "the diff." Implementation plan specifies how the skill introspects the most recent edit.
4. **Interaction with `dd-qa`'s failure** — if `dd-qa` reports a correctness issue, does `dd-ai-ready` still run? Recommendation: yes, they're independent concerns. Implementation plan confirms.

## Risks

1. **Noise overwhelms signal.** If the gate is too generous and every edit produces 10 findings, the ledger gets polluted and the user starts ignoring the skill. Mitigation: the 5-check gate is designed to silently pass on non-relevant edits; the post-ship monitoring catches tuning needs.
2. **Findings go stale.** The infrastructure to close `[ai-ready]` findings (event spine, stable API) takes months to build. During that time, hundreds of findings accumulate. Mitigation: this is a *feature*, not a bug — the pile is Stream B's input. The `[ai-ready]` prefix makes them filterable so they don't drown out other follow-ups.
3. **Skill drifts out of sync with `dd-qa`.** If `dd-qa`'s trigger paths change and `dd-ai-ready`'s don't, the two skills diverge. Mitigation: they live in the same directory, are maintained together, and their triggers should be updated in lockstep. The memory index entry calls this out.
4. **The "adaptive checks" logic gets complex.** Each branch has 3–4 questions; 5 branches × 3–4 questions = up to 20 checks the skill has to execute. If the skill body grows unmaintainably large, split into per-branch sub-skill files and have the main skill dispatch. Revisit after 3 months of use.
5. **False confidence.** The skill catches *some* AI-readiness concerns. It does not catch all of them. Users should not read "✓ No concerns" as "this code is AI-ready" — it means "no concerns matched the gate checks." Stream B's audit is the authoritative pass.
