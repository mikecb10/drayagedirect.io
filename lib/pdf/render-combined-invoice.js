import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import CombinedInvoiceTemplate from '../../components/pdf/CombinedInvoiceTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate } from './format-date';

/**
 * Fetch consolidated invoice data and shape it for the combined-invoice
 * composer. Returns null if the invoice doesn't exist for this tenant.
 *
 * Uses orders.pickup_org / orders.delivery_org directly for the Loads Summary
 * locations (cheaper than per-order moves+events fetch — and the configured
 * pickup/delivery is the billing-correct answer, not the actual first-pull /
 * last-deliver event location).
 */
export async function fetchCombinedInvoiceData(svc, invoiceId, tenantId) {
  // 1. Invoice + bill-to customer (1 query)
  const { data: invoice, error: invErr } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, invoice_date, sent_at, created_at, due_date,
      payment_terms_days, is_consolidated,
      subtotal_cents, total_amount_cents, notes,
      customer_id,
      customer:customers!customer_id(
        id, name, address_line1, address_line2, city, state, zip,
        billing_email, phone
      )
    `)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (invErr) throw new Error(`Invoice fetch failed: ${invErr.message}`);
  if (!invoice) return null;

  // 2. ALL linked charge sets → ALL N orders + their pickup_org / delivery_org (1 query, joined)
  const { data: linkRows, error: linkErr } = await svc
    .from('invoice_charge_sets')
    .select(`
      charge_set:order_charge_sets(
        id, charge_set_number, order_id,
        order:orders(
          id, order_number, customer_reference,
          container_number, chassis_number,
          pickup_apt_from, delivery_apt_from,
          pickup_org:customers!orders_pickup_location_id_fkey(id, name, city, state),
          delivery_org:customers!orders_delivery_location_id_fkey(id, name, city, state)
        )
      )
    `)
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId);

  if (linkErr) throw new Error(`invoice_charge_sets lookup failed: ${linkErr.message}`);

  const consolidatedCount = (linkRows || []).length;

  // Build loads_summary array, one per order. Preserve link order.
  const loadsSummary = (linkRows || [])
    .map((link) => link.charge_set?.order)
    .filter(Boolean)
    .map((order) => ({
      order_id:          order.id,
      load_number:       order.order_number,
      container_number:  order.container_number,
      chassis_number:    order.chassis_number,
      pickup_location:   order.pickup_org
        ? { name: order.pickup_org.name, city: order.pickup_org.city, state: order.pickup_org.state }
        : null,
      delivery_location: order.delivery_org
        ? { name: order.delivery_org.name, city: order.delivery_org.city, state: order.delivery_org.state }
        : null,
      pickup_date:       formatDate(order.pickup_apt_from),
      delivery_date:     formatDate(order.delivery_apt_from),
    }));

  // 3. Invoice line items grouped by order_id (1 query)
  const { data: lineItems, error: liErr } = await svc
    .from('invoice_line_items')
    .select('id, order_id, description, quantity, unit_amount_cents, total_amount_cents, sort_order')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true });
  if (liErr) throw new Error(`invoice_line_items fetch failed: ${liErr.message}`);

  // Group by order_id, preserving the loadsSummary order.
  const linesByOrder = new Map();
  for (const li of lineItems || []) {
    const key = li.order_id || '__orphan__';
    if (!linesByOrder.has(key)) linesByOrder.set(key, []);
    linesByOrder.get(key).push({
      description:        li.description,
      quantity:           li.quantity,
      unit_amount_cents:  li.unit_amount_cents,
      total_amount_cents: li.total_amount_cents,
    });
  }
  const chargeGroups = loadsSummary
    .map((load) => {
      const lines = linesByOrder.get(load.order_id) || [];
      const subtotal_cents = lines.reduce((sum, l) => sum + (l.total_amount_cents || 0), 0);
      return { order_id: load.order_id, load_number: load.load_number, lines, subtotal_cents };
    })
    .filter((g) => g.lines.length > 0); // omit groups with no line items (defensive)

  // 4. Tenant + tenant_settings for Header (1 query each)
  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();
  const { data: settings } = await svc
    .from('tenant_settings')
    .select('company_display_name, logo_small_url, logo_large_url, address_line1, address_line2, city, state, zip, phone, website')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const tenant_info = {
    logo_url: settings?.logo_large_url || settings?.logo_small_url || null,
    address: [
      settings?.address_line1,
      settings?.address_line2,
      [settings?.city, settings?.state, settings?.zip].filter(Boolean).join(', '),
    ].filter(Boolean).join(', ') || null,
    phone: settings?.phone || null,
    website: settings?.website || null,
  };

  return {
    invoice_id: invoice.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: invoice.customer
      ? {
          name:          invoice.customer.name,
          address_line1: invoice.customer.address_line1,
          city:          invoice.customer.city,
          state:         invoice.customer.state,
          zip:           invoice.customer.zip,
        }
      : null,
    customer_contact: invoice.customer
      ? { phone: invoice.customer.phone, email: invoice.customer.billing_email }
      : null,
    bill_to_customer_id: invoice.customer_id || null,
    invoice_meta: {
      invoice_number:     invoice.invoice_number,
      invoice_date:       formatDate(invoice.invoice_date || invoice.sent_at || invoice.created_at),
      due_date:           formatDate(invoice.due_date),
      terms_days:         invoice.payment_terms_days,
      is_consolidated:    !!invoice.is_consolidated,
      consolidated_count: consolidatedCount,
      notes:              invoice.notes,
    },
    loads_summary: loadsSummary,
    charge_groups: chargeGroups,
    totals: {
      subtotal_cents: invoice.subtotal_cents,
      total_cents:    invoice.total_amount_cents,
    },
  };
}

/**
 * Fetch combined-invoice data + render as PDF Buffer. Public entry-point
 * is renderInvoicePdf in lib/pdf/render-invoice.js (which delegates here
 * when invoice.is_consolidated is true).
 *
 * @param {SupabaseClient} svc
 * @param {string} invoiceId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Invoice not found' if missing or wrong tenant
 */
export async function renderCombinedInvoicePdf(svc, invoiceId, tenantId) {
  const doc = await fetchCombinedInvoiceData(svc, invoiceId, tenantId);
  if (!doc) throw new Error('Invoice not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'combined_invoice'
  );

  return await renderToBuffer(
    React.createElement(CombinedInvoiceTemplate, { doc, sectionConfig })
  );
}
