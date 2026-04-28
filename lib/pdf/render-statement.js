import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import StatementTemplate from '../../components/pdf/StatementTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate } from './format-date';
import { computeAging } from './compute-aging';

/**
 * Compute days past due for a single invoice given an asOfDate.
 */
function computeDaysPastDue(dueDate, asOfDate) {
  // Normalize both to local midnight so the per-row DPD agrees with
  // computeAging()'s bucket assignment (which also uses setHours(0,0,0,0)).
  // Without this, a midday asOf can produce DPD=7 while the same invoice
  // counts into the days_1_30 bucket at 8 days — visible drift on the page.
  const ms = 1000 * 60 * 60 * 24;
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const asOfMidnight = new Date(asOfDate);
  asOfMidnight.setHours(0, 0, 0, 0);
  return Math.floor((asOfMidnight.getTime() - due.getTime()) / ms);
}

/**
 * Pick a display "account number" for the customer. Preference order:
 *   1. customer.short_name (if set)
 *   2. CUST-{first 8 chars of customer.id}
 */
function resolveAccountNumber(customer) {
  if (!customer) return null;
  if (customer.short_name) return customer.short_name;
  if (customer.id) return `CUST-${customer.id.slice(0, 8).toUpperCase()}`;
  return null;
}

/**
 * Fetch Statement data for a customer + asOfDate and shape it for the composer.
 * Returns null if the customer doesn't exist for this tenant.
 *
 * @param {SupabaseClient} svc
 * @param {string} customerId
 * @param {string} tenantId
 * @param {string|Date|null} asOfDate - ISO 'YYYY-MM-DD' or Date; default = now
 */
export async function fetchStatementData(svc, customerId, tenantId, asOfDate) {
  const asOf = asOfDate ? new Date(asOfDate) : new Date();

  // 1. Customer (1 query)
  const { data: customer, error: custErr } = await svc
    .from('customers')
    .select(`
      id, name, short_name, address_line1, address_line2, city, state, zip,
      billing_email, phone
    `)
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (custErr) throw new Error(`Customer fetch failed: ${custErr.message}`);
  if (!customer) return null;

  // 2. Open invoices (1 query, filtered)
  const asOfIso = asOf.toISOString().slice(0, 10);  // YYYY-MM-DD
  const { data: invoices, error: invErr } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, customer_reference,
      invoice_date, due_date, payment_terms_days,
      total_amount_cents, balance_due_cents,
      status, is_consolidated
    `)
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .not('status', 'in', '("void","draft")')
    .gt('balance_due_cents', 0)
    .lte('invoice_date', asOfIso)
    .order('invoice_date', { ascending: true });

  if (invErr) throw new Error(`Invoices fetch failed: ${invErr.message}`);

  const openInvoices = (invoices || []).map((inv) => ({
    invoice_id:            inv.id,
    invoice_number:        inv.invoice_number,
    invoice_date:          formatDate(inv.invoice_date),
    due_date:              formatDate(inv.due_date),
    days_past_due:         computeDaysPastDue(inv.due_date, asOf),
    customer_reference:    inv.customer_reference,
    original_amount_cents: inv.total_amount_cents,
    balance_due_cents:     inv.balance_due_cents,
  }));

  // 3. Aging — pure JS
  const aging = computeAging(invoices || [], asOf);
  const totalOutstandingCents = (invoices || []).reduce((sum, i) => sum + (i.balance_due_cents || 0), 0);

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
    customer_id: customer.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: {
      name:          customer.name,
      address_line1: customer.address_line1,
      address_line2: customer.address_line2,
      city:          customer.city,
      state:         customer.state,
      zip:           customer.zip,
    },
    customer_contact: {
      phone: customer.phone,
      email: customer.billing_email,
    },
    customer_account_number: resolveAccountNumber(customer),
    bill_to_customer_id: customer.id,
    statement_meta: {
      as_of_date:     formatDate(asOf),
      account_number: resolveAccountNumber(customer),
    },
    open_invoices: openInvoices,
    aging,
    total_outstanding_cents: totalOutstandingCents,
  };
}

/**
 * Fetch Statement data + render as PDF Buffer.
 *
 * @param {SupabaseClient} svc
 * @param {string} customerId
 * @param {string} tenantId
 * @param {string|Date|null} asOfDate
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Customer not found' if missing or wrong tenant
 */
export async function renderStatementPdf(svc, customerId, tenantId, asOfDate) {
  const doc = await fetchStatementData(svc, customerId, tenantId, asOfDate);
  if (!doc) throw new Error('Customer not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'statement'
  );

  return await renderToBuffer(
    React.createElement(StatementTemplate, { doc, sectionConfig })
  );
}
</content>
</invoke>