# Tier 0 Supabase Resilience — Design Spec

**Date:** 2026-04-17
**Status:** Draft, awaiting plan
**Predecessors:** None — foundational work for the three-tier resilience plan in `memory/project_resilience_plan.md`.

---

## 1. Goal

Build the Tier 0 layer of the Supabase-downtime resilience plan:

- **Circuit breaker + retry-with-backoff** at the Supabase client layer, so every server-side Supabase call gets automatic retry + fail-fast behavior without requiring per-route opt-in.
- **Public `/api/health` endpoint** that reports breaker state, enabling both in-app banners and external monitoring services.
- **Global resilience banner** mounted app-wide that surfaces two distinct states: 🟠 Service degraded (server up, Supabase down) vs 🔴 Can't reach server (client offline).
- **Dispatcher-specific stale indicator** — extend the existing `LiveIndicator` pill from 2 states (Live / Offline) to 3 (Live / Stale / Offline) with a relative-time label.

**Scope:** ~1 day of focused work. Foundation for Tier 1 (offline PWA + auth decoupling) which extends the same concepts.

**Why now:** the DNS saga during Plan G3 (router port-53 hijacking → Node DNS timeouts → 10-second login failures → total app unusable) was a dry run of a real Supabase outage. Tier 0 turns the 10-second pile-ups into <1ms fail-fast rejections with user-visible honest feedback, which is the gap between "app is broken and hanging" and "app is degraded but gracefully telling you so."

---

## 2. Hard constraints

| Aspect | Rule |
|---|---|
| Zero auth changes | Login still routes through Supabase Auth. Tier 0 doesn't touch the auth mechanism; it just fails fast when Supabase is unreachable. |
| Zero schema changes | No migrations, no new DB tables. Everything is server-process memory + transient state. |
| No new dependencies | Use only Node stdlib + React + existing packages. Roll our own circuit breaker (~100 LoC) for full control and to avoid dependency churn. |
| Backwards-compatible API routes | Existing handlers must continue to work. Breaker interception is transparent unless the breaker trips, in which case handlers see a typed `ResilienceError` they can convert to 503. |
| Single-process breaker state | Each Next.js server process maintains its own breaker state in memory. Correct behavior for serverless scaling; each instance is independently probing Supabase. No shared cache, no Redis. |
| Server-side only | Browser-side Supabase calls (primarily Realtime subscriptions) stay wrapped by the existing `LiveIndicator`. Direct browser→Supabase HTTP (if any) is Tier 1 scope. |

---

## 3. Architecture

### 3.1 File structure

```
lib/resilience/                              (NEW directory)
  ├─ circuit-breaker.js        (~60 LoC)    CircuitBreaker class + state machine
  ├─ retry.js                  (~30 LoC)    withRetry(fn, opts) wrapper
  ├─ supabase-wrapper.js       (~40 LoC)    wraps Supabase client with retry + breaker
  └─ errors.js                 (~15 LoC)    ResilienceError typed errors
                                            ('CIRCUIT_OPEN', 'RETRIES_EXHAUSTED', 'TIMEOUT')

lib/supabase.js                (modified)   exports pass through supabase-wrapper
lib/supabase-server.js         (modified)   wraps createServerClient output

pages/api/health.js            (NEW, ~30 LoC)
  GET → { status, breaker, supabase_last_ok_at, version }
  200 when breaker closed, 503 when open/half-open

components/resilience/                       (NEW directory)
  ├─ ResilienceBanner.js       (~70 LoC)    Top-of-app banner with 3 states (hidden, degraded, disconnected)
  └─ useResilienceHealth.js    (~40 LoC)    Hook that polls /api/health on 30s interval

pages/_app.js                  (modified)   mounts <ResilienceBanner /> at root

components/dispatcher/LiveIndicator.js       (modified — extends to 3 states + lastFetchedAt)
components/dispatcher/DispatcherBoard.js     (modified — passes lastFetchedAt from fetch hook)
```

### 3.2 Circuit breaker state machine

```
       ┌─────────┐   N failures   ┌──────┐
       │ CLOSED  │─────in window──▶│ OPEN │
       └─────────┘                 └──────┘
            ▲                         │
            │ test call succeeds      │ cooldownMs elapsed
            │                         ▼
            │                   ┌───────────┐
            └───────────────────│ HALF-OPEN │
               test call fails  └───────────┘
                (→ OPEN, reset timer)
```

**Configuration defaults:**
```js
makeBreaker({
  failureThreshold: 3,     // N consecutive failures in window → open
  windowMs: 10_000,        // sliding failure window (not fixed)
  cooldownMs: 30_000,      // open → half-open after this long
  callTimeoutMs: 5_000,    // individual Supabase call timeout
})
```

**Retry-then-breaker call order:**
```
request → withRetry(2 retries, [100ms, 500ms]) → withCircuitBreaker → real Supabase client
```

Retry sits inside the breaker, so each breaker "failure" represents 3 real attempts (1 + 2 retries). The `failureThreshold: 3` is "3 bursts of 3 attempts each" = 9 actual attempts before tripping. Transient hiccups get plenty of room to recover without spuriously tripping.

**What counts as a failure:**
- Network error (DNS, ECONNREFUSED, TLS, connection reset)
- Supabase returns 5xx
- Individual call exceeds `callTimeoutMs` (5s)

**What does NOT count as a failure:**
- 4xx responses (auth denial, validation, RLS denial — these are client bugs or legitimate rejections, not backend outages)
- `PGRST116` "no rows" errors (normal)
- Successful responses with application-level errors in the body

**OPEN state:**
- Calls reject immediately with `ResilienceError('CIRCUIT_OPEN')`.
- Millisecond rejection, no network roundtrip — the whole point.

**HALF-OPEN state:**
- Exactly ONE in-flight probe allowed. Other concurrent calls get `CIRCUIT_OPEN`.
- Probe succeeds → close breaker. Probe fails → re-open, reset 30s timer.

### 3.3 Supabase wrapper

The nuance: Supabase's JS client uses a lazy builder pattern. `supabase.from('loads').select('*').eq(...)` returns a `PostgrestQueryBuilder` — no HTTP fires until you `await` it or call `.then()`. Wrapping a plain function is easy; wrapping a lazy builder requires intercepting `.then()`.

**Approach:** intercept at the `from()` / `rpc()` level via a Proxy, returning a builder that wraps the terminal `.then()` with retry + breaker.

```js
// Pseudocode
function wrap(client) {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'from' || prop === 'rpc') {
        return (...args) => wrapBuilder(target[prop](...args));
      }
      return Reflect.get(target, prop);
    },
  });
}

function wrapBuilder(builder) {
  const originalThen = builder.then.bind(builder);
  builder.then = (onFulfilled, onRejected) => {
    return withRetry(() => withCircuitBreaker(() => originalThen(r => r)))
      .then(onFulfilled, onRejected);
  };
  return builder;
}
```

**NOT wrapped:** `/api/health` deliberately bypasses the wrapper. It reports breaker state directly via `.state()` — otherwise a tripped breaker would also hide the health endpoint from external monitors.

### 3.4 Health endpoint contract

```
GET /api/health
  (no auth required)

Response — healthy:
  HTTP 200
  {
    "status": "ok",
    "breaker": "closed",
    "supabase_last_ok_at": "2026-04-17T14:32:18Z",
    "version": "abc1234"
  }

Response — degraded:
  HTTP 503
  {
    "status": "degraded",
    "breaker": "open" | "half-open",
    "supabase_last_ok_at": "2026-04-17T14:29:03Z",
    "version": "abc1234"
  }
```

**Why HTTP status codes (200 vs 503) AND a body status field:**
1. External monitoring services (UptimeRobot, Better Uptime, Vercel Analytics) auto-detect 503 as unhealthy — alerting for free.
2. CDN / edge cache won't cache a 503.
3. In-app JavaScript uses the body field for finer-grained state (e.g., showing `breaker: 'half-open'` differently from `breaker: 'open'` later if we want).

### 3.5 Global banner — `<ResilienceBanner />`

Fixed-position thin strip at the top of the viewport, mounted in `pages/_app.js`. Three visible states (+ hidden):

| State | Color | Copy |
|---|---|---|
| hidden | — | banner not rendered |
| 🟠 degraded | amber | `Service degraded — data may be stale. Updates may fail until we recover.` · `Last healthy: 3 min ago` · `[Learn more ↗]` |
| 🔴 disconnected | red | `Can't reach server — check your internet connection.` · `Retrying in 15s` · `[Retry now →]` |

**Polling behavior (via `useResilienceHealth` hook):**
- 30-second interval
- `AbortController` per request; cancels previous on cleanup
- Pauses when `document.hidden` is true (tab backgrounded); resumes on `visibilitychange`
- Immediate poll on mount
- Debounce: requires 2 consecutive same-state responses before flipping the banner (prevents flicker from a single dropped poll)
- On recovery: shows `✅ Service restored` for 5 seconds before hiding

**Accessibility:**
- `role="status"` + `aria-live="polite"` so screen readers announce state changes
- Keyboard-focusable `[Retry now →]` button
- Non-dismissible by default (it's informational; add collapse in follow-up if users ask)

**Z-index:** above all page content, below modals. Never covers a dialog the user is working in.

### 3.6 Dispatcher stale indicator

Existing `LiveIndicator.js` extends from 2 states to 3:

| State | Pill color | Label | When |
|---|---|---|---|
| 🟢 Live | emerald | `Live` | Realtime connected AND last fetch < 60s ago |
| 🟡 Stale | amber | `Stale · 3 min` | Realtime disconnected OR last fetch > 60s ago, but we have data |
| ⚪ Offline | gray | `Offline · 12 min` | No data yet, or last fetch > 5 min ago |

**New prop:** `lastFetchedAt: number | null` — millisecond timestamp of the last successful loads fetch. Owned by the fetch hook (`useRealtimeLoads` or similar).

**Tooltip expands each state:**
- Live: `Real-time updates enabled. Last refresh: just now.`
- Stale: `Not receiving live updates. Last refresh: 3 minutes ago. Data may be out of date.`
- Offline: `No connection to live data. Showing cached snapshot from 12 minutes ago.`

**Label updates every 30s** via an interval in the component, so the relative-time label ticks over without needing upstream re-renders.

**Coupling to breaker:** when the circuit is open, HTTP fetches fail fast → `lastFetchedAt` stops advancing → pill drifts Live → Stale → Offline naturally as time passes.

---

## 4. Edge cases and error handling

**1. API route helper for 503 conversion.** A helper `lib/resilience/api-helper.js` wraps the common pattern:

```js
// lib/resilience/api-helper.js
export async function handleWithResilience(res, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === 'CIRCUIT_OPEN') {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        retryAfter: err.cooldownMsRemaining,
      });
    }
    throw err; // fall through to existing 500 handler
  }
}
```

API routes opt in by wrapping their handler body with this helper. NOT required — routes without the helper still benefit from retry + fail-fast; they just return generic 500s when the breaker is open.

**2. Login flow during outage.** Login is high-stakes. When Supabase is down:
- First 3 login attempts each do 3 retries with 5s timeout = ~15s each, frustrating.
- After 3 failures (~45s worst case), breaker opens. Subsequent logins fail in <1ms with `CIRCUIT_OPEN`.
- Login page catches `CIRCUIT_OPEN` and shows: `Authentication service is temporarily unavailable. Try again in 30s.`
- The global banner also shows, reinforcing the app-wide state.

**3. Startup race.** On boot, breaker starts `closed` with empty history. First request experiences full 15s timeout if Supabase is already down. Acceptable one-time cost per process start.

**4. Concurrent probe.** Only ONE in-flight probe in HALF-OPEN. Concurrent calls during probe reject with `CIRCUIT_OPEN`. Prevents thundering herd on recovery.

**5. Health endpoint failure.** If `fetch('/api/health')` itself fails (client offline, Vercel down, dev server crashed):
- Banner shows 🔴 Can't reach server
- Copy emphasizes the USER's side of the wire ("check your internet connection")
- Retries automatically with backoff; `[Retry now →]` button forces immediate retry

**6. `lastFetchedAt` update flow.** The HTTP fetch in the loads hook updates `lastFetchedAt` on success; on failure (breaker reject, network error, timeout), value doesn't advance. The pill reflects the drift naturally.

**7. Realtime subscription vs HTTP.** These are independent failure modes. Realtime could work while HTTP fails, or vice versa. The pill's logic combines both: Live requires BOTH Realtime connected AND fresh HTTP; any degradation on either side → Stale.

**8. Test coverage.**

The app currently has no automated test infrastructure — verification happens via manual QA + Cowork walkthroughs. Tier 0's core logic (`circuit-breaker.js`, `retry.js`) is pure, deterministic, and has clear behavior boundaries — ideal for tests if we decide to introduce a test runner. Two options:

- **Option A (aspirational):** introduce a minimal test runner (e.g., Vitest) scoped to `lib/resilience/*` only. Tests cover state transitions, thresholds, sliding windows, concurrent probe lockout. Plan treats this as a separate final task; skip if it adds scope pressure.
- **Option B (pragmatic, default):** no automated tests. Manual verification per Success Criteria section (simulate Supabase outage by firewalling the hostname on the dev machine; walk through breaker transitions and banner states). Matches the app's current discipline. This is the default unless the plan's execution surfaces a specific reason to introduce testing.

Either option is fine for Tier 0 as long as manual verification covers the Success Criteria.

---

## 5. Out of scope

Explicit guardrails — these are Tier 1 / Tier 2 work:

- **Offline-first caching / PWA** — no IndexedDB, no service worker, no "keep working while disconnected." Tier 0 tells you things are broken and fails fast; Tier 1 keeps you working with cached data.
- **Decoupling auth from Supabase** — login still requires a healthy Supabase connection. Tier 1.
- **Read replicas / hot standby / multi-region** — single Supabase, single point of failure. Tier 2.
- **Client-side (browser) circuit breaker** — server-side wrapping only. Browser Realtime already has `LiveIndicator`; direct browser→Supabase HTTP is Tier 1 PWA scope.
- **Persisting breaker state across process restarts** — each process starts fresh. Correct for serverless; do not add persistence.
- **Per-operation breaker tuning** — single global breaker for all Supabase traffic. If we later want "stricter for writes," that's a Tier 0.5 enhancement.
- **Status page** — banner's `[Learn more ↗]` link points to a placeholder. Real status page is a separate small project.
- **Alerting / on-call setup** — `/api/health`'s 503 response enables external services to alert; configuring those services is an ops task, not a code task.

---

## 6. Success criteria

A reviewer (or the user) can:

1. Kill Supabase network connectivity (e.g., firewall the hostname on the dev box) and watch dispatcher-board HTTP calls transition from 10-second timeouts to <1ms `CIRCUIT_OPEN` rejections after 3 failures.
2. Restore connectivity and observe the breaker half-open after 30s, then close after a successful probe.
3. Open `/api/health` in a browser and see correct `200 ok` / `503 degraded` responses reflecting current breaker state.
4. Load the app while Supabase is unreachable and see 🟠 Service degraded banner within 30 seconds.
5. Unplug Wi-Fi and see banner flip to 🔴 Can't reach server.
6. On dispatcher board: watch `LiveIndicator` pill transition 🟢 Live → 🟡 Stale · 1 min → ⚪ Offline · 6 min as a fetch-failing scenario progresses.
7. A dispatcher who had the page open before the outage can STILL SEE the loads they had loaded — just with clear indicators not to trust them as real-time.
8. `npm run build` clean. No new lint errors introduced.
9. Banner renders correctly in dark mode + at zoom 80 / 100 / 125%.
10. Unit tests pass: circuit-breaker state machine, retry backoff, health endpoint status-code mapping.

---

## 7. Open questions

None at design time. All resolved during brainstorming:

- Q: Where does the breaker wrapping happen? **A: Supabase client layer — ambient coverage, no per-route opt-in.**
- Q: Scope of the banner? **A: Global app-wide (hybrid with dispatcher-specific stale indicator). Two states: Service degraded vs Can't reach server.**
- Q: What decides "degraded"? **A: Circuit breaker state reported by `/api/health`. No active DB probe — the breaker is observing real traffic already.**
- Q: How does the client detect state changes? **A: 30-second polling interval. Pauses when tab hidden. Debounced (2 consecutive same-state responses before flipping).**
- Q: Roll-our-own vs library? **A: Roll our own — ~100 LoC, zero deps, tunable, reviewable in one sitting. Tier 1 PWA will extend the same patterns.**
- Q: Browser vs server wrapping? **A: Server-side only for Tier 0. Browser coverage is Tier 1 PWA scope.**
