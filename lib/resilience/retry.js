import { ResilienceError, CODES } from './errors.js';

/**
 * Retry wrapper with fixed-schedule backoff.
 *
 * @param {() => Promise<T>} fn - the async function to run
 * @param {object} opts
 * @param {number[]} [opts.backoffMs] - delays between attempts, e.g. [100, 500]
 *                                       (length = number of retries after the first attempt)
 * @param {(err: any) => boolean} [opts.shouldRetry] - decide whether an error is retryable
 * @returns {Promise<T>}
 * @throws {ResilienceError} with code RETRIES_EXHAUSTED if all attempts fail
 */
export async function withRetry(fn, { backoffMs = [100, 500], shouldRetry = defaultShouldRetry } = {}) {
  const maxAttempts = backoffMs.length + 1;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err) || attempt === maxAttempts) {
        // Don't wrap errors we can't retry — preserve original type
        if (attempt === maxAttempts && shouldRetry(err)) {
          throw new ResilienceError(CODES.RETRIES_EXHAUSTED, `Failed after ${maxAttempts} attempts: ${err.message}`, {
            attempts: maxAttempts,
            lastError: err,
          });
        }
        throw err;
      }
      const delay = backoffMs[attempt - 1];
      await sleep(delay);
    }
  }

  // Unreachable but satisfies the type-checker
  throw lastErr;
}

function defaultShouldRetry(err) {
  // Don't retry our own typed errors — they're already terminal signals
  // from the resilience layer (CIRCUIT_OPEN, TIMEOUT, RETRIES_EXHAUSTED).
  // Retrying CIRCUIT_OPEN in particular would wrap it in RETRIES_EXHAUSTED,
  // breaking the handleWithResilience helper's error discrimination.
  if (err?.name === 'ResilienceError') return false;

  // Retry on network errors + 5xx. Don't retry on 4xx (that's a client bug).
  // Heuristic: if err has a numeric status, retry only on >= 500.
  if (typeof err?.status === 'number') return err.status >= 500;
  if (typeof err?.code === 'string' && err.code.startsWith('PGRST')) return false; // PostgREST client errors
  // Network errors, timeouts, connection failures — retry
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
