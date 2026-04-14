/**
 * Context Builder — DB-backed hydration
 *
 * Given a tenant + load + acting user, build the context object that
 * `resolveEmailTemplate` expects (see lib/email-variable-resolver.js —
 * the variable catalog is organized by category: load, container,
 * chassis, customer, pickup, delivery, return, driver, truck, charges,
 * dates, tenant, user, system).
 *
 * No caching — each fire rebuilds the context fresh so late-breaking
 * column updates always propagate. At Phase 1 volumes (a few hundred
 * triggers/day) this is ~4-6 queries per fire which is acceptable.
 */

/**
 * Build the full trigger context for a load.
 *
 * Returns { context, formatPrefs, tenant, user } where:
 *   - context    = object matching the email-variables category tree
 *   - formatPrefs = tenant_format_preferences row (falls back to {} if missing)
 *   - tenant     = the tenants row (for lineage logging)
 *   - user       = the acting user row (may be null for cron-fired triggers)
 */
export async function buildTriggerContext(svc, tenantId, loadId, userId) {
  // 1. Fetch the load with the same joins the GET handler uses
  const { data: load, error: loadErr } = await svc
    .from('orders')
    .select(
      `
        *,
        customer:customers!orders_customer_id_fkey(id, name, main_phone, main_contact_name, address_line1, address_line2, city, state, zip),
        pickup_org:customers!orders_pickup_location_id_fkey(id, name, address_line1, city, state, zip, main_phone),
        delivery_org:customers!orders_delivery_location_id_fkey(id, name, address_line1, city, state, zip, main_phone),
        return_org:customers!orders_return_location_id_fkey(id, name, address_line1, city, state, zip, main_phone),
        final_delivery_org:customers!orders_final_delivery_location_id_fkey(id, name, address_line1, city, state, zip, main_phone),
        driver:drivers(id, first_name, last_name, name, phone, email),
        container_owner:container_owners(id, name, label, scac_code)
      `
    )
    .eq('tenant_id', tenantId)
    .eq('id', loadId)
    .maybeSingle();

  if (loadErr) throw new Error(`load fetch: ${loadErr.message}`);
  if (!load) throw new Error(`load not found: ${loadId}`);

  // 2. Fetch tenant (for lineage + fallback context values)
  const { data: tenant } = await svc
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .maybeSingle();

  // 3. Fetch tenant format preferences (single row per tenant)
  const { data: formatPrefs } = await svc
    .from('tenant_format_preferences')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  // 4. Fetch acting user (optional)
  let user = null;
  if (userId) {
    const { data } = await svc
      .from('users')
      .select('id, email, name, first_name, last_name, phone')
      .eq('id', userId)
      .maybeSingle();
    user = data || null;
  }

  // 5. Fetch load charges (for charges.* variables)
  const { data: charges } = await svc
    .from('order_charges')
    .select('*')
    .eq('order_id', loadId)
    .eq('tenant_id', tenantId);

  // 6. Aggregate charges into a single section
  let chargesTotalCents = 0;
  let chargesLinehaulCents = 0;
  for (const c of charges || []) {
    chargesTotalCents += c.amount_cents || 0;
    if (c.charge_type === 'linehaul') chargesLinehaulCents += c.amount_cents || 0;
  }

  const now = new Date();

  // 7. Assemble into the shape the variable catalog expects
  const context = {
    load: {
      id: load.id,
      order_number: load.order_number,
      status: load.status,
      load_type: load.load_type,
      pickup_date: load.pickup_date,
      delivery_date: load.delivery_date,
      cutoff_date: load.cutoff_date,
      last_free_day: load.last_free_day,
      vessel_eta: load.vessel_eta,
      discharge_date: load.discharge_date,
      outgate_date: load.outgate_date,
      ingate_date: load.ingate_date,
      empty_date: load.empty_date,
      per_diem_free_day: load.per_diem_free_day,
      ready_to_return_date: load.ready_to_return_date,
      dispatched_at: load.dispatched_at,
      actual_pickup_at: load.actual_pickup_at,
      actual_delivery_at: load.actual_delivery_at,
      bill_of_lading: load.bill_of_lading,
      house_bol: load.house_bol,
      booking_number: load.booking_number,
      pickup_number: load.pickup_number,
      reservation_number: load.reservation_number,
      appointment_number: load.appointment_number,
      return_number: load.return_number,
      vessel_name: load.vessel_name,
      voyage_number: load.voyage_number,
      shipment_number: load.shipment_number,
      customer_reference: load.customer_reference,
      delivery_reference: load.delivery_reference,
      work_order: load.work_order,
      piece_count: load.piece_count,
      pallet_count: load.pallet_count,
      weight_lbs: load.weight_lbs,
      weight_kg: load.weight_kg,
      commodity_description: load.commodity_description,
      notes: load.notes,
      is_hazmat: load.is_hazmat,
      is_overweight: load.is_overweight,
      is_hot: load.is_hot,
    },
    container: {
      number: load.container_number,
      seal: load.seal_number,
      size: load.container_size,
      type: load.container_type,
      owner: load.container_owner?.name || load.steamship_line_scac || load.steamship_line,
      ssl_scac: load.steamship_line_scac,
      ssl: load.steamship_line,
    },
    chassis: {
      number: load.chassis_number,
      type: load.chassis_type,
      size: load.chassis_size,
      owner: load.chassis_owner,
    },
    customer: {
      id: load.customer?.id,
      name: load.customer?.name,
      phone: load.customer?.main_phone,
      primary_contact_name: load.customer?.main_contact_name,
      address_line1: load.customer?.address_line1,
      address_line2: load.customer?.address_line2,
      city: load.customer?.city,
      state: load.customer?.state,
      zip: load.customer?.zip,
    },
    pickup: orgSection(load.pickup_org),
    delivery: orgSection(load.delivery_org),
    return: orgSection(load.return_org),
    final_delivery: orgSection(load.final_delivery_org),
    driver: {
      id: load.driver?.id,
      full_name:
        load.driver?.name ||
        [load.driver?.first_name, load.driver?.last_name].filter(Boolean).join(' '),
      first_name: load.driver?.first_name,
      last_name: load.driver?.last_name,
      phone: load.driver?.phone,
      email: load.driver?.email,
    },
    truck: {}, // Future: truck assignment lookup
    charges: {
      total: chargesTotalCents / 100,
      total_cents: chargesTotalCents,
      linehaul_amount: chargesLinehaulCents / 100,
      linehaul_cents: chargesLinehaulCents,
      line_count: (charges || []).length,
    },
    dates: {
      now: now.toISOString(),
      today: now.toISOString().slice(0, 10),
    },
    tenant: {
      id: tenant?.id,
      name: tenant?.name,
      scac_code: tenant?.scac_code,
      phone: tenant?.phone,
      email: tenant?.email,
      address: tenant?.address,
    },
    user: user
      ? {
          id: user.id,
          full_name:
            user.name ||
            [user.first_name, user.last_name].filter(Boolean).join(' ') ||
            user.email,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          phone: user.phone,
        }
      : null,
    system: {
      app_url: process.env.NEXT_PUBLIC_APP_URL || 'https://drayagedirect.io',
      load_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://drayagedirect.io'}/dispatcher?load=${load.id}`,
    },
  };

  // rawLoad = the full DB row with ALL columns. The umbrella matcher
  // needs this (not context.load which only has variable-resolver fields).
  return { context, formatPrefs: formatPrefs || {}, tenant: tenant || null, user, rawLoad: load };
}

function orgSection(org) {
  if (!org) return {};
  return {
    id: org.id,
    name: org.name,
    phone: org.main_phone,
    address_line1: org.address_line1,
    city: org.city,
    state: org.state,
    zip: org.zip,
  };
}
