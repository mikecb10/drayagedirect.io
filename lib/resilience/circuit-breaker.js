import { ResilienceError, CODES } from './errors.js';

/**
 * CircuitBreaker — closed/open/half-open state machine.
 *
 * - CLOSED: calls pass through, failures tracked in sliding window.
 * - OPEN: calls rejected immediately with CIRCUIT_OPEN. After cooldownMs, transitions to HALF_OPEN.
 * - HALF_OPEN: first call is a probe (passes through). Others reject with CIRCUIT_OPEN until probe resolves.
 *              Probe success → CLOSED. Probe failure → OPEN, cooldown timer resets.
 *
 * Each process has its own instance. No shared state.
 */
export class CircuitBreaker {
  constructor({
    failureThreshold = 3,
    windowMs = 10_000,
    cooldownMs = 30_000,
    callTimeoutMs = 5_000,
    name = 'default',
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.callTimeoutMs = callTimeoutMs;
    this.name = name;

    this.state = 'closed';
    this.failures = []; // array of timestamps
    this.openedAt = null;
    this.probeInFlight = false;
    this.lastOkAt = null;
  }

  /**
   * Current state: 'closed' | 'open' | 'half-open'. Transitions to half-open
   * lazily when cooldown has elapsed.
   */
  getState() {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  snapshot() {
    return {
      state: this.getState(),
      lastOkAt: this.lastOkAt ? new Date(this.lastOkAt).toISOString() : null,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      cooldownMsRemaining: this.openedAt ? Math.max(0, this.cooldownMs - (Date.now() - this.openedAt)) : 0,
    };
  }

  async execute(fn) {
    const state = this.getState();

    if (state === 'open') {
      throw new ResilienceError(CODES.CIRCUIT_OPEN, 'Circuit breaker is open', {
        cooldownMsRemaining: Math.max(0, this.cooldownMs - (Date.now() - this.openedAt)),
      });
    }

    if (state === 'half-open') {
      if (this.probeInFlight) {
        throw new ResilienceError(CODES.CIRCUIT_OPEN, 'Circuit probe in flight', {
          cooldownMsRemaining: 0,
        });
      }
      this.probeInFlight = true;
      try {
        const result = await this._runWithTimeout(fn);
        this._recordSuccess();
        return result;
      } catch (err) {
        this._recordFailure();
        throw err;
      } finally {
        this.probeInFlight = false;
      }
    }

    // CLOSED
    try {
      const result = await this._runWithTimeout(fn);
      this._recordSuccess();
      return result;
    } catch (err) {
      this._recordFailure();
      throw err;
    }
  }

  async _runWithTimeout(fn) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new ResilienceError(CODES.TIMEOUT, `Call exceeded ${this.callTimeoutMs}ms`, {
              durationMs: this.callTimeoutMs,
            }));
          }, this.callTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  _recordSuccess() {
    this.failures = [];
    this.lastOkAt = Date.now();
    if (this.state !== 'closed') {
      this.state = 'closed';
      this.openedAt = null;
    }
  }

  _recordFailure() {
    const now = Date.now();
    // Drop failures outside the sliding window
    this.failures = this.failures.filter((t) => now - t <= this.windowMs);
    this.failures.push(now);

    if (this.state === 'half-open') {
      // Probe failed → back to open, reset cooldown timer
      this.state = 'open';
      this.openedAt = now;
      return;
    }

    if (this.failures.length >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
    }
  }
}

/**
 * Shared singleton for the server-side Supabase breaker. Created lazily
 * on first access. Each Node process has its own instance.
 */
let sharedBreaker = null;
export function getSupabaseBreaker() {
  if (!sharedBreaker) {
    sharedBreaker = new CircuitBreaker({ name: 'supabase' });
  }
  return sharedBreaker;
}
