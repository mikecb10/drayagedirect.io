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
 * Shared singleton for the server-side Supabase breaker. Stored on
 * `globalThis` (not module scope) because Next.js bundles API route
 * modules separately — module-level `let` would give each route its
 * own independent breaker. globalThis is process-wide, so every API
 * route in the same Node process shares one breaker state (which is
 * what we actually want: a failure observed by one route is a signal
 * for all others).
 *
 * In serverless production each function invocation is its own Node
 * process; the breaker starts fresh. That's the correct behavior —
 * each instance independently probes Supabase.
 */
const BREAKER_KEY = '__drayageDirectSupabaseBreaker';

export function getSupabaseBreaker() {
  if (!globalThis[BREAKER_KEY]) {
    globalThis[BREAKER_KEY] = new CircuitBreaker({ name: 'supabase' });
  }
  return globalThis[BREAKER_KEY];
}
