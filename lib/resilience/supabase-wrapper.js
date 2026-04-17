import { withRetry } from './retry.js';
import { getSupabaseBreaker } from './circuit-breaker.js';

/**
 * Wraps a Supabase JS client so every .from() / .rpc() builder
 * automatically runs through retry-then-circuit-breaker when awaited.
 *
 * NOT wrapped: .auth, .storage, .functions, .channel (Realtime) —
 * those are Tier 1 concerns.
 *
 * @param {SupabaseClient} client
 * @returns {SupabaseClient} a Proxy that looks identical but intercepts data-plane calls
 */
export function wrapSupabaseClient(client) {
  if (!client || client.__resilienceWrapped) return client;

  const wrapped = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === '__resilienceWrapped') return true;
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'from') {
        return (...args) => wrapBuilder(value.apply(target, args));
      }
      if (prop === 'rpc') {
        return (...args) => wrapBuilder(value.apply(target, args));
      }
      return value;
    },
  });

  return wrapped;
}

function wrapBuilder(builder) {
  if (!builder || builder.__resilienceWrapped) return builder;

  // The Supabase PostgrestQueryBuilder is thenable. We intercept .then so that
  // awaiting the builder runs through retry + circuit breaker.
  const originalThen = builder.then?.bind(builder);
  if (!originalThen) return builder; // builder unexpectedly not a thenable — pass through

  builder.then = (onFulfilled, onRejected) => {
    const breaker = getSupabaseBreaker();
    // The fn we hand to the breaker creates a fresh awaitable from the builder
    // by calling originalThen with a pass-through resolver. Inside that fresh
    // promise we inspect the resolved value for Supabase-style error field.
    const fn = () =>
      new Promise((resolve, reject) => {
        originalThen(
          (result) => {
            // Supabase returns { data, error } — an error here is a real failure.
            if (result?.error) {
              const err = Object.assign(new Error(result.error.message || 'Supabase error'), {
                status: result.status ?? result.error.status,
                code: result.error.code,
                supabaseError: result.error,
              });
              reject(err);
              return;
            }
            resolve(result);
          },
          (err) => reject(err)
        );
      });

    const guarded = withRetry(() => breaker.execute(fn));
    return guarded.then(onFulfilled, onRejected);
  };

  builder.__resilienceWrapped = true;
  return builder;
}
