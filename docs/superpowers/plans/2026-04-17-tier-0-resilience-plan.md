# Tier 0 Supabase Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Tier 0 of the Supabase resilience plan — server-side circuit breaker + retry-with-backoff at the Supabase client layer, a public `/api/health` endpoint, a global `<ResilienceBanner />`, and a 3-state dispatcher `LiveIndicator` — so Supabase outages show honest feedback and fail fast instead of accumulating 10-second timeouts.

**Architecture:** A new `lib/resilience/` directory holds the self-contained circuit breaker (closed/open/half-open), a retry wrapper with fixed-schedule backoff, typed errors, and a Proxy-based Supabase client wrapper that intercepts `.then()` on PostgrestQueryBuilders. `pages/api/health.js` reads breaker state and returns 200/503. `components/resilience/ResilienceBanner.js` polls every 30s and renders two visible states. `components/dispatcher/LiveIndicator.js` extends from 2 → 3 states with a `lastFetchedAt` prop.

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4, `@supabase/supabase-js` + `@supabase/ssr`. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-17-tier-0-resilience-design.md`

---

## Hard rules (bake into every commit)

- No new npm dependencies.
- No schema changes, no migrations.
- `handleSave` / existing controller logic in API routes is NOT modified unless a route explicitly adopts the `handleWithResilience` helper (opt-in).
- Browser-side Supabase client is NOT wrapped (Tier 1 scope).
- Each server process has its own breaker state — don't attempt persistence.
- Don't run `npm run build` during implementation — it clobbers the running dev server's `.next/` directory. Verify via `git diff --staged` and runtime smoke tests.

---

## File structure (target state)

```
lib/resilience/                                 (NEW directory)
  ├─ errors.js                      (~15 LoC)  typed ResilienceError class
  ├─ retry.js                       (~30 LoC)  withRetry(fn, opts) wrapper
  ├─ circuit-breaker.js             (~60 LoC)  CircuitBreaker class + state machine
  ├─ supabase-wrapper.js            (~40 LoC)  wraps supabase-js client (Proxy + builder .then interception)
  └─ api-helper.js                  (~25 LoC)  handleWithResilience(res, fn) optional helper for 503 responses

lib/supabase.js                     (modified) exports wrapped clients
lib/supabase-server.js              (modified) wraps createServerClient output

pages/api/health.js                 (NEW, ~30 LoC) public health endpoint

components/resilience/              (NEW directory)
  ├─ useResilienceHealth.js         (~50 LoC)  hook: polls /api/health, returns { status, lastOkAt }
  └─ ResilienceBanner.js            (~100 LoC) app-wide banner, 3 states (hidden, degraded, disconnected)

pages/_app.js                       (modified) mounts <ResilienceBanner /> inside non-admin provider tree

components/dispatcher/LiveIndicator.js         (modified — 3 states + lastFetchedAt prop)
pages/dispatcher/index.js OR dispatcher hooks  (modified — tracks lastFetchedAt and passes to LiveIndicator)
```

---

## Phase 1: Core resilience library (pure logic, no integration)

Three small atomic commits. Pure logic. No wiring to Supabase yet.

### Task 1.1: Create `lib/resilience/errors.js`

**Files:**
- Create: `lib/resilience/errors.js`

- [ ] **Step 1: Create the file**

Write `lib/resilience/errors.js`:

```js
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
```

- [ ] **Step 2: Verify syntax**

Read the file back and verify no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add lib/resilience/errors.js
git commit -m "$(cat <<'EOF'
feat(resilience): add typed ResilienceError class

Foundation for Tier 0 circuit breaker + retry wrapper. Three codes:
CIRCUIT_OPEN, RETRIES_EXHAUSTED, TIMEOUT. Extra context (cooldown
remaining, attempts, duration) attached as own properties so API
routes can surface useful details in 503 responses.

Part of Tier 0 Supabase resilience (see
docs/superpowers/specs/2026-04-17-tier-0-resilience-design.md).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Create `lib/resilience/retry.js`

**Files:**
- Create: `lib/resilience/retry.js`

- [ ] **Step 1: Create the file**

Write `lib/resilience/retry.js`:

```js
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
```

- [ ] **Step 2: Verify syntax by reading back**

Read the file back. Verify imports resolve, no syntax errors, logic matches the spec's retry schedule (2 retries at 100ms / 500ms = 3 total attempts).

- [ ] **Step 3: Commit**

```bash
git add lib/resilience/retry.js
git commit -m "$(cat <<'EOF'
feat(resilience): add withRetry wrapper with fixed-schedule backoff

Retries transient failures with configurable backoff schedule
(default: 100ms / 500ms = 2 retries after initial attempt, 3 total
attempts). Default shouldRetry heuristic treats network errors and
5xx as retryable; 4xx and PostgREST (PGRST*) errors as permanent.

After all attempts fail, throws ResilienceError(RETRIES_EXHAUSTED)
with the last underlying error attached for debugging.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Create `lib/resilience/circuit-breaker.js`

**Files:**
- Create: `lib/resilience/circuit-breaker.js`

- [ ] **Step 1: Create the file**

Write `lib/resilience/circuit-breaker.js`:

```js
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
```

- [ ] **Step 2: Verify syntax + logic**

Read the file back. Trace through a mental scenario:
- Start CLOSED, no failures.
- Call fails 3 times in quick succession → `failures.length === 3` → `state = 'open'`.
- 30 seconds pass → `getState()` returns `'half-open'`.
- Next call is the probe — it succeeds → `state = 'closed'`, `failures = []`.

- [ ] **Step 3: Commit**

```bash
git add lib/resilience/circuit-breaker.js
git commit -m "$(cat <<'EOF'
feat(resilience): add CircuitBreaker state machine

Three-state circuit breaker (closed/open/half-open) with sliding
failure window and concurrent-probe lockout. Defaults tuned for the
Supabase wrapper use case:

- failureThreshold: 3
- windowMs: 10_000 (sliding)
- cooldownMs: 30_000
- callTimeoutMs: 5_000 (per-call race)

Exposes getSupabaseBreaker() singleton so the wrapper and the health
endpoint read from the same instance within a process.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Supabase client wrapper

The trickiest part of the plan — Supabase's client uses a lazy builder pattern, so we need a Proxy + `.then()` interception.

### Task 2.1: Create `lib/resilience/supabase-wrapper.js`

**Files:**
- Create: `lib/resilience/supabase-wrapper.js`

- [ ] **Step 1: Read how Supabase client methods work**

The builder chain (`supabase.from('loads').select('*').eq(...)`) only fires HTTP when `.then()` is called (typically via `await`). We intercept at two levels:
- `client.from(...)` and `client.rpc(...)` return builders — we wrap those.
- On the builder, we intercept `.then(onFulfilled, onRejected)` to inject retry + breaker around the real then.

`client.auth`, `client.storage`, `client.functions`, `client.channel` (Realtime) are NOT wrapped — they have different contracts. For Tier 0 we wrap only the data plane.

- [ ] **Step 2: Create the file**

Write `lib/resilience/supabase-wrapper.js`:

```js
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
```

**Note for subagent:** If during implementation you find the builder's `.then` isn't interceptable this way (e.g., Supabase internals call it differently), fall back to this alternative: wrap the builder's terminal methods (`.then`, `.maybeSingle`, `.single`, `.csv`, etc.) individually. Keep the approach above as the primary; this is a contingency.

- [ ] **Step 3: Verify syntax**

Read back, check Proxy + builder override logic.

- [ ] **Step 4: Commit**

```bash
git add lib/resilience/supabase-wrapper.js
git commit -m "$(cat <<'EOF'
feat(resilience): wrap Supabase client with retry + circuit breaker

Proxy-based wrapper intercepts .from() and .rpc() calls. Returns
builders whose .then is overridden to route the actual HTTP fetch
through withRetry + breaker.execute. Supabase's { data, error } shape
is inspected — an error field rejects the internal promise so the
breaker sees it as a failure.

NOT wrapped: .auth, .storage, .functions, .channel (Realtime) — those
have different contracts and are Tier 1 scope.

The wrapper is idempotent (marks wrapped objects with
__resilienceWrapped) so double-wrapping is safe.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Wire the wrapper into `lib/supabase.js` and `lib/supabase-server.js`

**Files:**
- Modify: `lib/supabase.js`
- Modify: `lib/supabase-server.js`

- [ ] **Step 1: Update `lib/supabase.js`**

Current content:
```js
import { createClient } from '@supabase/supabase-js';
// ...
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export function createServiceClient() {
  // ...
  return createClient(supabaseUrl, serviceRoleKey, { ... });
}
```

Replace with:

```js
import { createClient } from '@supabase/supabase-js';
import { wrapSupabaseClient } from './resilience/supabase-wrapper.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env.local');
}

// Client-side Supabase client (uses anon key, respects RLS).
// NOTE: browser-side client is NOT wrapped — Tier 0 covers server-side
// only. Browser Realtime already has its own indicator (LiveIndicator).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase client (uses service role key, bypasses RLS).
// Only use in API routes and server-side functions.
// Wrapped with the resilience layer — every .from() / .rpc() call goes
// through retry + circuit breaker.
export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return wrapSupabaseClient(client);
}
```

- [ ] **Step 2: Update `lib/supabase-server.js`**

Current content (read the file first):

```js
import { createServerClient } from '@supabase/ssr';

export function getSupabaseServerClient(req, res) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { /* cookies... */ }
  );
}
```

Replace the return with a wrapped version:

```js
import { createServerClient } from '@supabase/ssr';
import { wrapSupabaseClient } from './resilience/supabase-wrapper.js';

export function getSupabaseServerClient(req, res) {
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          const cookies = [];
          if (req.cookies) {
            Object.entries(req.cookies).forEach(([name, value]) => {
              cookies.push({ name, value });
            });
          }
          return cookies;
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.setHeader('Set-Cookie', [
              ...(Array.isArray(res.getHeader('Set-Cookie'))
                ? res.getHeader('Set-Cookie')
                : res.getHeader('Set-Cookie')
                  ? [res.getHeader('Set-Cookie')]
                  : []),
              `${name}=${value}; Path=${options?.path || '/'}; HttpOnly; SameSite=Lax${options?.maxAge ? `; Max-Age=${options.maxAge}` : ''}`,
            ]);
          });
        },
      },
    }
  );
  return wrapSupabaseClient(client);
}
```

- [ ] **Step 3: Smoke-verify via the dev server**

Open any dispatcher page in the browser. Confirm loads still render, edits still save. The wrapper is invisible when the breaker is CLOSED.

If it DOES break, open the DevTools network tab and check for unexpected errors. The most likely failure mode is the builder's `.then` being called differently than expected (e.g., Supabase internally calling a different terminal method). In that case, report a fallback approach — wrap terminal methods individually instead of `.then`.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase.js lib/supabase-server.js
git commit -m "$(cat <<'EOF'
feat(resilience): wire supabase clients through the resilience wrapper

Both server-side clients (createServiceClient and getSupabaseServerClient)
now route data-plane calls through retry + circuit breaker. Every
.from() / .rpc() on a server-side Supabase client automatically gets
fail-fast behavior during outages.

Client-side (browser) client NOT wrapped — Tier 1 scope. Browser
Realtime has its own existing LiveIndicator.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Health endpoint + API helper

### Task 3.1: Create `pages/api/health.js`

**Files:**
- Create: `pages/api/health.js`

- [ ] **Step 1: Create the file**

Write `pages/api/health.js`:

```js
import { getSupabaseBreaker } from '../../lib/resilience/circuit-breaker.js';

// Public health endpoint — no auth required.
// Reads breaker state directly (does NOT hit Supabase) so a tripped
// breaker still returns quickly. External monitoring services
// (UptimeRobot, Better Uptime, Vercel Analytics) auto-detect 503.

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const breaker = getSupabaseBreaker();
  const snap = breaker.snapshot();
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev';

  const body = {
    status: snap.state === 'closed' ? 'ok' : 'degraded',
    breaker: snap.state,
    supabase_last_ok_at: snap.lastOkAt,
    opened_at: snap.openedAt,
    cooldown_ms_remaining: snap.cooldownMsRemaining,
    version,
  };

  // Cache-Control: no-cache so monitoring services always see fresh state.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  return res.status(snap.state === 'closed' ? 200 : 503).json(body);
}
```

- [ ] **Step 2: Smoke test**

Hit `http://localhost:3000/api/health` in a browser. Expected: `200 { "status": "ok", "breaker": "closed", ... }` since the breaker hasn't seen any failures yet.

- [ ] **Step 3: Commit**

```bash
git add pages/api/health.js
git commit -m "$(cat <<'EOF'
feat(resilience): add /api/health endpoint reporting breaker state

Public endpoint (no auth) that reads the Supabase breaker's current
state directly. Returns HTTP 200 when closed, 503 when open or
half-open. External monitors (UptimeRobot, Better Uptime) auto-detect
503 for free alerting.

Does NOT call Supabase — reads breaker state from process memory.
That means a tripped breaker doesn't ALSO hide the health endpoint.

Response body includes breaker state, last-known-good timestamp,
cooldown remaining, and commit sha for cache-busting by consumers.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: Create `lib/resilience/api-helper.js` (optional 503 wrapper)

**Files:**
- Create: `lib/resilience/api-helper.js`

- [ ] **Step 1: Create the file**

Write `lib/resilience/api-helper.js`:

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/resilience/api-helper.js
git commit -m "$(cat <<'EOF'
feat(resilience): add handleWithResilience API helper

Optional wrapper for API routes that want to convert CIRCUIT_OPEN
and RETRIES_EXHAUSTED errors into clean 503 responses with
Retry-After headers. Routes that don't adopt it still get fail-fast
behavior; they just return generic 500s during outages.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Global banner

### Task 4.1: Create `components/resilience/useResilienceHealth.js` hook

**Files:**
- Create: `components/resilience/useResilienceHealth.js`

- [ ] **Step 1: Create the file**

Write `components/resilience/useResilienceHealth.js`:

```js
import { useEffect, useRef, useState, useCallback } from 'react';

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_COUNT = 2; // require N consecutive same-state responses before flipping

/**
 * Polls /api/health every POLL_INTERVAL_MS. Pauses when tab hidden.
 * Debounces state transitions (requires 2 consecutive same-state responses).
 *
 * @returns {{
 *   status: 'ok' | 'degraded' | 'disconnected',
 *   lastOkAt: string | null,
 *   retryNow: () => void,
 * }}
 */
export default function useResilienceHealth() {
  const [status, setStatus] = useState('ok');
  const [lastOkAt, setLastOkAt] = useState(null);
  const pendingStatusRef = useRef({ value: 'ok', count: 0 });
  const intervalRef = useRef(null);
  const abortRef = useRef(null);

  const poll = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    let next;
    try {
      const res = await fetch('/api/health', { signal: ac.signal, cache: 'no-store' });
      if (!res.ok) {
        next = 'degraded';
        try {
          const body = await res.json();
          if (body?.supabase_last_ok_at) setLastOkAt(body.supabase_last_ok_at);
        } catch { /* ignore */ }
      } else {
        next = 'ok';
        try {
          const body = await res.json();
          if (body?.supabase_last_ok_at) setLastOkAt(body.supabase_last_ok_at);
        } catch { /* ignore */ }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      next = 'disconnected';
    }

    // Debounce: require DEBOUNCE_COUNT consecutive same-state responses
    if (pendingStatusRef.current.value === next) {
      pendingStatusRef.current.count += 1;
    } else {
      pendingStatusRef.current = { value: next, count: 1 };
    }

    if (pendingStatusRef.current.count >= DEBOUNCE_COUNT) {
      setStatus(next);
    } else if (next === 'ok') {
      // Clearing back to OK is less risky — don't debounce the recovery
      setStatus('ok');
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const start = () => {
      poll(); // immediate
      intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    };
    const stop = () => {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      abortRef.current?.abort();
    };

    if (!document.hidden) start();

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll]);

  return { status, lastOkAt, retryNow: poll };
}
```

- [ ] **Step 2: Commit**

```bash
git add components/resilience/useResilienceHealth.js
git commit -m "$(cat <<'EOF'
feat(resilience): useResilienceHealth hook polling /api/health

Polls every 30s with tab-visibility pause, AbortController
cancellation, and debounced state transitions (2 consecutive
same-state responses required to flip). Recovery to 'ok' is NOT
debounced — faster recovery UX.

Exposes { status, lastOkAt, retryNow } for the banner component.
Status values: 'ok' | 'degraded' (server returned 503) |
'disconnected' (fetch itself failed, client offline).

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.2: Create `components/resilience/ResilienceBanner.js`

**Files:**
- Create: `components/resilience/ResilienceBanner.js`

- [ ] **Step 1: Create the file**

Write `components/resilience/ResilienceBanner.js`:

```jsx
import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff, RefreshCw } from 'lucide-react';
import useResilienceHealth from './useResilienceHealth';

/**
 * ResilienceBanner — app-wide thin banner at top of viewport.
 *
 * Three states:
 *  - hidden (status 'ok')
 *  - 🟠 degraded — server reachable, Supabase unreachable
 *  - 🔴 disconnected — client can't reach server
 *
 * role="status" + aria-live="polite" so screen readers announce changes.
 * z-index below modals so it never obscures a dialog.
 */
export default function ResilienceBanner() {
  const { status, lastOkAt, retryNow } = useResilienceHealth();
  const [showRestored, setShowRestored] = useState(false);
  const [prevStatus, setPrevStatus] = useState('ok');

  useEffect(() => {
    if (prevStatus !== 'ok' && status === 'ok') {
      setShowRestored(true);
      const t = setTimeout(() => setShowRestored(false), 5000);
      return () => clearTimeout(t);
    }
    setPrevStatus(status);
  }, [status, prevStatus]);

  if (status === 'ok' && !showRestored) return null;

  if (showRestored) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-40 w-full bg-emerald-500 text-white text-xs font-medium flex items-center justify-center gap-2 py-1.5"
      >
        <span>✅ Service restored</span>
      </div>
    );
  }

  if (status === 'degraded') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-40 w-full bg-amber-500 dark:bg-amber-600 text-white text-xs font-medium flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-1.5 px-3"
      >
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          Service degraded — data may be stale. Updates may fail until we recover.
        </span>
        {lastOkAt && (
          <span className="opacity-80">Last healthy: {formatRelative(lastOkAt)}</span>
        )}
        <a
          href="/api/health"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80"
        >
          Learn more ↗
        </a>
      </div>
    );
  }

  // status === 'disconnected'
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 w-full bg-red-600 text-white text-xs font-medium flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-1.5 px-3"
    >
      <span className="flex items-center gap-1.5">
        <WifiOff className="w-3.5 h-3.5" />
        Can't reach server — check your internet connection.
      </span>
      <button
        type="button"
        onClick={retryNow}
        className="inline-flex items-center gap-1 underline hover:opacity-80"
      >
        <RefreshCw className="w-3 h-3" /> Retry now
      </button>
    </div>
  );
}

function formatRelative(iso) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/resilience/ResilienceBanner.js
git commit -m "$(cat <<'EOF'
feat(resilience): ResilienceBanner component with 3 visible states

Thin sticky banner at top of viewport. States:
- hidden (service healthy)
- 🟠 amber "Service degraded" (server returned 503, Supabase down)
- 🔴 red "Can't reach server" (fetch to /api/health itself failed)

On recovery, flashes green "✅ Service restored" for 5s before
hiding. Uses role="status" + aria-live="polite" for screen readers.
z-index 40 so it sits above page content but below modals (z-50+).

Dark-mode classes included on the amber state; red state is solid
enough to not need a dark variant.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.3: Mount `<ResilienceBanner />` in `pages/_app.js`

**Files:**
- Modify: `pages/_app.js`

- [ ] **Step 1: Update `pages/_app.js`**

Current body (around lines 29-41):
```jsx
return (
  <AuthProvider>
    <ThemeProvider>
      <CompactModeProvider>
        <OverlayProvider>
          <ImpersonationBanner />
          {page}
          <OverlayRenderer />
        </OverlayProvider>
      </CompactModeProvider>
    </ThemeProvider>
  </AuthProvider>
);
```

Change to:

```jsx
return (
  <AuthProvider>
    <ThemeProvider>
      <CompactModeProvider>
        <OverlayProvider>
          <ResilienceBanner />
          <ImpersonationBanner />
          {page}
          <OverlayRenderer />
        </OverlayProvider>
      </CompactModeProvider>
    </ThemeProvider>
  </AuthProvider>
);
```

Also add the import near the top:

```jsx
import ResilienceBanner from '../components/resilience/ResilienceBanner';
```

NOTE: the admin-route branch (`isAdminRoute`) does NOT include the banner. That's intentional — admin routes are internal operator tooling and have their own expectations. Add it only if requested later.

- [ ] **Step 2: Smoke test**

Open the app in a browser. The banner should NOT be visible (status 'ok'). Open DevTools → Network tab → confirm `GET /api/health` fires on page load and every 30s. Each fires returns 200.

- [ ] **Step 3: Simulate degraded state (manual)**

For a quick end-to-end sanity check, temporarily trip the breaker by hitting a Supabase endpoint 3 times with a mocked failure. Easier: temporarily break DNS resolution by adding a hosts-file entry pointing your Supabase hostname to `0.0.0.0`, then reload the app. Watch the banner appear within ~60 seconds (3 failed attempts × retries + debounce).

Restore the hosts-file entry. The banner should clear within 30s.

This is optional — if the subagent can't easily simulate, note it for the controller to verify.

- [ ] **Step 4: Commit**

```bash
git add pages/_app.js
git commit -m "$(cat <<'EOF'
feat(resilience): mount ResilienceBanner globally

Banner now renders app-wide for tenant users. Admin routes opted
out for now — separate operator UX.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Dispatcher stale indicator

### Task 5.1: Extend `components/dispatcher/LiveIndicator.js` to 3 states

**Files:**
- Modify: `components/dispatcher/LiveIndicator.js`

- [ ] **Step 1: Replace the component**

Current `LiveIndicator.js` renders 2 states (Live / Offline) from `connectedRef` alone. Replace with:

```jsx
import { useEffect, useState } from 'react';

const STALE_AFTER_MS = 60_000;    // > 60s since last fetch → Stale
const OFFLINE_AFTER_MS = 5 * 60_000; // > 5min since last fetch → Offline

/**
 * LiveIndicator — pill showing data-freshness + Realtime connection state.
 *
 * Three states:
 *  🟢 Live       — Realtime connected AND last fetch < 60s ago
 *  🟡 Stale      — Realtime disconnected OR last fetch > 60s ago
 *  ⚪ Offline    — last fetch > 5min ago (or never)
 *
 * Props:
 *   connectedRef   — ref<boolean> from useRealtimeLoads (subscription status)
 *   lastFetchedAt  — number | null — ms timestamp of last successful HTTP fetch
 */
export default function LiveIndicator({ connectedRef, lastFetchedAt = null }) {
  const [tick, setTick] = useState(0);

  // Tick every 30s for relative-time label updates and to re-poll connectedRef
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Also poll every 500ms for realtime connection flips — connectedRef doesn't trigger re-render
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(interval);
  }, []);

  const connected = !!connectedRef?.current;
  const ageMs = lastFetchedAt ? Date.now() - lastFetchedAt : Infinity;

  let state; // 'live' | 'stale' | 'offline'
  if (connected && ageMs < STALE_AFTER_MS) {
    state = 'live';
  } else if (ageMs < OFFLINE_AFTER_MS) {
    state = 'stale';
  } else {
    state = 'offline';
  }

  const label = state === 'live'
    ? 'Live'
    : state === 'stale'
    ? `Stale · ${formatAge(ageMs)}`
    : `Offline${Number.isFinite(ageMs) ? ` · ${formatAge(ageMs)}` : ''}`;

  const tooltip = state === 'live'
    ? 'Real-time updates enabled. Last refresh: just now.'
    : state === 'stale'
    ? `Not receiving live updates. Last refresh: ${formatAge(ageMs)} ago. Data may be out of date.`
    : `No connection to live data.${Number.isFinite(ageMs) ? ` Showing cached snapshot from ${formatAge(ageMs)} ago.` : ''}`;

  const palette = {
    live: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60',
    stale: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60',
    offline: 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700',
  }[state];

  const dotColor = {
    live: 'bg-emerald-500',
    stale: 'bg-amber-500',
    offline: 'bg-gray-400 dark:bg-slate-500',
  }[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${palette}`}
      title={tooltip}
    >
      <span className="relative flex w-2 h-2">
        {state === 'live' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`} />
      </span>
      {label}
    </span>
  );
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dispatcher/LiveIndicator.js
git commit -m "$(cat <<'EOF'
feat(dispatcher): LiveIndicator extends to 3 states (Live/Stale/Offline)

Pill now factors in data-freshness alongside Realtime subscription
status. Thresholds:
- Live: Realtime connected AND last fetch < 60s
- Stale: Realtime disconnected OR last fetch > 60s, data present
- Offline: last fetch > 5min ago (or never)

New optional lastFetchedAt prop (ms timestamp) drives staleness.
Label shows relative time ("Stale · 3 min"). Tooltip expands the
current state so dispatchers know exactly what it means.

Backwards-compatible: callers that don't pass lastFetchedAt get
Offline when disconnected (since ageMs === Infinity) — same
effective behavior as before for the disconnected path.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2: Pass `lastFetchedAt` from dispatcher page to `<LiveIndicator>`

**Files:**
- Modify: `pages/dispatcher/index.js` (most likely location)

- [ ] **Step 1: Find where loads are fetched on the dispatcher page**

Run Grep:
- pattern: `fetch\(.*loads|fetch\(.*orders`
- path: `pages/dispatcher/index.js`
- output_mode: `content`, `-n`: true

Find the function / hook that does the initial HTTP fetch for the loads table. Most likely pattern:
```js
async function loadOrders() {
  const res = await fetch('/api/tenant/orders?...');
  const { orders } = await res.json();
  setOrders(orders);
}
```

- [ ] **Step 2: Add a `lastFetchedAt` state**

Near where the orders state is declared:

```jsx
const [lastFetchedAt, setLastFetchedAt] = useState(null);
```

Inside the fetch function, set it on success:

```jsx
async function loadOrders() {
  try {
    const res = await fetch('/api/tenant/orders?...');
    if (!res.ok) throw new Error('fetch failed');
    const { orders } = await res.json();
    setOrders(orders);
    setLastFetchedAt(Date.now());
  } catch (e) {
    // don't update lastFetchedAt — this is what drives the stale indicator
    setError(e.message);
  }
}
```

- [ ] **Step 3: Pass the prop to `<LiveIndicator>`**

Find where `<LiveIndicator connectedRef={...} />` is rendered and extend:

```jsx
<LiveIndicator connectedRef={connectedRef} lastFetchedAt={lastFetchedAt} />
```

- [ ] **Step 4: Smoke test**

Open the dispatcher page. Pill should show Live (if Realtime connects) or Stale (if not) but in either case the label should include a relative time like "Stale · 5s" once the initial fetch completes.

- [ ] **Step 5: Commit**

```bash
git add pages/dispatcher/index.js
git commit -m "$(cat <<'EOF'
feat(dispatcher): track lastFetchedAt and pass to LiveIndicator

Populate the new 3-state LiveIndicator's lastFetchedAt prop from the
orders-fetch state. If a fetch fails, lastFetchedAt does NOT update —
the pill naturally drifts Live → Stale → Offline as time passes.

Part of Tier 0 Supabase resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Final QA + push

### Task 6.1: End-to-end verification + push

- [ ] **Step 1: Confirm final file shape**

Run:
```bash
ls -la lib/resilience components/resilience
```
Expected: 5 files in `lib/resilience/` + 2 files in `components/resilience/`.

Run:
```bash
wc -l lib/resilience/*.js components/resilience/*.js pages/api/health.js
```
Expected: all files under their budgeted LoC (errors ~15, retry ~30, circuit-breaker ~60, supabase-wrapper ~40, api-helper ~25, useResilienceHealth ~50, ResilienceBanner ~100, health ~30).

- [ ] **Step 2: Happy-path runtime verification**

Open the app → login works → dispatcher board loads → `/api/health` returns 200 ok. No banner visible. `LiveIndicator` shows 🟢 Live.

- [ ] **Step 3: Breaker-trip verification (manual)**

Easiest approach on Windows: edit `C:\Windows\System32\drivers\etc\hosts` (requires admin) and add:
```
0.0.0.0 hyszwiezsxcdktfczfsx.supabase.co
```
Run `ipconfig /flushdns`. Reload the app.

Expected progression:
1. First couple of API requests take ~15s each (retries × timeouts). Server-side console shows the retries.
2. After ~3 of those, breaker opens. Subsequent requests fail in <10ms with CIRCUIT_OPEN.
3. `/api/health` returns 503 with `breaker: 'open'`.
4. Within ~60s (poll interval + debounce), the 🟠 degraded banner appears.
5. `LiveIndicator` transitions 🟢 → 🟡 Stale · Xmin → ⚪ Offline · Xmin as time passes.

Remove the hosts-file entry. Run `ipconfig /flushdns` again. Within ~30s the breaker half-opens, a successful probe closes it, banner clears (flashes ✅ Service restored for 5s), pill returns to 🟢 Live.

- [ ] **Step 4: Disconnected-state verification**

Stop the dev server (`preview_stop`). Within 30s the banner should flip from 🟠 degraded (if it was showing) to 🔴 Can't reach server. Restart the dev server; banner clears.

- [ ] **Step 5: Git log sanity**

```bash
git log --oneline 45598ba..HEAD
```

Expected: ~12 commits (3 phase-1, 2 phase-2, 2 phase-3, 3 phase-4, 2 phase-5) all ending with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

- [ ] **Step 6: Push**

```bash
git push origin main
```

Write a brief release note in chat summarizing what shipped. Update memory file `project_resilience_plan.md` to mark Tier 0 as shipped, note any implementation nuances discovered.

---

## Summary

12 commits across 6 phases. New `lib/resilience/` library (~170 LoC total across 5 files), new `pages/api/health.js` (~30 LoC), new `components/resilience/` directory (~150 LoC across 2 files), and surgical edits to `pages/_app.js`, `lib/supabase*.js`, `components/dispatcher/LiveIndicator.js`, `pages/dispatcher/index.js`. Total new code: ~400 LoC.

After this ships:
- Any server-side Supabase call automatically retries + fails fast during outages
- External monitors can alert on `/api/health` 503 for free
- Users see honest "Service degraded" / "Can't reach server" feedback instead of 15-second hanging requests
- Dispatchers have a 3-state staleness indicator in place of the current 2-state connect/disconnect pill

Tier 1 (offline-first driver PWA, auth decoupling) is the natural follow-on when revenue justifies the scope. The same `lib/resilience/*` primitives will extend there.
