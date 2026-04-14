-- ============================================================
-- Migration 052: Email System — Core Tables
-- ============================================================
-- Templates, Umbrellas, Email Groups, Group Templates, Triggers.
--
-- Model overview
-- ──────────────
--
-- email_templates          Named, reusable email bodies with {{variable}}
--                          tokens. System-seeded templates ship with
--                          default names but are fully renamable/editable.
--
-- email_umbrellas          Named load-filter scopes. An umbrella matches
--                          a load when ALL of its populated filter columns
--                          equal the load's attributes. Specificity score
--                          is computed from the number of populated filters
--                          (more filters = more specific = higher score).
--                          When multiple umbrellas match a load, the most
--                          specific wins unless another has always_run=true.
--
-- email_umbrella_groups    Within an umbrella, a named sub-group of
--                          recipients (To/CC/BCC) that should receive
--                          a specific subset of templates. One umbrella
--                          can fan out into multiple groups, each with
--                          their own recipient list and template set.
--
-- email_umbrella_group_templates
--                          Junction: which templates a given group sends.
--                          Each row represents one email that will fire
--                          when the umbrella matches AND the trigger fires.
--
-- email_template_triggers  Trigger rules attached to templates. When an
--                          event (load.dispatched, document.uploaded,
--                          status.changed, schedule.elapsed) matches a
--                          trigger's conditions, the trigger engine finds
--                          all umbrellas the event's load matches, walks
--                          the umbrella's groups, and sends this template
--                          to every group that has it attached.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- email_templates
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- User-editable friendly name (e.g. "Import POD Confirmation — ABC Customer")
  name TEXT NOT NULL,
  -- Optional internal description / notes
  description TEXT,

  -- System templates are seeded on tenant creation. They can be renamed
  -- and edited freely but cannot be deleted — they only toggle is_active.
  -- This lets tenants lean on a baseline library without accidentally
  -- breaking it, while still retaining full customization.
  is_system BOOLEAN NOT NULL DEFAULT false,
  -- System templates reference a canonical slug so the trigger engine
  -- and migrations can find them without depending on user-editable names
  -- (e.g. 'pod_delivered', 'load_dispatched', 'empty_return_confirmed').
  system_slug TEXT,

  -- Active = eligible to be sent. Inactive templates still exist for
  -- audit/history purposes but the trigger engine skips them.
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- ── Content ──
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT, -- Optional plain-text version; if NULL, generated from body_html

  -- ── Per-template format overrides ──
  -- JSONB of tenant_format_preferences columns that this template overrides.
  -- Leave empty to inherit everything from the tenant-wide formatting rules.
  -- Example: {"date_format": "MMM D, YYYY", "currency_symbol": "US$"}
  format_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ── Attachment behavior ──
  -- When true, the trigger engine attaches documents whose type matches
  -- the entries in attachment_document_types. Example: a POD template might
  -- set attachment_document_types = ['pod', 'bol'] to always attach both.
  attachment_document_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Opt-out of the tenant's default signature for this template specifically
  suppress_default_signature BOOLEAN NOT NULL DEFAULT false,

  -- ── Audit ──
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- System slugs are unique within a tenant so the resolver can locate them
  -- The filter ensures only rows with a slug participate in the constraint.
  CONSTRAINT email_templates_system_slug_unique UNIQUE (tenant_id, system_slug)
);

CREATE INDEX IF NOT EXISTS idx_email_templates_tenant
  ON email_templates(tenant_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_email_templates_system
  ON email_templates(tenant_id, is_system) WHERE is_system = true;
CREATE INDEX IF NOT EXISTS idx_email_templates_slug
  ON email_templates(tenant_id, system_slug) WHERE system_slug IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- email_umbrellas
--
-- Each umbrella is a named scope with zero or more load-filter
-- columns populated. Specificity score = count of non-null
-- filter columns. The trigger engine uses this to pick the most
-- specific matching umbrella for each fired event, suppressing
-- all less-specific umbrellas UNLESS they have always_run=true.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_umbrellas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,

  -- CSS-specificity escape hatch — when true this umbrella fires even if
  -- a more specific umbrella also matches. Used for compliance reminders
  -- that MUST go out regardless of customer-specific routing rules.
  always_run BOOLEAN NOT NULL DEFAULT false,

  -- ── Load filter scope (all optional; populated columns form an AND) ──
  -- Core filters
  load_type TEXT,                      -- 'import' | 'export' | 'outbound' | 'inbound' | 'one_way'
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  pickup_location_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  delivery_location_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  return_location_id UUID REFERENCES customers(id) ON DELETE CASCADE,

  -- Optional record rules (from the Create Email Record UI)
  container_type TEXT,
  container_size TEXT,
  ssl TEXT,        -- Steamship Line / container owner
  csr TEXT,        -- Customer Service Rep (user id or free text — stored as text for flexibility)
  route_id UUID,   -- Future: reference to a Routes table (currently NULL everywhere)
  chassis_type TEXT,
  chassis_size TEXT,
  chassis_owner TEXT,

  -- Boolean flags (3-state: NULL = "don't care", true = must be true, false = must be false)
  hazmat BOOLEAN,
  overweight BOOLEAN,
  liquor BOOLEAN,
  hot BOOLEAN,
  genset BOOLEAN,
  oog BOOLEAN,

  -- ── Computed specificity score (recalculated on insert/update via trigger) ──
  -- Number of non-null filter columns. Higher = more specific.
  specificity_score INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_email_umbrellas_tenant
  ON email_umbrellas(tenant_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_email_umbrellas_scope
  ON email_umbrellas(tenant_id, load_type, customer_id, pickup_location_id, delivery_location_id);
CREATE INDEX IF NOT EXISTS idx_email_umbrellas_always_run
  ON email_umbrellas(tenant_id) WHERE always_run = true;
CREATE INDEX IF NOT EXISTS idx_email_umbrellas_specificity
  ON email_umbrellas(tenant_id, specificity_score DESC);

-- ── Specificity score trigger ──
-- Recalculates specificity_score whenever any filter column changes.
-- Score = the number of populated (non-null) filter columns. This is
-- the raw count used by the trigger engine's umbrella resolution.
CREATE OR REPLACE FUNCTION compute_email_umbrella_specificity()
RETURNS TRIGGER AS $$
BEGIN
  NEW.specificity_score := (
    (CASE WHEN NEW.load_type IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.customer_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.pickup_location_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.delivery_location_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.return_location_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.container_type IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.container_size IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.ssl IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.csr IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.route_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.chassis_type IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.chassis_size IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.chassis_owner IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.hazmat IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.overweight IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.liquor IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.hot IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.genset IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.oog IS NOT NULL THEN 1 ELSE 0 END)
  );
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_umbrella_specificity ON email_umbrellas;
CREATE TRIGGER trg_email_umbrella_specificity
  BEFORE INSERT OR UPDATE ON email_umbrellas
  FOR EACH ROW
  EXECUTE FUNCTION compute_email_umbrella_specificity();

-- ──────────────────────────────────────────────────────────────
-- email_umbrella_groups
--
-- Named groups of recipients inside an umbrella. One umbrella can
-- have many groups, each sending its own subset of templates to
-- its own recipient list. This mirrors the PortPro "Email Groups"
-- pattern from the Create Email Record UI.
--
-- Recipients are stored as JSONB arrays of structured entries so
-- we can mix literal email addresses, contact IDs, contact-group
-- IDs, and role tokens in the same field without a mess of FKs.
--
-- Each entry has the shape:
--   { "type": "email",          "value": "ops@example.com" }
--   { "type": "contact",        "value": "<uuid>", "label": "Jane Doe — AP" }
--   { "type": "contact_group",  "value": "<uuid>", "label": "ABC Customer AP" }
--   { "type": "role",           "value": "load_dispatcher" }
--   { "type": "variable",       "value": "customer.primary_contact.email" }
--
-- The variable-resolver expands role/variable entries at send time.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_umbrella_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  umbrella_id UUID NOT NULL REFERENCES email_umbrellas(id) ON DELETE CASCADE,

  name TEXT NOT NULL, -- User-friendly group name (e.g. "Customer AP", "Warehouse Receiving")
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,

  to_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  bcc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Optional reply-to address override for this group.
  -- If NULL, inherits from the email_account used to send.
  reply_to TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_umbrella_groups_umbrella
  ON email_umbrella_groups(umbrella_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_email_umbrella_groups_tenant
  ON email_umbrella_groups(tenant_id) WHERE is_active = true;

-- ──────────────────────────────────────────────────────────────
-- email_umbrella_group_templates
-- Junction: which templates each group will send.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_umbrella_group_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES email_umbrella_groups(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (group_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_email_umbrella_group_templates_group
  ON email_umbrella_group_templates(group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_email_umbrella_group_templates_template
  ON email_umbrella_group_templates(template_id);

-- ──────────────────────────────────────────────────────────────
-- email_template_triggers
--
-- Rules that decide when a template should fire. A trigger is
-- attached to exactly one template but may be evented (fires
-- immediately when a domain event happens) or polled (fires N
-- time units after a status/event, evaluated by a cron worker).
--
-- The engine processes triggers in two phases:
--
--   Phase A (evented)  — fires when domain code emits an event:
--     - load.dispatched
--     - load.status_changed
--     - document.uploaded   (any doc type; filter by trigger condition)
--     - move.departed / move.arrived
--     - rail_slip.verified
--     - charge_set.status_changed
--     - driver.assigned / driver.unassigned
--     - custom.user_send    (Communication tab manual send)
--
--   Phase B (polled)   — cron worker queries every 15m for:
--     - schedule.elapsed_since (status_entered | event_fired | date_field)
--     - missing_information.timer_elapsed
--     - appointment.approaching
--
-- Each trigger carries its own conditions JSONB, a dedupe window,
-- and an active flag. The umbrella-matching step happens at fire
-- time (engine loads the load, finds all active umbrellas whose
-- scope matches, picks the most specific + always_run ones, walks
-- the group→template joins, and sends the template to every group
-- that contains it).
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_template_triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,

  name TEXT NOT NULL, -- User-facing trigger name (e.g. "Send on BOL upload")
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- 'evented' or 'polled'
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('evented', 'polled')),

  -- Event name for evented triggers (load.dispatched, document.uploaded, etc.)
  -- NULL for polled triggers.
  event_name TEXT,

  -- Polled trigger settings — "N time_unit after anchor"
  -- Anchor is a dotted-path into load-scoped data (e.g.
  -- 'status_entered_at.in_transit', 'move.arrived_delivery', 'cutoff_date')
  poll_anchor TEXT,
  poll_delay_amount INT,   -- e.g. 2
  poll_delay_unit TEXT,    -- 'minutes' | 'hours' | 'days' | 'weekdays'

  -- Additional filter conditions on the firing event.
  -- Shape: { "field": "value" | { "op": "in", "value": [..] } | { "op": ">=", "value": "..." } }
  -- Example for document.uploaded:
  --   { "document_type": { "op": "in", "value": ["bol", "pod"] } }
  -- Example for load.status_changed:
  --   { "new_status": "delivered" }
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Dedupe window in seconds. If the same (template_id, load_id, trigger_key)
  -- fired within this window, a new fire is suppressed. Default 1 hour.
  dedupe_window_seconds INT NOT NULL DEFAULT 3600,

  -- When true, the trigger engine will backfill this trigger for loads
  -- that matched its conditions before the trigger was created. Default
  -- FALSE per user decision (triggers are future-only).
  retroactive BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_email_template_triggers_template
  ON email_template_triggers(template_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_email_template_triggers_evented
  ON email_template_triggers(tenant_id, event_name)
  WHERE is_active = true AND trigger_kind = 'evented';
CREATE INDEX IF NOT EXISTS idx_email_template_triggers_polled
  ON email_template_triggers(tenant_id)
  WHERE is_active = true AND trigger_kind = 'polled';

-- ──────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_umbrellas ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_umbrella_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_umbrella_group_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_template_triggers ENABLE ROW LEVEL SECURITY;

-- Reusable RLS pattern: tenant_id = current_tenant_id() OR is_dd_admin()
-- for SELECT/INSERT/UPDATE; dd-admin-only for DELETE on the core tables
-- so users can't accidentally wipe their template library.
-- Users CAN delete their own custom templates/umbrellas/groups — but
-- system templates are gated by is_system and protected via check below.

DROP POLICY IF EXISTS et_select ON email_templates;
CREATE POLICY et_select ON email_templates FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS et_insert ON email_templates;
CREATE POLICY et_insert ON email_templates FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS et_update ON email_templates;
CREATE POLICY et_update ON email_templates FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS et_delete ON email_templates;
CREATE POLICY et_delete ON email_templates FOR DELETE
  USING ((tenant_id = current_tenant_id() AND is_system = false) OR is_dd_admin());

DROP POLICY IF EXISTS eu_select ON email_umbrellas;
CREATE POLICY eu_select ON email_umbrellas FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS eu_insert ON email_umbrellas;
CREATE POLICY eu_insert ON email_umbrellas FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS eu_update ON email_umbrellas;
CREATE POLICY eu_update ON email_umbrellas FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS eu_delete ON email_umbrellas;
CREATE POLICY eu_delete ON email_umbrellas FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS eug_all ON email_umbrella_groups;
CREATE POLICY eug_all ON email_umbrella_groups FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS eugt_all ON email_umbrella_group_templates;
CREATE POLICY eugt_all ON email_umbrella_group_templates FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS ett_all ON email_template_triggers;
CREATE POLICY ett_all ON email_template_triggers FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- updated_at triggers for the tables that need them
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_email_core_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON email_templates;
CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION set_email_core_updated_at();

DROP TRIGGER IF EXISTS trg_email_umbrella_groups_updated_at ON email_umbrella_groups;
CREATE TRIGGER trg_email_umbrella_groups_updated_at
  BEFORE UPDATE ON email_umbrella_groups
  FOR EACH ROW EXECUTE FUNCTION set_email_core_updated_at();

DROP TRIGGER IF EXISTS trg_email_template_triggers_updated_at ON email_template_triggers;
CREATE TRIGGER trg_email_template_triggers_updated_at
  BEFORE UPDATE ON email_template_triggers
  FOR EACH ROW EXECUTE FUNCTION set_email_core_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
