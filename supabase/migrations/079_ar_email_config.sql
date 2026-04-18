-- ============================================================
-- Migration 079: AR email configuration
-- ============================================================
-- Adds the category column to email_templates so AR-specific
-- templates (invoice, rate confirmation) can be routed to a
-- dedicated settings section instead of the operational-templates
-- list. Seeds two new system templates per tenant and backfills
-- existing tenants. Adds optional audit columns on invoices for
-- tracking deliberate "Skip email" actions.
--
-- Supports sub-projects 2a.2 (invoice email popup) + 2a.3 (rate
-- confirmation email popup).
-- ============================================================

BEGIN;

-- ── email_templates.category ─────────────────────────────────
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'operational';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'email_templates'::regclass
      AND conname = 'email_templates_category_check'
  ) THEN
    ALTER TABLE email_templates
      ADD CONSTRAINT email_templates_category_check
      CHECK (category IN ('operational', 'ar'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_templates_tenant_category
  ON email_templates(tenant_id, category);

-- ── invoices.email_skipped_* audit columns ──────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS email_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_skipped_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ── AR seed function (separate from operational 13-row seeder) ──
-- The existing seed_system_email_templates_for_tenant() defined in
-- migration 056 seeds the 13 operational templates and is NOT
-- modified here. We add a parallel function dedicated to AR rows.
CREATE OR REPLACE FUNCTION seed_ar_email_templates_for_tenant(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  -- ── AR #1: Invoice Send ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug, category,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Invoice Send',
    'Sent when an AR user dispatches an invoice to a customer via the email popup. Editable in Settings → AR Configuration → Invoice Email.',
    true,
    'invoice_send',
    'ar',
    'Invoice {{invoice.number}} from {{tenant.name}}',
    E'Hi {{customer.primary_contact_name}},\n\nPlease find attached invoice {{invoice.number}} for {{invoice.total}}, covering order {{load.order_number}} (reference {{invoice.reference_number}}).\n\nDue date: {{invoice.due_date}}.\n\nReply to this email to confirm receipt.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Please find attached invoice <strong>{{invoice.number}}</strong> for <strong>{{invoice.total}}</strong>, covering order <strong>{{load.order_number}}</strong> (reference {{invoice.reference_number}}).</p><p><strong>Due date:</strong> {{invoice.due_date}}</p><p>Reply to this email to confirm receipt.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── AR #2: Rate Confirmation Send ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug, category,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Rate Confirmation Send',
    'Sent when a dispatcher delivers a rate confirmation to a customer via the email popup. Editable in Settings → AR Configuration → Rate Con Email.',
    true,
    'rate_con_send',
    'ar',
    'Rate Confirmation {{charge_set.number}} — Order {{load.order_number}}',
    E'Hi {{customer.primary_contact_name}},\n\nAttached is the rate confirmation for order {{load.order_number}} (container {{container.number}}).\n\nPickup: {{pickup.name}}\nDelivery: {{delivery.name}}\nTotal: {{charge_set.total}}\n\nPlease reply to confirm.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Attached is the rate confirmation for order <strong>{{load.order_number}}</strong> (container {{container.number}}).</p><p><strong>Pickup:</strong> {{pickup.name}}<br/><strong>Delivery:</strong> {{delivery.name}}<br/><strong>Total:</strong> {{charge_set.total}}</p><p>Please reply to confirm.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Auto-seed trigger for new tenants (AR templates) ────────
CREATE OR REPLACE FUNCTION trg_seed_ar_email_templates_fn()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_ar_email_templates_for_tenant(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_seed_ar_email_templates ON tenants;
CREATE TRIGGER trg_seed_ar_email_templates
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION trg_seed_ar_email_templates_fn();

-- ── Backfill existing active tenants with AR templates ──────
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants WHERE deleted_at IS NULL LOOP
    PERFORM seed_ar_email_templates_for_tenant(t.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
