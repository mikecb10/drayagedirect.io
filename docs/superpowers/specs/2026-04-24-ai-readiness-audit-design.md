---
name: 2026-04-24-ai-readiness-audit-design
description: One-time AI-readiness audit of the DrayageDirect codebase across 6 dimensions (5 mirroring Stream A gates + AI-runtime cross-cutting concerns). Produces a markdown document at `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` containing per-category current-state / future-state / gap / priority analysis plus a synthesis section recommending the Stream B.1 deep-dive target. Every identified gap becomes an FU entry in followups.md. Output only — zero code changes, zero migrations.
type: spec
---

# AI-Readiness Audit — Design Spec

## Summary

Stream A (`dd-ai-ready` skill) is live and now catches AI-readiness concerns at the moment new code is written. But the codebase has ~55 files in `lib/`, 95 migrations, and a `pages/api/` surface across 6 subtrees — none of which have been audited against AI-agent-readiness principles. Stream B is the one-time retrospective audit that Stream A complements.

The audit's job is to answer three questions: (1) what do we have today, (2) what do per-tenant AI agents need in each area, and (3) which gap do we close first. The deliverable is a single markdown document (~10–20 pages) that clusters findings across 6 dimensions (the 5 Stream-A categories plus cross-cutting AI-runtime concerns) and ends with a priority-ranked synthesis recommending one target for Stream B.1 / Stream C's first infrastructure work.

The audit is observational and prescriptive on priority, never prescriptive on implementation detail. Technology choices (which event bus, which API versioning strategy, which SOP DSL) are explicitly Stream C's job — Stream B only says "event spine comes first" or "stable API comes first" based on what unblocks the most downstream work.

Every gap the audit identifies integrates with Stream A's ledger: new gaps get `[ai-ready]` FU entries; existing Stream A findings get clustered by category and referenced, not duplicated. This keeps one source of truth.

## Goals

- Produce one comprehensive audit doc spanning all 6 dimensions so the priority signal across the whole codebase is legible in a single read
- Every section has the same 4-part shape (current / future / gap / priority) so the doc is skimmable
- End the doc with a synthesis section that names a single recommended Stream B.1 deep-dive target (the infrastructure to build first) plus a dependency graph showing what each deep-dive unblocks
- Integrate with `followups.md` — every gap becomes a tracked FU entry; no parallel ledger
- Finish in one spec → plan → execute cycle (not multi-session) — if it turns out to be too big, decompose by category at execution time
- Write it in a way that it stays useful as a reference even after Stream B.1 / C ship — i.e., it's not only a planning artifact, it's a "here's how the system actually worked on 2026-04-24" snapshot

## Non-Goals (explicitly out of scope)

1. **Fixing anything identified.** The audit names gaps; it does not close them. Each gap's FU entry is the handoff to future work.
2. **Writing Stream C specs.** Agent runtime, SOP framework DSL, admin feature-flag plumbing — all separate specs that consume this audit as input.
3. **Choosing specific technology.** The audit may say "an event spine is needed" but will not say "use X library" or "use Postgres LISTEN/NOTIFY." That's a downstream design decision.
4. **Deep architectural redesigns.** The audit does not propose "rebuild this differently." It catalogs + prioritizes.
5. **Performance, security, or correctness audits.** Those are separate audit types. This one is AI-agent-readiness only.
6. **Running the code.** Pure static analysis — reading files, grepping for patterns. No test runs, no instrumented execution, no database inspection beyond schema.
7. **Retroactive re-flagging of already-shipped Stream A findings.** If an `[ai-ready]` FU already exists for something the audit would otherwise flag, reference it — don't duplicate.
8. **Branch/worktree isolation.** The deliverable is a markdown doc committed to main. No feature branch needed.
9. **Multi-tenant data inspection.** The audit reads schema and code, not actual tenant data.
10. **Timing / effort estimates beyond S/M/L/XL buckets.** Sizing at the audit stage is a signal, not a plan. Day-level estimates come in the Stream B.1/C plans.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Single audit document, one cycle | Broad-shallow priority signal beats deep-narrow vertical |
| D2 | 6 dimensions: 5 Stream-A categories + AI-runtime cross-cutting | Mirrors Stream A's gate structure so findings cluster; adds one section for runtime concerns Stream A's per-edit gate doesn't catch |
| D3 | 4-part per-category format: current / future / gap / priority | Skimmable; uniform shape lets reader compare across dimensions |
| D4 | Priority rank = H/M/L × agent-impact × effort-to-retrofit-later | Simple enough to assign by eye; weighted toward "cost of delay" since that's the point of auditing now |
| D5 | Every gap → FU entry with `[ai-ready]` prefix | Uses Stream A's existing ledger; no parallel tracking |
| D6 | Doc lives at `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` | New directory parallel to `specs/` and `plans/` so audits are a first-class artifact type |
| D7 | Synthesis section names one Stream B.1 target | Forces a concrete next-step recommendation; avoids "everything is important" sprawl |
| D8 | Static analysis only; no runtime inspection | Cheap, reproducible, matches the per-edit discipline Stream A uses |
| D9 | Scope capped at one cycle; decompose mid-execution if too big | Prevents audit sprawl; category-level decomposition is a clean fallback |
| D10 | Audit includes file:line references for every claim | Makes findings verifiable; future readers can confirm nothing has bit-rotted since the audit |

## Audit Structure (6 dimensions)

The document has one section per dimension. Each section is 1–2 pages. The order reflects Stream A's gate numbering for continuity:

### 1. API surface (mirrors Stream A's G1)

- **Current state inventory:** every file under `pages/api/**` classified by purpose (admin / auth / cron / driver / tenant / webhooks / misc)
- Versioning status: count of `/api/v*/` prefixed vs. unprefixed endpoints (expected: 0 versioned today)
- Documentation coverage: endpoints with JSDoc blocks / adjacent `.md` / OpenAPI entries vs. none
- UI-coupling heuristic: scan for response-shape fields that encode display concerns (`displayLabel`, `isSelected`, `uiSortKey`, `badgeColor`)
- Business-logic-inline vs. lib-delegated: does the handler call into `lib/*` or does it have its own SQL/compute?

### 2. Data schema (mirrors Stream A's G2)

- **Current state inventory:** every migration in `supabase/migrations/` scanned; canonical entity list extracted (`orders`, `order_charge_sets`, `order_driver_pay_lines`, etc.) with their columns
- Audit-trail coverage: which state-bearing tables have a `*_history` table or equivalent; which don't
- Reference-data vs. hardcoded-enum ratio: count of `CREATE TYPE ... AS ENUM` vs. lookup tables with `tenant_id`
- Agent-friendly naming score: sample 20 columns; score naming (opaque / workable / agent-friendly)
- New-canonical-entity candidates: things agents will want to query that aren't first-class entities today

### 3. State / event spine (mirrors Stream A's G3)

- **Current state inventory:** every file that writes a status/state change (grep for `.update(` + status-bearing columns across `pages/api/`, `lib/`)
- Side-effects per transition: which transitions trigger auto-charge-set creation, auto-email sends, auto-rebill, etc. — catalog each
- Current audit trail mechanism: log tables, audit triggers, event-like patterns (if any)
- Duplicated transition paths: same state change written from 2+ places (candidates for centralization)
- Recommended event shape: what a future event payload needs to carry (entity_id, tenant_id, from_state, to_state, actor, caused_by, side_effects_triggered, ...)

### 4. Business logic (mirrors Stream A's G4)

- **Current state inventory:** grep for conditional business rules outside rules-engine files — file:line list
- For each hardcoded rule, tag one of:
  - "Could move to rules engine today" (engine already supports the shape)
  - "Engine extension candidate" (new rule type needed)
  - "Cannot be rules-engine-ified" (too irregular; stays as code)
- Tenant-specific branches: grep for `tenantId === '...'` (critical — multi-tenant correctness concern, not just AI readiness)
- Magic numbers in pricing/routing: list of thresholds/constants that should become tenant config

### 5. Rules engine (mirrors Stream A's G5)

- **Current state inventory:** per engine (tariff, driver-tariff, charge-profile, driver-pay, routing, ar-rules, condition-evaluator, dry-run) — what rule shapes does it support today? What's declarative vs. executable code?
- Export readiness: could each engine's active-rules-for-tenant be serialized as JSON an agent could read?
- Evaluator purity: does each engine evaluate side-effect-free, or does evaluation itself write data / send email / call APIs?
- Dry-run coverage: how many engines have a pure "what would happen if?" mode vs. only "apply this now"?
- New-rule-type schema documentation: does adding a new rule type require updating a schema doc, or is it tribal knowledge?

### 6. AI-runtime cross-cutting (Stream A's gate doesn't cover)

- **Admin feature flag plumbing:** how are existing tiered features (per `feature_branches.md`, `project_email_sender_architecture.md`) enabled per tenant? Is there a pattern the future "AI enabled" flag can slot into?
- **Per-tenant capability gating:** if a tenant has AI enabled, what needs to be configurable? SOP set, allowed-action whitelist, escalation thresholds?
- **Intent / outcome log landing spot:** where should "agent wanted to do X, called Y, got Z" records live? Closest existing table?
- **SOP schema landing spot:** SOPs are essentially "rules bound to scenarios" — does an existing rules-engine engine extend naturally, or does SOP need its own?
- **Observability hooks:** once agents are running, how does operational oversight work? Existing dashboard / log / alert patterns worth reusing?
- **Rate limiting, quotas, cost controls:** agents calling APIs on behalf of tenants need budget controls — any existing infra to lean on?

## Per-Category Format (uniform shape)

Each of the 6 sections follows this shape:

```
### N. [Category]

#### Current state
[Inventory + observations, with file:line references. 3-6 bullet points max.]

#### Future state (what AI agents will need)
[What the per-tenant AI agent runtime will require from this area. 3-6 bullet points max.]

#### Gap
[Delta between current and future. Concrete. 3-8 bullet points.]

#### Priority
[H / M / L based on (agent-impact) × (cost-of-retrofit-later). One sentence of rationale.]

#### Dependencies
[Does this gap depend on another category's work? One line.]

#### Tracked follow-ups
[List of FU-XXX entries opened or referenced. Bulleted.]
```

Total per section: ~400-600 words, plus file references. 6 sections = ~3,000-4,000 words for the dimension coverage.

## Synthesis Section (the punchline)

After the 6 dimensions, one "Synthesis" section with:

### 6-dimension priority matrix

A table:

| Dimension | Priority | Agent-impact | Cost-of-delay | Effort bucket |
|---|---|---|---|---|
| 1. API surface | H/M/L | ... | ... | S/M/L/XL |
| 2. Data schema | ... | ... | ... | ... |
| ...etc |

### Dependency graph

A simple text/ASCII dependency graph:

```
Event spine (Dim 3) ──┬──> Stable API (Dim 1) ──> Agent runtime entry point
                      ├──> Audit-trail completion (Dim 2)
                      └──> Intent log (Dim 6)

Rules-engine declarative schema (Dim 5) ──┬──> SOP schema (Dim 6)
                                          └──> Business-logic migration (Dim 4)

Admin feature flag (Dim 6) ──> independent; unblocks everything behind tenant gating
```

(Actual graph shape depends on findings — above is illustrative.)

### Recommended Stream B.1 target

One paragraph naming the single highest-leverage infrastructure piece to design next. Explains:
- What it is
- Why it's first (what it unblocks)
- Approximate effort bucket (S/M/L/XL)
- What's expected to emerge from the Stream B.1 spec (not the spec itself — just what it covers)

### Bottom-line priority summary

A three-sentence "if you only read this paragraph" summary. This is what stakeholders read first.

## Ledger Integration

For every gap identified in the audit, the auditor (Claude) does one of:

1. **Reference existing FU** — if an `[ai-ready]` entry already exists in `followups.md` for this gap (produced by Stream A during ongoing feature work), cite it. Do not duplicate.
2. **Open new FU** — if no existing entry matches, open a new `### FU-XXX: [ai-ready] <Category>: <title>` entry with:
   - `Source: docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (pointing back to the audit)
   - `Scope: small / medium / large` matching the audit's effort bucket
   - `Area: infra` (standard for AI-readiness)
   - `Intent: <the gap, in one sentence>`
   - `Notes:` including file:line refs from the audit's Current state section

Every new FU number is allocated sequentially from the current max (next available after FU-046 as of spec-writing time). If the audit opens 30 gaps, it consumes FU-047 through FU-076 — perfectly fine, that's what the ledger is for.

## Execution Model

One spec → plan → execute cycle:

1. **This spec** (what we're approving now)
2. **Plan** (writing-plans skill) — breaks the audit into actionable tasks: read X, grep for Y, write section Z
3. **Execute** — one implementer subagent does the static analysis and produces the audit document
4. **Review** — spec-compliance reviewer + quality reviewer pass, same as Stream A
5. **Close out** — commit the audit doc + all new FU entries + update MEMORY.md

**If mid-execution the audit turns out too big for one pass,** the implementer decomposes by dimension: ships the audit with the first N dimensions covered; opens FU entries for the remaining dimensions ("finish dim K in next session"). This is a graceful fallback, not a failure mode.

## Output Location

- **Audit doc:** `docs/superpowers/audits/2026-04-24-ai-readiness-audit.md` (new directory)
- **Directory README** (optional, one-time): `docs/superpowers/audits/README.md` — "audits are retrospective analyses of the codebase against a specific concern (AI-readiness, security, accessibility, etc.). Each audit is a point-in-time snapshot with file:line refs."
- **FU entries:** `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (standard ledger)
- **MEMORY.md update:** new entry under a "Reference docs" or "Audits" section pointing to the committed audit

## Risks

1. **Audit sprawl.** 6 dimensions × detailed analysis could balloon into a 50-page doc nobody reads. Mitigation: word-count targets per section (400-600 words), file:line refs keep claims compact, synthesis section is the only mandatory read.
2. **Audit becomes stale fast.** The codebase is actively evolving. Mitigation: audit header includes the commit SHA it was run against; staleness is a known feature, not a bug; Stream A catches drift going forward.
3. **Priority assignments are subjective.** H/M/L with one-sentence rationale isn't rigorous. Mitigation: audit explicitly documents the reasoning per priority call; reader can disagree and re-rank.
4. **Synthesis over-commits.** Naming one Stream B.1 target might pre-empt your judgment — you see the audit and want a different priority. Mitigation: the synthesis is a *recommendation*, not a decision. You veto at review.
5. **Dependency graph is hand-wavy.** A text dependency graph isn't a formal model. Mitigation: it's not intended as formal — it's a priority-ordering aid. Stream B.1's spec will do the real dependency modeling if needed.
6. **FU flood.** Opening 30 new `[ai-ready]` FUs in one go could overwhelm the ledger. Mitigation: `[ai-ready]` prefix makes them filterable; Stream A already expected this accumulation; MEMORY.md audit-line bump notes the new count.

## Open Questions (deferred to plan)

1. **How deep does the implementer go on "scan every file"?** E.g., "read all 95 migrations" vs. "sample 20 representative migrations and infer patterns." The plan answers. Recommendation: sample + verify the sample is representative.
2. **Who verifies the static analysis is accurate?** The implementer produces the audit; the spec-compliance reviewer spot-checks claims against actual code. Plan details the spot-check methodology.
3. **Synthesis recommendation confidence level.** If the implementer isn't confident in the "single B.1 target" pick, they can report it as a ranked top-3 with a preferred choice. Plan addresses.
4. **Directory README — do we actually create `docs/superpowers/audits/README.md`?** Small point; plan decides.
