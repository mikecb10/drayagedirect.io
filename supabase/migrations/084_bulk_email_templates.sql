-- ============================================================
-- Migration 084: Bulk AR email templates (rate con + invoice)
-- ============================================================
-- Splits the AR email templates into single + bulk variants so
-- bulk sends don't reference only the first charge-set or invoice.
--
-- The existing `rate_con_send` + `invoice_send` templates use
-- singular tokens ({{charge_set.number}}, {{invoice.number}},
-- {{pickup.name}}, etc.) — fine for single-send, misleading for
-- bulk-send where the subject + body describe only the first
-- attachment.
--
-- This migration:
--   1. Updates seed_ar_email_templates_for_tenant (defined in
--      migration 079) to ALSO seed two new rows:
--        - rate_con_bulk_send
--        - invoice_bulk_send
--      Existing `invoice_send` + `rate_con_send` INSERTs are
--      preserved intact; tenants that have customized those are
--      unaffected (ON CONFLICT DO NOTHING on all four).
--   2. Backfills existing active tenants via the updated function.
--
-- Bulk tokens (already populated by buildBulkChargeSetContext /
-- buildBulkInvoiceContext):
--   {{charge_set.numbers}}   — comma-joined
--   {{charge_set.count}}     — "3"
--   {{charge_set.total_bulk}} — sum in dollars
--   {{invoice.numbers}} / {{invoice.count}} / {{invoice.total_bulk}}
--   {{invoice.earliest_due}}
--
-- Endpoints (email-defaults-bulk-rate-con.js, email-defaults-bulk.js)
-- look up the bulk slug first and fall back to the single slug so
-- tenants pre-084 keep working until the migration applies.
-- ============================================================

BEGIN;

-- ── AR seed function (adds two new bulk rows) ──
-- Keep the existing invoice_send + rate_con_send INSERTs byte-identical
-- with migration 079 so this is a pure superset. The ON CONFLICT
-- clauses mean tenants who customized the originals keep their edits.
CREATE OR REPLACE FUNCTION seed_ar_email_templates_for_tenant(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  -- ── AR #1: Invoice Send (unchanged from migration 079) ──
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

  -- ── AR #2: Rate Confirmation Send (unchanged from migration 079) ──
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

  -- ── AR #3: Invoice Bulk Send (NEW in migration 084) ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug, category,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Invoice Bulk Send',
    'Sent when an AR user dispatches multiple invoices to the same customer via the bulk email flow. Editable in Settings → AR Configuration → Invoice Email (Bulk).',
    true,
    'invoice_bulk_send',
    'ar',
    '{{invoice.count}} invoices from {{tenant.name}} — total {{invoice.total_bulk}}',
    E'Hi {{customer.primary_contact_name}},\n\nPlease find attached {{invoice.count}} invoices from {{tenant.name}}, totaling {{invoice.total_bulk}}:\n{{invoice.numbers}}\n\nEarliest due date: {{invoice.earliest_due}}.\n\nReply to this email to confirm receipt.\n\nThank you,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Please find attached <strong>{{invoice.count}}</strong> invoices from {{tenant.name}}, totaling <strong>{{invoice.total_bulk}}</strong>:</p><p>{{invoice.numbers}}</p><p><strong>Earliest due date:</strong> {{invoice.earliest_due}}</p><p>Reply to this email to confirm receipt.</p><p>Thank you,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;

  -- ── AR #4: Rate Confirmation Bulk Send (NEW in migration 084) ──
  INSERT INTO email_templates (
    tenant_id, name, description, is_system, system_slug, category,
    subject, body_text, body_html, body_format
  ) VALUES (
    p_tenant_id,
    'Rate Confirmation Bulk Send',
    'Sent when a dispatcher delivers multiple rate confirmations to the same customer via the bulk email flow. Editable in Settings → AR Configuration → Rate Con Email (Bulk).',
    true,
    'rate_con_bulk_send',
    'ar',
    'Rate Confirmations for {{customer.name}} — {{charge_set.count}} charge sets',
    E'Hi {{customer.primary_contact_name}},\n\nAttached are {{charge_set.count}} rate confirmations totaling {{charge_set.total_bulk}}:\n{{charge_set.numbers}}\n\nPlease countersign and return at your earliest convenience.\n\nThanks,\n{{tenant.name}}',
    '<p>Hi {{customer.primary_contact_name}},</p><p>Attached are <strong>{{charge_set.count}}</strong> rate confirmations totaling <strong>{{charge_set.total_bulk}}</strong>:</p><p>{{charge_set.numbers}}</p><p>Please countersign and return at your earliest convenience.</p><p>Thanks,<br/>{{tenant.name}}</p>',
    'plain'
  )
  ON CONFLICT (tenant_id, system_slug) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Backfill existing active tenants with the two new bulk rows ──
-- The existing invoice_send + rate_con_send rows are preserved by
-- ON CONFLICT DO NOTHING; only the two new slugs will insert.
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
