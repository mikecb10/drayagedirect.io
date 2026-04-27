import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pickTemplate } from '../lib/pdf/resolve-template-config.js';

const TENANT_DEFAULT = {
  customer_id: null,
  section_config: { visibility: { signature_block: true } },
};

const CUSTOMER_SPECIFIC = {
  customer_id: 'cust-walmart-uuid',
  section_config: { visibility: { signature_block: false, barcode: true } },
};

test('returns customer-specific template when customerId matches', () => {
  const result = pickTemplate([TENANT_DEFAULT, CUSTOMER_SPECIFIC], 'cust-walmart-uuid');
  assert.deepEqual(result, CUSTOMER_SPECIFIC.section_config);
});

test('returns tenant default when customerId provided but no customer-specific exists', () => {
  const result = pickTemplate([TENANT_DEFAULT], 'cust-walmart-uuid');
  assert.deepEqual(result, TENANT_DEFAULT.section_config);
});

test('returns tenant default when customerId is null', () => {
  const result = pickTemplate([TENANT_DEFAULT, CUSTOMER_SPECIFIC], null);
  assert.deepEqual(result, TENANT_DEFAULT.section_config);
});

test('returns undefined when no templates exist', () => {
  assert.equal(pickTemplate([], 'cust-walmart-uuid'), undefined);
  assert.equal(pickTemplate([], null), undefined);
});

test('returns undefined when only customer-specific templates exist and customerId does not match any', () => {
  const result = pickTemplate([CUSTOMER_SPECIFIC], 'cust-target-uuid');
  assert.equal(result, undefined);
});

test('customer-specific takes priority over tenant default even when both match', () => {
  const result = pickTemplate(
    [CUSTOMER_SPECIFIC, TENANT_DEFAULT], // order shouldn't matter
    'cust-walmart-uuid'
  );
  assert.deepEqual(result, CUSTOMER_SPECIFIC.section_config);
});

test('treats customer_id: undefined as the tenant default', () => {
  const tenantDefaultWithUndefined = {
    customer_id: undefined,
    section_config: { visibility: { bill_to: false } },
  };
  const result = pickTemplate([tenantDefaultWithUndefined], null);
  assert.deepEqual(result, tenantDefaultWithUndefined.section_config);
});

test('returns undefined for non-array input', () => {
  assert.equal(pickTemplate(null, 'cust-walmart-uuid'), undefined);
  assert.equal(pickTemplate(undefined, 'cust-walmart-uuid'), undefined);
});

test('handles multiple customer-specific templates (one match, one not)', () => {
  const otherCustomer = {
    customer_id: 'cust-target-uuid',
    section_config: { visibility: { hazmat_details: false } },
  };
  const result = pickTemplate(
    [otherCustomer, CUSTOMER_SPECIFIC, TENANT_DEFAULT],
    'cust-walmart-uuid'
  );
  assert.deepEqual(result, CUSTOMER_SPECIFIC.section_config);
});
