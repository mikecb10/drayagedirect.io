/**
 * Default subject + body for AR email templates (invoice, rate con).
 *
 * These are the source of truth for:
 *   1. What migration 079 seeds into email_templates (invoice_send + rate_con_send rows)
 *   2. What the AR Configuration "Reset to default" action writes back
 *
 * Keep strings in this file byte-identical with the migration's seed INSERTs.
 * If either drifts, Reset behaves unexpectedly.
 */

export const AR_TEMPLATE_DEFAULTS = {
  invoice_send: {
    name: 'Invoice Send',
    description: 'Sent when an AR user dispatches an invoice to a customer via the email popup. Editable in Settings → AR Configuration → Invoice Email.',
    subject: 'Invoice {{invoice.number}} from {{tenant.name}}',
    body_text:
      'Hi {{customer.primary_contact_name}},\n\n' +
      'Please find attached invoice {{invoice.number}} for {{invoice.total}}, ' +
      'covering order {{load.order_number}} (reference {{invoice.reference_number}}).\n\n' +
      'Due date: {{invoice.due_date}}.\n\n' +
      'Reply to this email to confirm receipt.\n\n' +
      'Thank you,\n{{tenant.name}}',
    body_html:
      '<p>Hi {{customer.primary_contact_name}},</p>' +
      '<p>Please find attached invoice <strong>{{invoice.number}}</strong> for <strong>{{invoice.total}}</strong>, ' +
      'covering order <strong>{{load.order_number}}</strong> (reference {{invoice.reference_number}}).</p>' +
      '<p><strong>Due date:</strong> {{invoice.due_date}}</p>' +
      '<p>Reply to this email to confirm receipt.</p>' +
      '<p>Thank you,<br/>{{tenant.name}}</p>',
    body_format: 'plain',
  },

  rate_con_send: {
    name: 'Rate Confirmation Send',
    description: 'Sent when a dispatcher delivers a rate confirmation to a customer via the email popup. Editable in Settings → AR Configuration → Rate Con Email.',
    subject: 'Rate Confirmation {{charge_set.number}} — Order {{load.order_number}}',
    body_text:
      'Hi {{customer.primary_contact_name}},\n\n' +
      'Attached is the rate confirmation for order {{load.order_number}} ' +
      '(container {{container.number}}).\n\n' +
      'Pickup: {{pickup.name}}\n' +
      'Delivery: {{delivery.name}}\n' +
      'Total: {{charge_set.total}}\n\n' +
      'Please reply to confirm.\n\n' +
      'Thank you,\n{{tenant.name}}',
    body_html:
      '<p>Hi {{customer.primary_contact_name}},</p>' +
      '<p>Attached is the rate confirmation for order <strong>{{load.order_number}}</strong> ' +
      '(container {{container.number}}).</p>' +
      '<p><strong>Pickup:</strong> {{pickup.name}}<br/>' +
      '<strong>Delivery:</strong> {{delivery.name}}<br/>' +
      '<strong>Total:</strong> {{charge_set.total}}</p>' +
      '<p>Please reply to confirm.</p>' +
      '<p>Thank you,<br/>{{tenant.name}}</p>',
    body_format: 'plain',
  },

  invoice_bulk_send: {
    name: 'Invoice Bulk Send',
    description: 'Sent when an AR user dispatches multiple invoices to the same customer via the bulk email flow. Editable in Settings → AR Configuration → Invoice Email (Bulk).',
    subject: '{{invoice.count}} invoices from {{tenant.name}} — total {{invoice.total_bulk}}',
    body_text:
      'Hi {{customer.primary_contact_name}},\n\n' +
      'Please find attached {{invoice.count}} invoices from {{tenant.name}}, ' +
      'totaling {{invoice.total_bulk}}:\n' +
      '{{invoice.numbers}}\n\n' +
      'Earliest due date: {{invoice.earliest_due}}.\n\n' +
      'Reply to this email to confirm receipt.\n\n' +
      'Thank you,\n{{tenant.name}}',
    body_html:
      '<p>Hi {{customer.primary_contact_name}},</p>' +
      '<p>Please find attached <strong>{{invoice.count}}</strong> invoices from {{tenant.name}}, ' +
      'totaling <strong>{{invoice.total_bulk}}</strong>:</p>' +
      '<p>{{invoice.numbers}}</p>' +
      '<p><strong>Earliest due date:</strong> {{invoice.earliest_due}}</p>' +
      '<p>Reply to this email to confirm receipt.</p>' +
      '<p>Thank you,<br/>{{tenant.name}}</p>',
    body_format: 'plain',
  },

  rate_con_bulk_send: {
    name: 'Rate Confirmation Bulk Send',
    description: 'Sent when a dispatcher delivers multiple rate confirmations to the same customer via the bulk email flow. Editable in Settings → AR Configuration → Rate Con Email (Bulk).',
    subject: 'Rate Confirmations for {{customer.name}} — {{charge_set.count}} charge sets',
    body_text:
      'Hi {{customer.primary_contact_name}},\n\n' +
      'Attached are {{charge_set.count}} rate confirmations totaling ' +
      '{{charge_set.total_bulk}}:\n' +
      '{{charge_set.numbers}}\n\n' +
      'Please countersign and return at your earliest convenience.\n\n' +
      'Thanks,\n{{tenant.name}}',
    body_html:
      '<p>Hi {{customer.primary_contact_name}},</p>' +
      '<p>Attached are <strong>{{charge_set.count}}</strong> rate confirmations totaling ' +
      '<strong>{{charge_set.total_bulk}}</strong>:</p>' +
      '<p>{{charge_set.numbers}}</p>' +
      '<p>Please countersign and return at your earliest convenience.</p>' +
      '<p>Thanks,<br/>{{tenant.name}}</p>',
    body_format: 'plain',
  },
};

export const AR_SYSTEM_SLUGS = Object.keys(AR_TEMPLATE_DEFAULTS);

export function isArSystemSlug(slug) {
  return AR_SYSTEM_SLUGS.includes(slug);
}
