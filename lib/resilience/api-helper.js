import { CODES } from './errors.js';

/**
 * Optional helper for API routes that want to surface a clean 503
 * response when the circuit breaker is open. Usage:
 *
 *   export default async function handler(req, res) {
 *     return handleWithResilience(res, async () => {
 *       const supabase = createServiceClient();
 *       const { data } = await supabase.from('loads').select('*');
 *       return res.status(200).json({ loads: data });
 *     });
 *   }
 *
 * Routes that don't adopt this helper still benefit from retry +
 * fail-fast — they just return generic 500s during a breaker-open
 * outage instead of tailored 503s.
 */
export async function handleWithResilience(res, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === CODES.CIRCUIT_OPEN) {
      res.setHeader('Retry-After', Math.ceil((err.cooldownMsRemaining || 30_000) / 1000));
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        code: 'SERVICE_DEGRADED',
        retry_after_ms: err.cooldownMsRemaining || 30_000,
      });
    }
    if (err?.code === CODES.RETRIES_EXHAUSTED) {
      return res.status(503).json({
        error: 'Service temporarily unavailable after retries',
        code: 'RETRIES_EXHAUSTED',
      });
    }
    throw err; // fall through to existing 500 handler in Next.js
  }
}
