# Driver Modal Polish Implementation Plan (FU-042)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit + polish the already-built Driver Modal. Align API `EDITABLE_FIELDS` with UI form state, add any missing Mobile Permissions Profile section, sweep dark-mode variants, verify audit-logging, open FU-077 for deferred infrastructure.

**Architecture:** Read-then-fix pass across 7 files. No new migrations, no new tests unless a fix requires one, no new features. Closes FU-042, opens FU-077.

**Tech Stack:** Next.js API routes, React/Tailwind with mandatory `dark:` variants, `logTenantAction` from `lib/tenant-audit.js` with `actorType: 'human'` default.

**Spec:** [docs/superpowers/specs/2026-04-24-driver-modal-polish-design.md](docs/superpowers/specs/2026-04-24-driver-modal-polish-design.md)

**Commit baseline:** HEAD = `6ca6094` (spec). Each task commits separately.

**Files touched (up to 7):**

| Type | File |
|---|---|
| Audit+Modify | `pages/api/tenant/drivers/index.js` (POST — accept all UI fields) |
| Audit+Modify | `pages/api/tenant/drivers/[id]/index.js` (PUT — expand EDITABLE_FIELDS) |
| Audit+Modify | `components/drivers/DriverModal.js` (dark-mode variants) |
| Audit+Modify | `components/drivers/tabs/DriverInfoTab.js` (dark-mode) |
| Audit+Modify | `components/drivers/tabs/DriverPreferencesTab.js` (dark-mode) |
| Audit+Modify | `components/drivers/tabs/DriverMobilePermissionsTab.js` (dark-mode + Profile section if missing) |
| Audit+Modify | `components/drivers/tabs/DriverNotesTab.js` (dark-mode) |
| Modify | `followups.md` (close FU-042, open FU-077) |
| Modify | `MEMORY.md` (audit-line bump) |

---

## Phase 1 — API field audit (1 task)

### Task 1: Align POST + PUT handlers with UI form state

**Files:**
- Modify: `pages/api/tenant/drivers/index.js`
- Modify: `pages/api/tenant/drivers/[id]/index.js`

- [ ] **Step 1: Extract the canonical UI field list**

Open `C:\Users\bento\app-drayagedirect\components\drivers\DriverModal.js`. Read the `EMPTY` form-state constant at the top. Copy every field name into a working list — these are the 40+ fields the modal sends.

Also check whether any fields are synthesized at submit time (e.g., combined from multiple inputs). Read the submit handler to be sure every field in the outgoing request body is covered.

- [ ] **Step 2: Read the PUT handler's `EDITABLE_FIELDS`**

Open `C:\Users\bento\app-drayagedirect\pages\api\tenant\drivers\[id]\index.js`. Find the `const EDITABLE_FIELDS = [...]` array near line 9.

Diff against the list from Step 1. List every field the UI sends that is NOT in `EDITABLE_FIELDS`.

- [ ] **Step 3: Read the POST handler's insert fields**

Open `C:\Users\bento\app-drayagedirect\pages\api\tenant\drivers\index.js`. Find the `.insert(...)` call near line 141. The fields inserted may be explicitly listed or spread from the request body. Identify any UI-sent fields that don't reach the INSERT.

- [ ] **Step 4: Cross-reference against schema**

Run:

```bash
grep -nE "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS" C:/Users/bento/app-drayagedirect/supabase/migrations/*.sql
```

Confirm every gap field the UI sends has a matching column in the `drivers` table (from migration 001 + 002 enrichment). If any UI field has NO schema column, flag as a concern in the final report — do NOT add the field to EDITABLE_FIELDS yet (would cause runtime errors).

- [ ] **Step 5: Expand `EDITABLE_FIELDS` to include all gap fields**

In `pages/api/tenant/drivers/[id]/index.js`, add the missing fields to the `EDITABLE_FIELDS` array. Preserve alphabetical or logical grouping if the existing array uses one.

Example (pseudo-diff — actual fields depend on Step 2's gap list):

```js
const EDITABLE_FIELDS = [
  'name', 'phone', 'email', 'license_number', 'license_state', 'license_expiry',
  'status', 'pay_type', 'pay_rate_cents', 'pay_percentage', 'notes',
  // ADDED by FU-042 polish:
  'first_name', 'last_name', 'username', 'date_of_birth', 'date_of_hire',
  'billing_email', 'home_branch_timezone', 'default_start_location',
  'driver_tags', 'profile_type',
  'medical_exp', 'twic_exp', 'sea_link_exp', 'ocac_insurance_exp', 'termination_date',
  'sealink_number', 'register_business_name', 'hst_number', 'social_security',
  'tablet_number', 'eld_number', 'eld_connected', 'fuel_card', 'ez_pass',
  'bank_account', 'routing_number',
  'emergency_contact_name', 'emergency_relation', 'emergency_phone',
  'truck_owner', 'carrier_name', 'main_office_address',
  'tshirt_size', 'permanent_address',
  'endorsements', 'mobile_permissions',
  // ... etc, based on actual gap list
];
```

- [ ] **Step 6: Expand POST handler's insert**

In `pages/api/tenant/drivers/index.js`, if the insert uses an explicit field whitelist, add missing fields. If it spreads `req.body`, ensure the shape handles any new fields gracefully.

- [ ] **Step 7: Verify audit-logging is present**

Both POST and PUT handlers should call `logTenantAction`. Check:
- POST: after successful insert, call with `action: 'driver.create'`, `entityType: 'driver'`, `entityId: newDriver.id`. `actorType` defaults to 'human'.
- PUT: after successful update, call with `action: 'driver.update'`, `entityType: 'driver'`, `entityId: driverId`, `newValues: updates`.

If either call is missing, add it. If present, verify `actorType` either defaults (no param needed) or explicitly passes `'human'`.

- [ ] **Step 8: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add pages/api/tenant/drivers/index.js pages/api/tenant/drivers/[id]/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "fix(drivers): align EDITABLE_FIELDS with UI form state + verify audit-logging

Audit revealed N UI-sent fields missing from EDITABLE_FIELDS (PUT handler)
and M fields missing from the POST insert. Added all gap fields so
driver edits persist end-to-end.

Audit-logging via logTenantAction [verified present / added — fill in].
actorType defaults to 'human' per B.1d foundation.

Part of FU-042 polish."
```

---

## Phase 2 — Mobile Permissions Profile section (1 task)

### Task 2: Verify + add Profile section to MobilePermissionsTab

**Files:**
- Modify: `components/drivers/tabs/DriverMobilePermissionsTab.js`

- [ ] **Step 1: Read the current file**

Open `C:\Users\bento\app-drayagedirect\components\drivers\tabs\DriverMobilePermissionsTab.js`. Check for:
- `DISPATCH_PERMISSIONS` constant (should be present — we confirmed earlier)
- `OTHER_PERMISSIONS` constant (should be present)
- `PROFILE_PERMISSIONS` constant (may be missing — the polish target)

If `PROFILE_PERMISSIONS` exists with all 4 expected keys (update truck, chassis, trailer, docs), this task is a no-op — skip to Step 4.

- [ ] **Step 2: Add `PROFILE_PERMISSIONS` if missing**

After the existing `OTHER_PERMISSIONS` constant, add:

```js
const PROFILE_PERMISSIONS = [
  { key: 'allow_update_truck',  label: 'Allow driver to update truck information' },
  { key: 'allow_update_chassis', label: 'Allow driver to update chassis information' },
  { key: 'allow_update_trailer', label: 'Allow driver to update trailer information' },
  { key: 'allow_update_docs',    label: 'Allow driver to update docs and expirations (TWIC, medical, CDL, Sealink)' },
];
```

- [ ] **Step 3: Render the Profile section**

Find the JSX where `DISPATCH_PERMISSIONS` and `OTHER_PERMISSIONS` are rendered (likely `.map()` producing Checkbox rows grouped under section headers). Add a third section rendering `PROFILE_PERMISSIONS`:

```jsx
<div className="mt-6">
  <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2">Profile</h3>
  <div className="space-y-2">
    {PROFILE_PERMISSIONS.map((p) => (
      <Checkbox
        key={p.key}
        checked={form.mobile_permissions?.[p.key] || false}
        onChange={(v) => updatePermission(p.key, v)}
        label={p.label}
      />
    ))}
  </div>
</div>
```

Match the exact pattern the file already uses for the other two sections — the grouping, spacing, and prop shape.

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add components/drivers/tabs/DriverMobilePermissionsTab.js
git -C C:/Users/bento/app-drayagedirect commit -m "feat(drivers): add Profile section to Mobile Permissions tab

Memory spec's 3rd permissions section (truck/chassis/trailer/docs update
permissions) was absent. Added 4-permission Profile section matching
the pattern of existing Dispatch + Other sections.

Dark-mode variants applied (slate-100 on header).

Part of FU-042 polish."
```

If Step 1 found the section already present, skip this task — just log "Profile section already complete" in the final report.

---

## Phase 3 — Dark-mode sweep (1 task)

### Task 3: Dark-mode variant audit across 5 driver component files

**Files:**
- Modify: `components/drivers/DriverModal.js`
- Modify: `components/drivers/tabs/DriverInfoTab.js`
- Modify: `components/drivers/tabs/DriverPreferencesTab.js`
- Modify: `components/drivers/tabs/DriverMobilePermissionsTab.js`
- Modify: `components/drivers/tabs/DriverNotesTab.js`

- [ ] **Step 1: Grep for unmatched gray/white/border classes**

For each of the 5 files, run:

```bash
cd C:/Users/bento/app-drayagedirect && grep -nE "(bg|text|border)-(white|gray|slate)" components/drivers/DriverModal.js components/drivers/tabs/*.js | grep -v "dark:"
```

This returns lines where a gray/white/border class exists WITHOUT an adjacent `dark:` variant. Each such line is a polish target.

- [ ] **Step 2: Add `dark:` variants to each unmatched class**

For each match from Step 1, open the file and add an appropriate `dark:` variant. The pattern is:

| Light class | Dark variant |
|---|---|
| `bg-white` | `dark:bg-slate-800` (or `dark:bg-slate-900` for deeper) |
| `bg-gray-50` | `dark:bg-slate-900` |
| `bg-gray-100` | `dark:bg-slate-800` |
| `text-gray-900` | `dark:text-slate-100` |
| `text-gray-700` | `dark:text-slate-200` |
| `text-gray-500` | `dark:text-slate-400` |
| `border-gray-300` | `dark:border-slate-600` |
| `border-gray-200` | `dark:border-slate-700` |

Apply surgically — only touch lines with missing variants. Don't disturb lines that already have them.

If the file uses component wrappers (`<Input>`, `<Button>`, `<Checkbox>`) that already handle dark-mode internally, no change needed — only raw Tailwind usages need sweeping.

- [ ] **Step 3: Verify zero remaining unmatched classes**

Re-run Step 1's grep. Expected: the only remaining matches are either:
- Inside component wrappers (handled elsewhere)
- Inside `dark:` clauses themselves (e.g., `dark:text-gray-100` — valid)
- Inside comments or string literals (ignore)

If any unmatched classes remain in actual JSX, address them.

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add components/drivers/DriverModal.js components/drivers/tabs/*.js
git -C C:/Users/bento/app-drayagedirect commit -m "style(drivers): dark-mode variant sweep on DriverModal + 4 tabs

Added dark: variants on all unmatched gray/white/border classes across
DriverModal.js + DriverInfoTab.js + DriverPreferencesTab.js +
DriverMobilePermissionsTab.js + DriverNotesTab.js per
dev_dark_mode_convention.md.

No behavior change. Pure styling.

Part of FU-042 polish."
```

---

## Phase 4 — Ledger (1 task)

### Task 4: Close FU-042, open FU-077, bump MEMORY.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`

- [ ] **Step 1: Get current HEAD SHA**

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

Capture — this is the SHA for FU-042's resolution.

- [ ] **Step 2: Move FU-042 to Recently Resolved**

Find `### FU-042:` in `followups.md` Open section. Move to Recently Resolved with:

```markdown
### FU-042: Driver modal (full spec from PortPro)
- Source: feature_driver_modal.md
- Resolved: 2026-04-24 in <SHA from Step 1>
- Area: driver
- Intent: (preserve existing)
- Notes: Shipped via commits 6ca6094 (spec) through <SHA>. Polish pass — EDITABLE_FIELDS aligned with UI form state; Mobile Permissions Profile section added [if missing]; dark-mode variants swept across 5 files; audit-logging verified. Schema was already 100% complete (migrations 001+002). Full PortPro spec feature set available.
```

- [ ] **Step 3: Open FU-077**

Run:

```bash
grep -oE "FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md | sort -t- -k2 -n -u | tail -1
```

Expected: max is likely `FU-076`. Next: `FU-077`. If higher, use max+1.

Insert at the top of the Open section:

```markdown
### FU-077: [ai-ready] State: transitionDriverStatus helper + driver_status_history table
- Source: docs/superpowers/specs/2026-04-24-driver-modal-polish-design.md (FU-042 polish)
- Scope: medium
- Area: driver / infra
- Intent: `drivers.status` (active/inactive/on_leave) is a state machine that should follow the Stream B.1a pattern — a transition helper (lib/drivers/transition.js), a history table (driver_status_history via migration 100), wired into the event spine so driver-state changes can fire triggers and preserve actor_type. Currently, driver status is written via raw .update() calls in the POST/PUT handlers without history or helper. This was deferred from the FU-042 polish spec because building new infrastructure doesn't fit a "polish" cycle.
- Notes: Pattern to follow: lib/charge-sets/transition.js + migration 096 + Stream B.1b event-spine integration. Migration adds driver_status_history mirroring order_status_history schema. Also adds actor_type column to match Stream B.1d foundation. dd-ai-ready G3 gate will flag the current raw .update() calls until this ships.
```

- [ ] **Step 4: Update MEMORY.md audit-line**

```bash
grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Previous count was 68 (post-FU-043). New count = 68 + 1 (FU-077 opened) - 1 (FU-042 resolved) = 68.

Update the audit-line:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<new SHA>`). 68 open, ~24 recently-resolved.
```

- [ ] **Step 5: No commit — memory files outside repo**

- [ ] **Step 6: Final report**

Summarize:
- 3 code commits (Tasks 1, 2, 3). Task 2 may be no-op if Profile section was already present.
- EDITABLE_FIELDS gaps found and fixed (count)
- Profile section status (added / already present)
- Dark-mode classes fixed (count)
- Audit-logging status (already-present / added)
- FU-042 resolved in `<SHA>`
- FU-077 opened
- MEMORY.md bumped to `<SHA>`, 68 open

---

## Rollout note

Pure polish — no user-visible behavior change except that UI edits which previously didn't persist (if any) now do, and dark-mode rendering is clean on every driver-editing surface. No migration to apply.

## Risks during plan execution

1. **EDITABLE_FIELDS may have intentional omissions** — a field might be excluded because it's computed server-side (e.g., `created_at`, `updated_at`). Plan Task 1 Step 4 cross-references against the schema; any field without a column is intentionally excluded. Don't blindly add.
2. **Profile section might already exist under a different constant name** — Plan Task 2 Step 1 reads first, skips if already present.
3. **Dark-mode sweep could produce a large diff** — each file may have 10–30 class-string touches. Keep commits at the file-boundary level if the total diff feels unwieldy.
4. **Audit-logging may be intentionally absent** in some handler branch (e.g., a bulk-edit path doesn't call `logTenantAction` because it would generate 100 log rows). Don't add without reading the surrounding context.
