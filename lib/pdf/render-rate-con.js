import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import RateConTemplate from '../../components/pdf/RateConTemplate';

/**
 * Fetch rate-con data (charge set + load + equipment + locations)
 * and render as PDF Buffer.
 *
 * NOTE: pickup/delivery locations are stored on the orders table as foreign
 * keys to the customers table (not a separate locations table). The FK names
 * are orders_pickup_location_id_fkey and orders_delivery_location_id_fkey,
 * confirmed from the existing load-detail endpoint.
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} chargeSetId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Charge set not found' if missing or wrong tenant
 */
export async function renderRateConPdf(svc, chargeSetId, tenantId) {
  const { data: cs, error } = await svc
    .from('order_charge_sets')
    .select(`
      id, charge_set_number, created_at, total_cents,
      order:orders(
        order_number, reference_number, container_number, chassis_number,
        pickup_org:customers!orders_pickup_location_id_fkey(id, name, address_line1, city, state, zip),
        delivery_org:customers!orders_delivery_location_id_fkey(id, name, address_line1, city, state, zip),
        pickup_appt_from, delivery_appt_from
      ),
      line_items:order_charge_set_line_items(id, name, description, unit_count, per_unit_price_cents, total_cents)
    `)
    .eq('id', chargeSetId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Charge set query failed: ${error.message}`);
  if (!cs) throw new Error('Charge set not found');

  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const lineItems = (cs.line_items || []).map((li) => ({
    id: li.id,
    description: li.description || li.name,
    quantity: li.unit_count || 1,
    unit_amount_cents: li.per_unit_price_cents,
    total_amount_cents: li.total_cents,
  }));

  const props = {
    tenantName: tenant?.name || 'Company',
    confirmationNumber: cs.charge_set_number,
    issueDate: cs.created_at,
    referenceNumber: cs.order?.reference_number || cs.order?.order_number || null,
    containerNumber: cs.order?.container_number,
    chassisNumber: cs.order?.chassis_number,
    pickup: {
      location: cs.order?.pickup_org,
      date: cs.order?.pickup_appt_from,
    },
    delivery: {
      location: cs.order?.delivery_org,
      date: cs.order?.delivery_appt_from,
    },
    lineItems,
    total: cs.total_cents,
  };

  return await renderToBuffer(React.createElement(RateConTemplate, props));
}
