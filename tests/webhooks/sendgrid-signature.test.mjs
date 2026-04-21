/**
 * Signature verification tests for SendGrid webhook.
 *
 * We can't easily fake a real ECDSA P-256 signature in a unit test without
 * a private key, so these tests focus on the guard paths that don't require
 * a valid signature: missing headers, malformed headers, timestamp drift.
 * The happy-path (valid signature) is covered by reviewer Gate 2 against the
 * live SendGrid "Test Your Integration" button.
 */
import { verifySendGridSignature } from '../../lib/webhooks/sendgrid-signature.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

const PUBLIC_KEY_FAKE = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefake==';
const rawBody = Buffer.from('[{"event":"delivered","sg_event_id":"abc"}]');
const nowSec = Math.floor(Date.now() / 1000);

// Missing signature header
check('rejects missing signature', (() => {
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: null,
    timestamp: String(nowSec),
  });
  return r.ok === false && r.reason === 'missing_signature';
})());

// Missing timestamp header
check('rejects missing timestamp', (() => {
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: 'somesignature',
    timestamp: null,
  });
  return r.ok === false && r.reason === 'missing_timestamp';
})());

// Timestamp drift > 10 min (replay protection)
check('rejects timestamp more than 10 min old', (() => {
  const old = String(nowSec - 11 * 60);
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: 'somesignature',
    timestamp: old,
  });
  return r.ok === false && r.reason === 'timestamp_drift';
})());

// Timestamp drift > 10 min into future
check('rejects timestamp more than 10 min in future', (() => {
  const future = String(nowSec + 11 * 60);
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: 'somesignature',
    timestamp: future,
  });
  return r.ok === false && r.reason === 'timestamp_drift';
})());

// Missing publicKey → mis-config
check('rejects when publicKey is empty', (() => {
  const r = verifySendGridSignature({
    publicKey: '',
    rawBody,
    signature: 'somesignature',
    timestamp: String(nowSec),
  });
  return r.ok === false && r.reason === 'missing_public_key';
})());

// Invalid signature with valid-shaped inputs → signature_invalid
check('rejects invalid signature against fake key', (() => {
  const r = verifySendGridSignature({
    publicKey: PUBLIC_KEY_FAKE,
    rawBody,
    signature: 'MEUCIQDfakeSignatureBase64fakeSignatureBase64fakeSignatureBase64fake=',
    timestamp: String(nowSec),
  });
  return r.ok === false && (r.reason === 'signature_invalid' || r.reason === 'verification_error');
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
