---
name: 2026-04-24-ai-readiness-audit
description: One-time retrospective audit of the DrayageDirect codebase against per-tenant AI-agent-readiness across 6 dimensions. Identifies gaps between current state and future agent runtime requirements, opens one FU entry per gap, and recommends one Stream B.1 deep-dive target in the synthesis.
type: audit
commit_sha: 9a89bb4
---

# DrayageDirect AI-Readiness Audit

**Run date:** 2026-04-24
**Against commit:** `9a89bb4`
**Spec:** `docs/superpowers/specs/2026-04-24-ai-readiness-audit-design.md`
**Plan:** `docs/superpowers/plans/2026-04-24-ai-readiness-audit.md`

## Bottom line (read this first)

The DrayageDirect codebase is **structurally strong** for AI-agent readiness — multi-tenant isolation is intact (zero hardcoded `tenantId === '...'` branches), the rules engine is already declarative with JSONB storage + 33 documented rule types + pure evaluator primitives, and `tenant_audit_log` has 252 call sites covering essentially every mutation — but it lacks the canonical event spine that per-tenant AI agents will need to react to state transitions. The highest-leverage gap is the **canonical event spine** (Dim 3); closing it simultaneously unblocks audit-trail completion (Dim 2), intent/outcome logging (Dim 6), and agent-subscription triggers. **24 new `[ai-ready]` follow-ups** have been opened to track every identified gap — see `followups.md` or the per-dimension "Tracked follow-ups" subsections below.

---

## 1. API surface

### Current state

- **Endpoint count:** 176 files across `pages/api/**`, distributed as: tenant=155, admin=13, auth=2, driver=1 (`driver/loads/[id]/rail-slip.js`), webhooks=1 (`sendgrid.js`), cron=1 (`evaluate-triggers.js`), plus top-level `quote.js`, `hello.js`, `health.js`. (Verified: `find pages/api -name "*.js" | wc -l` returns 176.)
- **Versioning:** zero `/api/v*/` prefixed subdirectories (verified: `find pages/api -type d -name "v*"` returns empty). All endpoints live under their domain root (e.g., `/api/tenant/loads`, `/api/admin/features`).
- **Documentation coverage:** 81 of 176 endpoint files contain at least one `/**` block (46%; verified: `grep -rlE "^/\*\*" pages/api --include="*.js" | wc -l`). Zero adjacent `.md` contract files exist in `pages/api/**`.
- **UI coupling in responses:** 18 lines across all handlers match `displayLabel|isSelected|uiSortKey|badgeColor|formattedTotal|formattedDate|_display|Display:`, but all 18 are legitimate data fields (`from_display_name` for email sender display, `company_display_name` for tenant branding) not UI scaffolding. A stricter grep for `sortKey|badgeColor|uiLabel|labelText` returns 0. **Response shapes are already domain-canonical** — the UI-coupling concern is largely not present.
- **Business-logic-inline vs. lib-delegated** (from 10-sample): **7/10 delegate substantially to `lib/*`** — `tenant/loads/index.js:1-12` imports 7 lib modules (tariff-engine, routing-template-seed, kpi-engine, load-margin, etc.); `tenant/ar/invoices/index.js:1-11` imports 5. **3/10 have substantial inline logic** — `admin/tenants/index.js` (inline SQL via `supabase.from(...)` at line 27-37), `admin/features.js` (inline), `auth/login.js` (inline `MAX_ATTEMPTS`/`LOCKOUT_MINUTES` + rate-limiting at line 3-4). `loads/[id]/charge-sets/[csId].js:21-34` has an inline `recomputeTotals` helper that is business logic.
- **Representative handler shape:** tenant endpoints follow the pattern `requireTenantUser(req, res)` → `requirePermission(ctx, [PERMISSIONS.X])` → `getServiceClient()` → Supabase query with `.eq('tenant_id', ctx.tenantId)` scoping → return. Cited: `pages/api/tenant/loads/index.js:65-79`, `pages/api/tenant/ar/invoices/index.js:19-24`, `pages/api/tenant/ar/invoices/[invoiceId].js:15-22`. Admin endpoints follow a similar `requireAdmin` pattern but skip `tenant_id` scoping (`pages/api/admin/tenants/index.js:13-32`).

### Future state (what AI agents will need)

- A **versioned, stable API surface** (`/api/v1/*`) that agent runtimes can bind against without breaking when UI screens change.
- **Documented request/response contracts** per endpoint — JSDoc, OpenAPI, or adjacent `.md` — so agents can register tool calls against machine-readable schemas.
- **Canonical domain responses** (the current shape, preserved) so agents consume stable data formats. Good news: this already holds for the sampled endpoints.
- **Handler → library delegation everywhere** so agent runtimes can invoke business logic without an HTTP hop. The 7/10 ratio is promising; the 3/10 gap (mostly admin + auth) is the work.
- **Per-endpoint permission semantics** exposed as metadata (RBAC roles, side effects, mutation targets) so agents can reason about what they're allowed to call.

### Gap

- No versioned prefix exists today. Introducing `/api/v1/*` is a breaking change for the UI unless done with path aliasing/rewrite.
- JSDoc coverage is 46% (81/176) — the other 95 endpoints are undocumented or covered only by variable naming. No OpenAPI schema, no adjacent `.md`.
- 3/10 sampled endpoints (admin + auth) perform business logic inline; agents would need to go through HTTP to reach that logic.
- No endpoint metadata registry — no single source of "what does each endpoint do, what RBAC does it require, what does it mutate?"
- UI coupling is **not** a material gap (18 hits are all legitimate domain fields). This dim closes faster than initially expected.

### Priority

**H** — reasoning: AI agents have zero path to the system without a stable, documented API surface. However, UI-coupling is already clean, and 7/10 of tenant endpoints already delegate to `lib/*`, so the effort is smaller than a full rewrite. Agent-impact is high (gating); cost-of-delay is moderate (aliasing is always possible); effort is M (adding versioning prefix + JSDoc coverage for the top-20 most-called endpoints + extracting the 3 admin/auth cases).

### Dependencies

- API canonical-response shape depends on the data-schema audit (Dim 2) — the canonical shape IS the schema's first-class entity shape (already largely aligned).
- Handler → lib extraction for the 3 inline cases overlaps with the business-logic audit (Dim 4).

### Tracked follow-ups

- `FU-047` — Versioning strategy and `/api/v1/*` aliasing plan
- `FU-048` — JSDoc / OpenAPI contract coverage for top-20 endpoints (currently 46% overall)
- `FU-049` — Extract inline business logic in `admin/tenants/index.js`, `admin/features.js`, `auth/login.js` to `lib/*`
- `FU-050` — Endpoint metadata registry (RBAC, side effects, mutation targets)

---

## 2. Data schema

### Current state

- **Migration count:** 95 total migrations (`001_initial_schema.sql` through `095_invoice_rebill_lineage.sql`). Earliest is the initial schema; most recent five are `091_driver_planner_assigned_at.sql`, `092_load_margin_thresholds.sql`, `093_payment_document.sql`, `094_invoice_date.sql`, `095_invoice_rebill_lineage.sql` (all 2026-04). Verified: `ls supabase/migrations/*.sql | wc -l` = 95.
- **Canonical entities:** 114 unique `CREATE TABLE` statements grouped by domain (verified: grep `^CREATE TABLE` across all migrations):
  - **Loads / orders:** `orders`, `order_charge_sets`, `order_charge_set_line_items`, `order_charges`, `order_container_moves`, `order_driver_pay_lines`, `order_documents`, `order_holds`, `order_notes`, `order_routing_events`, `order_status_history`
  - **AR / billing:** `invoices`, `invoice_charge_sets`, `invoice_line_items`, `invoice_orders`, `payments_received`, `payment_applications`, `credit_memos`, `accessorial_charges`
  - **AP / driver pay:** `driver_pay`, `driver_settlements`, `driver_settlement_lines`, `driver_settlement_deductions`, `driver_deductions`, `settlement_periods`, `driver_charge_profiles`, `driver_charge_profile_tiers`, `driver_charge_profile_versions`, `driver_tariffs`, `driver_tariff_charge_sets`, `driver_tariff_charge_set_profiles`, `driver_tariff_advanced_routes`
  - **Drivers / equipment:** `drivers`, `driver_groups`, `driver_group_members`, `driver_location_pings`, `drive_segments`, `geofence_events`, `equipment_trucks`, `equipment_trailers`, `equipment_chassis`
  - **Organizations:** `customers`, `customer_branches`, `customer_contacts`, `customer_contact_groups`, `customer_contact_group_members`, `customer_billing_emails`, `organization_contacts`, `organization_groups`, `organization_group_members`, `branches`
  - **Routing / locations:** `locations`, `routing_templates`, `system_terminals`, `tenant_terminal_overrides`, `firms_codes`, `zip_codes`
  - **Pricing / rules:** `tariffs`, `tariff_charge_sets`, `tariff_charge_set_profiles`, `tariff_charge_set_tags`, `tariff_charge_items`, `tariff_advanced_routes`, `charge_profiles`, `charge_profile_tiers`, `charge_profile_versions`, `charge_profile_tags`, `per_diem_rules`, `per_diem_rule_tiers`, `rate_profiles`, `rates`
  - **Reference data:** `container_types`, `container_sizes`, `container_owners`, `chassis_types`, `chassis_sizes`, `chassis_owners`, `deduction_types`
  - **Tenants / users:** `tenants`, `tenant_settings`, `tenant_feature_flags`, `tenant_format_preferences`, `tenant_market_toggles`, `tenant_reference_sort_orders`, `tenant_reference_toggles`, `tenant_sender_addresses`, `tenant_sender_domains`, `users`, `user_permissions`, `user_invites`, `user_branches`, `user_dispatcher_preferences`, `user_ar_preferences`
  - **Email / comms:** `email_accounts`, `email_account_permissions`, `email_configurations`, `email_configuration_umbrellas`, `email_messages`, `email_message_attachments`, `email_templates`, `email_template_triggers`, `email_trigger_log`, `email_umbrellas`, `email_umbrella_groups`, `email_umbrella_group_templates`
  - **Misc / infra:** `dry_run_attempts`, `dd_employees`, `subscription_tiers`, `feature_flags`, `account_lockouts`, `document_submissions`
- **Audit-trail coverage:** only one per-entity history table exists — `order_status_history` (`supabase/migrations/001_initial_schema.sql`). **Entities with `status` columns but NO `*_history` table:** `invoices` (`001_initial_schema.sql:562`, `status invoice_status_enum`), `driver_pay` (`001_initial_schema.sql:539`), `driver_settlements`, `order_charge_sets` (has `versions` table but not `status_history`), `rate_profiles` (`001_initial_schema.sql:334`). Coverage is ~1/5 state-bearing entities (~20%). The generic `tenant_audit_log` (`001_initial_schema.sql:662`) captures old/new JSON values for ANY entity as a catchall, but isn't structured per-state-transition.
- **Enum vs lookup-table ratio:** **16 hardcoded `CREATE TYPE ... AS ENUM` types** in `001_initial_schema.sql:15-37` (tenant_status_enum, user_role_enum, order_status_enum, invoice_status_enum, driver_pay_status_enum, location_type_enum, container_size_enum, origin_dest_type_enum, billing_email_type_enum, customer_contact_role_enum, charge_type_enum, rate_profile_status_enum, subscription_tier_enum, user_status_enum, permission_type_enum, driver_pay_type_enum) vs. **7+ tenant-scoped lookup tables** (`container_types`, `container_sizes`, `container_owners`, `chassis_types`, `chassis_sizes`, `chassis_owners`, `deduction_types`). Notable: `container_size_enum = ('20','40','40HC','45')` at `001_initial_schema.sql:32` overlaps `container_sizes` table — partial double-tracking.
- **Agent-friendly naming (sample of 3 recent migrations: 093, 094, 095):** 7 columns added (`document_url`, `document_filename`, `invoice_date`, `rebilled_at`, `rebilled_by_user_id`, `rebilled_to_invoice_id`, `rebilled_from_invoice_id`). **All 7/7 are agent-friendly** (verb + noun or noun + modifier; no `flag_N`, `extra_jsonb`, etc.). Extending the sample to older migrations: `order_driver_pay_lines.order_id` (from `session_2026_04_23_leg_distance_ship.md` note) follows the pattern. Naming quality is high.

### Future state (what AI agents will need)

- A **machine-readable schema catalog** agents can read to understand the domain — ideally autogenerated from the live schema (`information_schema` + column comments).
- **Complete audit trails** for every state-bearing entity (`invoices`, `driver_pay`, `driver_settlements`, `order_charge_sets`). The generic `tenant_audit_log` is a catchall, but structured per-entity history tables or an event-sourced projection are easier for agents to query.
- **Tenant-extensible reference data** — hardcoded enums should become lookup tables with `tenant_id` so customers can customize vocabulary (e.g., custom container sizes, custom load statuses) without code changes.
- **Agent-friendly column names** — already the prevailing pattern; preserve going forward.
- **Canonical entity IDs with stable references** — already universal (UUIDs + FK constraints); no regression concerns.

### Gap

- No machine-readable schema catalog today. Memory files (`feature_rules_engine.md`, `feature_tariffs_charges.md`) describe entities informally.
- Audit-trail coverage is weakest for billing/AP (invoices, driver_pay, settlements); only orders have per-entity history. `tenant_audit_log` exists as a generic fallback but its JSONB old/new shape is harder to query than a structured history table.
- 16 hardcoded enums block tenant customization. High-leverage ones to migrate first: `order_status_enum`, `invoice_status_enum`, `driver_pay_status_enum`, `container_size_enum` (duplicates `container_sizes` table).
- Column naming is clean — this is a preservation concern, not a gap.

### Priority

**M** — reasoning: Schema is stable overall (114 tables, clean naming, UUIDs everywhere, FK constraints consistent). The two real gaps are audit-trail completeness and enum → lookup-table migration. Both are high-leverage but can be done lazily behind the event-spine work. Agent-impact M (agents can use `tenant_audit_log` until richer trails arrive); cost-of-delay M (each new state entity added without a history table compounds).

### Dependencies

- Audit-trail completion strongly overlaps with State/event spine (Dim 3) — a single event-emission layer would populate per-entity history projections automatically.
- Schema catalog could block on API versioning decisions (Dim 1) — same consumption format (OpenAPI + JSON Schema) could cover both.

### Tracked follow-ups

- `FU-051` — Machine-readable schema catalog (autogenerated from live schema + column comments)
- `FU-052` — Per-entity audit-trail for `invoices`, `driver_pay`, `driver_settlements`, `order_charge_sets` (or event-sourced projections)
- `FU-053` — Migrate 16 hardcoded enums to tenant-scoped lookup tables (priority: `order_status_enum`, `invoice_status_enum`, `container_size_enum`)

---

## 3. State / event spine

### Current state

- **State-write locations:** 21 distinct `.update({ status: ... })` call sites across `lib/` and `pages/api/` (verified: grep `\.update\(\s*\{[^}]*status`). Breakdown by entity:
  - **`order_routing_events` / `order_container_moves` status** — 9 locations, all in `pages/api/tenant/loads/[id]/routing/index.js` (lines 86, 659, 673, 694, 702, 729, 744, 752) plus `routing/events/[eventId].js:428`. Transitions: `pending → in_progress → completed → pending_completion`. This single route file is the routing-state switchboard.
  - **`orders` status** — 3 direct locations: `pages/api/tenant/loads/[id]/index.js:571` (soft-delete → `cancelled`), `pages/api/tenant/loads/deleted.js:46` (restore → `pending`), `pages/api/tenant/dispatcher/planner/dispatch.js:46` (→ `dispatched`), plus `pages/api/tenant/loads/[id]/routing/index.js:702` (→ `completed` on complete_load action). Total: 4 files.
  - **`order_charge_sets` status** — 5 locations: `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js:274`, `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js:151`, `pages/api/tenant/ar/invoices/index.js:459`, `pages/api/tenant/ar/invoices/[invoiceId].js:140`, and `pages/api/tenant/loads/[id]/charge-sets/[csId].js` (known from Task 2 read).
  - **`driver_settlements` status** — 1 location: `pages/api/tenant/ap/settlements/[id]/index.js:80` (→ `finalized`).
  - **`credit_memos` status** — 1 location: `pages/api/tenant/ar/credit-memos/[memoId].js:92` (→ `void`).
  - **Soft-delete + inactive/disabled pattern** — 3 locations on `drivers` (`pages/api/tenant/drivers/[id]/index.js:103`), `organizations` (`pages/api/tenant/organizations/[id]/index.js:142`), `users` (`pages/api/tenant/users/[id]/index.js:115`).
  - Extending to `status: 'X'` literal form (broader grep across assignments, not just `.update()` args): 52 total lines — likely includes insert-time defaults.
- **DB-level triggers:** 65 `CREATE TRIGGER`/`CREATE FUNCTION` statements (verified: grep `(CREATE|REPLACE) (TRIGGER|FUNCTION)`). The overwhelming majority are `set_updated_at` row-level triggers or seed-on-insert helpers (e.g., `seed_tenant_format_preferences`, `seed_default_email_umbrella`). **No status-transition trigger logic** — state machines are implemented in application code, not database triggers. Notable non-updated_at triggers: `trg_email_umbrella_specificity` (`052_email_system_core.sql:209`), `trg_seed_system_email_templates` (`056_email_templates_seed.sql:308`).
- **Side-effect catalog** (transition → effect):
  - **Load `status` changed** → `lib/email-dispatch/status-change-fire.js:28` (`fireStatusChangeTriggers`) inserts a row into `order_status_history` at line 41 AND evaluates email-template triggers bound to that status. Called from `pages/api/tenant/loads/[id]/index.js:517`, `pages/api/tenant/loads/[id]/routing/events/[eventId].js:434`, `pages/api/tenant/loads/[id]/routing/index.js:10` (import). **This is the closest thing to an event emit that exists today** — but it's email-dispatch-specific, not a general spine.
  - **Load matching field changed** → `lib/auto-recalc-trigger.js:40` (`maybeRecalcOnLoadChange`) re-runs the tariff engine IF the first charge set is still `draft`; applies new charges via `lib/tariff-engine.js:459` (`applyChargesToLoad`). Called from the load PUT handler.
  - **`order_charge_sets.status = 'rate_con_sent'`** → auto-dispatches rate-con email via `lib/email-dispatch/dispatcher.js:462` (`dispatchEmail`); writes `sent_at` timestamp. Entry point: `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js:112`.
  - **Charge-set → invoice approval flow** (`ar/invoices/index.js:459`) cascades `status: 'invoiced'` back to the originating charge set(s).
- **Duplicate transition paths:**
  - **`order_charge_sets.status` = `'invoiced'`** is written from 2 different handlers (`ar/invoices/index.js:459` and `ar/invoices/[invoiceId].js:140`) — a centralization candidate.
  - **`order_container_moves.status` = `'completed'`** is written from 3 distinct actions (start/complete-move/complete-load) within `routing/index.js` (lines 673, 694, 744, 752). Single file, so low duplication risk, but the side-effect fanout ("mark every move completed + order delivered") at lines 692-707 is all inline.
  - **No cross-file duplication of `orders.status`** — the 4 write locations are action-distinct (cancel, restore, dispatch, complete).

### Future state (what AI agents will need)

- A **canonical event spine** where every state transition emits a structured event (`load.status.changed`, `charge_set.status.changed`, `invoice.status.changed`, `routing_event.status.changed`, etc.) with a stable payload shape: `{ entity_id, tenant_id, from_state, to_state, actor_id, actor_type, caused_by, side_effects_triggered, timestamp }`.
- **Event subscription API** so agents (and downstream systems) can react to state changes without polling.
- **At-least-once delivery** guarantees via an outbox pattern (atomic with the transition write).
- **Dry-run mode** on state transitions so agents can preview "if I accept this load, what cascades?" — `lib/dry-run-engine.js` already exists as a seed pattern (shipped 2026-04-22 per session recap).
- **Unified status-change fire** — the email-only `fireStatusChangeTriggers` shape in `lib/email-dispatch/status-change-fire.js` is a natural template to generalize.

### Gap

- **No general event spine today.** Every state transition is a point-write; the only "event-like" infrastructure is email-dispatch-specific (`status-change-fire.js`) and the `order_status_history` table (populated from that same single code path).
- **Side-effect sprawl** — auto-recalc, email dispatch, status-history writes, and downstream cascades are all invoked in-line by the handlers after `.update({ status })`. There's no atomic "transition + emit + effects" wrapper.
- **Duplicate transition paths** (charge_set `invoiced`, routing move `completed`) mean a future event spine must be added at each of them, OR they need centralizing first.
- **No outbox infrastructure.** Closest existing pattern: `pages/api/webhooks/sendgrid.js` for incoming events; no outbound event bus.
- **Dry-run is feature-specific**, not a general capability — `lib/dry-run-engine.js` targets tariff recalc; no generalized "simulate this state transition" API.

### Priority

**H** — reasoning: State/event spine is the single highest-leverage gap. Most agent use cases ("when load X transitions to Y, do Z") depend on event-driven execution. Effort is L (21+ transition points need centralization + emit), but the design space is well-understood: `fireStatusChangeTriggers` is a natural generalization target, and the outbox pattern is a well-known solution. Agent-impact H (gating for subscription-style agents); cost-of-delay H (each new state entity compounds the problem).

### Dependencies

- **Unblocks:** subscription-style agent triggers; audit-trail completion for billing/AP entities (Dim 2); intent/outcome logs (Dim 6 cross-cutting).
- **Depends on:** centralizing the duplicate transition paths first (prerequisite refactor, small); ideally a single `updateChargeSetStatus()` helper in `lib/charge-sets/` before hooking up emits.

### Tracked follow-ups

- `FU-054` — Design canonical event shape + emit-from-where decision
- `FU-055` — Centralize `order_charge_sets.status` updates (currently 5 locations, with 1 cross-file duplicate)
- `FU-056` — Centralize `order_container_moves.status` fanout in `routing/index.js` (3+ code paths + inline side effects at lines 692-707)
- `FU-057` — Outbox pattern / event bus selection (atomic transition + emit)
- `FU-058` — Generalize `lib/dry-run-engine.js` to cover any state transition, not just tariff recalc

---

## 4. Business logic

### Current state

- **Hardcoded business rules outside rules engines:** **CLEAN.** Grep surveys turned up zero material instances.
  - `commodity === '...'` outside engine files: **0 matches** (verified: `grep -rnE "commodity\s*===" lib pages/api` excluding engine files returns empty).
  - `customerId === '...'` / `customer_id === '...'` / `customerName === '...'`: **0 matches** (verified: `grep -rnE "customer(Id|_id|Name)\s*===?\s*['\"]" lib pages/api`).
  - Pricing/surcharge magic-number operations (`surcharge|fee|rate|charge|total` with `+=/-=/*=/` and a literal number): **0 matches** (verified: `grep -rnE "(surcharge|fee|rate|charge|total)\s*[+\-*/]=\s*[0-9]+"`).
- **Tenant-specific hardcoded logic:** **CLEAN.** 0 matches for `tenantId ===` or `tenant_id === '...'` across the entire codebase (verified: `grep -rnE "tenant(Id|_id)\s*===?\s*['\"]" lib pages/api --include="*.js"` returns empty). Multi-tenant correctness is intact. This dim avoids becoming a CRITICAL finding.
- **Magic-number thresholds:**
  - Day / hour thresholds: **0 matches** for `days?|hours?\s*>\s*[0-9]+` across `lib/` and `pages/api/` (verified).
  - Amount/total/cents comparisons: 5 matches total, **all `> 0` guards** not business thresholds (`lib/driver-tariff-engine.js:455`, `lib/driver-tariff-engine.js:472`, `lib/tariff-engine.js:296`, `pages/api/tenant/ar/invoices/[invoiceId].js:123`, `pages/api/tenant/loads/[id]/payments.js:135`). The engine hits ARE inside engines and part of their legitimate logic.
  - System-level auth thresholds: `MAX_ATTEMPTS = 5` and `LOCKOUT_MINUTES = 30` in `pages/api/auth/login.js:3-4` and duplicated at `pages/api/admin/auth/login.js:6-7`. These are system policies, not per-tenant business rules — but are duplicated rather than shared, and could become tenant-config if customers want different lockout policies.
- **Duplicated enum / reference arrays in API code:**
  - `VALID_LOAD_TYPES = ['import', 'inbound', 'export', 'outbound', 'road', 'bill_only']` at `pages/api/tenant/loads/index.js:14` — mirrors load_type data that lives in the DB (via `VALID_LOAD_TYPES`); any new tenant-defined load type would require editing this file.
  - `VALID_STATUSES = ['pending', 'available', 'dispatched', 'in_transit', 'dropped', 'delivered', 'completed', 'cancelled']` at `pages/api/tenant/loads/index.js:15` — duplicates `order_status_enum` (`supabase/migrations/001_initial_schema.sql:23`). Tenant-scoped custom statuses cannot be added without a code change.
  - `LOAD_TYPE_LETTER = { import: 'M', ... }` at `pages/api/tenant/loads/index.js:19-26` — single-letter prefix lookup for load-number generation.
- **Status-value conditionals** (`if (status === '...')`): 28 matches outside engines, clustered in:
  - `lib/dispatcher-states.js:198-211` — a **state classifier** (maps load.status → dispatcher column). This is categorization, not externalizable rules.
  - `lib/kpi-engine.js:372-487` — **KPI counters** (completed-today, dropped-today). Business-meaningful and covered by tests; moving these to an engine would add indirection without benefit.
  - Admin/handler guards (`pages/api/admin/tenants/[id]/index.js:68-71`, `pages/api/tenant/ap/settlements/[id]/index.js:50`) — one-off endpoint guards; appropriate where they are.
- **Classification (of hardcoded patterns found):**
  - MOVE NOW (rules engine supports the shape): **0** — the rules are already in engines.
  - ENGINE EXTENSION (new rule type needed): **0** — no candidates.
  - TOO IRREGULAR / legitimate code (KPI counters, dispatcher classifier, auth guards): ~30 sites — no action.
  - Tenant-extensible reference duplication (`VALID_LOAD_TYPES`, `VALID_STATUSES`, `LOAD_TYPE_LETTER`, system-wide `MAX_ATTEMPTS`/`LOCKOUT_MINUTES`): **4** sites — these are the real findings for this dim.

### Future state (what AI agents will need)

- All business rules **externalized** into the rules engine so agents can read the current rule set and reason about outcomes. **Already effectively achieved** — this codebase is the best-case starting position.
- **Declarative rule schema** (operator + condition + action) so rules are machine-parseable — see Dim 5 for engine-level gaps.
- **Tenant-extensible reference data** — `VALID_LOAD_TYPES`, `VALID_STATUSES`, auth-policy numbers should be pulled from tenant/system config so customers can customize without a code change.
- **Zero tenant-specific hardcoded branches** — **already achieved.**

### Gap

- **Business-logic externalization is effectively complete.** No hardcoded commodity / customer / tenant branches. The rules-engine discipline (`dev_ai_ready_skill.md` has been gating new code since Stream A shipped; earlier work followed the same pattern organically) has held.
- **Remaining gap is reference-data duplication, not business-rule externalization:** the 3 hardcoded arrays in `pages/api/tenant/loads/index.js:14-26` and the 2 auth constants in `pages/api/auth/login.js:3-4` / `pages/api/admin/auth/login.js:6-7`. Total: 5 sites where a small migration to DB/config would unblock tenant customization.
- Auth constants are duplicated verbatim across two files — minor DRY issue independent of AI readiness.

### Priority

**L** — reasoning: This dim is CLEAN. The findings that exist are 5 small reference-data/config-extraction items, each scope-small. Agent-impact is Low (rules are already readable via engine schemas — see Dim 5). Cost-of-delay is Low (each new file wouldn't typically add tenant-specific branches thanks to the dd-ai-ready gate). Effort S for cleanup. Elevated to M only if the Dim-2 enum migration hasn't yet happened; then the `VALID_STATUSES` duplicate would break at migration time.

### Dependencies

- Reference-data extraction depends on Dim 2's enum → lookup-table migration for the `order_status_enum` / `VALID_STATUSES` pair to avoid another cross-file duplication.
- System auth constants are independent; a small tenant-config extension would suffice.

### Tracked follow-ups

- `FU-059` — Extract `VALID_LOAD_TYPES` / `VALID_STATUSES` / `LOAD_TYPE_LETTER` from `pages/api/tenant/loads/index.js:14-26` into the DB (aligns with Dim 2 enum migration)
- `FU-060` — Move auth `MAX_ATTEMPTS` / `LOCKOUT_MINUTES` to shared config / tenant settings (currently duplicated at `pages/api/auth/login.js:3-4` and `pages/api/admin/auth/login.js:6-7`)

---

## 5. Rules engine

### Current state

- **Engine inventory (per domain):**
  - **Tariff engine** (`lib/tariff-engine.js`, 581 lines) — evaluates tenant-scoped `tariffs` + their `charge_profiles` against a load. Operators: `any_in / not_in / equal / not_equal / larger / smaller / larger_or_equal / smaller_or_equal / between / not_between`. Calculation modes: `between_statuses` (with per_hour/per_day/per_Nmin UOMs), `by_lane`, `by_event`, `by_move`. UOMs: `fixed`, `percentage`, `per_hour`, `per_day`, `per_15/30/45min`, `per_pounds`, `per_miles`, `radius_rate`. **Declarative: YES** — rules stored in DB as structured columns + JSONB conditions (`supabase/migrations/026_tariffs_charge_profiles.sql:16-37`). **Pure evaluator: PARTIAL** — `findMatchingCharges` (`lib/tariff-engine.js:50`) is pure; `applyChargesToLoad` (`lib/tariff-engine.js:459`) writes to `order_charge_set_line_items` (lines 480-564). Clean split already exists.
  - **Driver tariff engine** (`lib/driver-tariff-engine.js`, 564 lines) — mirror of tariff engine for driver-pay side. Same operators, same calculation modes. Declarative storage in `driver_tariffs`, `driver_charge_profiles`, `driver_charge_profile_tiers` (`supabase/migrations/067_driver_pay_rates.sql:19-89`). Pure / applied split follows the same pattern.
  - **Charge profile spec** (`lib/charge-profile-constants.js`, 248 lines + `lib/charge-profile-row-shapes.js`, 56 lines + `lib/driver-charge-profile-constants.js`, 193 lines) — the **schema definition** for charge-profile rule shapes. Exports `CHARGE_NAMES` (22 canonical charge types), `UNITS_OF_MEASURE` (11 UOMs), `UOM_MODES` (which calc modes each UOM supports). This IS a machine-readable schema today.
  - **Routing rules** (`lib/routing-rules.js`, 225 lines) — encodes drayage-specific event ordering (e.g., "can't deliver before pickup"). `ALLOWED_AFTER` is a static JS object mapping event_type → allowed next event_types. **Declarative: STATIC CODE** (not DB; not tenant-customizable). **Pure: YES.**
  - **Advanced route matcher** (`lib/advanced-route-matcher.js`, 192 lines + `lib/advanced-route-validator.js`, 63 lines) — matches a load's sequence of `order_routing_events` against a tariff's `route_template JSONB`. `LANE_DEFINING_EVENT_TYPES` and `OPERATIONAL_EVENT_TYPES` are hardcoded classifications. **Pure: YES.**
  - **AR rule definitions** (`lib/ar-rule-definitions.js`, 455 lines) — **33 rule types** documented with `key`, `label`, `category`, `operators`, `valueType`, `valueSource` (API endpoints for dropdowns). This is a **declarative rule-type registry** consumed by the UI condition builder. Machine-readable.
  - **Condition evaluator** (`lib/condition-evaluator.js`, 218 lines) — **general-purpose operator applicator** used by both tariff-engine and driver-tariff-engine. Takes `(load, conditions[], context)` → boolean. Pure function, AND-combines conditions. This is the atomic rule-evaluation primitive.
  - **Dry-run engine** (`lib/dry-run-engine.js`, 106 lines) — shipped 2026-04-22 per `session_2026_04_22_dry_run_ship.md`. Provides `computeManualAmount(input)` for dry-run attempts: fixed amounts or per-mile calculations, with sanity ceilings (`MAX_AMOUNT_CENTS = $100k`). Pure / side-effect-free. Feature-specific: covers the dry-run UI workflow, not state transitions generally.
- **DB rule storage:** 14+ rule-related tables (verified: grep `CREATE TABLE.*(rule|tariff|profile|rate)`). Key tables — **all use structured columns + JSONB for conditions, not SQL/JS string blobs**:
  - `tariffs` (`026_tariffs_charge_profiles.sql:70`) — structured matching columns (load_types, customer_ids, pickup_conditions JSONB, etc.) + priority ordering.
  - `charge_profiles` (`026_tariffs_charge_profiles.sql:16`) — `conditions JSONB DEFAULT '[]'::jsonb` + `match_resolution` enum (first_match_wins, highest_rate, lowest_rate, stack_combine).
  - `charge_profile_tiers`, `driver_charge_profile_tiers` — date-ranged price rows.
  - `driver_tariffs`, `driver_charge_profiles`, `driver_charge_profile_versions` — driver-pay mirror of the AR stack.
  - `per_diem_rules`, `per_diem_rule_tiers` — per-diem pricing rules.
  - `email_templates`, `email_template_triggers` — email firing rules (trigger + template pairing).
- **Schema documentation:** rule shape described in multiple memory files — `feature_rules_engine.md` (50+ rule types overview), `feature_tariffs_charges.md` (pricing engine), `feature_charge_profile_autofill.md`, `feature_driver_charge_profiles.md`. **Not machine-readable** (markdown prose).
- **Dry-run coverage:** 1 of ~7 major engines (`lib/dry-run-engine.js`) — the dry-run pattern applies to manual-charge dry-run attempts, not to "what would happen if I approved this charge set" or "what would happen if I accepted this load." Tariff engine has the pure `findMatchingCharges` (useful primitive) but no tenant-level "simulate this rule on this load" wrapper.
- **Evaluator purity:** 4 of 6 engines have pure evaluation split from application (tariff-engine, driver-tariff-engine, condition-evaluator, advanced-route-matcher, dry-run-engine all expose pure functions). The dispatch/apply step (`applyChargesToLoad`, auto-recalc trigger) writes data.

### Future state (what AI agents will need)

- **Declarative rule schemas** (JSON/YAML) for every engine so agents can read a tenant's active rule set. **Largely achieved** — the rule schema IS declarative + JSONB.
- **Exportable-per-tenant** — given a `tenant_id`, an agent can fetch "all tariff rules that apply to you." Endpoints exist for the UI (`/api/tenant/tariffs`, `/api/tenant/ar/config/**`); need a canonical agent-facing bundle rather than per-UI-endpoint.
- **Pure evaluators** — agents need deterministic rule evaluation for "dry-run this rule on input X" without triggering side effects. **Already the pattern** for tariff / driver-tariff engines (`findMatchingCharges`); needs to be generalized.
- **Unified rule language** — across engines, operators and conditions should share vocabulary. **Already largely unified** via `lib/condition-evaluator.js` (shared by AR and AP); 33 rule types in `ar-rule-definitions.js`.
- **SOP-compatibility** — extending the rules-engine schema to represent "when X scenario, perform Y sequence of actions" (SOPs). Natural fit given the existing declarative schema + condition evaluator; needs new action verbs.

### Gap

- Rule storage is already declarative + JSONB + tenant-scoped. Gaps are:
  - **No exported-for-agents bundle** — to read all rules for a tenant, an agent currently needs to call multiple `/api/tenant/*` endpoints (tariffs, charge-profiles, per-diem-rules, driver-charge-profiles, routing-rules). A single "/api/v1/agents/{tenant_id}/rules" snapshot would consolidate.
  - **Schema documentation is prose** (memory files), not machine-readable JSON Schema.
  - **Dry-run is feature-specific** (manual-charge dry-run only). A generalized "simulate this rule on this load" capability is missing.
  - **Routing rules are static code**, not DB-stored. Tenants can't customize drayage flow vocabulary. Low-priority gap because drayage physics don't vary by tenant, but Still a retrofit cost if ever needed.
  - **No SOP-shape extension yet.** The rules-engine schema could extend to action-sequences but no work has started.

### Priority

**M** — reasoning: The rules engine is the strongest dimension in the codebase for AI readiness. Existing declarative JSONB storage, 33 documented rule types, pure evaluator primitives, and a tenant-scoped schema mean most agent use cases for rule-reading are already technically possible. Remaining work is consolidation (agent-bundle endpoint) + SOP extension, not foundational refactor. Agent-impact M (already usable today via existing endpoints); cost-of-delay L (each new rule type adheres to the existing shape automatically via the dd-ai-ready gate).

### Dependencies

- SOP schema design (Dim 6 cross-cutting) depends on rules-engine declarative shape — the existing shape is a strong foundation.
- API exposure of rule sets (Dim 1) — an agent-bundle endpoint depends on versioning strategy (/api/v1/*).

### Tracked follow-ups

- `FU-061` — Design agent-bundle endpoint: single `/api/v1/agents/{tenant_id}/rules` snapshot covering tariffs, charge-profiles, per-diem, driver-pay, routing-rules
- `FU-062` — Generate machine-readable JSON Schema for rule types (from `lib/ar-rule-definitions.js` + `lib/charge-profile-constants.js`)
- `FU-063` — Generalize dry-run beyond manual charges: "simulate tariff match / simulate status transition / simulate apply" variants
- `FU-064` — SOP shape design (new action verbs on the declarative schema; candidate Stream C seed)

---

## 6. AI-runtime cross-cutting

### Current state

- **Feature-flag infrastructure:**
  - **First-class pattern exists.** `feature_flags` table (`supabase/migrations/001_initial_schema.sql:100-108`) defines flag catalog with `tier_required subscription_tier_enum`. Per-tenant overrides live in `tenant_feature_flags` (`001_initial_schema.sql:111-120`) with `(tenant_id, feature_flag_id, user_id)` unique key — supporting both per-tenant AND per-user overrides.
  - Admin management at `pages/api/admin/features.js` and `pages/admin/features.js` (verified: directory listing).
  - Newer tiered features use **boolean columns on `tenants`** as a shorthand: email sender tiers (`project_email_sender_architecture.md`), resilience tiers (`project_resilience_plan.md`), branches (`feature_branches.md`). This is parallel to the `feature_flags`/`tenant_feature_flags` pattern — adopted for simpler features.
  - RBAC definitions in `lib/permissions.js` + `lib/rbac.js` (per-role permission maps used by `requirePermission(ctx, [...])` at ~every tenant endpoint).
- **Audit / log infrastructure:**
  - **Tables:** `admin_audit_log` (`001_initial_schema.sql:142`), `tenant_audit_log` (`001_initial_schema.sql:662`), `email_trigger_log` (email-dispatch-specific), `geofence_events`. Each records JSONB `old_values` / `new_values`, `action`, `entity_type`, `entity_id`, `user_id`, `ip_address`, `created_at`.
  - **Helpers:** `lib/admin-audit.js` (`logAdminAction`), `lib/tenant-audit.js` (`logTenantAction`). The tenant helper is **used at 252 call sites** across `pages/api/` (verified: `grep -rn logTenantAction pages/api | wc -l`) — essentially every mutating handler logs an action.
  - **Shape:** `{ tenantId, userId, action: string, entityType: string, entityId, oldValues: JSONB, newValues: JSONB, ipAddress }`. **Adding `actor_type: 'human' | 'agent' | 'system'` and `agent_metadata: JSONB` columns would make this the natural intent/outcome log for agents** without a new table.
  - Event-shaped logs: partial. `order_status_history` is the only per-entity state-transition log (see Dim 3 findings).
- **Rate limiting / quota:** **ABSENT.** Grep for `rateLimit|throttle|quota` finds only circuit-breaker files (`lib/resilience/`), which handle Supabase unavailability (Tier 0 resilience per `project_resilience_plan.md`), not request-rate capping. Auth has `MAX_ATTEMPTS = 5` / `LOCKOUT_MINUTES = 30` at `pages/api/auth/login.js:3-4` + `pages/api/admin/auth/login.js:6-7` — system lockout policy, not generic rate-limiting.
- **Observability:**
  - **Resilience layer:** `lib/resilience/circuit-breaker.js`, `api-helper.js`, `retry.js`, `supabase-wrapper.js`, `errors.js` (Tier 0 per `project_resilience_plan.md`). `/api/health` (`pages/api/health.js`) returns `{status, breaker, supabase_last_ok_at, cooldown_ms_remaining}`.
  - **Webhooks (incoming):** `pages/api/webhooks/sendgrid.js` — SendGrid ECDSA-signed delivery events.
  - **Cron:** `pages/api/cron/evaluate-triggers.js` — polled-trigger evaluation across all tenants via Vercel Cron + `CRON_SECRET` auth pattern.
  - **Admin UI:** `pages/admin/audit-log.js`, `pages/admin/features.js`, `pages/admin/lockouts.js`, `pages/admin/tenants/` already exist — natural extension point for an "agent activity" dashboard page.

### Future state (what AI agents will need)

- A **per-tenant "AI agents enabled" feature flag** that slots into the existing `feature_flags` / `tenant_feature_flags` pattern (one row in `feature_flags` with `name='ai_agents'`, per-tenant opt-in via `tenant_feature_flags`).
- A **per-tenant AI configuration table** (active SOPs, allowed-action whitelist, escalation thresholds, rate caps, model/provider selection).
- **Intent / outcome logging** — "agent wanted to do X, attempted Y via Z, got W, took N ms, cost M tokens." **Extending `tenant_audit_log` with `actor_type` + `agent_metadata` columns is the lightest-touch option**; 252 existing call sites already use it. Alternatively: a dedicated `agent_actions` table sharing the shape.
- **SOP schema storage** — live next to rules-engine tables (`tariffs`, `charge_profiles`); query by tenant. New tables `sops` + `sop_steps` fit the existing pattern.
- **Agent rate limiting / cost caps** — prevent runaway agent loops from racking up LLM bills. **Entirely new infrastructure; no current foundation to lean on** beyond the auth-lockout pattern (which is request-count-based, not cost-based).
- **Real-time observability** — admin dashboard listing recent agent actions per tenant, last-seen error, open disputes. `pages/admin/audit-log.js` is the natural extension point.

### Gap

- **No dedicated AI feature flag today.** Low-effort to add via the existing `feature_flags` pattern.
- **No AI configuration table.** Needs design from scratch — but the existing `tenant_settings` / `tenant_reference_toggles` / `tenant_format_preferences` pattern (one row per tenant with many optional columns) is a reusable template.
- **Intent/outcome log.** The `tenant_audit_log` shape (JSONB old/new, action, entity_type) is ~80% of what's needed; adding `actor_type` + `agent_metadata` + `duration_ms` + `cost_cents` columns would close the gap. This is the easiest high-value add.
- **SOP schema storage** — entirely new. Depends on Dim 5's declarative rule schema (already solid) for the underlying shape.
- **Rate limiting / cost caps** — entirely new. No existing infra.
- **Observability dashboard** — builds on `pages/admin/audit-log.js` which already lists raw audit rows; the lift is agent-specific filtering + aggregation, not a new page.

### Priority

**M** — reasoning: This dimension is **mostly net-new infrastructure** (SOP schema, rate limits, AI config table) rather than retrofit. The lightest items — AI feature flag slot, `tenant_audit_log` extension — are one small PR each. The heaviest — SOP schema + rate limiting — are Stream C scope, not Stream B.1. Agent-impact H (gating for agent rollout); cost-of-delay L-M (net-new infra can be built when Stream C arrives).

### Dependencies

- Intent/outcome log depends on the event spine (Dim 3) for structured transitions — share the outbox.
- SOP schema depends on rules-engine declarative shape (Dim 5) — already good.
- Rate limiting + cost caps can proceed independently of other dims but are a pre-requisite for Stream C agent runtime.

### Tracked follow-ups

- `FU-065` — Per-tenant AI-enabled feature flag (add `ai_agents` row to `feature_flags`, wire to `tenant_feature_flags`)
- `FU-066` — AI configuration table design (active SOPs, allowed-action whitelist, thresholds)
- `FU-067` — Extend `tenant_audit_log` with `actor_type`, `agent_metadata`, `duration_ms`, `cost_cents` columns (or dedicated `agent_actions` table)
- `FU-068` — SOP schema storage design (`sops` + `sop_steps` tables, leveraging Dim 5 rule shapes)
- `FU-069` — Agent rate limiting / cost cap infrastructure (entirely new; no existing foundation)
- `FU-070` — Agent observability dashboard — extend `pages/admin/audit-log.js` with agent-filtered view

---

## Synthesis

### Priority matrix

| # | Dimension | Priority | Agent-impact | Cost-of-delay | Effort |
|---|---|---|---|---|---|
| 1 | API surface | H | H | M | M |
| 2 | Data schema | M | M | M | M |
| 3 | State / event spine | H | H | H | L |
| 4 | Business logic | L | L | L | S |
| 5 | Rules engine | M | M | L | M |
| 6 | AI-runtime cross-cutting | M | H | L | M |

### Dependency graph

```text
Event spine (Dim 3) ──┬──> Audit-trail completion (Dim 2, billing/AP entities)
                      ├──> Intent/outcome log (Dim 6, extends tenant_audit_log)
                      └──> Agent-subscription triggers (the primary agent use case)

Rules-engine declarative export (Dim 5) ──┬──> SOP schema (Dim 6)
                                          └──> Agent-bundle endpoint (Dim 1 v1 API)

API versioning (Dim 1) ──> Agent-bundle endpoint (rules snapshot) + canonical entity API

AI-enabled feature flag (Dim 6) ──> independent; gates everything behind tenant opt-in

Reference-data cleanup (Dim 4) ──> depends on Dim 2 enum migration (VALID_STATUSES etc.)
```

### Recommended Stream B.1 target

**Canonical event spine** — a single-point emission layer for state transitions (`load.status.changed`, `charge_set.status.changed`, `invoice.status.changed`, `routing_event.status.changed`, etc.) with a stable payload shape.

**What it is:** A `lib/events/` library + outbox table pattern that wraps state-transition writes. Every `.update({ status: ... })` call becomes `await emitStateTransition({ entity, fromState, toState, actorType, ... })` which atomically writes the transition AND enqueues a structured event for downstream consumers (including future agents).

**Why it's first:** This single piece unblocks three other dimensions at once:
1. **Dim 2 audit trails** — a per-entity history projection can be populated automatically from the event stream, closing the billing/AP gap without bespoke `*_history` tables.
2. **Dim 6 intent/outcome logs** — agent actions emit the same events; `actor_type: 'agent'` flows through to `tenant_audit_log` naturally.
3. **Agent-subscription triggers** — the primary agent use case ("when load X transitions to Y, do Z") depends on event-driven execution. No spine = agents must poll.

Effort is L (21 known transition points need wrapping + 2 duplicate paths need centralizing first), but the design space is well-understood — the outbox pattern is documented, and `lib/email-dispatch/status-change-fire.js:28` is already a single-purpose version of the pattern that can be generalized.

**Approximate effort:** **L** — reasoning: 21 transition points need wrapping, but each is a mechanical wrap once the emit library exists. Size driver is the per-entity testing of transition side effects (each entity has its own cascade to verify: `orders` auto-creates charge sets, `ar_invoices` writes timestamps + fires SendGrid, etc.). Minimum-viable scope (2 centralizations + outbox + 1 consumer) is closer to M; full 21-site coverage is L. Picking L for planning assumes full coverage is the B.1→B.2 span.

**What the Stream B.1 spec should cover:**
- Event payload shape (`entity_id`, `tenant_id`, `from_state`, `to_state`, `actor_id`, `actor_type`, `caused_by`, `side_effects_triggered`, `occurred_at`)
- Emit-from-where decision: in-band (DB trigger) vs. application-layer wrapper vs. outbox (transactionally-written, async-consumed)
- Centralization plan for the 2 known duplicate transition paths
- Consumer pattern — who reads the outbox, how delivery guarantees work, what replay looks like
- Migration strategy from the 21 scattered state-write sites (phased, not big-bang)
- Test strategy — the pure `lib/dry-run-engine.js` pattern applied to "simulate this transition"

### Minimum viable Stream B.1 (what ships in one cycle)

The spec above enumerates all event-spine design questions. To keep Stream B.1 to one spec→plan→execute cycle, only these three items must ship:

1. **Centralize the two highest-duplication entities** — `charge_sets` status updates (FU-055: 5 scattered sites) and `orders` routing-move updates (FU-056: 6+ scattered sites in one file). These are mechanical prerequisites — the event spine can't emit consistently if the underlying writes aren't consolidated first.
2. **Ship `lib/events/` emit wrapper covering those two centralized entities** — proves the emit pattern on real transitions without needing to cover all 21 sites up front.
3. **Outbox table + one consumer pattern** — doesn't need to be the final architectural choice (could be Postgres `NOTIFY`, a dedicated table polled by a cron, or Supabase Realtime) — just proves end-to-end delivery for one downstream consumer.

Everything else — generalizing to the remaining 4 entities, the subscription API, dry-run across transitions, intent/outcome log unification — defers to Stream B.2 or Stream C. Explicitly out of scope for B.1.

### Alternatives considered

- **API surface (Dim 1)** — also H priority, but *parallelizable* with event-spine work rather than a prerequisite for it. An agent-bundle endpoint at `/api/v1/agents/*` can be aliased as a new path while leaving the UI endpoints untouched — so agents can bind to a stable surface without requiring a codebase-wide API rewrite. This decouples Dim 1 from the Stream B.1 critical path.
- **Dim 6 AI-enabled feature flag** — trivially easy (one row in `feature_flags`) but not a force multiplier. Can ship alongside or after event spine.

### Why not [each of the remaining dimensions]

- **Dim 2 (Schema):** audit-trail gap closes as a side effect of event spine — no standalone work needed if spine ships first.
- **Dim 4 (Business logic):** CLEAN enough that it's L priority; 5 small cleanup items don't unblock anything downstream.
- **Dim 5 (Rules engine):** already declarative + tenant-scoped + JSONB. Consolidation (agent-bundle endpoint) is additive, not blocking.

### What this audit can't see

This audit is static-analysis only — no runtime inspection, no actual-data inspection, no production telemetry. Claims in this document are well-grepped against the committed source but carry caveats a reader should know:

- **Code-path coverage ≠ runtime correctness.** The 252 `logTenantAction` call sites and 21 status-update call sites reflect what's wired up in source — not whether any path silently fails at runtime, or whether error-handling swallows a call.
- **Sampling was used** for API-handler inspection (10 of 176 endpoints) and migration review (3 recent + canonical-entity extraction across all). The remaining 165+ handlers are uninspected and could contain counter-examples to the patterns claimed.
- **UI-coupling in responses was grep-checked, not response-shape-checked at runtime** — a handler might return extra fields the grep missed.
- **Rules-engine "declarative" claims** reflect the storage format (JSONB) and the existence of explicit operator/action fields — not the completeness of any given engine's vocabulary or its behavior under edge-case inputs.

None of these caveats invalidate the priority recommendation; they bound its confidence. A runtime audit (instrumented requests, actual-data inspection) would refine the picture — treated as a potential Stream B.1-follow-up if the emit wrapper work surfaces gaps this audit missed.

---

## Tracked follow-ups (opened by this audit)

This audit opened **24** new `[ai-ready]` follow-ups (FU-047 through FU-070) and referenced **0** pre-existing entries.

**New entries (in opening order):**

- [FU-047] [ai-ready] API: Versioning strategy and /api/v1/* aliasing plan
- [FU-048] [ai-ready] API: JSDoc / OpenAPI contract coverage for top-20 endpoints
- [FU-049] [ai-ready] API: Extract inline business logic in admin/tenants, admin/features, auth/login to lib/*
- [FU-050] [ai-ready] API: Endpoint metadata registry (RBAC, side effects, mutation targets)
- [FU-051] [ai-ready] Schema: Machine-readable schema catalog (autogenerated from live schema)
- [FU-052] [ai-ready] Schema: Per-entity audit trails for invoices / driver_pay / driver_settlements / order_charge_sets
- [FU-053] [ai-ready] Schema: Migrate 16 hardcoded enums to tenant-scoped lookup tables
- [FU-054] [ai-ready] State: Design canonical event shape + emit-from-where decision
- [FU-055] [ai-ready] State: Centralize order_charge_sets.status updates (5 locations)
- [FU-056] [ai-ready] State: Centralize order_container_moves.status fanout in routing/index.js
- [FU-057] [ai-ready] State: Outbox pattern / event bus selection (atomic transition + emit)
- [FU-058] [ai-ready] State: Generalize dry-run-engine beyond tariff recalc
- [FU-059] [ai-ready] Business-logic: Extract VALID_LOAD_TYPES / VALID_STATUSES / LOAD_TYPE_LETTER from loads/index.js
- [FU-060] [ai-ready] Business-logic: Move auth MAX_ATTEMPTS / LOCKOUT_MINUTES to shared config
- [FU-061] [ai-ready] Rules-engine: Design agent-bundle endpoint for per-tenant rules snapshot
- [FU-062] [ai-ready] Rules-engine: Machine-readable JSON Schema for rule types
- [FU-063] [ai-ready] Rules-engine: Generalize dry-run to simulate any rule/transition
- [FU-064] [ai-ready] Rules-engine: SOP shape design (new action verbs on declarative schema)
- [FU-065] [ai-ready] Cross-cutting: Per-tenant AI-enabled feature flag
- [FU-066] [ai-ready] Cross-cutting: AI configuration table design
- [FU-067] [ai-ready] Cross-cutting: Extend tenant_audit_log for agent intent/outcome logging
- [FU-068] [ai-ready] Cross-cutting: SOP schema storage design (sops + sop_steps tables)
- [FU-069] [ai-ready] Cross-cutting: Agent rate limiting / cost cap infrastructure
- [FU-070] [ai-ready] Cross-cutting: Agent observability dashboard (extend admin/audit-log.js)

**Referenced pre-existing entries (no new FU opened):** none — no prior `[ai-ready]` entries match any audit finding. Stream A was ~1 day old at audit time; the existing FU-045 and FU-046 are skill-tuning entries, not content findings.

**By category:**
- API: 4 entries (FU-047..FU-050)
- Schema: 3 entries (FU-051..FU-053)
- State: 5 entries (FU-054..FU-058)
- Business-logic: 2 entries (FU-059, FU-060)
- Rules-engine: 4 entries (FU-061..FU-064)
- Cross-cutting: 6 entries (FU-065..FU-070)
