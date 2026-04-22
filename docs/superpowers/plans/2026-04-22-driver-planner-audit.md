# Driver Planner Schema Audit

**Date:** 2026-04-22  
**Purpose:** Verify schema state before Task 2 writes migration 090 (driver planner foundations).

---

## 1. order_container_moves.status

**Current Values:** `'pending'` (default)  
**Status Type:** TEXT (no enum constraint)  
**Check Constraint:** None

**Findings:**
- Column defined in migration 003_phase5b1_loads.sql, line 102: `status TEXT DEFAULT 'pending'`
- No explicit CHECK constraint limiting values
- Only value observed in migrations: `'pending'` (set in migration 046_clean_phantom_completed_moves.sql, line 33)
- Status is treated as free-form TEXT in schema but enforced at API layer

**Assumption from plan:** Plan assumes status will hold values like `'pending'`, `'completed'`, `'dispatched'`, etc., and that the schema supports this via TEXT column or enum. ✓ **VERIFIED** — TEXT column is flexible enough.

---

## 2. order_container_moves columns

**Current Columns (migration 003):**
```
id (UUID, PK)
tenant_id (UUID, FK to tenants)
order_id (UUID, FK to orders)
sequence (INTEGER)
move_type (TEXT)
driver_id (UUID, FK to drivers)
truck_id (UUID, FK to equipment_trucks)
chassis_id (UUID, FK to equipment_chassis)
status (TEXT, default 'pending')
started_at (TIMESTAMPTZ)
completed_at (TIMESTAMPTZ)
created_at (TIMESTAMPTZ, default now())
updated_at (TIMESTAMPTZ, default now())
```

**ALTER TABLE Statements:** None found for order_container_moves in any migration.

**Check: Do `scheduled_date` and `sort_order` already exist?**
- `scheduled_date` — **NOT FOUND** ✓
- `sort_order` — **NOT FOUND** ✓

**Assumption from plan:** Plan will ADD these two columns in migration 090. ✓ **VERIFIED** — they do not exist yet.

---

## 3. Existing container flags

**Search terms:** `container_at_port`, `empty_ready_for_return`, `at_port`, `empty_ready`

**Findings:**

In **migrations:** None found.

In **lib/kpi-engine.js:**
- Mentions `need_delivery_at_port` KPI stat (line 410, 484, 613) — this is a derived KPI flag, not a schema column.
- Calls `isAtPortStatus(l)` helper (line 613) but these are computed runtime checks, not schema columns.

In **specs/2026-04-22-driver-planner-design.md:**
- Defines the planned columns: `container_at_port` (boolean) and `empty_ready_for_return_at` (timestamptz).
- These are in the spec but NOT YET in the schema.

**Conclusion:**
- No existing `container_at_port` or `empty_ready_for_return_at` columns on `orders` table.
- No equivalent columns under different names.
- Plan will ADD both in migration 090. ✓ **VERIFIED** — they do not exist yet.

---

## 4. drivers table

### drivers.status values

**Current Definition (migration 001, line 400):**
```sql
status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave'))
```

**Verified Values:** `'active'`, `'inactive'`, `'on_leave'` ✓

### ELD and HOS-shaped columns

**Existing ELD-related columns found:**

In **migration 002_phase5a_master_data.sql:**
- Line 70: `eld_number TEXT`
- Line 71: `eld_connected BOOLEAN DEFAULT false`

In **migration 036_driver_tracking.sql:**
- Lines 115–117:
  ```sql
  eld_provider TEXT        -- samsara, keeptruckin, etc.
  eld_device_id TEXT
  eld_connected BOOLEAN DEFAULT false  -- (added again / idempotent)
  ```

**No existing `eld_snapshot` or HOS state columns found.**

**Columns related to ELD but NOT snapshot data:**
- `eld_number`, `eld_connected`, `eld_provider`, `eld_device_id` are config/connection info.
- No JSONB snapshot column storing ELD state (hours worked, duty status, etc.).

**Assumption from plan:** Plan will ADD `eld_snapshot JSONB` to drivers in migration 090 to cache ELD state snapshots for planner use. ✓ **VERIFIED** — this column does not exist yet.

---

## 5. Next migration number

**Latest Migration:** 089_routing_event_distance.sql (added 2026-04-22)

**Contents of 089:** Routing event distance persistence (not driver planner).

**Next Available Migration Number:** 090

**Status:** ✓ **CORRECT** — Task 2 should write `090_driver_planner_foundations.sql`, not 089.

---

## Summary of Audit Results

| Item | Status | Notes |
|------|--------|-------|
| `order_container_moves.status` values | ✓ Valid | TEXT column, default 'pending', no constraint. API layer enforces valid values. |
| `order_container_moves` existing columns | ✓ Complete | 13 columns total. No `scheduled_date` or `sort_order` yet. |
| `container_at_port` / `empty_ready_for_return_at` | ✓ Not found | Do not exist on orders table. Plan will add both. |
| `drivers.status` values | ✓ Valid | ('active', 'inactive', 'on_leave') via CHECK constraint. |
| ELD columns | ✓ Present (partial) | Connection info exists. No `eld_snapshot` JSONB yet. |
| Next migration number | ✓ Ready | 090 is the next available. |

---

## Plan Assumption Verification

All assumptions baked into the plan at `docs/superpowers/plans/2026-04-22-driver-planner.md` are **VERIFIED**:

1. ✓ `order_container_moves` exists with driver_id, move_type, status, started_at, completed_at.
2. ✓ `scheduled_date` and `sort_order` do not yet exist on `order_container_moves`.
3. ✓ `container_at_port` and `empty_ready_for_return_at` do not yet exist on `orders`.
4. ✓ `drivers.status` has exactly three values ('active', 'inactive', 'on_leave').
5. ✓ No `eld_snapshot` JSONB column yet on drivers.
6. ✓ Migration 090 is the next available number (not 089 — that is routing-event-distance).

**Ready for Task 2:** Write migration 090_driver_planner_foundations.sql with high confidence.
