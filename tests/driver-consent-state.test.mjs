// tests/driver-consent-state.test.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isConsentValid, CURRENT_CONSENT_VERSION } from '../lib/driver-consent/version.js';

test('isConsentValid: never asked → false', () => {
  assert.equal(isConsentValid({
    tracking_consented_at: null, tracking_revoked_at: null, tracking_consent_version: null,
  }), false);
});

test('isConsentValid: accepted current version, not revoked → true', () => {
  assert.equal(isConsentValid({
    tracking_consented_at: '2026-04-24T12:00:00Z',
    tracking_revoked_at: null,
    tracking_consent_version: CURRENT_CONSENT_VERSION,
  }), true);
});

test('isConsentValid: revoked after accepted → false', () => {
  assert.equal(isConsentValid({
    tracking_consented_at: '2026-04-24T12:00:00Z',
    tracking_revoked_at: '2026-04-24T13:00:00Z',
    tracking_consent_version: CURRENT_CONSENT_VERSION,
  }), false);
});

test('isConsentValid: re-accepted after revoke → true (consented_at > revoked_at)', () => {
  assert.equal(isConsentValid({
    tracking_consented_at: '2026-04-24T14:00:00Z',
    tracking_revoked_at: '2026-04-24T13:00:00Z',
    tracking_consent_version: CURRENT_CONSENT_VERSION,
  }), true);
});

test('isConsentValid: stale consent version → false', () => {
  assert.equal(isConsentValid({
    tracking_consented_at: '2026-04-24T12:00:00Z',
    tracking_revoked_at: null,
    tracking_consent_version: CURRENT_CONSENT_VERSION - 1,
  }), false);
});
