-- ============================================================
-- Migration 056: Email System — body_format + System Template Seed
-- ============================================================
-- Two additions for Milestone 2 of the Email System:
--
-- 1. email_templates.body_format
--    Lets the template editor remember whether the author wrote the
--    body in Plain or HTML mode. The resolver produces the final HTML
--    either way — see the editor's save handler which auto-wraps plain
--    text in <p> tags and auto-derives plain text from HTML via
--    lib/email-variable-resolver.js::stripHtml().
--
-- 2. seed_system_email_templates_for_tenant(tenant_id)
--    Per-tenant seed function that installs the 13 baseline operational
--    templates. Uses ON CONFLICT (tenant_id, system_slug) DO NOTHING so
--    re-running is safe. The templates cover the common drayage flow:
--    dispatch → pickup → BOL → rail/port check-in → delivery → POD →
--    empty return, plus reminder templates for cutoff/LFD/delays/missing
--    info.
--
--    NOTE: Invoice + Rate Confirmation templates are NOT seeded here —
--    those flow through the AR module's Configurations section (future
--    milestone) because they carry generated PDFs and bind to charge-set
--    state machines, not to general load events.
--
-- 3. Auto-seed trigger on new tenants so signups get the catalog
--    automatically. Fires AFTER INSERT ON tenants.
--
-- 4. Backfill: seed every existing active tenant in the same transaction.
--
-- Idempotent: safe to re-run. All inserts use ON CONFLICT, all DDL uses
-- IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================

BEGIN;

-- ==================================================================
-- SECTION 1: body_format column
-- ==================================================================
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS body_format TEXT NOT NULL DEFAULT 'plain';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'email_templates'::regclass
      AND conname = 'email_templates_body_format_check'
  ) THEN
    ALTER TABLE email_templates
      ADD CONSTRAINT email_templates_body_format_check
      CHECK (body_format IN ('plain', 'html'));
  END IF;
END $$;

-- ==================================================================
-- SECTION 2: Per-tenant seed function
-- ==================================================================
-- Inserts the 13 baseline system templates for a given tenant. Each
-- template has a user-friendly name, a helpful description, a default
-- subject line with variables, and parallel plain-text + HTML bodies
-- so the editor and send path both work immediately.
--
-- System templates are marked is_system=true which means:
--   - They cannot be deleted via the RLS delete policy
--   - They carry a canonical system_slug the trigger engine can look up
--   - The editor shows "System template" badge but allows rename + edit

CREATE OR REPLACE FUNCTION seed_system_email_templates_for_tenant(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  -- ── 1. Load Dispatched ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Load Dispatched',
    'Fires when a load is dispatched to a driver. Confirms pickup details with the customer.',
    true,
    'load_dispatched',
    'Load Dispatched — Order {{load.order_number}}',
    E'Hi {{customer.primary_contact_name}},\n\nYour load has been dispatched.\n\nOrder Number: {{load.order_number}}\nReference: {{load.customer_reference}}\nContainer: {{container.number}}\nPickup: {{pickup.name}}\nDelivery: {{delivery.name}}\nDriver: {{driver.full_name}} — {{driver.phone}}\n\nWe will update you once the driver arrives for pickup.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Your load has been dispatched.</p><p><strong>Order Number:</strong> {{load.order_number}}<br/><strong>Reference:</strong> {{load.customer_reference}}<br/><strong>Container:</strong> {{container.number}}<br/><strong>Pickup:</strong> {{pickup.name}}<br/><strong>Delivery:</strong> {{delivery.name}}<br/><strong>Driver:</strong> {{driver.full_name}} — {{driver.phone}}</p><p>We will update you once the driver arrives for pickup.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 2. Driver Assigned ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Driver Assigned',
    'Fires when a driver is assigned to a load. Useful for internal notifications.',
    true,
    'driver_assigned',
    'Driver Assigned — {{driver.full_name}} on {{load.order_number}}',
    E'Driver {{driver.full_name}} ({{driver.phone}}) has been assigned to order {{load.order_number}}.\n\nContainer: {{container.number}}\nPickup: {{pickup.name}}\nDelivery: {{delivery.name}}\n\n— {{tenant.name}}',
    '<p>Driver <strong>{{driver.full_name}}</strong> ({{driver.phone}}) has been assigned to order <strong>{{load.order_number}}</strong>.</p><p><strong>Container:</strong> {{container.number}}<br/><strong>Pickup:</strong> {{pickup.name}}<br/><strong>Delivery:</strong> {{delivery.name}}</p><p>— {{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 3. Arrived at Pickup ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Arrived at Pickup',
    'Fires when the driver arrives at the pickup location.',
    true,
    'load_arrived_pickup',
    'Arrived at Pickup — {{load.order_number}}',
    E'Hi {{customer.primary_contact_name}},\n\n{{driver.full_name}} has arrived at {{pickup.name}} for container {{container.number}} (order {{load.order_number}}).\n\nArrival time: {{pickup.arrived_at}}\n\nWe will notify you again when the driver departs with the container.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p><strong>{{driver.full_name}}</strong> has arrived at <strong>{{pickup.name}}</strong> for container <strong>{{container.number}}</strong> (order {{load.order_number}}).</p><p><strong>Arrival time:</strong> {{pickup.arrived_at}}</p><p>We will notify you again when the driver departs with the container.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 4. BOL Uploaded ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'BOL Uploaded',
    'Fires when the driver uploads the Bill of Lading. Attaches the BOL document automatically.',
    true,
    'bol_uploaded',
    'BOL Uploaded — {{load.order_number}} — Container {{container.number}}',
    E'Hi {{customer.primary_contact_name}},\n\nThe Bill of Lading has been uploaded for order {{load.order_number}}. The BOL is attached to this email.\n\nContainer: {{container.number}}\nSeal: {{container.seal}}\nPieces: {{load.piece_count}}\nWeight: {{load.weight}}\n\nPlease confirm the details match your records.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>The Bill of Lading has been uploaded for order <strong>{{load.order_number}}</strong>. The BOL is attached to this email.</p><p><strong>Container:</strong> {{container.number}}<br/><strong>Seal:</strong> {{container.seal}}<br/><strong>Pieces:</strong> {{load.piece_count}}<br/><strong>Weight:</strong> {{load.weight}}</p><p>Please confirm the details match your records.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 5. Rail/Port Slip Cleared ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Rail/Port Slip Cleared',
    'Fires when the dispatcher clears the Rail/Port Check-In Slip on an outbound/export load.',
    true,
    'rail_slip_verified',
    'Rail/Port Check-In Cleared — {{load.order_number}}',
    E'The rail/port check-in slip for order {{load.order_number}} has been verified and cleared.\n\nContainer: {{container.number}}\nSeal: {{container.seal}}\nFinal destination: {{delivery.name}}\n\nDriver {{driver.full_name}} is cleared to proceed.\n\n— {{tenant.name}}',
    '<p>The rail/port check-in slip for order <strong>{{load.order_number}}</strong> has been verified and cleared.</p><p><strong>Container:</strong> {{container.number}}<br/><strong>Seal:</strong> {{container.seal}}<br/><strong>Final destination:</strong> {{delivery.name}}</p><p>Driver <strong>{{driver.full_name}}</strong> is cleared to proceed.</p><p>— {{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 6. Arrived at Delivery ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Arrived at Delivery',
    'Fires when the driver arrives at the delivery location.',
    true,
    'load_arrived_delivery',
    'Arrived at Delivery — {{load.order_number}} — {{delivery.name}}',
    E'Hi {{customer.primary_contact_name}},\n\n{{driver.full_name}} has arrived at {{delivery.name}} with container {{container.number}}.\n\nOrder: {{load.order_number}}\nArrival time: {{delivery.arrived_at}}\n\n— {{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p><strong>{{driver.full_name}}</strong> has arrived at <strong>{{delivery.name}}</strong> with container <strong>{{container.number}}</strong>.</p><p><strong>Order:</strong> {{load.order_number}}<br/><strong>Arrival time:</strong> {{delivery.arrived_at}}</p><p>— {{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 7. POD Delivered ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'POD Delivered',
    'Fires when delivery is complete (driver departs with empty). Attaches POD document when available.',
    true,
    'pod_delivered',
    'Delivered — {{load.order_number}} — Container {{container.number}}',
    E'Hi {{customer.primary_contact_name}},\n\nGood news — your container {{container.number}} has been delivered to {{delivery.name}}.\n\nOrder: {{load.order_number}}\nReference: {{load.customer_reference}}\nDelivered at: {{delivery.departed_at}}\n\nThe signed POD is attached (or will follow separately once scanned).\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Good news — your container <strong>{{container.number}}</strong> has been delivered to <strong>{{delivery.name}}</strong>.</p><p><strong>Order:</strong> {{load.order_number}}<br/><strong>Reference:</strong> {{load.customer_reference}}<br/><strong>Delivered at:</strong> {{delivery.departed_at}}</p><p>The signed POD is attached (or will follow separately once scanned).</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 8. Appointment Confirmed ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Appointment Confirmed',
    'Fires when a delivery appointment is booked/confirmed.',
    true,
    'appointment_confirmed',
    'Appointment Confirmed — {{load.order_number}} — {{delivery.appointment_date}}',
    E'Hi {{customer.primary_contact_name}},\n\nThe delivery appointment for order {{load.order_number}} has been confirmed.\n\nDelivery: {{delivery.name}}\nDate: {{delivery.appointment_date}}\nTime: {{delivery.appointment_time}}\nContainer: {{container.number}}\n\nDriver {{driver.full_name}} will reach out with an ETA on the day of delivery.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>The delivery appointment for order <strong>{{load.order_number}}</strong> has been confirmed.</p><p><strong>Delivery:</strong> {{delivery.name}}<br/><strong>Date:</strong> {{delivery.appointment_date}}<br/><strong>Time:</strong> {{delivery.appointment_time}}<br/><strong>Container:</strong> {{container.number}}</p><p>Driver <strong>{{driver.full_name}}</strong> will reach out with an ETA on the day of delivery.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 9. Empty Container Returned ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Empty Container Returned',
    'Fires when the empty container is returned to the terminal.',
    true,
    'empty_returned',
    'Empty Returned — Container {{container.number}} — {{load.order_number}}',
    E'Hi {{customer.primary_contact_name}},\n\nContainer {{container.number}} (order {{load.order_number}}) has been returned empty to {{return.name}}.\n\nReturned at: {{return.empty_returned_at}}\n\nThis completes the move.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Container <strong>{{container.number}}</strong> (order {{load.order_number}}) has been returned empty to <strong>{{return.name}}</strong>.</p><p><strong>Returned at:</strong> {{return.empty_returned_at}}</p><p>This completes the move.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 10. Cutoff Date Approaching ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Cutoff Date Approaching',
    'Polled reminder. Fires 48 hours before the export cutoff date.',
    true,
    'cutoff_reminder',
    'Cutoff Approaching — {{load.order_number}} — {{load.cutoff_date}}',
    E'Hi {{customer.primary_contact_name}},\n\nReminder: the export cutoff for order {{load.order_number}} is approaching.\n\nCutoff: {{load.cutoff_date}}\nContainer: {{container.number}}\nPickup: {{pickup.name}}\nDelivery: {{delivery.name}}\n\nPlease ensure all shipping instructions are finalized before the cutoff.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Reminder: the export cutoff for order <strong>{{load.order_number}}</strong> is approaching.</p><p><strong>Cutoff:</strong> {{load.cutoff_date}}<br/><strong>Container:</strong> {{container.number}}<br/><strong>Pickup:</strong> {{pickup.name}}<br/><strong>Delivery:</strong> {{delivery.name}}</p><p>Please ensure all shipping instructions are finalized before the cutoff.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 11. Last Free Day Approaching ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Last Free Day Approaching',
    'Polled reminder. Fires 24 hours before the last free day to avoid per diem charges.',
    true,
    'lfd_reminder',
    'Last Free Day — {{load.order_number}} — {{load.last_free_day}}',
    E'Hi {{customer.primary_contact_name}},\n\nReminder: the last free day for container {{container.number}} (order {{load.order_number}}) is {{load.last_free_day}}.\n\nAfter this date, per diem charges will begin accruing. Please confirm the delivery appointment is set to avoid additional charges.\n\nCurrent delivery: {{delivery.name}}\nCurrent appointment: {{delivery.appointment_date}}\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Reminder: the last free day for container <strong>{{container.number}}</strong> (order {{load.order_number}}) is <strong>{{load.last_free_day}}</strong>.</p><p>After this date, per diem charges will begin accruing. Please confirm the delivery appointment is set to avoid additional charges.</p><p><strong>Current delivery:</strong> {{delivery.name}}<br/><strong>Current appointment:</strong> {{delivery.appointment_date}}</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 12. Load Behind Schedule ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Load Behind Schedule',
    'Fires when GPS/ELD data indicates the driver will miss the scheduled pickup or delivery appointment.',
    true,
    'load_delayed',
    'Load Delayed — {{load.order_number}}',
    E'Hi {{customer.primary_contact_name}},\n\nWe wanted to give you a heads-up: order {{load.order_number}} is currently running behind schedule based on real-time tracking.\n\nContainer: {{container.number}}\nDriver: {{driver.full_name}} — {{driver.phone}}\nScheduled: {{delivery.appointment_time}}\nDestination: {{delivery.name}}\n\nWe are working to minimize the delay and will update you as soon as the driver provides a revised ETA.\n\nThank you for your patience,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>We wanted to give you a heads-up: order <strong>{{load.order_number}}</strong> is currently running behind schedule based on real-time tracking.</p><p><strong>Container:</strong> {{container.number}}<br/><strong>Driver:</strong> {{driver.full_name}} — {{driver.phone}}<br/><strong>Scheduled:</strong> {{delivery.appointment_time}}<br/><strong>Destination:</strong> {{delivery.name}}</p><p>We are working to minimize the delay and will update you as soon as the driver provides a revised ETA.</p><p>Thank you for your patience,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── 13. Missing Information ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Missing Information Reminder',
    'Polled reminder. Fires when a load sits in a pending state waiting for required information.',
    true,
    'missing_info_reminder',
    'Action Needed — Missing Information on {{load.order_number}}',
    E'Hi {{customer.primary_contact_name}},\n\nOrder {{load.order_number}} is waiting on additional information from you before we can proceed.\n\nContainer: {{container.number}}\nPickup: {{pickup.name}}\nDelivery: {{delivery.name}}\n\nPlease reply to this email or contact us at your earliest convenience so we can dispatch the load.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Order <strong>{{load.order_number}}</strong> is waiting on additional information from you before we can proceed.</p><p><strong>Container:</strong> {{container.number}}<br/><strong>Pickup:</strong> {{pickup.name}}<br/><strong>Delivery:</strong> {{delivery.name}}</p><p>Please reply to this email or contact us at your earliest convenience so we can dispatch the load.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==================================================================
-- SECTION 3: Auto-seed trigger for new tenants
-- ==================================================================
CREATE OR REPLACE FUNCTION trg_seed_system_email_templates_fn()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_system_email_templates_for_tenant(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_seed_system_email_templates ON tenants;
CREATE TRIGGER trg_seed_system_email_templates
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION trg_seed_system_email_templates_fn();

-- ==================================================================
-- SECTION 4: Backfill existing active tenants
-- ==================================================================
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants WHERE deleted_at IS NULL LOOP
    PERFORM seed_system_email_templates_for_tenant(t.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
