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

  // 7. Fetch routing events so the resolver can render arrival/departure
  // timestamps — {{pickup.arrived_at}}, {{delivery.departed_at}}, etc.
  //
  // Architectural invariant (2026-04-15): a load has at most one pull,
  // one deliver, and one return routing event (the "canonical" trio that
  // drives the load's live state). We grab those three to back the
  // pickup/delivery/return template variables.
  const { data: routingEvents } = await svc
    .from('order_routing_events')
    .select('event_type, sequence, arrived_at, departed_at')
    .eq('tenant_id', tenantId)
    .eq('order_id', loadId)
    .in('event_type', ['pull', 'deliver', 'return'])
    .order('sequence', { ascending: true });

  // Build a first-by-type map. If duplicates exist (shouldn't, but be safe),
  // keep the lowest-sequence one since `.order('sequence')` already gives
  // them to us in that order.
  const firstEventByType = {};
  for (const ev of routingEvents || []) {
    if (!firstEventByType[ev.event_type]) firstEventByType[ev.event_type] = ev;
  }
  const pullEvent = firstEventByType.pull || null;
  const deliverEvent = firstEventByType.deliver || null;
  const returnEvent = firstEventByType.return || null;

  const now = new Date();

  // Helper: map a boolean-ish value to the catalog's expected "Yes"/"No"
  // text. Null/undefined falls through to the resolver's empty placeholder.
  const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);

  // Helper: format reefer temperature. Catalog sample is "34°F" — append
  // the unit when a number is present so the template renders cleanly.
  const formatReeferTemp = (t) => {
    if (t === null || t === undefined || t === '') return null;
    const num = typeof t === 'number' ? t : Number(t);
    if (Number.isNaN(num)) return null;
    return `${num}°F`;
  };

  // 8. Assemble into the shape the variable catalog expects
  //
  // Key note: template variables use simplified names (e.g. `load.weight`,
  // `load.type`, `container.vessel`) that differ from the raw DB columns
  // (`weight_lbs`, `load_type`, `vessel_name`). We include BOTH so existing
  // templates that reference column names keep working while the catalog
  // documented in lib/email-variables.js resolves cleanly.
  const context = {
    load: {
      id: load.id,
      order_number: load.order_number,
      status: load.status,
      // Catalog alias: {{load.type}} — template-friendly name for load_type.
      type: load.load_type,
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
      // Catalog: {{load.available_date}} — when the container became available.
      available_date: load.available_date,
      dispatched_at: load.dispatched_at,
      actual_pickup_at: load.actual_pickup_at,
      actual_delivery_at: load.actual_delivery_at,
      // Catalog aliases for the datetime variables in the picker.
      dispatched_date: load.dispatched_at,
      delivered_date: load.actual_delivery_at,
      // No dedicated completed_at column; fall back to actual_delivery_at
      // so the Completed template variable isn't blank.
      completed_date: load.actual_delivery_at,
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
      // Catalog alias: {{load.weight}} — weight formatter uses tenant units.
      weight: load.weight_lbs,
      commodity_description: load.commodity_description,
      // Catalog alias: {{load.commodity}}.
      commodity: load.commodity_description,
      notes: load.notes,
      is_hazmat: load.is_hazmat,
      is_overweight: load.is_overweight,
      is_hot: load.is_hot,
      // Catalog aliases for the Yes/No derived flags.
      hazmat: yesNo(load.is_hazmat),
      overweight: yesNo(load.is_overweight),
      // Next-appointment fallback — tries pickup, then delivery, then return.
      // Enough for templates like "Load Delayed" that reference the generic
      // load.appointment_* pair; section-specific templates should prefer
      // pickup.appointment_* / delivery.appointment_* / return.appointment_*.
      appointment_date:
        load.pickup_apt_from || load.delivery_apt_from || load.return_apt_from,
      appointment_time:
        load.pickup_apt_from || load.delivery_apt_from || load.return_apt_from,
    },
    container: {
      number: load.container_number,
      seal: load.seal_number,
      size: load.container_size,
      type: load.container_type,
      owner: load.container_owner?.name || load.steamship_line_scac || load.steamship_line,
      ssl_scac: load.steamship_line_scac,
      ssl: load.steamship_line,
      // Catalog aliases: vessel/voyage live on the orders row but the
      // picker groups them under Container since they're container-trip
      // attributes.
      vessel: load.vessel_name,
      voyage: load.voyage_number,
      genset: yesNo(load.is_genset),
      reefer_temp: formatReeferTemp(load.genset_temperature),
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
    // Location sections — orgSection layers the static org fields with
    // load-level timestamps (from the routing event for this leg) and
    // the appointment window (from orders.*_apt_from). Without this the
    // system-triggered templates (#3 Arrived at Pickup, #6 Arrived at
    // Delivery, #7 Delivered, #8 Appointment Confirmed, #9 Empty Returned)
    // would all render "—" for the most important fields.
    pickup: orgSection(load.pickup_org, {
      arrived_at: pullEvent?.arrived_at,
      departed_at: pullEvent?.departed_at,
      appointment_date: load.pickup_apt_from || load.pickup_date,
      appointment_time: load.pickup_apt_from || load.pickup_date,
    }),
    delivery: orgSection(load.delivery_org, {
      arrived_at: deliverEvent?.arrived_at,
      departed_at: deliverEvent?.departed_at,
      appointment_date: load.delivery_apt_from || load.delivery_date,
      appointment_time: load.delivery_apt_from || load.delivery_date,
    }),
    return: orgSection(load.return_org, {
      arrived_at: returnEvent?.arrived_at,
      // Return's "empty returned" = the depart timestamp on the return event.
      empty_returned_at: returnEvent?.departed_at,
      appointment_date: load.return_apt_from,
      appointment_time: load.return_apt_from,
    }),
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

/**
 * Build a full variable-resolver context starting from an invoice id.
 * Hydrates: invoice, linked charge set(s), linked order, customer,
 * container, pickup/delivery locations, tenant.
 *
 * The returned context includes all load.* / customer.* / container.* etc.
 * tokens (via the reused buildTriggerContext call) plus the invoice.*
 * and charge_set.* families.
 */
export async function buildInvoiceContext(svc, invoiceId, tenantId) {
  const { data: invoice, error } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, sent_at, created_at, due_date,
      subtotal_cents, total_amount_cents,
      customer_id,
      customer:customers!customer_id(id, name, billing_email, address_line1, address_line2, city, state, zip, payment_terms),
      charge_sets:invoice_charge_sets(
        charge_set:order_charge_sets(
          id, charge_set_number, total_cents,
          order:orders(id, order_number, customer_reference)
        )
      )
    `)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(`Invoice fetch failed: ${error.message}`);
  if (!invoice) {
    const err = new Error('Invoice not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Derive reference_number the same way the invoice PDF renderer does:
  // first non-null customer_reference from linked charge sets, else first order_number.
  const firstCs = invoice.charge_sets?.[0]?.charge_set;
  const referenceNumber =
    firstCs?.order?.customer_reference ||
    firstCs?.order?.order_number ||
    null;

  // Build a load-level context from the first linked order (if any).
  // Reuses buildTriggerContext so token coverage matches non-AR sends.
  // Surface formatPrefs from the trigger-context call so callers don't have
  // to refetch tenant_format_preferences on their own.
  let loadContext = {};
  let formatPrefs = null;
  if (firstCs?.order?.id) {
    const result = await buildTriggerContext(svc, tenantId, firstCs.order.id, null);
    loadContext = result.context;
    formatPrefs = result.formatPrefs || null;
  } else {
    // No linked order — fetch format prefs directly to keep the contract
    // uniform regardless of whether the invoice has reached an order yet.
    const { data: fp } = await svc
      .from('tenant_format_preferences')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    formatPrefs = fp || null;
  }

  const context = {
    ...loadContext,
    // Shape matches EMAIL_VARIABLES catalog paths (invoice.number, invoice.total, etc.)
    // The resolver calls getByPath(context, 'invoice.total') so keys must match exactly.
    invoice: {
      number: invoice.invoice_number || null,
      // kind:'currency' expects dollar values (not cents)
      total: invoice.total_amount_cents != null ? invoice.total_amount_cents / 100 : null,
      subtotal: invoice.subtotal_cents != null ? invoice.subtotal_cents / 100 : null,
      due_date: invoice.due_date || null,
      // issue_date is derived from sent_at or created_at
      issue_date: invoice.sent_at || invoice.created_at || null,
      reference_number: referenceNumber,
      customer_id: invoice.customer_id,
    },
    charge_set: firstCs
      ? {
          number: firstCs.charge_set_number || null,
          // kind:'currency' expects dollar values (not cents)
          total: firstCs.total_cents != null ? firstCs.total_cents / 100 : null,
          reference_number: referenceNumber,
        }
      : null,
  };

  return { context, formatPrefs };
}

/**
 * Build a template-rendering context for a bulk-invoice email.
 * All invoice_ids must belong to the same customer_id (caller asserts
 * via resolveBulkBillingRecipients or similar).
 *
 * Populates context.invoice.* with bulk-aware values so the pure-
 * descriptor catalog (lib/email-variables.js) resolves correctly
 * via getByPath:
 *   - invoice.numbers       (comma-joined string)
 *   - invoice.count         (string)
 *   - invoice.total_bulk    (dollars, summed and divided — catalog currency kind expects dollars)
 *   - invoice.earliest_due  (ISO date string from due_date)
 *   - invoice.number        (first invoice's number — fallback for single-send tokens)
 *   - invoice.total, invoice.subtotal, invoice.due_date, invoice.issue_date,
 *     invoice.reference_number — from the first invoice (fallback)
 *
 * context.invoices = full array of invoice rows (available for future tokens / debugging).
 *
 * NOTE: argument order matches buildInvoiceContext: (svc, invoiceId, tenantId) →
 * we use (svc, tenantId, invoiceIds) with tenantId second because there is no
 * single invoiceId — callers must pass tenantId explicitly.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} tenantId
 * @param {string[]} invoiceIds
 * @returns {Promise<{ context: object, formatPrefs: object }>}
 */
export async function buildBulkInvoiceContext(svc, tenantId, invoiceIds) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new Error('buildBulkInvoiceContext: invoiceIds required');
  }

  // Load all invoices — select the same columns buildInvoiceContext uses
  // (invoice_number, total_amount_cents, subtotal_cents, due_date, sent_at, created_at, customer_id).
  const { data: invoices, error } = await svc
    .from('invoices')
    .select('id, invoice_number, sent_at, created_at, due_date, subtotal_cents, total_amount_cents, customer_id')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .in('id', invoiceIds)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`buildBulkInvoiceContext: ${error.message}`);
  if (!invoices || invoices.length !== invoiceIds.length) {
    throw new Error(
      `buildBulkInvoiceContext: expected ${invoiceIds.length} invoices, got ${invoices?.length ?? 0}`
    );
  }

  // Reuse single-invoice builder for tenant/format/customer/load fields.
  // buildInvoiceContext signature: (svc, invoiceId, tenantId) — invoiceId before tenantId.
  const { context: singleCtx, formatPrefs } = await buildInvoiceContext(
    svc, invoiceIds[0], tenantId
  );

  // Compute bulk-specific values
  const invoiceNumbers = invoices
    .map((i) => i.invoice_number)
    .filter(Boolean)
    .join(', ');

  const totalCentsSum = invoices.reduce((a, i) => a + (i.total_amount_cents || 0), 0);
  const totalBulkDollars = totalCentsSum / 100; // catalog currency kind expects dollars

  // Sort due_date strings ascending; pick earliest non-null one
  const dueDates = invoices.map((i) => i.due_date).filter(Boolean).sort();
  const earliestDue = dueDates[0] ?? null;

  const context = {
    ...singleCtx,
    invoices, // plural — full array for future tokens / debugging
    invoice: {
      ...singleCtx.invoice, // fields from first invoice: number, total, subtotal, due_date, issue_date, reference_number, customer_id
      numbers: invoiceNumbers,      // bulk token: comma-joined invoice numbers
      count: String(invoices.length),
      total_bulk: totalBulkDollars, // bulk token: sum in dollars
      earliest_due: earliestDue,    // bulk token: earliest due_date
    },
  };

  return { context, formatPrefs };
}

/**
 * Build a variable-resolver context starting from a charge-set id.
 * Hydrates: charge set, linked order, full load context tree.
 */
export async function buildChargeSetContext(svc, chargeSetId, tenantId) {
  const { data: cs, error } = await svc
    .from('order_charge_sets')
    .select(`
      id, charge_set_number, total_cents, created_at,
      order_id,
      order:orders(id, order_number, customer_reference, customer_id)
    `)
    .eq('id', chargeSetId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Charge set fetch failed: ${error.message}`);
  if (!cs) {
    const err = new Error('Charge set not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const referenceNumber = cs.order?.customer_reference || cs.order?.order_number || null;

  let loadContext = {};
  let formatPrefs = null;
  if (cs.order?.id) {
    const result = await buildTriggerContext(svc, tenantId, cs.order.id, null);
    loadContext = result.context;
    formatPrefs = result.formatPrefs || null;
  } else {
    const { data: fp } = await svc
      .from('tenant_format_preferences')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    formatPrefs = fp || null;
  }

  const context = {
    ...loadContext,
    // Shape matches EMAIL_VARIABLES catalog paths (charge_set.number, charge_set.total, etc.)
    charge_set: {
      number: cs.charge_set_number || null,
      // kind:'currency' expects dollar values (not cents)
      total: cs.total_cents != null ? cs.total_cents / 100 : null,
      reference_number: referenceNumber,
      order: cs.order ? { customer_id: cs.order.customer_id } : null,
    },
  };

  return { context, formatPrefs };
}

/**
 * Build a location section (pickup/delivery/return/final_delivery).
 *
 * The `extras` argument layers load-level fields on top of the static org
 * record — things like the arrived_at timestamp (which lives on the routing
 * event, not on the customer row) or the appointment window (which lives on
 * orders.pickup_apt_from etc.). Keeping this in one helper means the catalog
 * contract (what `{{pickup.arrived_at}}` resolves to) is declared once.
 *
 * When `org` is null but extras has data, we still return the extras so
 * timestamp/appointment variables keep working even if the dispatcher hasn't
 * picked an org yet.
 */
function orgSection(org, extras = {}) {
  if (!org) {
    return { ...extras };
  }
  return {
    id: org.id,
    name: org.name,
    phone: org.main_phone,
    address_line1: org.address_line1,
    city: org.city,
    state: org.state,
    zip: org.zip,
    ...extras,
  };
}
