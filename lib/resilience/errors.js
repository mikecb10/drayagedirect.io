// Typed errors thrown by the resilience layer so API routes and
// callers can distinguish circuit-open from retries-exhausted from
// other failures.

export const CODES = {
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  RETRIES_EXHAUSTED: 'RETRIES_EXHAUSTED',
  TIMEOUT: 'TIMEOUT',
};

export class ResilienceError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'ResilienceError';
    this.code = code;
    // Attach any extra context (e.g. cooldownMsRemaining on CIRCUIT_OPEN,
    // attempts on RETRIES_EXHAUSTED, durationMs on TIMEOUT)
    Object.assign(this, extra);
  }
}
