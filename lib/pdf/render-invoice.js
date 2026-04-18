import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import InvoiceTemplate from '../../components/pdf/InvoiceTemplate';

/**
 * Fetch invoice data and render as PDF Buffer.
 * @param {SupabaseClient} svc - service-role client
 * @param {string} invoiceId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Invoice not found' if missing or wrong tenant
 */
export async function renderInvoicePdf(svc, invoiceId, tenantId) {
  // Fetch invoice + joins
  const { data: invoice, error } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, sent_at, created_at, due_date, subtotal_cents, total_amount_cents, notes,
      customer:customers!customer_id(id, name, billing_email, address_line1, address_line2, city, state, zip, payment_terms),
      line_items:invoice_line_items(id, description, quantity, unit_amount_cents, total_amount_cents, sort_order),
      charge_sets:invoice_charge_sets(
        charge_set:order_charge_sets(
          charge_set_number,
          order:orders(order_number, customer_reference)
        )
      )
    `)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(`Invoice query failed: ${error.message}`);
  if (!invoice) throw new Error('Invoice not found');

  // Fetch tenant name for header
  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  // Reference number: prefer orders.customer_reference from linked charge sets,
  // else fall back to order_number for identification.
  const cs = invoice.charge_sets?.[0]?.charge_set;
  const referenceNumber = cs?.order?.customer_reference || cs?.order?.order_number || null;

  // Sort line items
  const lineItems = (invoice.line_items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Build props
  const props = {
    tenantName: tenant?.name || 'Company',
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.sent_at || invoice.created_at,
    dueDate: invoice.due_date,
    referenceNumber,
    customer: invoice.customer,
    lineItems,
    subtotal: invoice.subtotal_cents,
    total: invoice.total_amount_cents,
    notes: invoice.notes,
  };

  return await renderToBuffer(React.createElement(InvoiceTemplate, props));
}
