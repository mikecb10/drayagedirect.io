import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-pod-section-data.js';

const baseDoc = {
  order_id: 'order-uuid',
  tenant_name: 'Acme Drayage',
  tenant_info: {
    logo_url: 'https://example.com/logo.png',
    address: '1 Main St, Newark, NJ 07102',
    phone: '555-1212',
    website: 'acme.com',
  },
  bill_to: { name: 'Walmart', address_line1: '702 SW 8th', city: 'Bentonville', state: 'AR', zip: '72716' },
  customer_contact: { phone: '555-9999', email: 'ap@walmart.com' },
  bill_to_customer_id: 'cust-walmart-uuid',
  pod_meta: {
    order_number: 'L-ABC',
    customer_reference: 'PO-12345',
    driver_name: 'John Driver',
    delivery_date: 'Apr 26, 2026',
    delivery_time: '2:30 PM',
  },
  first_order: {
    order_id: 'order-uuid',
    order_number: 'L-ABC',
    customer_reference: 'PO-12345',
    container_number: 'MSCU1234567',
    container_size: '40',
    container_type: 'HC',
    chassis_number: 'CHX9999',
    chassis_size: null,
    chassis_type: null,
    chassis_owner: null,
    steamship_line: 'MSC',
    seal_number: 'SEAL999',
    mbol: 'MBL123',
    hbol: 'HBL456',
    booking_number: 'BK789',
    pickup_number: 'PU123',
    is_hazmat: false,
    last_free_day: '2026-04-22',
    per_diem_free_day: '2026-04-25',
    pull_container_date: '2026-04-20',
    return_container_date: '2026-04-23',
    notes: 'Driver delivered without incident',
    internal_notes: 'Internal: route went smoothly',
  },
  load_level_locations: {
    pickup_location:   { name: 'Newark Terminal',  city: 'Newark', state: 'NJ' },
    delivery_location: { name: 'Edison Warehouse', city: 'Edison', state: 'NJ' },
    return_location:   { name: 'Newark Terminal',  city: 'Newark', state: 'NJ' },
  },
  moves: [],
  attached_documents: [
    { id: 'doc-1', file_name: 'POD_signed.jpg', document_type: 'POD', uploaded_at: 'Apr 26, 2026' },
    { id: 'doc-2', file_name: 'BOL_copy.pdf',   document_type: 'POD', uploaded_at: 'Apr 26, 2026' },
  ],
};

test('buildSectionData maps pod_meta to pod_details (5 fields)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.pod_details.order_number, 'L-ABC');
  assert.equal(sd.pod_details.customer_reference, 'PO-12345');
  assert.equal(sd.pod_details.driver_name, 'John Driver');
  assert.equal(sd.pod_details.delivery_date, 'Apr 26, 2026');
  assert.equal(sd.pod_details.delivery_time, '2:30 PM');
});

test('buildSectionData maps bill_to to address_details.customer (AddressDetails-internal ID)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer.name, 'Walmart');
  assert.equal(sd.address_details.customer.phone, '555-9999');
});

test('buildSectionData maps load_level_locations to address_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.pickup_location.name,   'Newark Terminal');
  assert.equal(sd.address_details.delivery_location.name, 'Edison Warehouse');
  assert.equal(sd.address_details.return_location.name,   'Newark Terminal');
});

test('buildSectionData maps first_order columns to order_details (19 fields)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.order_details.reference_number,      'PO-12345');
  assert.equal(sd.order_details.container_number,      'MSCU1234567');
  assert.equal(sd.order_details.steamship_line,        'MSC');
  assert.equal(sd.order_details.booking_bl,            'BK789');
  assert.equal(sd.order_details.last_free_day,         '2026-04-22');
});

test('buildSectionData passes attached_documents through verbatim', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.attached_documents.length, 2);
  assert.equal(sd.attached_documents[0].file_name, 'POD_signed.jpg');
  assert.equal(sd.attached_documents[1].file_name, 'BOL_copy.pdf');
});

test('buildSectionData maps notes.driver_notes from first_order.notes', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.driver_notes, 'Driver delivered without incident');
});

test('buildSectionData returns null-safe shapes when first_order is null', () => {
  const sd = buildSectionData({ ...baseDoc, first_order: null, load_level_locations: null, attached_documents: null });
  assert.equal(sd.address_details.pickup_location, null);
  assert.equal(sd.address_details.delivery_location, null);
  assert.equal(sd.address_details.return_location, null);
  assert.equal(sd.order_details.reference_number, null);
  assert.equal(sd.notes.driver_notes, null);
  assert.deepEqual(sd.attached_documents, []);
});
