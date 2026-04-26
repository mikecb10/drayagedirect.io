# FU-111: Add missing FK on `order_charge_sets.invoice_id` — Design

**Status:** Design approved 2026-04-26 (brainstorm). DDL applied live to Supabase via SQL Editor; this spec exists so the repo migration file matches the database state.
**Tracks:** FU-111
**Discovered during:** NewLoadModal redesign post-merge spot-check (2026-04-26 — `0803740`)

## 1. Goal

Restore the Load Detail → Billing tab. The endpoint `pages/api/tenant/loads/[id]/charge-sets/index.js` does a PostgREST nested join `invoice:invoices!invoice_id(...)`, but `order_charge_sets.invoice_id` is a plain `UUID` column with no FK constraint (since migration 003), so PostgREST has no relationship in its schema cache and returns a 500. Adding the FK makes PostgREST happy and closes a long-standing schema-integrity gap.

## 2. Scope

**In scope**
- New migration `supabase/migrations/106_order_charge_sets_invoice_fk.sql`:
  - `ALTER TABLE order_charge_sets ADD CONSTRAINT order_charge_sets_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL`
  - `CREATE INDEX IF NOT EXISTS idx_charge_sets_invoice_id ON order_charge_sets(invoice_id) WHERE invoice_id IS NOT NULL`
  - `NOTIFY pgrst, 'reload schema'`
- BEGIN/COMMIT wrapper per `dev_migration_template.md`
- Verify `GET /api/tenant/loads/<order_id>/charge-sets` returns 200 against an order that has charge sets
- Update `memory/followups.md`: FU-111 → resolved

**Out of scope (deferred)**
- Audit other PostgREST nested joins in the codebase for the same trap. (Worth a follow-up FU; not part of this fix.)
- Adding FK constraints retroactively to other UUID columns that lack them (broader schema-integrity sweep).
- Any change to `pages/api/tenant/loads/[id]/charge-sets/index.js` — the endpoint code is correct once the FK exists.

## 3. Decisions (made during brainstorm)

**`ON DELETE SET NULL`.** Charge sets can outlive their invoice — the existing rollback paths in `pages/api/tenant/ar/invoices/index.js:475-481` already null out `invoice_id` before deleting the invoice, so `SET NULL` matches that lifecycle and acts as a safety net for any future code path that forgets the manual cleanup. RESTRICT was considered (slightly more defensive — would force explicit unlinking) but rejected because the "no invoice" state is a legitimate state in the charge-set lifecycle (every charge set starts there).

**Partial index `WHERE invoice_id IS NOT NULL`.** Most charge sets are uninvoiced (drafts, in-progress); a partial index keeps storage and write cost down while still helping FK enforcement on the rare invoice-delete path.

**Why no orphan cleanup step.** Pre-flight orphan-count query against production returned 0; the ALTER applies cleanly with no data fix-up needed.

## 4. Verification plan

1. After migration apply, `GET /api/tenant/loads/<id>/charge-sets` for a load known to have charge sets must return 200 with the expected JSON shape (`charge_sets: [...]`, each item including `invoice` object or null and `invoice_locked` flag).
2. Server log must show no `Could not find a relationship between 'order_charge_sets' and 'invoices' in the schema cache` errors.
3. The Billing tab in the Load Detail UI must render without the red "Failed to load charge sets" banner.

## 5. Risk and rollback

**Risk:** essentially zero. Orphan count was 0; the ALTER is non-destructive (adds a constraint to an existing column); `ON DELETE SET NULL` cannot fail on apply.

**Rollback:** if PostgREST schema-cache reload fails to pick up the new FK (unlikely with the explicit `NOTIFY pgrst, 'reload schema'`), restart the Supabase project's PostgREST. To revert the schema entirely: `ALTER TABLE order_charge_sets DROP CONSTRAINT order_charge_sets_invoice_id_fkey; DROP INDEX IF EXISTS idx_charge_sets_invoice_id;` — would also restore the 500 on the Billing tab.
